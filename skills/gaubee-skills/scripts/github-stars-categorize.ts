#!/usr/bin/env bun
/**
 * github-stars-categorize.ts — 星标分类规则与全量索引（source: github-stars）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：全面理解收藏 + 每天新星标自动归类。
 * - 1. 分类规则唯一声明源：CATEGORIES（数组顺序即优先级，首条命中即止）
 * - 2. --stats：打印各分类数量分布（调参用）
 * - 3. --suggest [DATE]：对某日变更（默认今天）的新增星标输出「repo → 建议分类」
 * - 4. --build-catalog：重建 data/sources/github-stars/catalog.md（全量索引，按分类分组）
 *
 * 运行：bun scripts/github-stars-categorize.ts <mode>
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { localDate, sourceDir, writeFileAtomic, type Snapshot, type StarRepo } from "./lib.ts";

const SRC = sourceDir("github-stars");

export interface Category {
  name: string;
  hint: string; // 一句话定位，写进 taxonomy/catalog
  match: (r: StarRepo) => boolean;
}

const inTopics = (r: StarRepo, ...kw: string[]) => kw.some((k) => r.topics.includes(k));
const inText = (r: StarRepo, ...kw: string[]) => {
  const t = `${r.full_name} ${r.description} ${r.homepage}`.toLowerCase();
  return kw.some((k) => t.includes(k));
};
const inLang = (r: StarRepo, ...langs: string[]) => langs.includes(r.language);

/**
 * 分类规则（kzf 收藏实证调参，2026-10-03，1639 项）。
 * 注意：typescript/javascript 只是书写语言不是主题——不为它们设分类，按仓库主题归类。
 */
export const CATEGORIES: Category[] = [
  {
    name: "AI Agent 与编码助手",
    hint: "MCP、agent 框架、skills、coding agent、computer-use、AI IDE——把 LLM 变成干活的同事",
    match: (r) =>
      inTopics(
        r,
        "mcp",
        "agent-skills",
        "ai-agents",
        "ai-agent",
        "agents",
        "claude-code",
        "computer-use",
        "ai-tools",
        "coding-agent",
        "ai-agent-framework",
        "ai-sre",
      ) ||
      inText(
        r,
        "mcp server",
        "model context protocol",
        "claude code",
        "claude-code",
        "coding agent",
        "ai agent",
        "agentic",
        "ai ide",
        "computer use",
        "agent skill",
        "ai sre",
        "agents",
        "skills",
      ),
  },
  {
    name: "AI/LLM 模型与应用",
    hint: "模型、推理、RAG、prompt、AI 应用与工作台",
    match: (r) =>
      inTopics(
        r,
        "ai",
        "llm",
        "openai",
        "rag",
        "diffusion",
        "inference",
        "local-llm",
        "gpt",
        "chatgpt",
        "prompt",
        "prompt-engineering",
        "deep-learning",
        "machine-learning",
        "transformers",
        "ollama",
        "stable-diffusion",
        "text-to-image",
        "speech",
        "tts",
        "whisper",
        "embedding-models",
        "screenshot-to-code",
      ) ||
      inText(
        r,
        "llm",
        "large language model",
        "language model",
        "openai",
        "anthropic",
        "gemini",
        "rag",
        "prompt",
        "diffusion",
        "embedding",
        "multimodal",
        "screenshot-to-code",
        "screenshot to code",
        "扩散模型",
        "大模型",
      ),
  },
  {
    name: "编译器、解析器与编程语言",
    hint: "compiler/parser/grammar/语言实现——理解代码如何被读懂和生成",
    match: (r) =>
      inTopics(
        r,
        "compiler",
        "parser",
        "grammar",
        "programming-language",
        "interpreter",
        "transpiler",
        "lexer",
        "ast",
        "syntax",
        "language-server",
        "lsp",
      ) ||
      inText(
        r,
        "compiler",
        "parser",
        "parsing",
        "interpreter",
        "programming language",
        "tree-sitter",
        "语法分析",
      ),
  },
  {
    name: "前端框架与 UI 组件",
    hint: "react/vue/svelte 生态、组件库、headless UI、应用框架",
    match: (r) =>
      inTopics(
        r,
        "react",
        "vue",
        "svelte",
        "angular",
        "solid",
        "nextjs",
        "nuxt",
        "preact",
        "qwik",
        "astro",
        "ui",
        "ui-components",
        "component-library",
        "ui-kit",
        "shadcn",
        "headless-ui",
        "frontend",
        "widgets",
        "design-system",
        "radix-ui",
        "tailwindcss",
        "tailwind",
        "web-components",
        "webcomponent",
      ) ||
      inText(
        r,
        "react component",
        "vue component",
        "svelte",
        "ui component",
        "component library",
        "headless ui",
        "shadcn",
        "web component",
        "layout",
      ),
  },
  {
    name: "样式、动效与可视化",
    hint: "css、svg、动画、图表、图形学、字体——像素层面的手艺",
    match: (r) =>
      inTopics(
        r,
        "css",
        "svg",
        "animation",
        "animations",
        "chart",
        "charts",
        "data-visualization",
        "visualization",
        "threejs",
        "webgl",
        "webgpu",
        "canvas",
        "icon",
        "icons",
        "design",
        "gradient",
        "shader",
        "typography",
        "font",
        "fonts",
      ) ||
      inText(
        r,
        "css framework",
        "css-in-js",
        "animation library",
        "data visualization",
        "chart library",
        "webgl",
        "icon set",
      ),
  },
  {
    name: "Web 工程化与工具链",
    hint: "构建、打包、monorepo、测试、lint、包管理、AI 代码评审——kzf 的 viteplus 主场",
    match: (r) =>
      inTopics(
        r,
        "vite",
        "webpack",
        "rollup",
        "esbuild",
        "bundler",
        "monorepo",
        "testing",
        "testing-tools",
        "unit-testing",
        "e2e-testing",
        "lint",
        "linter",
        "eslint",
        "formatter",
        "code-formatting",
        "package-manager",
        "build-tools",
        "developer-tools",
        "devtools",
        "storybook",
        "static-analysis",
        "code-review",
      ) ||
      inText(
        r,
        "build tool",
        "bundler",
        "monorepo",
        "test framework",
        "e2e test",
        "linting",
        "code formatter",
        "package manager",
        "code review tool",
        "开发工具链",
      ),
  },
  {
    name: "终端与 CLI",
    hint: "cli、terminal、tui、shell——命令行里的生产力",
    match: (r) =>
      inTopics(
        r,
        "cli",
        "terminal",
        "tui",
        "shell",
        "command-line",
        "commandline",
        "zsh",
        "fish",
        "console",
      ) || inText(r, "command line", "command-line", "terminal ", "tui ", "shell script"),
  },
  {
    name: "数据与存储",
    hint: "数据库、sqlite、搜索引擎、ORM——数据落在哪里、怎么查",
    match: (r) =>
      inTopics(
        r,
        "database",
        "sqlite",
        "sql",
        "postgresql",
        "mysql",
        "redis",
        "mongodb",
        "vector-database",
        "search-engine",
        "full-text-search",
        "orm",
        "query-builder",
        "storage",
        "key-value",
        "embedded-database",
        "meilisearch",
        "typesense",
        "lucene",
      ) ||
      inText(
        r,
        "database",
        "sqlite",
        "search engine",
        "full-text search",
        "vector search",
        "vector similarity",
        "similarity search",
        "tantivy",
        "向量数据库",
      ),
  },
  {
    name: "网络、P2P 与分布式",
    hint: "p2p、webrtc、quic、crdt、同步、消息——去中心化与实时协作",
    match: (r) =>
      inTopics(
        r,
        "p2p",
        "peer-to-peer",
        "webrtc",
        "webtorrent",
        "crdt",
        "distributed-systems",
        "distributed",
        "networking",
        "quic",
        "libp2p",
        "iot",
        "mqtt",
        "nat",
        "hole-punching",
        "decentralized",
        "federation",
      ) ||
      inText(
        r,
        "peer-to-peer",
        "p2p network",
        "crdt",
        "distributed system",
        "real-time sync",
        "hole punching",
        "局域网",
      ),
  },
  {
    name: "Rust / WASM / 系统编程",
    hint: "rust 生态、webassembly、性能敏感的系统级工程",
    match: (r) =>
      inTopics(r, "rust", "wasm", "webassembly", "systems-programming", "wasi") ||
      (inLang(r, "Rust", "Zig") && inText(r, "rust", "wasm", "webassembly", "系统编程")) ||
      (inLang(r, "C", "C++") && inText(r, "wasm", "webassembly")),
  },
  {
    name: "浏览器与 Web 平台",
    hint: "browser 扩展、引擎、自动化（playwright/puppeteer）、web api",
    match: (r) =>
      inTopics(
        r,
        "browser",
        "browser-extension",
        "chrome",
        "chrome-extension",
        "firefox",
        "chromium",
        "web-extension",
        "userscript",
        "automation",
        "web-api",
        "dom",
      ) ||
      inText(
        r,
        "browser extension",
        "headless browser",
        "browser automation",
        "playwright",
        "puppeteer",
        "chromium",
        "浏览器",
      ),
  },
  {
    name: "移动开发",
    hint: "android、ios、kmp、flutter、compose multiplatform",
    match: (r) =>
      inTopics(
        r,
        "android",
        "ios",
        "kotlin",
        "kotlin-multiplatform",
        "kmp",
        "swift",
        "swiftui",
        "flutter",
        "jetpack-compose",
        "react-native",
        "mobile",
        "mobile-development",
        "android-app",
        "ios-app",
      ) || inLang(r, "Kotlin", "Swift", "Dart", "Objective-C"),
  },
  {
    name: "业务系统与中文生态",
    hint: "电商/支付/小程序/微信公众号等业务型项目与中文生态工具",
    match: (r) =>
      inTopics(
        r,
        "ecommerce",
        "e-commerce",
        "mall",
        "payment",
        "payments",
        "wechat",
        "weixin",
        "mini-program",
        "wechatapp",
        "wechat-mini-program",
      ) ||
      inText(
        r,
        "电商",
        "商城",
        "支付",
        "小程序",
        "微信公众号",
        "闲鱼",
        "ecommerce",
        "mall system",
        "payment system",
      ),
  },
  {
    name: "自托管、桌面与效率软件",
    hint: "self-hosted 服务、electron/tauri 桌面应用、launcher、工作流自动化",
    match: (r) =>
      inTopics(
        r,
        "self-hosted",
        "selfhosted",
        "macos",
        "windows",
        "linux",
        "cross-platform",
        "electron",
        "tauri",
        "desktop-app",
        "launcher",
        "productivity",
        "workflow",
        "automation-tool",
        "app",
      ) ||
      inText(
        r,
        "self-hosted",
        "self hosted",
        "desktop app",
        "electron app",
        "tauri",
        "macos app",
        "menu bar",
        "menubar",
        "效率工具",
      ),
  },
  {
    name: "知识管理、Markdown 与编辑器",
    hint: "markdown、笔记、wiki、富文本编辑器、文档",
    match: (r) =>
      inTopics(
        r,
        "markdown",
        "editor",
        "notes",
        "note-taking",
        "knowledge-base",
        "knowledge-management",
        "wiki",
        "obsidian",
        "documentation",
        "wysiwyg",
        "rich-text-editor",
        "text-editor",
        "code-editor",
      ) ||
      inText(
        r,
        "markdown editor",
        "markdown parser",
        "note-taking",
        "rich text editor",
        "text editor",
        "knowledge base",
        "second brain",
      ),
  },
  {
    name: "媒体、图形与创意编码",
    hint: "音视频处理、图像、生成艺术、游戏——创造性的那一半",
    match: (r) =>
      inTopics(
        r,
        "video",
        "audio",
        "ffmpeg",
        "image-processing",
        "graphics",
        "game",
        "gamedev",
        "creative-coding",
        "generative-art",
        "music",
        "photo",
        "video-editing",
        "media",
        "animation",
        "spritesheet",
      ) ||
      inText(
        r,
        "video editor",
        "video rendering",
        "video game",
        "audio processing",
        "image processing",
        "image editor",
        "game engine",
        "generative art",
        "music video",
        "音乐",
        "视频",
      ),
  },
  {
    name: "安全与密码学",
    hint: "加密、认证、密码管理、隐私",
    match: (r) =>
      inTopics(
        r,
        "security",
        "cryptography",
        "encryption",
        "authentication",
        "oauth",
        "password-manager",
        "privacy",
        "2fa",
        "jwt",
      ) ||
      inText(r, "encryption", "cryptography", "password manager", "end-to-end encryption", "认证"),
  },
  {
    name: "学习资源与清单",
    hint: "awesome、教程、面试、书籍、博客——收藏里的图书馆",
    match: (r) =>
      inTopics(
        r,
        "awesome",
        "awesome-list",
        "tutorial",
        "tutorials",
        "learning",
        "cheatsheet",
        "cheat-sheet",
        "resources",
        "interview",
        "book",
        "books",
        "roadmap",
        "curated-list",
        "blog",
      ) ||
      inText(
        r,
        "awesome-",
        "curated list",
        "cheat sheet",
        "interview questions",
        "learning resource",
        "roadmap",
        "weekly digest",
        "textbook",
        "电子书",
        "教程",
        "面试",
      ),
  },
  {
    name: "早期收藏（考古区）",
    hint: "2017 年以前的收藏——jQuery/html5 时代的参考与记忆，按历史价值检索",
    match: (r) => r.starred_at !== "" && r.starred_at < "2018-01-01",
  },
  {
    name: "未分类",
    hint: "等一双眼睛给它安家",
    match: () => true,
  },
];

export function categorize(r: StarRepo): Category {
  return CATEGORIES.find((c) => c.match(r))!;
}

async function loadStars(): Promise<Snapshot> {
  return JSON.parse(await Bun.file(path.join(SRC, "stars.json")).text());
}

async function main() {
  const mode = process.argv[2];

  if (mode === "--stats") {
    const s = await loadStars();
    const counts = new Map<string, number>();
    for (const r of s.repos) {
      const c = categorize(r).name;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    for (const c of CATEGORIES) console.log(`${counts.get(c.name) ?? 0}\t${c.name}`);
  } else if (mode === "--suggest") {
    const date = process.argv[3] ?? localDate();
    const file = Bun.file(path.join(SRC, "changes", `${date}.json`));
    if (!(await file.exists())) {
      console.error(`no changes file for ${date}（先跑 github-stars-diff.ts）`);
      process.exit(1);
    }
    const { added } = await file.json();
    for (const r of added) {
      console.log(`${r.full_name}\t${categorize(r).name}\t${r.description || "(无描述)"}`);
    }
  } else if (mode === "--build-catalog") {
    const s = await loadStars();
    const groups = new Map<string, StarRepo[]>();
    for (const c of CATEGORIES) groups.set(c.name, []);
    for (const r of s.repos) groups.get(categorize(r).name)!.push(r);
    const lines: string[] = [
      `# 星标全量索引（机器生成，勿手改）`,
      "",
      `> 共 ${s.count} 项 · 生成于 ${new Date().toISOString()} · 账号 @${s.user}`,
      `> 重建：bun scripts/github-stars-categorize.ts --build-catalog · 分类定义见本脚本 CATEGORIES`,
      "",
    ];
    for (const c of CATEGORIES) {
      const repos = groups.get(c.name)!;
      lines.push(`## ${c.name}（${repos.length} 项）`, "", `> ${c.hint}`, "");
      lines.push(
        ...repos.map(
          (r) =>
            `- [${r.full_name}](${r.html_url}) — ${r.description || "(无描述)"} [${r.language || "?"}]⭐${r.stars}`,
        ),
      );
      lines.push("");
    }
    mkdirSync(SRC, { recursive: true });
    writeFileAtomic(path.join(SRC, "catalog.md"), lines.join("\n"));
    console.log(
      `written ${path.join(SRC, "catalog.md")} (${s.count} repos, ${CATEGORIES.length} categories)`,
    );
  } else {
    console.error("usage: github-stars-categorize.ts --stats | --suggest [DATE] | --build-catalog");
    process.exit(2);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
