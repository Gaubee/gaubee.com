// x-capture-v2 测试（2026-10-09 捕捉 v2：线程走链 / 渲染 thread / 头像 upsert）
//   bun test skills/gaubee-skills/scripts/x-capture-v2.test.ts
//
// 覆盖：
// - walkThread 纯函数（注入假 fetcher）：向上链 / 自己是链根向下收 / 环（visited 防环）/
//   断链（null 与 undefined 都是拿多少拼多少）/ 跨作者链接忽略 / 20 层上限 / 自媒体链接不成链 /
//   段文本剔除链内互链（t.co 展开后按 status id 删）
// - itemCard thread 渲染：分隔符数量与文案 / 原推文链接指向互动条目自身 / 译文 toggle 对拼接全文生效 /
//   单段 thread 回退 t.text
// - upsertAuthor / saveAuthors：新增即补、已存在以新值更新、空值不覆盖、无 screen_name 拒绝、
//   幂等无变化、原子落盘（内容完整 + 无 .tmp 残留）
//
// 夹具全内存/临时目录隔离，全部 id 与用户名为假值，不触真实仓库、真实数据与网络。

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as path from "node:path";

import { itemCard, type Tweet } from "./lib/x-arch-render.ts";
import {
  sameAuthorStatusLinks,
  saveAuthors,
  threadPartText,
  upsertAuthor,
  walkThread,
  type AuthorRec,
  type SynFetcher,
} from "./x-media-backfill.ts";

// ---------- 假 syndication payload ----------

const T0 = "2026-10-01T09:00:00.000Z";

// status 链接匹配要求纯数字 id（与真实推文 id 同形），夹具一律用数字串
function synOf(
  id: string,
  createdAt: string,
  links: { id: string; author?: string }[] = [],
  text = `part-${id} 原文`,
) {
  return {
    id_str: id,
    created_at: createdAt,
    text,
    user: { screen_name: "me", name: "Me" },
    entities: {
      urls: links.map((l, i) => ({
        url: `https://t.co/link${id}_${i}`,
        expanded_url: `https://x.com/${l.author ?? "me"}/status/${l.id}`,
      })),
    },
  };
}

/** 假 fetcher：按 id 查表；missing 行为可配（"null"=永久不可见，"undefined"=网络失败） */
function fakeFetcher(
  table: Record<string, any>,
  missing: "null" | "undefined" = "null",
): SynFetcher & { calls: string[] } {
  const calls: string[] = [];
  const fn: SynFetcher = async (id) => {
    calls.push(id);
    if (table[id]) return table[id];
    return missing === "null" ? null : undefined;
  };
  return Object.assign(fn, { calls });
}

function iso(offsetMinutes: number): string {
  return new Date(Date.parse(T0) + offsetMinutes * 60_000).toISOString();
}

// ---------- walkThread ----------

describe("walkThread（线程走链纯函数）", () => {
  test("向上链：E→P→R，产出 [R, P, E]（最早在前，含自身），段内互链被剔除", async () => {
    // 3001(09:00) ← 3002(09:10) ← 3003(09:20)：3003 引 3002，3002 引 3001
    const table = {
      "3003": synOf("3003", iso(20), [{ id: "3002" }]),
      "3002": synOf("3002", iso(10), [{ id: "3001" }]),
      "3001": synOf("3001", iso(0), []),
    };
    const f = fakeFetcher(table);
    const thread = await walkThread(table["3003"]!, f);
    expect(thread.map((p) => p.id)).toEqual(["3001", "3002", "3003"]);
    expect(f.calls).toEqual(["3002", "3001"]); // 两跳，无多余调用
    // 3003 段文本剔除了指向 3002 的链接（t.co 已展开再按 id 删）
    expect(thread.find((p) => p.id === "3003")!.text).not.toContain("status/3002");
    // 各段正文保留
    expect(thread.find((p) => p.id === "3001")!.text).toBe("part-3001 原文");
    expect(thread.find((p) => p.id === "3003")!.created_at).toBe(iso(20));
  });

  test("自己是链根：R 引下一部分 N（更晚），向下收出 [R, N]；N 引回 R 被防环挡住", async () => {
    const table = {
      "4001": synOf("4001", iso(0), [{ id: "4002" }]),
      "4002": synOf("4002", iso(10), [{ id: "4001" }]),
    };
    const f = fakeFetcher(table);
    const thread = await walkThread(table["4001"]!, f);
    expect(thread.map((p) => p.id)).toEqual(["4001", "4002"]);
    expect(f.calls).toEqual(["4002"]); // 同一 id 只拉一次（cache），方向试探不复费
    expect(thread.find((p) => p.id === "4002")!.text).not.toContain("status/4001");
  });

  test("环：X 引 Y（早）、Y 引 Z（早）、Z 回指 Y——visited 防环，有限次调用收尾", async () => {
    const table = {
      "5001": synOf("5001", iso(30), [{ id: "5002" }]),
      "5002": synOf("5002", iso(20), [{ id: "5003" }]),
      "5003": synOf("5003", iso(10), [{ id: "5002" }]), // 回指已 visited → 止
    };
    const f = fakeFetcher(table);
    const thread = await walkThread(table["5001"]!, f);
    expect(thread.map((p) => p.id)).toEqual(["5003", "5002", "5001"]);
    expect(f.calls.length).toBeLessThanOrEqual(3); // 有限收尾，不死循环
  });

  test("断链：中间一跳 fetch 返回 null——拿多少拼多少（[P, E]，R 缺失如实缺）", async () => {
    const table = {
      "6003": synOf("6003", iso(20), [{ id: "6002" }]),
      "6002": synOf("6002", iso(10), [{ id: "6001" }]),
      // 6001 不在表里 → fetch 返回 null（删除/不可见）
    };
    const f = fakeFetcher(table, "null");
    const thread = await walkThread(table["6003"]!, f);
    expect(thread.map((p) => p.id)).toEqual(["6002", "6003"]);
  });

  test("网络失败（undefined）：同样即止，不比 null 多收", async () => {
    const table = {
      "7003": synOf("7003", iso(20), [{ id: "7002" }]),
      "7002": synOf("7002", iso(10), [{ id: "7001" }]),
    };
    const f = fakeFetcher(table, "undefined");
    const thread = await walkThread(table["7003"]!, f);
    expect(thread.map((p) => p.id)).toEqual(["7002", "7003"]);
  });

  test("跨作者链接忽略：entities 指向别人的 status 不成链，产出空数组", async () => {
    const table = {
      "8001": synOf("8001", iso(20), [{ id: "8888", author: "someone-else" }]),
    };
    const f = fakeFetcher(table);
    const thread = await walkThread(table["8001"]!, f);
    expect(thread).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  test("20 层上限：26 节点链只收 20 段，fetch 恰 19 次", async () => {
    const table: Record<string, any> = {};
    const ids = Array.from({ length: 26 }, (_, i) => String(9000 - i)); // 9000 最新，链向更早
    for (let i = 0; i < ids.length; i++) {
      const links = i + 1 < ids.length ? [{ id: ids[i + 1]! }] : [];
      table[ids[i]!] = synOf(ids[i]!, iso(-i * 5), links); // 越往后越早
    }
    const f = fakeFetcher(table);
    const thread = await walkThread(table["9000"]!, f); // 从最新往回走
    expect(thread.length).toBe(20);
    expect(thread[0]!.id).toBe("8981"); // 上限截断：最早只收到 8981（9000-19）
    expect(thread[thread.length - 1]!.id).toBe("9000");
    expect(f.calls.length).toBe(19);
  });

  test("自媒体链接（指向自身 status/video/1）不成链，正文里的媒体占位被剔除", async () => {
    const self = {
      id_str: "9500",
      created_at: iso(0),
      text: "看视频 https://t.co/self",
      user: { screen_name: "me", name: "Me" },
      entities: {
        media: [{ url: "https://t.co/self", expanded_url: "https://x.com/me/status/9500/video/1" }],
      },
    };
    const f = fakeFetcher({ "9500": self });
    const thread = await walkThread(self, f);
    expect(thread).toEqual([]); // 只有自身，不产 thread
    expect(f.calls).toEqual([]);
    // 段文本工具直接验证：媒体占位链接被 cleanText 删掉
    expect(threadPartText(self, new Set(["9500"]), "9500")).toBe("看视频");
  });

  test("起点信息不全（无 user/id）：返回空数组不抛错", async () => {
    expect(await walkThread({ id_str: "A" }, fakeFetcher({}))).toEqual([]);
    expect(await walkThread(null, fakeFetcher({}))).toEqual([]);
  });

  test("sameAuthorStatusLinks：urls 与 media 都扫、去重保序、只认同作者", () => {
    const s = {
      entities: {
        urls: [
          { url: "https://t.co/1", expanded_url: "https://x.com/me/status/111" },
          { url: "https://t.co/2", expanded_url: "https://x.com/other/status/222" },
          { url: "https://t.co/3", expanded_url: "https://twitter.com/me/status/111" }, // 去重（同 id）
          { url: "https://t.co/4", expanded_url: "https://x.com/me/status/444?cmt=1" },
        ],
        media: [{ url: "https://t.co/5", expanded_url: "https://x.com/me/status/555/video/1" }],
      },
    };
    const links = sameAuthorStatusLinks(s, "me");
    expect(links.map((l) => l.id)).toEqual(["111", "444", "555"]);
    expect(links[0]!.tco).toBe("https://t.co/1");
  });
});

// ---------- itemCard thread 渲染 ----------

describe("itemCard thread 渲染（捕捉 v2）", () => {
  const authors: Record<string, AuthorRec> = { me: { name: "Me", avatar: "https://pbs.twimg.com/a_bigger.jpg" } };
  const base: Tweet = {
    id: "E",
    text: "part-E 原文",
    created_at: "2026-10-08T10:20:00.000Z",
    kind: "liked",
    author: "me",
  };

  test("多段 thread：按段渲染，段间插分隔符（数量=段数-1），分隔符带 aria-label", () => {
    const t: Tweet = {
      ...base,
      thread: [
        { id: "R", text: "part-R 原文", created_at: "2026-10-08T10:00:00.000Z" },
        { id: "P", text: "part-P 原文", created_at: "2026-10-08T10:10:00.000Z" },
        { id: "E", text: "part-E 原文", created_at: "2026-10-08T10:20:00.000Z" },
      ],
    };
    const html = itemCard(t, authors, {}, {});
    const sepCount = html.split("x-arch-thread-sep").length - 1; // class 出现次数 = 分隔 div 数
    expect(sepCount).toBe(2); // 3 段 → 2 个分隔
    expect(html).toContain(`aria-label="接上文"`);
    expect(html).toContain("⤵");
    expect(html.indexOf("part-R 原文")).toBeLessThan(html.indexOf("part-P 原文"));
    expect(html.indexOf("part-P 原文")).toBeLessThan(html.indexOf("part-E 原文"));
  });

  test("原推文链接指向互动条目自身（不随线程根漂移）", () => {
    const t: Tweet = {
      ...base,
      thread: [
        { id: "R", text: "part-R 原文" },
        { id: "E", text: "part-E 原文" },
      ],
    };
    const html = itemCard(t, authors, {}, {});
    expect(html).toContain('href="https://x.com/me/status/E"');
    expect(html).not.toContain('href="https://x.com/me/status/R"');
  });

  test("译文 toggle：translations[id] 对拼接全文生效，原文段与译文段并存", () => {
    const t: Tweet = {
      ...base,
      thread: [
        { id: "R", text: "part-R 原文" },
        { id: "E", text: "part-E 原文" },
      ],
    };
    const html = itemCard(t, authors, { E: "拼接全文的中文译文" }, {});
    expect(html).toContain('class="x-arch-lang-input x-arch-lang-input-zh" checked'); // 默认选「译」
    expect(html).toContain('id="xl-E-orig"');
    expect(html).toContain('x-arch-trans">拼接全文的中文译文');
    expect(html).toContain('x-arch-orig">');
    expect(html.indexOf("part-R 原文")).toBeGreaterThan(-1); // 原文段仍是多段拼接
  });

  test("无 thread / 单段 thread：行为不变（无分隔符，用 t.text）", () => {
    const plain = itemCard(base, authors, {}, {});
    expect(plain).not.toContain("x-arch-thread-sep");
    expect(plain).toContain("part-E 原文");
    const single = itemCard({ ...base, thread: [{ id: "E", text: "其他文本" }] }, authors, {}, {});
    expect(single).not.toContain("x-arch-thread-sep");
    expect(single).toContain("part-E 原文"); // 回退 t.text，不采用单段 thread
  });
});

// ---------- 头像 upsert / 原子落盘 ----------

describe("upsertAuthor / saveAuthors（捕捉 v2 头像覆盖）", () => {
  test("缺失即补：_normal 归一 _bigger；已存在以新值更新（avatar+name）", () => {
    const authors: Record<string, AuthorRec> = {};
    expect(
      upsertAuthor(authors, {
        screen_name: "alice",
        name: "Alice",
        profile_image_url_https: "https://pbs.twimg.com/profile_images/1/x_normal.png",
      }),
    ).toBe(true);
    expect(authors["alice"]).toEqual({ name: "Alice", avatar: "https://pbs.twimg.com/profile_images/1/x_bigger.png" });
    expect(
      upsertAuthor(authors, {
        screen_name: "alice",
        name: "Alice A",
        profile_image_url_https: "https://pbs.twimg.com/profile_images/2/y_normal.jpg",
      }),
    ).toBe(true);
    expect(authors["alice"]).toEqual({ name: "Alice A", avatar: "https://pbs.twimg.com/profile_images/2/y_bigger.jpg" });
  });

  test("新值为空不覆盖旧值；无 screen_name 拒绝；无变化返回 false（幂等）", () => {
    const authors: Record<string, AuthorRec> = { bob: { name: "Bob", avatar: "https://pbs.twimg.com/old_bigger.jpg" } };
    expect(upsertAuthor(authors, { screen_name: "bob", name: "", profile_image_url_https: "" })).toBe(false);
    expect(authors["bob"]).toEqual({ name: "Bob", avatar: "https://pbs.twimg.com/old_bigger.jpg" });
    expect(upsertAuthor(authors, { name: "NoHandle" })).toBe(false);
    expect(upsertAuthor(authors, { screen_name: "bob", name: "Bob", profile_image_url_https: "https://pbs.twimg.com/old_bigger.jpg".replace("old_bigger", "old_normal") })).toBe(false);
    expect(Object.keys(authors).length).toBe(1);
  });

  test("saveAuthors 原子落盘：内容完整读回、无 .tmp 残留", () => {
    const dir = mkdtempSync(path.join("/tmp", "x-capture-v2-"));
    try {
      const file = path.join(dir, "authors.json");
      const authors: Record<string, AuthorRec> = { carol: { name: "Carol", avatar: "https://pbs.twimg.com/c_bigger.jpg" } };
      saveAuthors(file, authors);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(authors);
      expect(existsSync(`${file}.tmp`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
