/**
 * GitHub unified diff patch 解析器。
 *
 * GitHub commit API 返回的 files[].patch 是 unified diff 文本：
 * ```
 * @@ -10,7 +10,12 @@ function foo() {
 *   const a = 1;
 * -  const b = 2;
 * +  const b = 3;
 * ```
 *
 * 本解析器把它拆成结构化行数组，供模板逐行着色渲染：
 * - hunk-header：@@ ... @@（灰色背景）
 * - add：+ 开头（绿色 bg-emerald-500/10）
 * - del：- 开头（红色 bg-destructive/10）
 * - context：空格开头（默认色）
 */

export type PatchLineType = "hunk-header" | "add" | "del" | "context";

export interface PatchLine {
  type: PatchLineType;
  /** 行内容（不含前缀 +/-/空格）。 */
  text: string;
  /** 旧行号（context/del 有，add 无）。 */
  oldLine?: number;
  /** 新行号（context/add 有，del 无）。 */
  newLine?: number;
}

/**
 * 解析 unified diff patch 文本为结构化行数组。
 * 空字符串返回空数组。无 patch（文件太大被 GitHub 省略）返回空数组。
 */
export function parsePatch(patch: string): PatchLine[] {
  if (!patch) return [];
  const lines = patch.split("\n");
  const result: PatchLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      result.push({ type: "hunk-header", text: line });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", text: line.slice(1), newLine: newLine++ });
    } else if (line.startsWith("-")) {
      result.push({ type: "del", text: line.slice(1), oldLine: oldLine++ });
    } else if (line.startsWith(" ") || line === "") {
      // 空行可能是 patch 末尾的空行，当作 context
      result.push({
        type: "context",
        text: line.startsWith(" ") ? line.slice(1) : "",
        oldLine: line.startsWith(" ") ? oldLine++ : undefined,
        newLine: line.startsWith(" ") ? newLine++ : undefined,
      });
    } else if (line.startsWith("\\ No newline at end of file")) {
      // 特殊标记，忽略
      continue;
    }
  }
  return result;
}
