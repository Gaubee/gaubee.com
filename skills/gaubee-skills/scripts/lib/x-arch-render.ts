/**
 * x-arch-render.ts — x-arch-* 卡片共享渲染器（2026-10-09 从 x-archive-events.ts 原样抽出）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-09] X 内容管道统一（kzf 裁决）：日报卡片化——X 日报（x-daily-events.ts）
 *   与历史归档（x-archive-events.ts）共用同一套 x-arch-* HTML 卡片渲染，保证两种
 *   event 视觉与交互一致；本模块只做纯渲染，不读盘不落盘。
 * - 抽取范围 = x-archive-events.ts 原函数逐字搬移（escapeHtml/localDateOf/hhmm/
 *   TAG_RULES/classifyTags/KIND_META/richText/inlineText/itemCard），新增
 *   renderDayBody(items, opts) 产 x-arch-meta 统计行 + x-arch-day 包裹块。
 * - [2026-10-09] 捕捉 v2：itemCard 支持 entry.thread（同作者线程链按段渲染，段间
 *   x-arch-thread-sep 分隔；原推文链接仍指互动条目自身；译文对拼接全文生效）。
 * - [2026-10-09] 全库纠正：译文取值 translations[id] ?? t.xTrans——xTrans（--all 纠正
 *   收割的 X 译文，存 x.json 条目，不进 translations 文件）存在即同样出 译/原 toggle。
 * - [2026-10-09] 事件应用对齐：原推文外链 ↗ 换 lucide arrow-up-right 标准图标（裁决 3）；
 *   作者锚点注入 data-name/data-avatar 供 hover 用户卡 action 消费（裁决 4）；
 *   inlineText linkify 加 new URL 防线（截断/非法 URL 降级纯文本，护 prerender 构建）。
 *
 * 契约引用：
 * - canonical media key `cdn-media/x/<月>/<文件>`（cdn-media-bootstrap Phase 3 语义冻结），
 *   正文引用一律拼 `/${p}` = `/cdn-media/...`（R1 路径契约：永不绑定存储域名）。
 * - 译文切换：双段 toggle 组（译|原），双 radio 零 JS（kzf 裁决 15 + 2026-10-06 走查）。
 */

export interface Tweet {
  id: string;
  text: string;
  created_at: string;
  kind: "posted" | "reposted" | "liked" | "bookmarked";
  author?: string;
  // Phase 3（cdn-media-bootstrap，2026-10-07）语义冻结：值为 canonical media key
  // `cdn-media/x/<月>/<文件>`（原 `x-media/<月>/<文件>`），正文引用一律拼
  // `/${p}` = `/cdn-media/x/...`（R1 路径契约：永不绑定存储域名）。
  mediaLocal?: string[];
  videoLocal?: string[];
  posterLocal?: string;
  // 捕捉 v2（kzf 2026-10-09）：同作者线程链（最早部分→本条，含自身；x-media-backfill
  // 走链产出，>1 段才写）。存在时正文按段渲染，段间插 x-arch-thread-sep 分隔。
  thread?: { id: string; text: string; created_at?: string }[];
  // 全库纠正（2026-10-09）：x-media-backfill --all 收割的 X 译文（存量被污染条目的
  // 原中文）。存在且 translations 无该 id 时作为译文出 译/原 toggle。
  xTrans?: string;
}

export interface AuthorInfo {
  name?: string;
  avatar?: string;
}

export type MediaMeta = Record<string, { w: number; h: number; ms?: number }>;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** UTC ISO → 本地时区 YYYY-MM-DD */
export function localDateOf(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 5);
}

/** 内容 tag 分类器（kzf 2026-10-05 裁决：归档基于内容加合理 tag）。
 *  按当日全部正文命中关键词计数，取最多的前 3 个；命中不足 1 次的规则不入选。 */
export const TAG_RULES: [RegExp, string][] = [
  [/\b(rust|wasm|webassembly|zig|cargo|crab)\b|rust 代码|Rust 写/i, "rust"],
  [/\b(react|svelte|vue|frontend|front-end|css|tailwind|html|browser|web api|canvas)\b/i, "frontend"],
  [/\b(ai|llm|gpt|claude|gemini|agent|openai|anthropic|deepseek|moonbit|model|prompt|kimi|glm)\b|模型|智能体|大语言/i, "ai"],
  [/\b(database|postgres|mysql|sqlite|redis|sql|duckdb|存储)\b/i, "database"],
  [/\b(docker|kubernetes|k8s|self-?host|devops|deploy|server|nginx|vps)\b|自托管|部署/i, "devops"],
  [/\b(apple|ios|macos|swift|iphone|ipad|vision ?pro|airpods)\b|苹果/i, "apple"],
  [/\b(python|django|flask|pandas)\b/i, "python"],
  [/\b(game|gameplay|游戏|扫雷|roguelike|像素)\b/i, "game"],
  [/\b(design|动效|设计|typography|字体|icon|排版)\b/i, "design"],
  [/\b(security|加密|encrypt|cve|密码学)\b/i, "security"],
  [/\b(video|ffmpeg|player|播放器|视频)\b/i, "media"],
  [/\b(mcp|skill|coding agent|cli|terminal|终端)\b/i, "agent-tooling"],
];

export function classifyTags(items: Tweet[]): string[] {
  const hits = new Map<string, number>();
  for (const t of items) {
    const text = `${t.text ?? ""}`;
    for (const [re, tag] of TAG_RULES) {
      const m = text.match(re);
      if (m) hits.set(tag, (hits.get(tag) ?? 0) + m.length);
    }
  }
  return [...hits.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);
}

/** kind → 有色图标（lucide path，kzf 2026-10-05 裁决：icon 替代文字） */
export const KIND_META: Record<Tweet["kind"], { label: string; paths: string[] }> = {
  liked: {
    label: "赞",
    paths: ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"],
  },
  posted: {
    label: "发",
    paths: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"],
  },
  reposted: {
    label: "转",
    paths: ["m17 2 4 4-4 4", "M3 11v-1a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3"],
  },
  bookmarked: {
    label: "藏",
    paths: ["m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"],
  },
};

/** 正文富文本：``` 围栏转代码块（microlighter 高亮），URL 自动包裹成链接（kzf 裁决 12/13） */
export function richText(raw: string): string {
  const parts: string[] = [];
  const fenceRe = /```(?:\w+)?\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw))) {
    if (m.index > last) parts.push(inlineText(raw.slice(last, m.index)));
    parts.push(`<pre class="x-arch-code" data-language="js"><code>${escapeHtml(m[1].replace(/\n$/, ""))}</code></pre>`);
    last = m.index + m[0].length;
  }
  if (last < raw.length) parts.push(inlineText(raw.slice(last)));
  return parts.join("\n");
}

export function inlineText(s: string): string {
  const escaped = escapeHtml(s).replace(/\n/g, "<br />");
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (m) => {
    // X 展示层截断 URL（… 结尾）与 new URL 校验不过的一律降级纯文本：这类 href 会让
    // SvelteKit prerender 的链接爬取 new URL(href) 抛 Invalid URL 直接炸构建
    // （实证 00490 `https://dash.yl0.me…`，2026-10-09）
    if (m.endsWith("…") || m.endsWith("...")) return m;
    try {
      new URL(m);
    } catch {
      return m;
    }
    return `<a href="${m}" target="_blank" rel="noopener">${m}</a>`;
  });
}

export function itemCard(
  t: Tweet,
  authors: Record<string, AuthorInfo>,
  translations: Record<string, string>,
  mediaMeta: MediaMeta,
): string {
  const author = t.author || "gaubeebangeel";
  const statusUrl = `https://x.com/${author}/status/${t.id}`;
  const time = hhmm(t.created_at);
  const parts: string[] = [];
  const avatar = authors[author]?.avatar;
  const avatarImg = avatar
    ? `<img class="x-arch-avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : "";
  const meta = KIND_META[t.kind];
  const kindIcon =
    `<span class="x-arch-kind x-arch-kind-${t.kind}" aria-label="${meta.label}" title="${meta.label}">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    meta.paths.map((d) => `<path d="${d}" />`).join("") +
    `</svg></span>`;
  // 译文：translations 文件优先，回退条目自带 xTrans（全库纠正收割，2026-10-09）
  const translation = translations[t.id] ?? t.xTrans;
  // 译文切换（kzf 裁决 15 + 2026-10-06 走查）：双段 toggle 组（译|原），双 radio 零 JS，
  // 默认选中「译」；name 按推文 id 隔离，避免跨条目互斥
  const langInputs = translation
    ? `<input type="radio" name="xl-${t.id}" id="xl-${t.id}-zh" class="x-arch-lang-input x-arch-lang-input-zh" checked aria-label="显示译文" />` +
      `<input type="radio" name="xl-${t.id}" id="xl-${t.id}-orig" class="x-arch-lang-input x-arch-lang-input-orig" aria-label="显示原文" />`
    : "";
  const langSwitch = translation
    ? `<span class="x-arch-lang-switch" role="group" aria-label="切换原文/译文">` +
      `<label for="xl-${t.id}-zh" class="x-arch-lang-opt x-arch-lang-zh">译</label>` +
      `<label for="xl-${t.id}-orig" class="x-arch-lang-opt x-arch-lang-orig">原</label></span>`
    : "";
  // hover 用户卡（kzf 2026-10-09 裁决 4）：作者数据经 data-* 注入渲染产物，消费端
  // authorHoverCard action（author-hover-card.ts）读取；两者皆缺时消费端优雅降级不浮卡
  const info = authors[author];
  const authorData =
    (info?.name ? ` data-name="${escapeHtml(info.name)}"` : "") +
    (info?.avatar ? ` data-avatar="${escapeHtml(info.avatar)}"` : "");
  parts.push(
    `    ${langInputs}<div class="x-arch-head">${avatarImg}${kindIcon}` +
      `<a class="x-arch-author" href="https://x.com/${author}" target="_blank" rel="nofollow noopener"${authorData}>@${escapeHtml(author)}</a>` +
      `<span class="x-arch-time">${time}</span>` +
      langSwitch +
      `<a class="x-arch-link" href="${statusUrl}" target="_blank" rel="noopener">原推文` +
      // 外链标准图标（kzf 裁决 3）：lucide arrow-up-right，替代文字箭头 ↗，与 KIND_META 同族内联 SVG
      `<svg class="x-arch-ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10" /><path d="M7 17 17 7" /></svg></a></div>`,
  );
  // 线程链（捕捉 v2）：按段渲染，段间插分隔（⤵ + 细线缩进，样式见 x-archive.css）；
  // 原推文链接始终指向互动条目自身（statusUrl 用 t.id，不随线程根变）
  const threadParts = (t.thread ?? []).filter((p) => (p.text ?? "").trim());
  const threadSep = `<div class="x-arch-thread-sep" aria-label="接上文">⤵</div>`;
  const origHtml =
    threadParts.length > 1
      ? threadParts.map((p) => richText(p.text.trim())).join(`\n    ${threadSep}\n    `)
      : richText((t.text ?? "").trim());
  if (origHtml && translation) {
    parts.push(`    <div class="x-arch-text x-arch-orig">${origHtml}</div>`);
    // 译文对拼接全文生效（translations[id] 是整条推文的译文，toggle 逻辑不变）
    parts.push(`    <div class="x-arch-text x-arch-trans">${richText(translation)}</div>`);
  } else if (origHtml) {
    parts.push(`    <div class="x-arch-text">${origHtml}</div>`);
  }
  const imgs = (t.mediaLocal ?? []).filter((p) => !p.endsWith(".mp4"));
  if (imgs.length) {
    parts.push(`    <div class="x-arch-media">`);
    for (let i = 0; i < imgs.length; i++) {
      const p = imgs[i]!;
      const size = mediaMeta[p];
      const dims = size ? ` width="${size.w}" height="${size.h}"` : "";
      parts.push(
        `      <a href="/${p}" target="_blank" rel="noopener"><img class="x-arch-img" src="/${p}" alt="@${escapeHtml(author)} 的配图 ${i + 1}/${imgs.length}" loading="lazy" decoding="async"${dims} /></a>`,
      );
    }
    parts.push(`    </div>`);
  }
  const video = (t.videoLocal ?? [])[0];
  if (video) {
    const poster = t.posterLocal ? ` poster="/${t.posterLocal}"` : "";
    const vsize = mediaMeta[video];
    const dims = vsize ? ` width="${vsize.w}" height="${vsize.h}" data-duration="${Math.round((vsize.ms ?? 0) / 1000)}"` : "";
    parts.push(
      `    <video class="x-arch-video" preload="none" playsinline${poster} src="/${video}"${dims} aria-label="@${escapeHtml(author)} 的视频"></video>`,
    );
  }
  return `  <div class="x-arch-item">\n${parts.join("\n")}\n  </div>`;
}

/** 一天的卡片块：x-arch-meta 统计行 + x-arch-day 包裹（2026-10-09 新增，供
 *  x-archive-events.ts 与 x-daily-events.ts 共用；渲染口径与抽取前逐字节一致） */
export function renderDayBody(
  items: Tweet[],
  opts: {
    authors: Record<string, AuthorInfo>;
    translations: Record<string, string>;
    mediaMeta: MediaMeta;
  },
): string {
  const { authors, translations, mediaMeta } = opts;
  const imgCount = items.reduce((n, t) => n + (t.mediaLocal ?? []).filter((p) => !p.endsWith(".mp4")).length, 0);
  const vidCount = items.reduce((n, t) => n + (t.videoLocal?.length ?? 0), 0);
  const cards = items.map((t) => itemCard(t, authors, translations, mediaMeta)).join("\n");
  return [
    `<div class="x-arch-meta">${items.length} 条动态 · 图 ${imgCount} · 视频 ${vidCount}</div>`,
    `<div class="x-arch-day">`,
    cards,
    `</div>`,
  ].join("\n");
}
