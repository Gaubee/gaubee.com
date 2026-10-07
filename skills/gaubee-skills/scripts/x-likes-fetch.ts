#!/usr/bin/env bun
import { execFileSync, execSync } from "node:child_process";
/**
 * x-likes-fetch.ts — X (Twitter) 个人动态抓取（source: x-likes）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：抓取我所有 X 上的 events（发帖/转发/点赞/收藏）进 gaubee-skills 管道。
 * - [2026-10-03] 裁决：官方 API 读自己数据要钱（402 credits depleted），且"我浏览器能访问的就能抓"——
 *   默认后端 **browser**（ego-browser 真实登录态，只读低频）；xurl 官方通道保留为 `--backend xurl` 备用（绑卡后可用）。
 * - 1. browser 后端：spawn ego-browser 跑 scripts/x-likes-browser.js 抽取三条流（posts/likes/bookmarks）
 * - 2. 增量：按 tweet id 对照 x.json 库存去重；新条目写 changes/<date>.json（kind: posted/reposted/liked/bookmarked）
 * - 3. 历史回灌走 scripts/x-archive-import.ts（官方 Data Archive，免费全量）
 *
 * 运行：bun scripts/x-likes-fetch.ts [--backend browser|xurl] [--user <username>] [--media-backfill N] [--video-backfill N]
 * 前置：ego-browser 已登录 x.com（browser 后端）；xurl 已授权 + 账户有积分（xurl 后端）
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { localDate, sourceDir, writeFileAtomic } from "./lib.ts";

const SRC = sourceDir("x-likes");
const APP = "kzf-agent";
const MAX_PAGES = 2; // xurl 后端：每流每轮最多 2 页 × 100 条
const SNIPPET = 120;

interface Tweet {
  id: string;
  text: string;
  created_at: string; // ISO
  kind: "posted" | "reposted" | "liked" | "bookmarked";
  author?: string; // 原作者 @handle（点赞/收藏对象）
  media?: string[]; // 图片 URL（pbs.twimg.com，已归一 name=large）
  video?: string[]; // 视频 mp4 直链（时间线 DOM 能拿到的，如 gif；blob 播放器拿不到）
  hasVideo?: boolean; // 有视频播放器（blob 源）——直链拿不到时交 yt-dlp 解析下载
  // Phase 3（cdn-media-bootstrap，2026-10-07）语义冻结：canonical media key
  // `cdn-media/x/<月>/<文件>`（原 `x-media/...`），不再兼任 staging 路径——
  // 磁盘落点 = cdn-media/staging/x/<月>/<文件>（canonical key 布局，media-pack 输入约定）
  mediaLocal?: string[];
  videoLocal?: string[];
}

interface StreamCursor {
  newest_id: string;
  last_seen_at: string;
}

interface XStore {
  updated_at: string;
  user: { id: string; username: string };
  cursors: Partial<Record<string, StreamCursor>>;
  items: Record<string, Tweet>; // tweet id → Tweet（累计去重库）
}

type Stream = "posts" | "likes" | "bookmarks";
const KIND_OF: Record<Stream, Tweet["kind"]> = {
  posts: "posted",
  likes: "liked",
  bookmarks: "bookmarked",
};

// ---------- xurl 后端（备用，需账户积分） ----------

function xurlGet(apiPath: string): { data?: any[]; meta?: { next_token?: string } } {
  // xurl 语法：路径直接作第一个位置参数（没有 get 子命令，写 "get" 会变成请求 api.x.com/get）
  const out = execSync(`npx -y @xdevplatform/xurl "${apiPath}" --app ${APP}`, {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

function xurlUser(): { id: string; username: string } {
  const me = xurlGet("/2/users/me?user.fields=username") as {
    data?: { id: string; username: string };
  };
  if (!me.data)
    throw new Error("xurl 无法读取 /2/users/me（先跑：xurl auth oauth2 --app kzf-agent）");
  return { id: me.data.id, username: me.data.username };
}

const ENDPOINTS: Record<Stream, (id: string) => string> = {
  posts: (id) => `/2/users/${id}/tweets`,
  likes: (id) => `/2/users/${id}/liked_tweets`,
  bookmarks: (id) => `/2/users/${id}/bookmarks`,
};

function pullXurl(
  stream: Stream,
  userId: string,
  store: XStore,
): { fresh: Tweet[]; newest?: { id: string; created_at: string } } {
  const fresh: Tweet[] = [];
  let newest: { id: string; created_at: string } | undefined;
  let token = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = xurlGet(
      `${ENDPOINTS[stream](userId)}?max_results=100${token ? `&pagination_token=${token}` : ""}`,
    );
    const batch = res.data ?? [];
    if (page === 0 && batch[0]) newest = { id: batch[0].id, created_at: batch[0].created_at ?? "" };
    for (const t of batch) {
      if (store.items[t.id]) continue;
      const isRetweet = (t.referenced_tweets ?? []).some((r: any) => r.type === "retweeted");
      fresh.push({
        id: t.id,
        text: (t.text ?? "").slice(0, SNIPPET),
        created_at: t.created_at ?? "",
        kind: isRetweet && stream === "posts" ? "reposted" : KIND_OF[stream],
      });
    }
    const next = res.meta?.next_token;
    if (!next || batch.length === 0) break;
    token = next;
  }
  return { fresh, newest };
}

// ---------- browser 后端（默认，ego-browser 真实登录态） ----------

function pullBrowser(username: string): Record<Stream, Tweet[]> {
  const out = path.join(tmpdir(), `x-likes-extract-${Date.now()}.json`);
  const scriptFile = path.join(import.meta.dir, "x-likes-browser.js");
  // ego 的 Node 宿主不透传自定义 env（实测）；stdin 管道会进 REPL（实测）——
  // 配置以内联 JSON 进脚本，用 -e + args 数组调用（文档支持的执行形式，无 shell 转义问题）
  const source = readFileSync(scriptFile, "utf8").replaceAll(
    "__CONFIG__",
    JSON.stringify({ username, out }),
  );
  let status: string;
  try {
    status = execFileSync("ego-browser", ["nodejs", "-e", source], {
      encoding: "utf8",
      timeout: 180_000,
    }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ego-browser 运行失败：${msg.slice(0, 400)}`);
  }
  if (!existsSync(out)) throw new Error(`抽取脚本未产出结果文件（status=${status}）`);
  const result = JSON.parse(readFileSync(out, "utf8")) as {
    ok: boolean;
    extracted: Partial<Record<Stream, { items?: any[]; error?: string }>>;
  };
  rmSync(out, { force: true });
  if (!result.ok) throw new Error(`浏览器抽取失败：${JSON.stringify(result).slice(0, 200)}`);

  const streams: Record<Stream, Tweet[]> = { posts: [], likes: [], bookmarks: [] };
  const errors: string[] = [];
  for (const s of ["posts", "likes", "bookmarks"] as const) {
    const r = result.extracted[s];
    if (r?.error) {
      errors.push(`${s}: ${r.error}`);
      continue;
    }
    streams[s] = (r?.items ?? []).map((t: any) => ({
      id: t.id,
      text: t.text ?? "",
      created_at: t.created_at ?? "",
      kind: t.reposted && s === "posts" ? "reposted" : KIND_OF[s],
      author: t.author ?? "",
      media: t.media ?? [],
      video: t.video ?? [],
      hasVideo: t.hasVideo ?? false,
    }));
  }
  if (errors.some((e) => e.includes("not-logged-in"))) {
    throw new Error("X 会话失效：请在 ego-browser 里登录 x.com 后重跑");
  }
  if (errors.length) console.error(`WARN 部分流抽取异常：${errors.join("; ")}`);
  return streams;
}

// ---------- 主流程 ----------

async function main() {
  const argv = process.argv.slice(2);
  let backend = "browser";
  let userOverride = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--backend") backend = argv[++i] ?? "browser";
    else if (argv[i] === "--user") userOverride = argv[++i] ?? "";
  }
  if (!["browser", "xurl"].includes(backend)) {
    console.error("usage: x-likes-fetch.ts [--backend browser|xurl] [--user <username>]");
    process.exit(2);
  }

  const storeFile = path.join(SRC, "x.json");
  const baseline = !existsSync(storeFile);
  const store: XStore = baseline
    ? { updated_at: "", user: { id: "", username: userOverride }, cursors: {}, items: {} }
    : JSON.parse(await Bun.file(storeFile).text());

  const all: Tweet[] = [];

  if (backend === "xurl") {
    const user = !userOverride && store.user.username ? store.user : xurlUser();
    store.user = user;
    for (const stream of ["posts", "likes", "bookmarks"] as const) {
      const { fresh, newest } = pullXurl(stream, user.id, store);
      if (newest) store.cursors[stream] = { newest_id: newest.id, last_seen_at: newest.created_at };
      all.push(...fresh);
    }
  } else {
    let username = userOverride || store.user.username;
    if (!username) {
      // 用户名引导：/2/users/me 在积分耗尽时仍可用
      username = xurlUser().username;
    }
    store.user = { ...store.user, username };
    const streams = pullBrowser(username);
    for (const s of ["posts", "likes", "bookmarks"] as const) all.push(...streams[s]);
  }

  // 找新增（在合并前判定）：库存里没有的才是新增；archive 回灌的无文本条目被富数据补全不算新增
  const fresh = all.filter((t) => !store.items[t.id]);

  for (const t of all) {
    const prev = store.items[t.id];
    if (!prev) {
      store.items[t.id] = t;
    } else if (prev.text === "" || prev.text === "(archive)") {
      store.items[t.id] = { ...t, mediaLocal: prev.mediaLocal, videoLocal: prev.videoLocal };
    } else if (
      (!prev.author && (t.author || t.media?.length || t.hasVideo)) ||
      (t.hasVideo && !prev.hasVideo) ||
      ((t.media?.length ?? 0) > 0 && !(prev.media?.length ?? 0))
    ) {
      // 富数据补全：旧条目缺 author/media/hasVideo，浏览器重扫时回填；text 取更长的版本
      //（archive 的 fullText 是全文，浏览器 DOM 文本截断在 400——不能让截断版倒灌）
      const text = (prev.text ?? "").length >= (t.text ?? "").length ? prev.text : t.text;
      store.items[t.id] = {
        ...t,
        text,
        kind: prev.kind,
        author: t.author || prev.author,
        media: t.media?.length ? t.media : prev.media,
        video: t.video?.length ? t.video : prev.video,
        mediaLocal: prev.mediaLocal,
        videoLocal: prev.videoLocal,
      };
    }
  }
  store.updated_at = new Date().toISOString();

  // ---- 媒体本地化（2026-10-05 kzf：动态 event 媒体进自己域名，墙内可读）----
  // Phase 3（cdn-media-bootstrap）：下载落点 = cdn-media/staging/x/<月>/<文件>
  // （canonical key 布局，media-pack --source 输入约定）；x.json 记 canonical
  // media key `cdn-media/x/<月>/<文件>`。媒体不再进主仓 git，经 media-pack
  // --patch 打卷上 GitHub Releases 后由 cdn-base 分发。
  // 新条目自动下载；--media-backfill N 给最近 N 条缺本地的补（体积抽样/回填用）
  // 视频：DOM 直链（gif）直接下；blob 播放器走 yt-dlp 兜底（--video-backfill N 补库存）
  let backfill = 0;
  let videoBackfill = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--media-backfill") backfill = Number.parseInt(argv[++i] ?? "0", 10) || 0;
    else if (argv[i] === "--video-backfill") videoBackfill = Number.parseInt(argv[++i] ?? "0", 10) || 0;
  }
  const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
  const STAGING = path.join(SITE, "cdn-media", "staging", "x");
  const mediaRoot = STAGING;
  const wantMedia: Tweet[] = fresh.filter(
    (t) => (t.media?.length ?? 0) + (t.video?.length ?? 0) > 0 || t.hasVideo,
  );
  if (backfill > 0) {
    const candidates = Object.values(store.items)
      .filter((t) => (t.media?.length ?? 0) > 0 && !(t.mediaLocal?.length ?? 0))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, backfill);
    wantMedia.push(...candidates);
  }
  if (videoBackfill > 0) {
    const candidates = Object.values(store.items)
      .filter(
        (t) =>
          (t.hasVideo || (t.video?.length ?? 0) > 0) &&
          !(t.videoLocal?.length ?? 0) &&
          !(t.mediaLocal ?? []).some((p) => p.endsWith(".mp4")),
      )
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, videoBackfill);
    wantMedia.push(...candidates);
  }
  let mediaBytes = 0;
  let mediaFiles = 0;
  for (const t of wantMedia) {
    const urls = [...(t.media ?? []), ...(t.video ?? [])];
    const month = (t.created_at || `${localDate()}`).slice(0, 7).replace("-", "-");
    const locals: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!;
      const extMatch = url.match(/format=(\w+)/) ?? url.match(/\.(jpg|jpeg|png|webp|mp4)(?:\?|$)/);
      const ext = extMatch ? extMatch[1]!.toLowerCase() : url.includes("video.twimg.com") ? "mp4" : "jpg";
      // canonical media key（x.json 值）与 staging 落点分离：key 冻结为 cdn-media/x/...，
      // 磁盘文件在 staging/x/...（media-pack 打卷输入）
      const rel = path.join("cdn-media", "x", month, `${t.id}-${i + 1}.${ext}`);
      const abs = path.join(STAGING, month, `${t.id}-${i + 1}.${ext}`);
      if (!existsSync(abs)) {
        try {
          const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 gaubee-skills" } });
          if (!res.ok) {
            console.error(`WARN media ${res.status} ${url.slice(0, 80)}`);
            continue;
          }
          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.length < 2000) {
            console.error(`WARN media too small (${buf.length}B) ${url.slice(0, 80)}`);
            continue;
          }
          mkdirSync(path.dirname(abs), { recursive: true });
          writeFileSync(abs, buf);
          mediaBytes += buf.length;
          mediaFiles++;
        } catch (err) {
          console.error(`WARN media fetch failed: ${err instanceof Error ? err.message : err}`);
          continue;
        }
      }
      locals.push(rel);
    }
    if (locals.length) t.mediaLocal = locals;

    // 视频兜底：blob 播放器无直链 → yt-dlp（软依赖，未安装/失败仅 WARN，不阻塞管道）
    const directVideo = (t.mediaLocal ?? []).some((p) => p.endsWith(".mp4"));
    if ((t.hasVideo || (t.video?.length ?? 0) > 0) && !t.videoLocal && !directVideo) {
      const statusUrl = `https://x.com/${t.author || store.user.username}/status/${t.id}`;
      const absNoExt = path.join(STAGING, month, `${t.id}-video`);
      try {
        mkdirSync(path.dirname(absNoExt), { recursive: true });
        execFileSync(
          "yt-dlp",
          [
            // 体积阶梯：≤190MB 里取最高 720p；超限降 480p；再不行取任意——单文件
            // 硬上限 190MB（media-pack 单卷 200MiB 上限要留 tar 头/对齐余量；
            // Phase 3 起媒体不进 git，原 100MB push 红线作废）
            "-f",
            "bv*[height<=720][size<190M]+ba/b[height<=720][size<190M]/bv*[height<=480]+ba/b[height<=480]/b",
            "--no-playlist",
            "--merge-output-format",
            "mp4",
            "-o",
            `${absNoExt}.%(ext)s`,
            statusUrl,
          ],
          { stdio: ["pipe", "pipe", "pipe"], timeout: 300_000 },
        );
        for (const ext of ["mp4", "mkv", "webm"]) {
          const absVideo = `${absNoExt}.${ext}`;
          if (existsSync(absVideo)) {
            t.videoLocal = [`cdn-media/x/${month}/${t.id}-video.${ext}`];
            mediaBytes += statSync(absVideo).size;
            mediaFiles++;
            break;
          }
        }
        if (!t.videoLocal) console.error(`WARN yt-dlp 无产物 ${statusUrl}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`WARN yt-dlp 失败 ${statusUrl}：${msg.slice(0, 160).split("\n").pop()}`);
      }
    }
  }
  if (mediaFiles) console.error(`media: ${mediaFiles} 个文件 ${(mediaBytes / 1024 / 1024).toFixed(2)} MB → ${mediaRoot}（staging，待 media-pack 打卷）`);

  mkdirSync(SRC, { recursive: true });
  writeFileAtomic(storeFile, JSON.stringify(store, null, 1));

  if (baseline) {
    console.log(
      `BASELINE x-likes 库存建立：${Object.keys(store.items).length} 条（@${store.user.username}），明日开始增量`,
    );
    return;
  }

  const today = localDate();
  if (fresh.length > 0) {
    const changes = {
      date: today,
      prev_date: "",
      baseline: false,
      added: fresh
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        .map((t) => ({
          full_name: `@${store.user.username} ${t.kind}：${(t.text || "(无文本)").slice(0, 50)}`,
          html_url: `https://x.com/${store.user.username}/status/${t.id}`,
          description: t.created_at ? t.created_at.slice(0, 16).replace("T", " ") : "",
          language: t.kind,
        })),
      removed: [],
      changed: [],
    };
    mkdirSync(path.join(SRC, "changes"), { recursive: true });
    writeFileAtomic(path.join(SRC, "changes", `${today}.json`), JSON.stringify(changes, null, 1));
  }

  const byKind = fresh.reduce<Record<string, number>>(
    (m, t) => ({ ...m, [t.kind]: (m[t.kind] ?? 0) + 1 }),
    {},
  );
  console.log(
    `x-likes: +${fresh.length} new（${JSON.stringify(byKind)}），库存 ${Object.keys(store.items).length}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
