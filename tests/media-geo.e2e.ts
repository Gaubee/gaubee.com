import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * 正交意图：
 * 1. 原始需求（2026-10-07，cdn-media-bootstrap Phase 2 / 2.4）：
 *    在真实事件详情页（00478）上端到端验收 use:mediasrc 的 A8 语义——
 *    geo 失败/默认规则（base 空串）→ 引用保持 `/cdn-media/` 相对路径（同源不重写）；
 *    geo 返回自定义 base → img[src] / video[poster]+[src] / source[src] / a[href] 全部重写。
 *
 * 运行拓扑（复现生产反代路由）：
 *   - `vite preview`（build 产物，/api 经 vite.config preview.proxy 转发）
 *   - `wrangler dev`（worker 目录，localhost:8787；本地 KV 状态在 worker/.wrangler/state）
 *   - PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm exec playwright test tests/media-geo.e2e.ts
 *
 * 场景说明：
 *   - 「worker 不可达」用例只在 wrangler dev 未启动时运行（其余情况自动 skip）；
 *   - 「默认规则」「自定义 base」需要 worker 在跑；自定义场景经
 *     `wrangler kv key put --local` 种入本地 KV（浏览器场景切换即刷新 sessionStorage，互不污染）。
 */

const WORKER_DIR = fileURLToPath(new URL("../worker", import.meta.url));
const KV_KEY = "geo_rules_v1";

const DEFAULT_RULES = { version: 0, rules: [{ match: { default: true }, mediaBase: "" }] };
const CUSTOM_BASE = "https://cdn-local.test";
const CUSTOM_RULES = {
	version: 7,
	rules: [
		{ match: { countries: ["CN"] }, mediaBase: "https://cn.example.test" },
		{ match: { default: true }, mediaBase: CUSTOM_BASE },
	],
};

async function fetchGeo(): Promise<{ mediaBase: string; ruleVersion: number } | null> {
	try {
		const res = await fetch(`${process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173"}/api/geo`);
		if (!res.ok) return null;
		return (await res.json()) as { mediaBase: string; ruleVersion: number };
	} catch {
		return null;
	}
}

/** 本地 KV 写入（--local 与 wrangler dev 共享 .wrangler/state 存储）。 */
function kvPut(value: unknown): void {
	execFileSync("npx", ["wrangler", "kv", "key", "put", KV_KEY, JSON.stringify(value), "--binding", "GEO_RULES", "--local"], {
		cwd: WORKER_DIR,
		stdio: "pipe",
	});
}

/** 本地 KV 删除（旧版 CLI 删除有确认提示，喂 "y"；失败由调用方兜底）。 */
function kvDelete(): void {
	try {
		execFileSync("npx", ["wrangler", "kv", "key", "delete", KV_KEY, "--binding", "GEO_RULES", "--local"], {
			cwd: WORKER_DIR,
			stdio: "pipe",
			input: "y\n",
		});
	} catch {
		/* key 不存在等情况忽略 */
	}
}

/** 轮询直到 /api/geo 达到期望状态（KV 写入传播 + 浏览器外确认）。 */
async function waitForGeo(expected: { mediaBase: string; ruleVersion: number }, timeoutMs = 20_000): Promise<void> {
	const started = Date.now();
	for (;;) {
		const geo = await fetchGeo();
		if (geo && geo.mediaBase === expected.mediaBase && geo.ruleVersion === expected.ruleVersion) return;
		if (Date.now() - started > timeoutMs) {
			throw new Error(`/api/geo 未达到期望状态 ${JSON.stringify(expected)}，实际 ${JSON.stringify(geo)}`);
		}
		await new Promise((r) => setTimeout(r, 500));
	}
}

/** 打开真实事件详情页（SPA 深链接 → ArticleDetailView，use:mediasrc 挂载点）。 */
async function open00478(page: Page): Promise<void> {
	await page.goto("/article/events/00478.x-archive-2026-07-25");
	await page.waitForSelector(".article-content");
}

/**
 * 向已挂载 action 的正文容器注入 /cdn-media/ 引用夹具（img/video poster+src/source src/a href）。
 * 走 MutationObserver 路径——与 MarkdownViewer 异步渲染同通道，顺带验证 MO 兜底。
 */
async function injectFixture(page: Page): Promise<void> {
	await page.evaluate(() => {
		const host = document.querySelector(".article-content");
		if (!host) throw new Error("article 容器未找到（use:mediasrc 挂载点缺失？）");
		host.insertAdjacentHTML(
			"beforeend",
			`<div id="media-geo-fixture">
				<img id="fx-img" src="/cdn-media/site/fixture.png" alt="fixture" />
				<video id="fx-video" poster="/cdn-media/x/2026-07/p.jpg" src="/cdn-media/x/2026-07/v.mp4"></video>
				<video id="fx-video-2"><source id="fx-source" src="/cdn-media/x/2026-07/s.mp4" type="video/mp4" /></video>
				<a id="fx-link" href="/cdn-media/misc/fixture.bin">fixture</a>
			</div>`,
		);
	});
}

function attrOf(page: Page, selector: string, attribute: string): ReturnType<Page["getAttribute"]> {
	return page.getAttribute(selector, attribute);
}

test.describe("use:mediasrc 地区路由（真实 00478 页面）", () => {
	test("worker 不可达：geo 失败静默，引用保持相对路径（A8 失败回退）", async ({ page }) => {
		const geo = await fetchGeo();
		test.skip(geo !== null, "本用例验证 /api/geo 缺失场景，请在 wrangler dev 未启动时运行");

		await open00478(page);
		await injectFixture(page);
		// geo 拉取（1.5s 超时）+ 负缓存窗口过后仍不得改写
		await page.waitForTimeout(2500);

		await expect(attrOf(page, "#fx-img", "src")).resolves.toBe("/cdn-media/site/fixture.png");
		await expect(attrOf(page, "#fx-video", "src")).resolves.toBe("/cdn-media/x/2026-07/v.mp4");
		await expect(attrOf(page, "#fx-video", "poster")).resolves.toBe("/cdn-media/x/2026-07/p.jpg");
		await expect(attrOf(page, "#fx-source", "src")).resolves.toBe("/cdn-media/x/2026-07/s.mp4");
		await expect(attrOf(page, "#fx-link", "href")).resolves.toBe("/cdn-media/misc/fixture.bin");
	});

	test("默认规则（base 空串）：引用保持 /cdn-media/ 相对路径（A8 默认同源）", async ({ page }) => {
		test.skip((await fetchGeo()) === null, "需要 wrangler dev 提供本机 /api/geo");

		// 重置本地 KV：先尝试删除（回退语义）；若删除未生效（旧 CLI 确认拦截），落一份默认规则文档——
		// 两者对 /api/geo 的可观测结果一致：{ mediaBase: "", ruleVersion: 0 }
		kvDelete();
		try {
			await waitForGeo({ mediaBase: "", ruleVersion: 0 }, 8_000);
		} catch {
			kvPut(DEFAULT_RULES);
			await waitForGeo({ mediaBase: "", ruleVersion: 0 });
		}

		await open00478(page);
		await injectFixture(page);
		await page.waitForTimeout(2500);

		await expect(attrOf(page, "#fx-img", "src")).resolves.toBe("/cdn-media/site/fixture.png");
		await expect(attrOf(page, "#fx-video", "src")).resolves.toBe("/cdn-media/x/2026-07/v.mp4");
		await expect(attrOf(page, "#fx-video", "poster")).resolves.toBe("/cdn-media/x/2026-07/p.jpg");
		await expect(attrOf(page, "#fx-source", "src")).resolves.toBe("/cdn-media/x/2026-07/s.mp4");
		await expect(attrOf(page, "#fx-link", "href")).resolves.toBe("/cdn-media/misc/fixture.bin");

		// 真实内容护栏：00478 的存量 /x-media/ 引用（Phase 3 才迁移前缀）不得被触碰
		const realPoster = await page.getAttribute(".x-arch-video", "poster");
		expect(realPoster ?? "").toMatch(/^\/x-media\//);
	});

	test("自定义 base：四类引用全部重写为 mediaBase + path", async ({ page }) => {
		test.skip((await fetchGeo()) === null, "需要 wrangler dev 提供本机 /api/geo");

		kvPut(CUSTOM_RULES);
		await waitForGeo({ mediaBase: CUSTOM_BASE, ruleVersion: 7 });

		await open00478(page);
		await injectFixture(page);

		// MutationObserver 触发重写（geo 解析 + MO 回调，放宽等待）
		await expect
			.poll(async () => page.getAttribute("#fx-img", "src"), { timeout: 8_000 })
			.toBe(`${CUSTOM_BASE}/cdn-media/site/fixture.png`);
		await expect(attrOf(page, "#fx-video", "src")).resolves.toBe(`${CUSTOM_BASE}/cdn-media/x/2026-07/v.mp4`);
		await expect(attrOf(page, "#fx-video", "poster")).resolves.toBe(`${CUSTOM_BASE}/cdn-media/x/2026-07/p.jpg`);
		await expect(attrOf(page, "#fx-source", "src")).resolves.toBe(`${CUSTOM_BASE}/cdn-media/x/2026-07/s.mp4`);
		await expect(attrOf(page, "#fx-link", "href")).resolves.toBe(`${CUSTOM_BASE}/cdn-media/misc/fixture.bin`);

		// 幂等护栏：重写后属性不再以 /cdn-media/ 开头（重复扫描不会二次加前缀）
		const imgSrc = await page.getAttribute("#fx-img", "src");
		expect(imgSrc).toBe(`${CUSTOM_BASE}/cdn-media/site/fixture.png`);

		// 真实内容护栏：/x-media/ 引用不被误伤
		const realPoster = await page.getAttribute(".x-arch-video", "poster");
		expect(realPoster ?? "").toMatch(/^\/x-media\//);
	});
});
