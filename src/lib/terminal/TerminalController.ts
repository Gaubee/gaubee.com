/**
 * xterm.js 终端控制器：管理 Terminal 实例 + readline 循环。
 *
 * 职责：
 * - 持有 Terminal + FitAddon 实例（每个 TerminalView 一个）
 * - 维护会话状态：cwd / history / currentLine / cursorPos
 * - 处理 onData 键盘流：可打印字符、Enter、Backspace、方向键、Ctrl+A/C/E/L、Tab
 * - 回车后调 runLine 执行命令，输出回写 xterm
 *
 * 设计参考 openspecui web/terminal-controller.ts 的"命令式控制器"模式，
 * 但极简化（单会话、无 WebSocket、无 PTY）。
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { Vfs } from "$lib/vfs/vfs";
import { vfs } from "$lib/vfs/vfs";
import {
  ANSI,
  prettyCwd,
  runLine,
  tabComplete,
  type CommandContext,
} from "./shell";

const DEFAULT_CWD = "src/content";
const HISTORY_KEY = "gaubee:terminal-history";
const HISTORY_MAX = 200;

export interface TerminalControllerOptions {
  /** VFS 单例（默认导出的 vfs）。允许注入便于测试。 */
  vfs?: Vfs;
  /** 初始 cwd。 */
  cwd?: string;
  /** 主题：light/dark。 */
  theme?: "light" | "dark";
}

export class TerminalController {
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private cwd: string;
  private readonly vfsInstance: Vfs;

  // readline 状态
  private currentLine = "";
  private cursorPos = 0;
  private busy = false;

  // 命令历史
  private history: string[] = [];
  private historyIdx = -1; // -1 表示当前行（未从历史选择）

  theme: "light" | "dark";

  constructor(opts: TerminalControllerOptions = {}) {
    this.vfsInstance = opts.vfs ?? vfs;
    this.cwd = opts.cwd ?? DEFAULT_CWD;
    this.theme = opts.theme ?? "dark";
    this.history = this.loadHistory();
  }

  // -------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------

  mount(container: HTMLElement): void {
    if (this.terminal) return; // 幂等
    this.container = container;

    this.terminal = new Terminal({
      cols: 80,
      rows: 12,
      cursorBlink: true,
      fontFamily:
        '"IBM Plex Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      allowTransparency: true,
      theme: this.theme === "dark" ? DARK_THEME : LIGHT_THEME,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(container);

    // 适配容器宽度
    try {
      this.fitAddon.fit();
    } catch {
      // 容器尚未布局完成，忽略
    }

    this.terminal.onData((data) => this.handleData(data));
    this.terminal.attachCustomKeyEventHandler(() => true); // 让 xterm 接收所有键

    // 容器尺寸变化时重排
    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this.resizeObserver.observe(container);

    this.writeWelcome();
    this.newPrompt();
    this.terminal.focus();
  }

  unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
    this.container = null;
  }

  /** 重新适配终端尺寸（容器变化时调用）。 */
  fit(): void {
    try {
      this.fitAddon?.fit();
    } catch {
      // 忽略
    }
  }

  focus(): void {
    this.terminal?.focus();
  }

  /** 切换暗/亮主题。 */
  setTheme(theme: "light" | "dark"): void {
    this.theme = theme;
    if (this.terminal) {
      this.terminal.options.theme = theme === "dark" ? DARK_THEME : LIGHT_THEME;
    }
  }

  // -------------------------------------------------------------------
  // 输出辅助
  // -------------------------------------------------------------------

  private write(s: string): void {
    this.terminal?.write(s);
  }

  private writeLine(s = ""): void {
    this.write(s + "\r\n");
  }

  private writeErr(s: string): void {
    this.write(`${ANSI.red}${s}${ANSI.reset}\r\n`);
  }

  private writeWelcome(): void {
    this.writeLine(
      `${ANSI.cyan}${ANSI.bold}Gaubee 终端${ANSI.reset} — 纯前端 bash（基于 VFS）`,
    );
    this.writeLine(
      `${ANSI.gray}输入 help 查看命令。↑↓ 切换历史，Tab 补全。${ANSI.reset}`,
    );
    this.writeLine("");
  }

  // -------------------------------------------------------------------
  // Prompt
  // -------------------------------------------------------------------

  private promptString(): string {
    return `${ANSI.green}gaubee${ANSI.reset}:${ANSI.blue}${prettyCwd(this.cwd)}${ANSI.reset}$ `;
  }

  /** 新起一行画 prompt（不擦除已有内容）。 */
  private newPrompt(): void {
    this.currentLine = "";
    this.cursorPos = 0;
    this.historyIdx = -1;
    this.write(this.promptString());
  }

  /**
   * 重绘当前输入行：回到行首、清到行尾、重写 prompt + currentLine，
   * 再把光标移到 cursorPos 位置。
   */
  private redrawLine(): void {
    if (!this.terminal) return;
    // \r 回到行首；\x1b[K 清除从光标到行尾
    this.write(`\r\x1b[K${this.promptString()}${this.currentLine}`);
    // 把光标移到正确位置：从行尾向左移动 (length - cursorPos)
    const tail = this.currentLine.length - this.cursorPos;
    if (tail > 0) {
      this.write(`\x1b[${tail}D`);
    }
  }

  // -------------------------------------------------------------------
  // onData 处理（键盘流）
  // -------------------------------------------------------------------

  private handleData(data: string): void {
    if (this.busy) return; // 命令执行中，忽略输入

    // 多字符控制序列（方向键等）
    // ESC [ A = 上，B = 下，C = 右，D = 左
    // ESC [ 3 ~ = Delete
    // ESC [ H = Home, F = End（部分终端）
    // ESC OH / OF = Home/End（xterm）
    if (data.startsWith("\x1b")) {
      this.handleEscapeSequence(data);
      return;
    }

    // Ctrl 组合（data 是单字节控制字符）
    // \x03 = Ctrl+C, \x04 = Ctrl+D, \x0c = Ctrl+L, \x01 = Ctrl+A, \x05 = Ctrl+E, \x15 = Ctrl+U, \x0b = Ctrl+K, \x08 = Ctrl+H(=Backspace)
    switch (data) {
      case "\r": // Enter
        this.handleEnter();
        return;
      case "\x03": // Ctrl+C
        this.write("^C");
        this.writeLine("");
        this.newPrompt();
        return;
      case "\x04": // Ctrl+D
        if (this.currentLine === "") {
          this.writeLine(`${ANSI.gray}（用 Ctrl+W 关闭标签页）${ANSI.reset}`);
          this.newPrompt();
        }
        return;
      case "\x0c": // Ctrl+L
        this.terminal?.clear();
        this.newPrompt();
        return;
      case "\x01": // Ctrl+A 行首
        this.cursorPos = 0;
        this.redrawLine();
        return;
      case "\x05": // Ctrl+E 行尾
        this.cursorPos = this.currentLine.length;
        this.redrawLine();
        return;
      case "\x15": // Ctrl+U 删除到行首
        this.currentLine = this.currentLine.slice(this.cursorPos);
        this.cursorPos = 0;
        this.redrawLine();
        return;
      case "\x0b": // Ctrl+K 删除到行尾
        this.currentLine = this.currentLine.slice(0, this.cursorPos);
        this.redrawLine();
        return;
      case "\x17": // Ctrl+W 删除前一个单词
        this.deleteWordBackward();
        return;
      case "\x7f": // Backspace（部分键盘）
      case "\x08": // Ctrl+H
        this.handleBackspace();
        return;
      case "\t": // Tab
        void this.handleTab();
        return;
    }

    // 普通可打印字符（可能一次多个，如粘贴/输入法）
    if (data >= " " && !data.startsWith("\x1b")) {
      this.insertAtCursor(data);
    }
  }

  private handleEscapeSequence(data: string): void {
    switch (data) {
      case "\x1b[A": // ↑
        this.historyPrev();
        return;
      case "\x1b[B": // ↓
        this.historyNext();
        return;
      case "\x1b[C": // →
        if (this.cursorPos < this.currentLine.length) {
          this.cursorPos++;
          this.write("\x1b[C");
        }
        return;
      case "\x1b[D": // ←
        if (this.cursorPos > 0) {
          this.cursorPos--;
          this.write("\x1b[D");
        }
        return;
      case "\x1b[H": // Home
      case "\x1bOH":
        this.cursorPos = 0;
        this.redrawLine();
        return;
      case "\x1b[F": // End
      case "\x1bOF":
        this.cursorPos = this.currentLine.length;
        this.redrawLine();
        return;
      case "\x1b[3~": // Delete
        if (this.cursorPos < this.currentLine.length) {
          this.currentLine =
            this.currentLine.slice(0, this.cursorPos) +
            this.currentLine.slice(this.cursorPos + 1);
          this.redrawLine();
        }
        return;
      default:
        // 忽略其他转义序列（如 Shift+方向键、F1-F12）
        return;
    }
  }

  private insertAtCursor(text: string): void {
    this.currentLine =
      this.currentLine.slice(0, this.cursorPos) +
      text +
      this.currentLine.slice(this.cursorPos);
    this.cursorPos += text.length;
    // 重绘（处理多字符/中间插入）
    this.redrawLine();
  }

  private handleBackspace(): void {
    if (this.cursorPos === 0) return;
    this.currentLine =
      this.currentLine.slice(0, this.cursorPos - 1) +
      this.currentLine.slice(this.cursorPos);
    this.cursorPos--;
    this.redrawLine();
  }

  private deleteWordBackward(): void {
    if (this.cursorPos === 0) return;
    // 从 cursorPos 往前跳过空格，再跳过一个非空格段
    let i = this.cursorPos;
    while (i > 0 && this.currentLine[i - 1] === " ") i--;
    while (i > 0 && this.currentLine[i - 1] !== " ") i--;
    this.currentLine =
      this.currentLine.slice(0, i) + this.currentLine.slice(this.cursorPos);
    this.cursorPos = i;
    this.redrawLine();
  }

  // -------------------------------------------------------------------
  // 历史
  // -------------------------------------------------------------------

  private historyPrev(): void {
    if (this.history.length === 0) return;
    if (this.historyIdx === -1) {
      // 第一次按 ↑：保存当前行，跳到最新历史
      this.historyIdx = this.history.length - 1;
    } else if (this.historyIdx > 0) {
      this.historyIdx--;
    } else {
      return; // 已经在最旧的历史
    }
    this.currentLine = this.history[this.historyIdx] ?? "";
    this.cursorPos = this.currentLine.length;
    this.redrawLine();
  }

  private historyNext(): void {
    if (this.historyIdx === -1) return; // 没在历史中
    this.historyIdx++;
    if (this.historyIdx >= this.history.length) {
      // 超出最新：恢复到当前行
      this.historyIdx = -1;
      this.currentLine = "";
    } else {
      this.currentLine = this.history[this.historyIdx];
    }
    this.cursorPos = this.currentLine.length;
    this.redrawLine();
  }

  // -------------------------------------------------------------------
  // Tab 补全
  // -------------------------------------------------------------------

  private async handleTab(): Promise<void> {
    const ctx = this.makeCtx();
    const candidates = await tabComplete(ctx, this.currentLine);
    if (candidates.length === 0) {
      return;
    }
    if (candidates.length === 1) {
      // 唯一匹配：替换最后一个 token
      this.applyCompletion(candidates[0]);
      return;
    }
    // 多匹配：显示候选，重画 prompt
    this.writeLine("");
    this.writeLine(candidates.map((c) => `  ${c}`).join("  "));
    this.redrawLine();
  }

  private applyCompletion(replacement: string): void {
    // replacement 是完整 token（含可能的前缀路径）。替换 currentLine 最后一个 token。
    const trimmed = this.currentLine;
    const lastSpace = trimmed.lastIndexOf(" ");
    const prefix = lastSpace >= 0 ? trimmed.slice(0, lastSpace + 1) : "";
    // 若补全的是目录且只有一个候选，加个斜杠继续；文件则加空格
    const endsWithSlash = replacement.endsWith("/");
    this.currentLine = prefix + replacement + (endsWithSlash ? "" : " ");
    this.cursorPos = this.currentLine.length;
    this.redrawLine();
  }

  // -------------------------------------------------------------------
  // 执行
  // -------------------------------------------------------------------

  private async handleEnter(): Promise<void> {
    const line = this.currentLine;
    this.writeLine(""); // 换行
    if (line.trim()) {
      this.pushHistory(line);
    }
    this.busy = true;
    try {
      const ctx = this.makeCtx();
      const result = await runLine(ctx, line);
      if (result.newCwd !== null) {
        this.cwd = result.newCwd;
      }
    } catch (e) {
      this.writeErr(`内部错误：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.busy = false;
      this.newPrompt();
    }
  }

  /** 构造 CommandContext（write 直通到 xterm）。 */
  private makeCtx(): CommandContext {
    return {
      cwd: this.cwd,
      vfs: this.vfsInstance,
      write: (s) => this.write(s),
      // writeErr 套 ANSI 红色（符合 CommandContext 接口契约）
      writeErr: (s) => this.write(`${ANSI.red}${s}${ANSI.reset}`),
      clear: () => {
        this.terminal?.clear();
      },
    };
  }

  // -------------------------------------------------------------------
  // 历史持久化
  // -------------------------------------------------------------------

  private loadHistory(): string[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
    } catch {
      return [];
    }
  }

  private pushHistory(line: string): void {
    // 去重连续相同
    if (this.history[this.history.length - 1] === line) return;
    this.history.push(line);
    if (this.history.length > HISTORY_MAX) {
      this.history = this.history.slice(-HISTORY_MAX);
    }
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    } catch {
      // 忽略配额/隐私模式错误
    }
  }

  /** 清空历史（供测试/重置用）。 */
  clearHistory(): void {
    this.history = [];
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // 忽略
    }
  }

  // -------------------------------------------------------------------
  // 移动端输入条 API（TerminalView 调用）
  // -------------------------------------------------------------------

  /** 从外部输入条提交一行（等价于用户在 xterm 输入并回车）。 */
  submitFromInputBar(text: string): void {
    if (this.busy) return;
    // 把 text 显示为当前输入（如同用户敲入），再触发 Enter
    this.currentLine = text;
    this.cursorPos = text.length;
    this.redrawLine();
    void this.handleEnter();
  }

  /** 模拟按键（供输入条发送 Ctrl+C / Tab 等）。 */
  sendRaw(data: string): void {
    this.handleData(data);
  }
}

// ---------------------------------------------------------------------------
// xterm 主题（与 app.css 的语义色对齐）
// ---------------------------------------------------------------------------

const DARK_THEME = {
  background: "#00000000", // 透明，跟随宿主 bg
  foreground: "#e5e5e5",
  cursor: "#e5e5e5",
  cursorAccent: "#1a1a1a",
  selectionBackground: "#ffffff33",
  black: "#1a1a1a",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e5e5e5",
  brightBlack: "#737373",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
};

const LIGHT_THEME = {
  background: "#00000000",
  foreground: "#1a1a1a",
  cursor: "#1a1a1a",
  cursorAccent: "#ffffff",
  selectionBackground: "#00000022",
  black: "#1a1a1a",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#e5e5e5",
  brightBlack: "#737373",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#ffffff",
};
