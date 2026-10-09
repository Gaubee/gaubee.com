/**
 * x-likes-browser.js — 在 ego-browser Node 宿主内运行的 X 时间线抽取器
 *
 * 意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：X 官方 API 读自己的数据要钱（credits depleted），改用浏览器自动化——"我浏览器能访问的就能抓"；基于 ego-browser。
 * - 1. 打开三条流（个人主页 posts / likes / i/bookmarks），等待时间线，滚 2 轮，逐 article 抽取 tweet
 * - 2. 结果写 X_OUT 指定的 JSON 文件（stdout 只留一行状态，避免污染解析）
 * - 3. 只读、每流 3 轮视口封顶——个人归档节奏，模拟真人浏览
 *
 * 环境变量：无（配置由调用方以内联 JSON 占位符注入：{ username, out }；注释里不要写字面占位符，避免干扰替换）
 * 产物 JSON：{ ok: true, user, extracted: { posts|likes|bookmarks: { items: [tweet] | error } } }
 *
 * 捕捉 v2（kzf 2026-10-09 裁决③：捕捉原文而非 X 自动翻译，X 译文收割复用）：
 * - 每条 article 检测翻译态（选择器候选：[data-testid="translation"]，或按钮文本
 *   「显示原帖/Show original」；候选未经真机登录态实测，容错双检，待真机验证）
 * - 翻译态：tweetText（此刻是 X 译文）存 xTrans，xTranslated: true；随后点「显示原帖」
 *   展开原文再抓 tweetText 存 text；点击失败（无按钮/文本未变化）→ xTrans 留译文、
 *   text 置空串待 syndication 富化补原文
 * - 未翻译条目行为不变
 */
import { writeFileSync } from "node:fs";

/**
 * 配置由调用方（x-likes-fetch.ts）以内联 JS 对象字面量注入（占位符裸放，不带引号）
 */
const CONFIG = __CONFIG__;
const USERNAME = CONFIG.username;
const OUT = CONFIG.out;
const ROUNDS = 3; // 每流：初始视口 + 2 轮滚动

if (!USERNAME) {
  writeFileSync(OUT, JSON.stringify({ ok: false, error: "username missing" }));
  console.log("EXTRACT-FAIL");
  process.exit(1);
}

const STREAMS = [
  { key: "posts", url: `https://x.com/${USERNAME}` },
  { key: "likes", url: `https://x.com/${USERNAME}/likes` },
  { key: "bookmarks", url: "https://x.com/i/bookmarks" },
];

const task = await taskSpace("x-likes 每日信号采集");
const page = task.page("p1");
const result = { ok: true, user: USERNAME, extracted: {} };
let sawLoginWall = false;

for (const s of STREAMS) {
  try {
    await page.goto(s.url, { timeout: 30000 });
    try {
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });
    } catch {
      const url = await page.url();
      if (url.includes("/login") || url.includes("/i/flow")) {
        sawLoginWall = true;
        result.extracted[s.key] = { error: "not-logged-in" };
      } else {
        result.extracted[s.key] = { error: "no-timeline" };
      }
      continue;
    }

    const items = [];
    for (let round = 0; round < ROUNDS; round++) {
      const batch = await page.evaluate(() =>
        [...document.querySelectorAll('article[data-testid="tweet"]')]
          .slice(0, 60)
          .map((a) => {
            const link = a.querySelector('a[href*="/status/"]');
            const time = a.querySelector("time[datetime]");
            const textEl = a.querySelector('[data-testid="tweetText"]');
            const social = a.querySelector('[data-testid="socialContext"]');
            const href = link?.getAttribute("href") ?? "";
            const m = href.match(/\/([^/]+)\/status\/(\d+)/);
            // 捕捉 v2：翻译态检测（候选选择器双检，未经真机登录态实测——见文件头）
            const translated =
              !!a.querySelector('[data-testid="translation"], [data-testid="translationBanner"]') ||
              [...a.querySelectorAll('button, [role="button"]')].some((el) =>
                /显示原帖|Show original/i.test(el.textContent ?? ""),
              );
            // 媒体：推文图片（排除头像/缩进引用里的重复）；视频取 DOM 里能拿到的 mp4 源
            const media = [
              ...new Set(
                [...a.querySelectorAll('img[src*="pbs.twimg.com/media"]')].map((im) => {
                  const src = im.getAttribute("src") ?? "";
                  // 统一压到 large 档：博客展示 ~1024px 足够，体积可控
                  return src.includes("name=") ? src.replace(/name=[^&]+/, "name=large") : src;
                }),
              ),
            ];
            const video = [...new Set([...a.querySelectorAll('video[src*="video.twimg.com"], video source[src*="video.twimg.com"]')].map((v) => v.getAttribute("src") ?? ""))].filter(Boolean);
            // blob 播放器拿不到直链，但「有视频」这个事实可以标记——交给 yt-dlp 解析
            const hasVideo = video.length > 0 || !!a.querySelector('video, [data-testid="videoPlayer"]');
            return {
              id: m?.[2] ?? "",
              author: m?.[1] ?? "",
              text: (textEl?.innerText ?? "").slice(0, 400),
              created_at: time?.getAttribute("datetime") ?? "",
              reposted: !!social && /repost|转发/i.test(social.textContent ?? ""),
              media,
              video,
              hasVideo,
              translated,
            };
          })
          .filter((t) => t.id),
      );
      const seen = new Set(items.map((i) => i.id));
      for (const t of batch) if (!seen.has(t.id)) items.push(t);

      // 捕捉 v2 译文收割：视口内翻译态条目——tweetText（X 译文）存 xTrans，点「显示原帖」
      // 展开原文再抓存 text；点击失败（无按钮/3 秒内文本未变化）→ xTrans 留译文、text 置空串
      try {
        const fixed = await page.evaluate(async () => {
          const out = [];
          for (const a of [...document.querySelectorAll('article[data-testid="tweet"]')].slice(0, 60)) {
            const textEl = a.querySelector('[data-testid="tweetText"]');
            const banner = a.querySelector('[data-testid="translation"], [data-testid="translationBanner"]');
            const btns = [...a.querySelectorAll('button, [role="button"]')].filter((el) =>
              /显示原帖|Show original/i.test(el.textContent ?? ""),
            );
            // 优先取位于主推文 tweetText 之后的按钮（主推自己的切换钮；引述推文的嵌套按钮靠后兜底）
            const btn =
              btns.find((el) => !textEl || el.compareDocumentPosition(textEl) & Node.DOCUMENT_POSITION_PRECEDING) ??
              btns[0];
            if (!banner && !btn) continue;
            const href = a.querySelector('a[href*="/status/"]')?.getAttribute("href") ?? "";
            const id = href.match(/\/status\/(\d+)/)?.[1] ?? "";
            if (!id) continue;
            const xTrans = (textEl?.innerText ?? "").slice(0, 400);
            let text = "";
            let expanded = false;
            if (btn) {
              try {
                btn.click();
              } catch {}
              // 等原文渲染（React 重绘），3 秒内文本没变即认点击失败
              for (let i = 0; i < 20; i++) {
                await new Promise((r) => setTimeout(r, 150));
                const t2 = (a.querySelector('[data-testid="tweetText"]')?.innerText ?? "").trim();
                if (t2 && t2 !== xTrans.trim()) {
                  text = t2.slice(0, 400);
                  expanded = true;
                  break;
                }
              }
            }
            out.push({ id, xTrans, text, expanded });
          }
          return out;
        });
        for (const f of fixed) {
          const item = items.find((i) => i.id === f.id);
          if (!item) continue;
          item.xTranslated = true;
          item.xTrans = f.xTrans;
          item.text = f.expanded ? f.text : "";
        }
      } catch {
        // 宿主不支持异步 evaluate 时降级：收尾兜底统一标记（text 置空待富化）
      }

      if (round < ROUNDS - 1) {
        const before = items.length;
        await page.mouse.move(400, 400, { label: "移到时间线区域" });
        await page.mouse.wheel(0, 2400, { label: `滚动 ${s.key} 流` });
        try {
          await page.waitForFunction(
            (n) => document.querySelectorAll('article[data-testid="tweet"]').length > n,
            before,
            { timeout: 4000 },
          );
        } catch {
          // 已滚到底/加载慢——下一轮抽取会尽力，不阻塞
          await page.waitForTimeout(1200);
        }
      }
    }
    // 收尾兜底：翻译态标记但从未被 fixup 处理到的条目（滚出视口/异步 evaluate 不可用）——
    // xTrans 留住已抓到的文本（此刻是 X 译文），text 置空串待 syndication 富化补原文
    for (const t of items) {
      if (t.translated && !t.xTranslated) {
        t.xTranslated = true;
        t.xTrans = t.text;
        t.text = "";
      }
      delete t.translated;
    }
    result.extracted[s.key] = { items };
  } catch (err) {
    result.extracted[s.key] = { error: String(err).slice(0, 200) };
  }
}

writeFileSync(OUT, JSON.stringify(result));
if (sawLoginWall) {
  console.log("EXTRACT-FAIL");
} else {
  console.log("EXTRACT-OK");
}
await task.finish({ keep: [] });
