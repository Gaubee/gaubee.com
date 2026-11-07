#!/usr/bin/env bun
/**
 * x-thread-backfill — X 线程兜底工具化（runbook 手工步 → CLI）
 *
 * 背景（捕捉 v2 AI 兜底条款）：浏览器抽取只拿到线程中的一条，正文带 🧵 或 n/m 序号
 * 标记但 entry.thread 缺失的条目，需要打开推文页抓同作者全链写回 entry.thread。
 * 此前这一步是 cron 里的人工简报活，本工具把它变成两条命令。
 *
 * 用法：
 *   bun tools/2026-10-24-x-thread-backfill/x-thread-backfill.ts            # 扫描：列疑似缺链条目
 *   bun tools/2026-10-24-x-thread-backfill/x-thread-backfill.ts --ids a,b  # 抓链：ego-browser 打开推文页写回 thread
 *
 * 退出码：0 = 正常（扫描无命中也 0）；1 = 参数/数据错误；2 = 抓链有失败（写入成功的仍落盘）。
 * 数据面：只改 x.json 的 entry.thread 字段（writeFileAtomic 原子写）；不动其它字段。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA =
  process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const XJSON = path.join(DATA, "sources", "x-likes", "x.json");

/** 疑似线程标记：🧵 emoji 或 (n/m)、n/m、n/m：等序号写法（行首或独立段更可信，这里从宽） */
const THREAD_SIGN = /🧵|(?:^|\s|\()\d{1,2}\s*\/\s*\d{1,2}(?:[:：）)\s]|$)/;

interface ThreadPart {
  id: string;
  text: string;
  created_at?: string;
}
interface Entry {
  id: string;
  text?: string;
  created_at?: string;
  thread?: ThreadPart[];
  /** 作者手柄（x.json 的 author 字段是字符串 screen_name） */
  author?: string;
}

function loadX(): Entry[] {
  if (!existsSync(XJSON)) {
    console.error(`x.json 不存在：${XJSON}`);
    process.exit(1);
  }
  const x = JSON.parse(readFileSync(XJSON, "utf8")) as { items?: Record<string, Entry> };
  return Object.values(x.items ?? {});
}

function scan(items: Entry[]): Entry[] {
  return items
    .filter((t) => !t.thread && THREAD_SIGN.test(t.text ?? ""))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

/** ego-browser 打开推文页，只收集页面上同作者的 status 链（id + 作者）。
 *  正文不从这里取：X 会话开了自动翻译时 DOM 里是译文，而且 article 顺序含广告/推荐，
 *  按 DOM 下标对齐会错位（2026-11-08 实证：thread 里写进了中文译文与外人回复）。 */
function grabThread(statusUrl: string): { links: [string, string][] } | null {
  const script = `
const task = await taskSpace("x-thread-backfill");
const page = await task.newPage();
await page.goto(${JSON.stringify(statusUrl)}, { timeout: 25000 });
await page.waitForTimeout(5000);
const data = await page.evaluate(() => {
  const seen = new Map();
  for (const a of document.querySelectorAll('a[href*="/status/"]')) {
    const m = a.href.match(/https:\\/\\/x\\.com\\/([A-Za-z0-9_]+)\\/status\\/(\\d{15,})/);
    if (m) seen.set(m[2], m[1]);
  }
  return { links: [...seen.entries()] };
});
console.log("GRAB:" + JSON.stringify(data));
`;
  const tmp = path.join(os.tmpdir(), `x-thread-grab-${Date.now()}.js`);
  const { writeFileSync, rmSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(tmp, script);
  try {
    // spawnSync 不经 shell，脚本内容必须直接作参数（$(cat …) 不会被展开）
    const res = Bun.spawnSync(["ego-browser", "nodejs", "-e", readFileSync(tmp, "utf8")], {
      timeout: 90_000,
    });
    const both = `${res.stdout.toString()}\n${res.stderr.toString()}`;
    const line = both.split("\n").find((l) => l.includes("GRAB:"));
    if (!line) return null;
    return JSON.parse(line.slice(line.indexOf("GRAB:") + 5)) as {
      links: [string, string][];
    };
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** syndication 取单条原文（免登录；X 会话的自动翻译不会污染这里）。 */
async function fetchOriginal(id: string): Promise<{ id: string; text: string; author: string } | null> {
  try {
    const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=x`, {
      headers: { "user-agent": "gaubee-skills-thread-backfill/1.0 (+https://gaubee.com)" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { text?: string; user?: { screen_name?: string } };
    if (!j.text || !j.user?.screen_name) return null;
    return { id, text: j.text, author: j.user.screen_name };
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const idsIdx = argv.indexOf("--ids");
  const items = loadX();

  if (idsIdx < 0) {
    const pending = scan(items);
    console.log(`库存 ${items.length} 条；已有 thread ${items.filter((t) => t.thread).length} 条；疑似缺链 ${pending.length} 条`);
    for (const t of pending.slice(0, 20)) {
      const sign = (t.text ?? "").match(THREAD_SIGN)?.[0]?.trim() ?? "";
      console.log(`  ${t.id} ${(t.created_at ?? "").slice(0, 10)} @${t.author ?? "?"} 标记="${sign}" https://x.com/${t.author ?? "i"}/status/${t.id}`);
    }
    if (pending.length > 20) console.log(`  … 共 ${pending.length} 条`);
    console.log(`抓链：bun tools/2026-10-24-x-thread-backfill/x-thread-backfill.ts --ids <id[,id…]>`);
    return 0;
  }

  const ids = (argv[idsIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const x = JSON.parse(readFileSync(XJSON, "utf8")) as { items: Record<string, Entry> };
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    const t = x.items[id];
    if (!t) {
      console.error(`  ${id}：库存无此条`);
      fail++;
      continue;
    }
    const url = `https://x.com/${t.author ?? "i"}/status/${id}`;
    const grabJson = grabThread(url);
    if (!grabJson) {
      console.error(`  ${id}：抓取失败（无 GRAB 行，ego-browser 未回内容）`);
      fail++;
      continue;
    }
    // 只留同作者链（剔除引用/转发的外人推文），按 id 数序 = 发帖序
    const own = grabJson.links.filter(([, name]) => name === t.author);
    const ownIds = own.map(([pid]) => pid).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    const parts: ThreadPart[] = [];
    for (const pid of ownIds) {
      const original = await fetchOriginal(pid);
      if (!original || original.author !== t.author) {
        // 取不到原文或作者对不上（已删/转发）→ 不写空壳段，留给下次重试
        continue;
      }
      // 推文页会把作者对别人的回复也列出来（同作者但不在本线程里）：以「@ 开头」识别并剔除，
      // 目标条目自身例外（它可能就是一条回复）。
      if (pid !== id && /^@[A-Za-z0-9_]+/.test(original.text.trim())) continue;
      parts.push({ id: pid, text: original.text });
    }
    if (parts.length <= 1) {
      console.error(`  ${id}：可取到原文的同作者段只有 ${parts.length} 条，不成链（可能已删或非线程）`);
      fail++;
      continue;
    }
    t.thread = parts;
    ok++;
    console.log(`  ${id}：写回 ${parts.length} 段（@${t.author}，原文经 syndication 校正）`);
  }
  if (ok > 0) {
    const { writeFileAtomic } = require(path.resolve(import.meta.dir, "..", "..", "scripts", "lib.ts")) as {
      writeFileAtomic: (p: string, s: string) => void;
    };
    writeFileAtomic(XJSON, JSON.stringify(x, null, 1));
    console.log(`已原子写回 ${XJSON}（改 ${ok} 条）`);
  }
  return fail ? 2 : 0;
}

process.exit(await main());
