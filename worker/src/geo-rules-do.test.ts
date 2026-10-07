/**
 * GeoRulesDO 单测（r10 P1-1：规则写入并发线性化的判别测试）：
 * - 并发 Promise.all 两个 version+1 的 PUT → 恰一 200、一 409，最终 state 唯一胜者；
 * - 首写正整数 200、首写 0 → 400；重复/回退/跳跃 → 409 带 currentVersion；严格 +1 → 200；
 * - schema 非法 → 400（防御纵深）；非法 JSON → 400；未知路径/方法 → 404；
 * - DO 重启（同 storage 的新实例）后 state 从 storage 恢复；
 * - storage.put 失败 → 内存回滚不留半提交。
 * 不依赖 workerd：DurableObjectState 用内存 Map 替身（get/put/blockConcurrencyWhile 结构面）。
 * node 单线程下「判定 → 内存落定」是无 await 的同步段，与 workerd input gate 等价地保证
 * CAS 原子性——两条路径都覆盖到并发判别力。
 */
import { describe, expect, it } from "vitest";

import type { GeoRules } from "../../src/lib/geo/contract";
import { GeoRulesDO } from "./geo-rules-do";

/** 内存 storage + blockConcurrencyWhile 直通的 DurableObjectState 测试替身。 */
function makeState(map: Map<string, unknown>): DurableObjectState {
	const storage = {
		get: async <T>(key: string): Promise<T | undefined> => map.get(key) as T | undefined,
		put: async (key: string, value: unknown): Promise<void> => {
			map.set(key, value);
		},
		delete: async (key: string): Promise<boolean> => map.delete(key),
		deleteAll: async (): Promise<void> => {
			map.clear();
		},
	};
	return {
		storage,
		blockConcurrencyWhile: (fn: () => Promise<void>): Promise<void> => fn(),
	} as unknown as DurableObjectState;
}

/** 新建 DO 实例；传入共享 map 可模拟「同 id 重启后的新实例」。 */
function makeDO(map: Map<string, unknown> = new Map()): { obj: GeoRulesDO; map: Map<string, unknown> } {
	return { obj: new GeoRulesDO(makeState(map), null), map };
}

const getState = (d: GeoRulesDO): Promise<Response> => d.fetch(new Request("https://do.test/state"));

const putState = (d: GeoRulesDO, body: unknown): Promise<Response> =>
	d.fetch(
		new Request("https://do.test/state", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);

const putRaw = (d: GeoRulesDO, raw: string): Promise<Response> =>
	d.fetch(new Request("https://do.test/state", { method: "PUT", body: raw }));

const BASE_RULES: GeoRules = {
	version: 3,
	rules: [
		{ match: { countries: ["CN"] }, mediaBase: "https://esa.example.com" },
		{ match: { default: true }, mediaBase: "" },
	],
};

/** 预置规则（走 DO 自身 PUT，首写语义：空实例接受任意正整数版本）。 */
async function seed(d: GeoRulesDO, rules: GeoRules): Promise<void> {
	const res = await putState(d, rules);
	if (res.status !== 200) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
}

describe("GeoRulesDO 基本语义", () => {
	it("无状态 GET /state → 404", async () => {
		const { obj } = makeDO();
		expect((await getState(obj)).status).toBe(404);
	});

	it("首写任意正整数 → 200 {ok, ruleVersion}，state 可回读", async () => {
		const { obj } = makeDO();
		const res = await putState(obj, BASE_RULES);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, ruleVersion: 3 });
		const doc = (await (await getState(obj)).json()) as GeoRules;
		expect(doc).toEqual(BASE_RULES);
	});

	it("首写 version 0 → 400（与内置默认规则 v0 撞代次）", async () => {
		const { obj } = makeDO();
		const res = await putState(obj, { ...BASE_RULES, version: 0 });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: string };
		expect(body.error).toContain("first write");
	});

	it("重复/回退/跳跃 → 409 带 currentVersion；严格 +1 → 200", async () => {
		const { obj } = makeDO();
		await seed(obj, BASE_RULES);

		const dup = await putState(obj, BASE_RULES);
		expect(dup.status).toBe(409);
		expect(await dup.json()).toEqual({
			error: "version conflict: current 3, expected 4",
			currentVersion: 3,
		});

		expect((await putState(obj, { ...BASE_RULES, version: 2 })).status).toBe(409);
		expect((await putState(obj, { ...BASE_RULES, version: 5 })).status).toBe(409);

		const ok = await putState(obj, { ...BASE_RULES, version: 4 });
		expect(ok.status).toBe(200);
		const doc = (await (await getState(obj)).json()) as GeoRules;
		expect(doc.version).toBe(4);
	});

	it("schema 非法 → 400（防御纵深：不信任上游 worker 的校验）", async () => {
		const { obj } = makeDO();
		const bad = await putState(obj, { version: "x", rules: [] });
		expect(bad.status).toBe(400);
		const unknown = await putState(obj, { version: 1, rules: [], extra: true });
		expect(unknown.status).toBe(400);
	});

	it("非法 JSON body → 400；未知路径/方法 → 404", async () => {
		const { obj } = makeDO();
		expect((await putRaw(obj, "{broken json")).status).toBe(400);
		expect((await obj.fetch(new Request("https://do.test/other"))).status).toBe(404);
		expect(
			(await obj.fetch(new Request("https://do.test/state", { method: "DELETE" }))).status,
		).toBe(404);
	});
});

describe("GeoRulesDO 并发线性化（r10 P1-1 判别）", () => {
	it("并发两个 version+1 的 PUT → 恰一 200、一 409，最终 state 唯一胜者（多轮）", async () => {
		for (let round = 0; round < 25; round++) {
			const { obj } = makeDO();
			await seed(obj, BASE_RULES);

			const a: GeoRules = {
				version: 4,
				rules: [{ match: { countries: ["CN"] }, mediaBase: "https://a.example.com" }],
			};
			const b: GeoRules = {
				version: 4,
				rules: [{ match: { countries: ["JP"] }, mediaBase: "https://b.example.com" }],
			};
			const [ra, rb] = await Promise.all([putState(obj, a), putState(obj, b)]);

			expect([ra.status, rb.status].sort()).toEqual([200, 409]);
			const winner = ra.status === 200 ? a : b;
			const loser = ra.status === 409 ? ra : rb;
			// 409 必然报告胜者已提交的 v4（CAS 原子：后到者的版本判定必见先到者的内存落定）——
			// 若见到 v3 则意味着判定与写入之间可被插入，正是 r10 P1-1 要消灭的丢失更新窗口
			expect(await loser.json()).toEqual({
				error: "version conflict: current 4, expected 5",
				currentVersion: 4,
			});
			// 最终文档只有一个确定胜者：state 逐字段等于 200 那个请求的 body
			const doc = (await (await getState(obj)).json()) as GeoRules;
			expect(doc).toEqual(winner);
		}
	});

	it("并发两个首写 → 恰一 200（另一个 409），state 唯一", async () => {
		const { obj } = makeDO();
		const a: GeoRules = { version: 1, rules: [{ match: { default: true }, mediaBase: "https://a.example.com" }] };
		const b: GeoRules = { version: 1, rules: [{ match: { default: true }, mediaBase: "https://b.example.com" }] };
		const [ra, rb] = await Promise.all([putState(obj, a), putState(obj, b)]);
		expect([ra.status, rb.status].sort()).toEqual([200, 409]);
		const doc = (await (await getState(obj)).json()) as GeoRules;
		expect(doc).toEqual(ra.status === 200 ? a : b);
	});

	it("storage.put 失败 → 异常上抛且内存回滚（不留半提交）", async () => {
		const map = new Map<string, unknown>();
		const { obj } = makeDO(map);
		await seed(obj, BASE_RULES);

		const failing = new GeoRulesDO(
			{
				storage: {
					get: async <T>(key: string): Promise<T | undefined> => map.get(key) as T | undefined,
					put: async (): Promise<void> => {
						throw new Error("storage unavailable");
					},
				},
				blockConcurrencyWhile: (fn: () => Promise<void>): Promise<void> => fn(),
			} as unknown as DurableObjectState,
			null,
		);
		await expect(putState(failing, { ...BASE_RULES, version: 4 })).rejects.toThrow("storage unavailable");

		// 失败实例自身内存已回滚；storage 未被触碰（共享 map 的原实例仍 v3）
		const memAfter = (await (await getState(failing)).json()) as GeoRules;
		expect(memAfter.version).toBe(3);
		const doc = (await (await getState(obj)).json()) as GeoRules;
		expect(doc.version).toBe(3);
	});
});

describe("GeoRulesDO 持久化（重启恢复）", () => {
	it("同 storage 的新实例（模拟 DO 重启/换 isolate）state 从 storage 恢复", async () => {
		const map = new Map<string, unknown>();
		const first = makeDO(map).obj;
		await seed(first, { ...BASE_RULES, version: 7 });

		const restarted = makeDO(map).obj;
		const doc = (await (await getState(restarted)).json()) as GeoRules;
		expect(doc).toEqual({ ...BASE_RULES, version: 7 });
		// 恢复后的实例继续执行版本单调：v8 可写，v7 重复 → 409
		expect((await putState(restarted, { ...BASE_RULES, version: 7 })).status).toBe(409);
		expect((await putState(restarted, { ...BASE_RULES, version: 8 })).status).toBe(200);
	});
});
