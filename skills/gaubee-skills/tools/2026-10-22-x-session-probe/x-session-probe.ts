#!/usr/bin/env bun
/**
 * x-session-probe — X 会话健康探针（抓取前置早警）。
 *
 * 背景（2026-10-21 实证）：ego-browser 的 x.com 会话过期后，三条流抓不到时间线，
 * 旧判定把登录墙误报为「no-timeline」，整天 X 数据缺失、日报缺一天才发现。
 * 本探针在每日抓取前先花几秒确认登录态：
 *   exit 0  健康（书签页有推文 article）
 *   exit 1  会话失效（被重定向到登录流）——请先在 ego-browser 登录 x.com 再跑抓取
 *   exit 2  未知（页面形态不在预期内，输出诊断信息人工判断）
 *
 * 运行：bun tools/2026-10-22-x-session-probe/x-session-probe.ts
 * 依赖：ego-browser（已登录过 x.com 的浏览器态）。一次运行一个 page，跑完即退。
 */

const PROBE_SCRIPT = `
const task = await taskSpace("x-session-probe");
const page = await task.newPage();
await page.goto("https://x.com/i/bookmarks", { timeout: 30000 });
await page.waitForTimeout(8000);
const info = await page.evaluate(() => ({
  url: location.href,
  articles: document.querySelectorAll('article[data-testid="tweet"]').length,
  body: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 200),
}));
console.log("PROBE " + JSON.stringify(info));
`;

interface ProbeInfo {
	url: string;
	articles: number;
	body: string;
}

const LOGIN_SIGNS = ["/login", "/i/flow", "/i/jf/onboarding", "mode=login"];

function main(): number {
	const p = Bun.spawnSync(["ego-browser", "nodejs", "-e", PROBE_SCRIPT], {
		stdout: "pipe",
		stderr: "pipe",
		timeout: 90_000,
	});
	// ego 宿主把脚本 console.log 混进 stderr（实测），两个流都找
	const out = new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr);
	const line = out.split("\n").find((l) => l.startsWith("PROBE "));
	if (!line) {
		console.error(`探针未产出结果（ego exit=${p.exitCode}）：${out.slice(0, 200)}`);
		return 2;
	}
	const info = JSON.parse(line.slice("PROBE ".length)) as ProbeInfo;
	const loginWall = LOGIN_SIGNS.some((s) => info.url.includes(s));
	if (loginWall) {
		console.error(`会话失效：书签页被重定向到登录流（${info.url.slice(0, 90)}）——请在 ego-browser 登录 x.com 后重跑抓取`);
		return 1;
	}
	// X 会把 /i/bookmarks 重定向到 /i/history（2026-10-22 实测），健康不看最终路径，看登录证据：
	// 有推文 article 且页面带本账号导航（主页/通知等）即视为已登录
	const loggedInNav = /主页|通知|书签|历史/.test(info.body);
	if (info.articles > 0 && loggedInNav) {
		console.log(`会话健康：已登录（${info.articles} 条推文 article，最终页 ${info.url.slice(0, 60)}）`);
		return 0;
	}
	console.error(`未知页面形态，人工判断：url=${info.url} articles=${info.articles} body=${info.body.slice(0, 120)}`);
	return 2;
}

process.exit(main());
