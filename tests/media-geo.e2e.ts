import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
 * 运行拓扑（复现生产反代路由，全部真实组件）：
 *   - `vite preview`（build 产物，/api 经 vite.config preview.proxy 转发）
 *   - `wrangler dev`（worker 目录，localhost:8787，真实 workerd + GeoRulesDO）
 *   - PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm exec playwright test tests/media-geo.e2e.ts
 *
 * 规则写入（r11 P1-2，KV 退役后）：经本地 worker 的 owner PUT（PUT /api/geo/rules）
 * 写入 GeoRulesDO——Bearer GitHub token 走真实鉴权链路（worker 调 GitHub /user 比对
 * OWNER_LOGIN）。token 用环境变量注入：export GH_TOKEN="$(gh auth token)"（owner 本人），
 * 或任意 GITHUB_TOKEN / GH_TOKEN（其 login 须为 owner）。
 *
 * DO 状态管理：wrangler dev 由本文件按需拉起（8787 已有存活实例则复用），persist 目录用
 * 一次性 mkdtemp（独立于默认 .wrangler/state）——默认规则场景依赖空 DO 状态
 * （DO 404 → worker 回退内置默认规则 v0），一次性目录保证零历史污染；结束后自动
 * 回收进程组并删除目录（进程零遗留）。
 */

const WORKER_DIR = fileURLToPath(new URL("../worker", import.meta.url));
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
/** 种规则用的 owner token（r11 P1-2：真实 owner PUT 链路，环境变量注入）。 */
const OWNER_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";

const CUSTOM_BASE = "https://cdn-local.test";
const CUSTOM_RULES = [
	{ match: { countries: ["CN"] }, mediaBase: "https://cn.example.test" },
	{ match: { default: true }, mediaBase: CUSTOM_BASE },
];

/** 本文件拉起的 wrangler dev 及其一次性状态目录（teardown 责任）。 */
let workerProc: ChildProcess | null = null;
let workerStateDir: string | null = null;
let workerLogPath: string | null = null;

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function fetchGeo(): Promise<{ mediaBase: string; ruleVersion: number } | null> {
	try {
		const res = await fetch(`${BASE_URL}/api/geo`);
		if (!res.ok) return null;
		return (await res.json()) as { mediaBase: string; ruleVersion: number };
	} catch {
		return null;
	}
}

/** 确保 8787 有存活的 wrangler dev：外部已启动则复用；否则拉起一次性实例（空 DO 状态）。 */
async function ensureWorker(): Promise<void> {
	if (await fetchGeo()) return;

	workerStateDir = await mkdtemp(path.join(tmpdir(), "gaubee-geo-e2e-"));
	workerLogPath = path.join(workerStateDir, "wrangler-dev.log");
	const log = await open(workerLogPath, "a");
	try {
		// detached：独立进程组，teardown 用 kill(-pid) 把 wrangler 与其 workerd 孙进程一并收割
		workerProc = spawn(
			"npx",
			["wrangler", "dev", "--port", "8787", "--persist-to", workerStateDir],
			{ cwd: WORKER_DIR, stdio: ["ignore", log.fd, log.fd], detached: true },
		);
	} finally {
		await log.close();
	}

	const deadline = Date.now() + 90_000;
	for (;;) {
		if (await fetchGeo()) return;
		if (workerProc.exitCode !== null) {
			throw new Error(`wrangler dev 提前退出（code ${workerProc.exitCode}），日志尾部：\n${await logTail()}`);
		}
		if (Date.now() > deadline) {
			throw new Error(`wrangler dev 90s 未就绪，日志尾部：\n${await logTail()}`);
		}
		await sleep(500);
	}
}

async function logTail(): Promise<string> {
	if (!workerLogPath) return "(无日志)";
	try {
		const text = await readFile(workerLogPath, "utf8");
		return text.split("\n").slice(-20).join("\n");
	} catch {
		return "(日志读取失败)";
	}
}

/** 回收本文件拉起的 wrangler dev（进程组 SIGTERM → SIGKILL 兜底）+ 清理一次性状态目录。 */
async function stopWorker(): Promise<void> {
	const proc = workerProc;
	workerProc = null;
	if (proc?.pid) {
		try {
			process.kill(-proc.pid, "SIGTERM");
		} catch {
			/* 进程组已不存在 */
		}
		const deadline = Date.now() + 10_000;
		while (proc.exitCode === null && Date.now() < deadline) await sleep(200);
		if (proc.exitCode === null) {
			try {
				process.kill(-proc.pid, "SIGKILL");
			} catch {
				/* 同上 */
			}
		}
	}
	if (workerStateDir) {
		await rm(workerStateDir, { recursive: true, force: true }).catch(() => {});
		workerStateDir = null;
	}
}

/**
 * 经本地 worker 的 owner PUT 种入自定义规则（真实鉴权链路），返回实际写入的版本号。
 * 先 owner GET 当前 DO 状态：空状态（fromDefault）用夹具版本 7（首写接受任意正整数），
 * 已有状态则 current+1（版本单调纪律）。
 */
async function seedCustomRules(): Promise<number> {
	if (!OWNER_TOKEN) {
		throw new Error('缺少 owner GitHub token：export GH_TOKEN="$(gh auth token)" 后重跑');
	}
	const readRes = await fetch(`${BASE_URL}/api/geo/rules`, {
		headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
	});
	if (!readRes.ok) {
		throw new Error(`GET /api/geo/rules → ${readRes.status}（token 无效或非 owner？）`);
	}
	const current = (await readRes.json()) as { rules: { version: number }; fromDefault: boolean };
	const version = current.fromDefault ? 7 : current.rules.version + 1;
	const putRes = await fetch(`${BASE_URL}/api/geo/rules`, {
		method: "PUT",
		headers: { Authorization: `Bearer ${OWNER_TOKEN}`, "Content-Type": "application/json" },
		body: JSON.stringify({ version, rules: CUSTOM_RULES }),
	});
	if (!putRes.ok) {
		throw new Error(`PUT /api/geo/rules → ${putRes.status} ${await putRes.text()}`);
	}
	return version;
}

/** 轮询直到 /api/geo 达到期望状态（写入传播 + 浏览器外确认）。 */
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
	// 本文件拉起的 wrangler dev（一次性状态目录）由 teardown 统一收割（进程零遗留）
	test.afterAll(stopWorker);

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
		await ensureWorker();

		// 空 DO 状态护栏：一次性 persist 目录保证 DO 从零开始（404 → 内置默认 v0）。
		// 外部复用的实例若已有规则，直接给出可操作的失败信息，而不是静默误判。
		const current = await fetchGeo();
		if (current && (current.mediaBase !== "" || current.ruleVersion !== 0)) {
			throw new Error(
				`默认规则场景要求空 DO 状态，实际 ${JSON.stringify(current)}。` +
					"复用的 wrangler dev 已有规则数据：请关掉它重跑（本文件会自动拉起一次性空状态实例）。",
			);
		}
		await waitForGeo({ mediaBase: "", ruleVersion: 0 });

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
		test.skip(!OWNER_TOKEN, '需要 owner GitHub token 种规则：export GH_TOKEN="$(gh auth token)"');
		await ensureWorker();

		const version = await seedCustomRules();
		await waitForGeo({ mediaBase: CUSTOM_BASE, ruleVersion: version });

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
