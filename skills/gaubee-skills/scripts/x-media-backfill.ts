#!/usr/bin/env bun
/**
 * x-media-backfill.ts — 历史 X 动态的正文/媒体回灌（syndication 公开接口，免登录）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-05] kzf：动态 event 要图文视频齐全、墙内可读；时间线抽取只能覆盖近期窗口，
 *   历史条目靠 syndication tweet-result 逐条补：正文全文 + 图片 + mp4 变体直链（免 yt-dlp）。
 * - 1. 遍历库存中无 synChecked 标记的条目，拉 syndication 富化（text/media/video/author/时间）
 * - 2. 媒体落 cdn-media/staging/x/YYYY-MM/（canonical key 布局，media-pack --source 输入；
 *   Phase 3 起不进主仓 git，打卷上 GitHub Releases 后由 cdn-base 分发）；x.json 记
 *   canonical media key `cdn-media/x/YYYY-MM/...`（不再兼任 staging 路径）
 * - 3. 幂等可续跑：每 50 条落盘一次（writeFileAtomic 镜像进 vault）；已处理条目标记 synChecked
 * - 4. 本地磁盘护栏：staging 累计下载超 --max-gb（默认 4.5）即停下载、只留元数据
 *   （R6 红线检查本体已移到 cron 的缓存水位/远端用量，这里只护本地盘）
 *
 * 运行：bun scripts/x-media-backfill.ts [--limit N] [--no-download] [--max-gb 4.5] [--ids id1,id2] [--all]
 *   --all 全库纠正模式：遍历全部条目（忽略 synChecked；已带 enrichedV2 的跳过=断点续跑），
 *   每条做原文纠正（翻译污染/前缀截断）+ t.co 展开 + 线程走链 + 头像 + 新媒体下载；
 *   配 --limit N 先金丝雀。
 * 前置：~/.gaubee-skills/data/sources/x-likes/x.json 已由 x-archive-import / x-likes-fetch 建立
 *
 * 捕捉 v2（kzf 2026-10-09 裁决：头像覆盖 + 线程链 + 原文强制）：
 * - 原文保证：条目带 xTranslated: true（捕捉层点到 X 译文）→ 即使已 synChecked 也重拉
 *   syndication 用原文覆盖 text；富化后清 xTranslated、保留 xTrans（X 译文收割复用）
 * - 头像 upsert：每次 fetchSyn 成功把 user.screen_name 新增/更新进 authors.json
 *   （_bigger 档，读改写原子落盘；已存在以新值更新，缺失即补）
 * - 线程链：富化时扫 entities 展开链接，命中同作者 status 链接即沿链收集（向上/向下都走，
 *   方向按 created_at 判，root=最早；上限 20 层、防环、失败即止拿多少拼多少），产出
 *   entry.thread = [{id, text, created_at?}]（最早→本条，含自身；段文本剔除链内互链）
 * - --ids a,b,c：强制重富化指定条目（忽略 synChecked），供已富化条目补线程/头像
 * - [2026-10-09] --all 全库纠正（kzf 裁决：管道向前修复之后，存量也要处理纠正）：
 *   遍历全部条目（忽略 synChecked，跳过已带 enrichedV2 的=断点续跑依据），每条一次
 *   fetchSyn 复用做五类纠正：a 原文纠正（翻译污染→text 换 orig、原中文收割进 xTrans；
 *   前缀截断→text 换 orig；皆非→不动）+ b t.co 短链按 entities 展开 + c walkThread
 *   线程走链 + d 头像 upsert + e 新媒体下载（既有 canonical key 逻辑与 --max-gb 护栏）。
 *   处理完打标 enrichedV2: true；失败逐条计数不中断；--limit N 先金丝雀
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { localDate, sourceDir, writeFileAtomic } from "./lib.ts";

const SRC = sourceDir("x-likes");
// token 参数必填但值任意（实测空值返回空对象）；固定一个随机串即可
const TOKEN = "gaubee-skills-x1";
const UA = "Mozilla/5.0 gaubee-skills";

interface Tweet {
  id: string;
  text: string;
  created_at: string;
  kind: "posted" | "reposted" | "liked" | "bookmarked";
  author?: string;
  media?: string[];
  video?: string[];
  hasVideo?: boolean;
  mediaLocal?: string[];
  videoLocal?: string[];
  synChecked?: boolean; // syndication 回灌已处理（无论成败，防重跑）
  // 捕捉 v2（kzf 2026-10-09）：翻译态标记 + X 译文收割 + 线程链
  xTranslated?: boolean; // 捕捉时 X 自动翻译态：text 待 syndication 原文覆盖，富化后清除
  xTrans?: string; // X 自动译文收割（原文覆盖后保留，供译文复用）
  thread?: ThreadPart[]; // 同作者线程链（最早部分→本条，含自身；>1 段才写）
  // --all 全库纠正（2026-10-09）：该条已按 v2 口径纠正过（原文/t.co/线程/头像/媒体），
  // 审计与断点续跑依据——--all 跳过已标条目，不再重复打 syndication
  enrichedV2?: boolean;
}

/** 线程链的一段（渲染器按 parts 顺序拼接，段间插 x-arch-thread-sep） */
export interface ThreadPart {
  id: string;
  text: string;
  created_at?: string;
}

/** syndication 拉取器（注入用）：null=永久不可见，undefined=网络性失败 */
export type SynFetcher = (id: string) => Promise<any | null | undefined>;

/** 头像条目（authors.json 值） */
export interface AuthorRec {
  name?: string;
  avatar?: string;
}

interface XStore {
  updated_at: string;
  user: { id: string; username: string };
  cursors: Record<string, unknown>;
  items: Record<string, Tweet>;
}

interface SynMedia {
  media_url_https?: string;
  type?: string;
  video_info?: {
    duration_millis?: number;
    variants?: { content_type?: string; url: string; bitrate?: number }[];
  };
}

/** 挑 mp4 变体：≤720p 里优先高码率，但预估体积（bitrate×duration）超 190MB 的降档
 *  ——单文件须能装进 media-pack 单卷（200MiB 上限留 tar 头/对齐余量；
 *  Phase 3 起媒体不进 git，原 100MB push 红线作废） */
function pickMp4(videoInfo: SynMedia["video_info"]): string | null {
  const mp4 = (videoInfo?.variants ?? []).filter((v) => v.content_type === "video/mp4");
  if (!mp4.length) return null;
  const durS = (videoInfo?.duration_millis ?? 0) / 1000;
  const withMeta = mp4.map((v) => ({
    url: v.url,
    h: Number(v.url.match(/\/(\d+)x(\d+)\//)?.[2] ?? 0),
    bitrate: (v as { bitrate?: number }).bitrate ?? 0,
  }));
  const estBytes = (v: { bitrate: number }) => (v.bitrate / 8) * durS;
  const fit = withMeta.filter(
    (v) => v.h > 0 && v.h <= 720 && (estBytes(v) === 0 || estBytes(v) < 190 * 1024 ** 2),
  );
  const pool = fit.length ? fit : withMeta.slice().sort((a, b) => estBytes(a) - estBytes(b));
  return pool.sort((a, b) => (b.h - a.h) || (b.bitrate - a.bitrate))[0]!.url;
}

async function fetchSyn(id: string): Promise<any | null> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=zh&token=${TOKEN}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429) {
        await Bun.sleep(15_000);
        continue;
      }
      if (res.status === 404) return null; // 删除/不可见，永久性
      if (!res.ok) {
        await Bun.sleep(2_000);
        continue;
      }
      const data = (await res.json()) as any;
      return data?.id_str ? data : null;
    } catch {
      await Bun.sleep(3_000);
    }
  }
  return undefined; // 网络性失败：不标记，下次重试
}

/** syndication 返回的正文带 HTML 实体（&amp; &lt; &#39; 等），入库前解码为真实字符。
 *  &amp; 放最后替换，避免 &amp;lt; 被二次解码。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** 清理推文正文：t.co 链接换成真实 URL，媒体占位链接直接删除，实体解码 */
function cleanText(text: string, entities: any): string {
  let out = text;
  for (const u of entities?.urls ?? []) {
    if (u.url && u.expanded_url) out = out.replaceAll(u.url, u.expanded_url);
  }
  for (const m of entities?.media ?? []) {
    if (m.url) out = out.replaceAll(m.url, "");
  }
  return decodeEntities(out.trim());
}

// ---------- 原文纠正判定（--all 全库纠正，2026-10-09；纯函数供测试） ----------

/** CJK 占比高（kzf 口径）：中文字符 >30% 或 >6 个 */
function cjkHigh(s: string): boolean {
  const n = (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return n > s.length * 0.3 || n > 6;
}

/** 原文纠正判定：存量 text 与 syndication 原文 orig 不一致时分类处置。
 *  - "pollution"：存量 CJK 占比高而 orig 非 CJK 主导 → X 自动翻译污染
 *    （browser 抓到的是 X 译文）——text 应换 orig，存量中文收割为 xTrans；
 *  - "truncated"：存量是 orig 的前缀截断（len 更短且 orig 以存量前 80 字符开头）
 *    ——text 应换 orig；
 *  - "none"：两者皆非（如中文作者的中文原文）→ text 不动。
 *  orig 为空或与存量一致时恒为 none。 */
export function classifyTextCorrection(
  stored: string,
  orig: string,
): { action: "pollution" | "truncated" | "none"; xTrans?: string } {
  if (!orig || orig === stored) return { action: "none" };
  if (cjkHigh(stored) && !cjkHigh(orig)) return { action: "pollution", xTrans: stored };
  if (stored.length < orig.length && orig.startsWith(stored.slice(0, 80))) {
    return { action: "truncated" };
  }
  return { action: "none" };
}

// ---------- 线程走链（捕捉 v2，2026-10-09；纯函数，fetcher 注入供测试） ----------

const STATUS_RE = (screenName: string) =>
  new RegExp(`^https://(?:x|twitter)\\.com/${screenName}/status/(\\d+)`);
// screen_name 字符集为 [A-Za-z0-9_]，不含正则元字符，无需转义

/** 从 syndication entities 提取同作者 status 链接（展开 URL 命中即算，
 *  含 entities.urls 与 entities.media；去重保序）。 */
export function sameAuthorStatusLinks(
  syn: any,
  screenName: string,
): { id: string; expanded: string; tco: string }[] {
  const out: { id: string; expanded: string; tco: string }[] = [];
  if (!screenName) return out;
  const seen = new Set<string>();
  const re = STATUS_RE(screenName);
  const push = (expanded: unknown, tco: unknown) => {
    if (typeof expanded !== "string") return;
    const m = expanded.match(re);
    if (!m) return;
    const id = m[1]!;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, expanded, tco: typeof tco === "string" ? tco : "" });
  };
  for (const u of syn?.entities?.urls ?? []) push(u.expanded_url, u.url);
  for (const u of syn?.entities?.media ?? []) push(u.expanded_url, u.url);
  return out;
}

/** 段正文：cleanText 后剔除指向链内其它部分的链接（t.co 已被 cleanText 换成展开 URL，
 *  按 status id 删；指向自身的保留——媒体占位已在 cleanText 删过）。 */
export function threadPartText(syn: any, chainIds: Set<string>, selfId: string): string {
  let out = cleanText(String(syn?.text ?? ""), syn?.entities);
  for (const id of chainIds) {
    if (id === selfId) continue;
    out = out.replaceAll(
      new RegExp(`https://(?:x|twitter)\\.com/[^\\s/]+/status/${id}(?:/photo/\\d+|/video/\\d+)?`, "g"),
      "",
    );
  }
  return out.trim();
}

/** 线程走链：从 start 的 payload 出发，沿同作者 status 链接向上（更早）与向下（更晚）
 *  递归收集，方向按 created_at 判断（root=最早）。上限 maxParts 段（含起点自身）；
 *  visited 防环；单步拉取失败（null/undefined）该方向即止——拿多少拼多少，如实记录。
 *  产出：从最早部分到最晚（含起点），段文本已剔除链内互链。起点信息不全返回空数组。 */
export async function walkThread(
  start: any,
  fetcher: SynFetcher,
  maxParts = 20,
): Promise<ThreadPart[]> {
  const selfId = String(start?.id_str ?? "");
  const screenName = String(start?.user?.screen_name ?? "");
  if (!selfId || !screenName) return [];
  const visited = new Set<string>([selfId]);
  const up: any[] = []; // 越走越早：[较近, ..., 较远]
  const down: any[] = []; // 越走越晚：[较近, ..., 较远]
  // 方向试探失败的目标不记 visited（另一方向要复用），用 cache 保证同一 id 只拉一次
  const cache = new Map<string, any>();
  const fetchOnce: SynFetcher = async (id) => {
    if (cache.has(id)) return cache.get(id);
    const p = await fetcher(id);
    if (p?.id_str) cache.set(id, p);
    return p;
  };

  const walkDir = async (from: any, goingUp: boolean) => {
    let current = from;
    let currentDate = Date.parse(String(current?.created_at ?? "")) || 0;
    while (up.length + down.length < maxParts - 1) {
      const links = sameAuthorStatusLinks(current, screenName).filter((l) => !visited.has(l.id));
      if (!links.length) break;
      const target = links[0]!;
      const payload = await fetchOnce(target.id);
      if (!payload?.id_str) break; // 删除/网络失败：该方向即止（不计 visited，另一方向可再试）
      const d = Date.parse(String(payload.created_at ?? "")) || 0;
      if (goingUp ? d >= currentDate : d <= currentDate) break; // 方向不符（root=最早）
      visited.add(target.id);
      (goingUp ? up : down).push(payload);
      current = payload;
      currentDate = d;
    }
  };
  await walkDir(start, true);
  await walkDir(start, false);

  if (up.length + down.length === 0) return [];
  const syns = [...up.slice().reverse(), start, ...down];
  const chainIds = new Set(syns.map((s) => String(s.id_str)));
  return syns.map((s) => ({
    id: String(s.id_str),
    text: threadPartText(s, chainIds, String(s.id_str)),
    created_at: s.created_at ? String(s.created_at) : undefined,
  }));
}

// ---------- 头像 upsert（捕捉 v2；authors.json 读改写原子落盘） ----------

/** 新增/更新一个作者：头像 URL 归一 _bigger 档；已存在的以新值更新（新值为空不覆盖旧值），
 *  缺失即补。返回是否有变化。 */
export function upsertAuthor(
  authors: Record<string, AuthorRec>,
  user: any,
): boolean {
  const handle = String(user?.screen_name ?? "");
  if (!handle) return false;
  const raw = String(user?.profile_image_url_https ?? "");
  const avatar = raw ? raw.replace(/_normal(\.\w+)$/, "_bigger$1") : "";
  const name = typeof user?.name === "string" ? user.name : "";
  const prev = authors[handle];
  const next: AuthorRec = { name: name || prev?.name, avatar: avatar || prev?.avatar };
  if (prev?.name === next.name && prev?.avatar === next.avatar) return false;
  authors[handle] = next;
  return true;
}

/** authors.json 原子落盘（writeFileAtomic：.tmp 写入后 rename，无撕裂无残留） */
export function saveAuthors(authorsFile: string, authors: Record<string, AuthorRec>): void {
  writeFileAtomic(authorsFile, JSON.stringify(authors, null, 1));
}

async function download(url: string, abs: string): Promise<number> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 2000) throw new Error(`too small (${buf.length}B)`);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, buf);
  return buf.length;
}

async function main() {
  const argv = process.argv.slice(2);
  let limit = Infinity;
  let noDownload = false;
  let maxGb = 4.5;
  let allMode = false;
  const forceIds = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") limit = Number.parseInt(argv[++i] ?? "0", 10) || Infinity;
    else if (argv[i] === "--no-download") noDownload = true;
    else if (argv[i] === "--all") allMode = true;
    else if (argv[i] === "--max-gb") maxGb = Number.parseFloat(argv[++i] ?? "4.5") || 4.5;
    else if (argv[i] === "--ids")
      for (const s of (argv[++i] ?? "").split(",")) {
        const id = s.trim();
        if (id) forceIds.add(id);
      }
  }

  const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
  const storeFile = path.join(SRC, "x.json");
  if (!existsSync(storeFile)) {
    console.error("x.json 不存在（先跑 x-archive-import.ts / x-likes-fetch.ts）");
    process.exit(2);
  }
  const store: XStore = JSON.parse(await Bun.file(storeFile).text());
  // 待回灌优先级：--ids 强制清单 > --all 全库纠正（忽略 synChecked，跳过已纠正的
  // enrichedV2=断点续跑）> 默认（无 synChecked 的新条目 + 翻译态条目）
  const todo = forceIds.size
    ? ([...forceIds].map((id) => store.items[id]).filter((t) => Boolean(t)) as Tweet[])
    : allMode
      ? Object.values(store.items).filter((t) => !t.enrichedV2)
      : Object.values(store.items).filter((t) => !t.synChecked || t.xTranslated);
  console.error(
    `待回灌 ${todo.length} 条（库存 ${Object.keys(store.items).length}${forceIds.size ? `，--ids 强制 ${forceIds.size}` : ""}${allMode ? "，--all 全库纠正" : ""}）`,
  );

  // 头像 upsert（捕捉 v2）：随每次 fetchSyn 成功新增/更新，与库存同节奏落盘
  const authorsFile = path.join(SRC, "authors.json");
  const authors: Record<string, AuthorRec> = existsSync(authorsFile)
    ? JSON.parse(await Bun.file(authorsFile).text())
    : {};
  let authorsDirty = false;

  const maxBytes = maxGb * 1024 ** 3;
  let bytes = 0;
  let dlFiles = 0;
  let guardTripped = false;
  const stats = {
    ok: 0,
    unavailable: 0,
    netFail: 0,
    text: 0,
    mediaTweets: 0,
    videoTweets: 0,
    translated: 0,
    avatars: 0,
    threads: 0,
    synCalls: 0,
    // --all 全库纠正（2026-10-09）分类计数
    polluted: 0, // 翻译污染修复（= xTrans 收割数）
    truncated: 0, // 前缀截断补全
    placeholder: 0, // "(archive)"/空占位被真实原文替换
    tco: 0, // t.co 短链展开（按 entities 展开/媒体占位剔除）
  };

  // 线程走链的 fetcher：与主循环同一礼貌限速（每跳后 280ms），计数 syndication 调用
  const threadFetcher: SynFetcher = async (id) => {
    stats.synCalls++;
    const r = await fetchSyn(id);
    await Bun.sleep(280);
    return r;
  };

  const save = () => {
    store.updated_at = new Date().toISOString();
    writeFileAtomic(storeFile, JSON.stringify(store, null, 1));
    if (authorsDirty) {
      saveAuthors(authorsFile, authors);
      authorsDirty = false;
    }
  };

  const shutdown = () => {
    console.error(`\n中断：已处理进度已落盘（ok=${stats.ok} unavailable=${stats.unavailable}）`);
    save();
    process.exit(130);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  let processed = 0;
  for (const t of todo) {
    if (processed >= limit) break;
    processed++;

    stats.synCalls++;
    const syn = await fetchSyn(t.id);
    if (syn === undefined) {
      stats.netFail++;
      continue; // 不标记，下次重试
    }
    if (syn === null) {
      t.synChecked = true;
      // 翻译态条目已删除/不可见：原文无处可取，清标记防每轮重拉（X 译文留在 xTrans）
      delete t.xTranslated;
      // --all 全库纠正：404/不可见是永久终态，同样打标防断点续跑时反复重拉
      if (allMode) t.enrichedV2 = true;
      stats.unavailable++;
      continue;
    }

    // 头像 upsert（捕捉 v2）：每次 syndication 成功即新增/更新作者
    if (upsertAuthor(authors, syn.user)) {
      authorsDirty = true;
      stats.avatars++;
    }

    // 正文富化。捕捉 v2 原文保证：翻译态条目无条件用 syndication 原文覆盖
    //（X 译文留在 xTrans，富化后清 xTranslated）；其余按占位/更长才覆盖的旧规则。
    // --all 全库纠正（或 --ids 强制）：改走分类纠正——翻译污染收割 xTrans、
    // 前缀截断补全；皆非（如中文作者中文原文）text 不动
    const text = cleanText(String(syn.text ?? ""), syn.entities);
    const correctAll = allMode || forceIds.has(t.id);
    if (t.xTranslated) {
      stats.translated++;
      if (text && text !== t.text) stats.text++;
      if (text) t.text = text;
      delete t.xTranslated;
    } else if (text && (t.text === "(archive)" || t.text === "")) {
      // 占位规则（既有）：真实原文替换占位符
      if (text !== t.text) stats.text++;
      t.text = text;
      if (correctAll) stats.placeholder++;
    } else if (correctAll && text) {
      const cls = classifyTextCorrection(t.text, text);
      if (cls.action === "pollution") {
        // X 翻译污染：text 换原文，存量中文收割为 xTrans（已有 xTrans 不覆盖）
        if (!t.xTrans) t.xTrans = cls.xTrans;
        t.text = text;
        stats.polluted++;
      } else if (cls.action === "truncated") {
        t.text = text;
        stats.truncated++;
      }
    } else if (text && text.length > t.text.length) {
      if (text !== t.text) stats.text++;
      t.text = text;
    }
    // t.co 展开（全库纠正）：存量正文里的短链按 syndication entities 展开、媒体占位
    // 剔除（沿用既有 cleanText 规则）；污染/截断路径的 text 已是 cleanText 产物，此处为幂等
    if (correctAll && !t.xTranslated && t.text.includes("t.co")) {
      const fixed = cleanText(t.text, syn.entities);
      if (fixed && fixed !== t.text) {
        t.text = fixed;
        stats.tco++;
      }
    }
    if (!t.author && syn.user?.screen_name) t.author = syn.user.screen_name;

    // 线程链（捕捉 v2）：沿同作者 status 链接向上/向下收集，>1 段才写 entry.thread
    const thread = await walkThread(syn, threadFetcher);
    if (thread.length > 1) {
      t.thread = thread;
      stats.threads++;
    }

    // 媒体元数据（URL 会被签名过期影响，回灌时以 syndication 新鲜值为准）
    const details: SynMedia[] = syn.mediaDetails ?? [];
    const photos = details.filter((m) => m.type === "photo" && m.media_url_https);
    const videos = details.filter((m) => m.type === "video" || m.type === "animated_gif");
    if (photos.length) t.media = photos.map((m) => m.media_url_https!);
    const mp4 = pickMp4(videos[0]?.video_info);
    if (mp4) {
      t.video = [mp4];
      t.hasVideo = true;
    } else if (videos.length) {
      t.hasVideo = true;
    }
    if (photos.length || videos.length) stats.mediaTweets++;
    if (videos.length) stats.videoTweets++;

    // 媒体下载（图片 name=large；视频挑好的 ≤720p 变体；防护栏）。
    // Phase 3：落点 staging/x/<月>/，x.json 记 canonical media key cdn-media/x/<月>/…
    const month = (t.created_at || localDate()).slice(0, 7);
    if (!noDownload && !guardTripped && (t.media?.length || t.video?.length)) {
      try {
        if (t.video?.length && !t.videoLocal) {
          const rel = `cdn-media/x/${month}/${t.id}-video.mp4`;
          const abs = path.join(SITE, "cdn-media", "staging", "x", month, `${t.id}-video.mp4`);
          if (existsSync(abs)) {
            t.videoLocal = [rel];
          } else {
            const size = await download(t.video[0]!, abs);
            bytes += size;
            dlFiles++;
            t.videoLocal = [rel];
          }
        }
        if (!t.video?.length && t.media?.length && !t.mediaLocal?.length) {
          const locals: string[] = [];
          for (let i = 0; i < t.media.length; i++) {
            let url = t.media[i]!;
            if (url.includes("/media/") && !url.includes("name=")) url += "?name=large";
            const ext = url.match(/\.(\w{3,4})(?:\?|$)/)?.[1]?.toLowerCase() ?? "jpg";
            const rel = `cdn-media/x/${month}/${t.id}-${i + 1}.${ext}`;
            const abs = path.join(SITE, "cdn-media", "staging", "x", month, `${t.id}-${i + 1}.${ext}`);
            if (!existsSync(abs)) {
              const size = await download(url, abs);
              bytes += size;
              dlFiles++;
            }
            locals.push(rel);
          }
          t.mediaLocal = locals;
        }
        if (bytes > maxBytes) {
          guardTripped = true;
          console.error(`\n体积护栏触发（${(bytes / 1024 ** 3).toFixed(2)} GB > ${maxGb} GB）：停止下载，只留元数据`);
        }
      } catch (err) {
        console.error(`WARN media ${t.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    t.synChecked = true;
    // 全库纠正标记（审计与断点续跑依据）：成功富化的条目不再被 --all 重拉
    if (correctAll) t.enrichedV2 = true;
    stats.ok++;

    if (stats.ok % 50 === 0) {
      save();
      console.error(
        `进度 ${stats.ok}/${todo.length}：正文+${stats.text} 媒体+${stats.mediaTweets} 视频+${stats.videoTweets} 下载 ${dlFiles} 文件 ${(bytes / 1024 / 1024).toFixed(1)}MB`,
      );
    }
    await Bun.sleep(280); // 公共接口限速礼貌：约 3.5 QPS 以下
  }

  save();
  console.error(
    `完成：ok=${stats.ok} 不可用=${stats.unavailable} 网络失败=${stats.netFail}（下次重试）\n` +
      `富化：正文 ${stats.text} 条、媒体推文 ${stats.mediaTweets}、含视频 ${stats.videoTweets}\n` +
      `捕捉 v2：翻译态原文覆盖 ${stats.translated}、头像新增/更新 ${stats.avatars}、线程链 ${stats.threads} 条（syndication 共 ${stats.synCalls} 次调用）\n` +
      `全库纠正：翻译污染修复 ${stats.polluted}（xTrans 收割同数）、前缀截断补全 ${stats.truncated}、占位替换 ${stats.placeholder}、t.co 展开 ${stats.tco}\n` +
      `下载：${dlFiles} 文件 ${(bytes / 1024 / 1024).toFixed(1)} MB${guardTripped ? `（护栏 ${maxGb}GB 触发，历史剩余未下载）` : ""}`,
  );
}

// import.meta.main 守卫：测试可 import 纯函数（walkThread/upsertAuthor 等）而不触发 CLI
if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
