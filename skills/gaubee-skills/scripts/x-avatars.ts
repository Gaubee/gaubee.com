#!/usr/bin/env bun
/**
 * x-avatars.ts — 采集推文作者头像（syndication 公开接口）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-05] kzf：归档卡片的作者头像走外链（pbs.twimg.com 直链，不本地化）。
 * - 1. 找出库存中每个独立作者的一条代表推文，拉 syndication 取 user 字段
 * - 2. 写 ~/.gaubee-skills/data/sources/x-likes/authors.json（handle → name/avatar），幂等可续跑
 * - 3. 头像 URL 归一 _bigger 档（73px，列表头像足够）
 *
 * 运行：bun scripts/x-avatars.ts
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { sourceDir, writeFileAtomic } from "./lib.ts";

const SRC = sourceDir("x-likes");
const TOKEN = "gaubee-skills-x1";
const UA = "Mozilla/5.0 gaubee-skills";

interface Tweet {
  id: string;
  author?: string;
}

interface AuthorInfo {
  name?: string;
  avatar?: string;
}

async function fetchSyn(id: string): Promise<any | null | undefined> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=zh&token=${TOKEN}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429) {
        await Bun.sleep(15_000);
        continue;
      }
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
  return undefined;
}

async function main() {
  const store: { items: Record<string, Tweet> } = JSON.parse(
    await Bun.file(path.join(SRC, "x.json")).text(),
  );
  const authorsFile = path.join(SRC, "authors.json");
  const authors: Record<string, AuthorInfo> = existsSync(authorsFile)
    ? JSON.parse(await Bun.file(authorsFile).text())
    : {};

  // 每个作者挑一条代表推文（已有头像的作者跳过）
  const rep: Record<string, string> = {};
  for (const t of Object.values(store.items)) {
    if (!t.author || authors[t.author]?.avatar) continue;
    if (!rep[t.author]) rep[t.author] = t.id;
  }
  const todo = Object.entries(rep);
  console.error(`待采集作者头像 ${todo.length} 个（已有 ${Object.keys(authors).length} 个）`);

  let done = 0;
  let fail = 0;
  const save = () => writeFileAtomic(authorsFile, JSON.stringify(authors, null, 1));
  process.on("SIGINT", () => {
    save();
    process.exit(130);
  });

  for (const [handle, tweetId] of todo) {
    const syn = await fetchSyn(tweetId);
    if (syn === undefined) {
      fail++;
      continue; // 不标记，下次重试
    }
    const user = syn?.user;
    if (user?.screen_name) {
      let avatar: string = user.profile_image_url_https ?? "";
      avatar = avatar.replace(/_normal(\.\w+)$/, "_bigger$1");
      authors[handle] = { name: user.name, avatar };
    } else {
      fail++;
    }
    done++;
    if (done % 50 === 0) {
      save();
      console.error(`进度 ${done}/${todo.length}，失败 ${fail}`);
    }
    await Bun.sleep(260);
  }
  save();
  console.error(`完成：${Object.keys(authors).length} 个作者头像，失败 ${fail}（下次重试）`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
