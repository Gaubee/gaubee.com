/**
 * geo-store.test.ts —— 文件存储的 DO 语义对齐测试（移植 worker/src/geo-rules-do.test.ts 的关键判定）：
 * 首写拒 0、CAS v+1（重复/回退/跳跃 409 带 currentVersion）、跨实例持久恢复、损坏文件 fail-open。
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { GeoRulesStore } from "../src/geo-store";

function doc(version: number) {
	return { version, rules: [{ match: { default: true }, mediaBase: "" }] };
}

let dir: string;
let path: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "geo-store-"));
	path = join(dir, "geo-rules.json");
});

describe("GeoRulesStore", () => {
	it("空存储：无状态；首写拒 0、接受正整数", () => {
		const store = new GeoRulesStore(path);
		expect(store.hasState()).toBe(false);
		expect(store.getState()).toBeNull();

		const zero = store.putState(doc(0));
		expect(zero.ok).toBe(false);
		if (!zero.ok) expect(zero.status).toBe(400);

		const first = store.putState(doc(1));
		expect(first).toEqual({ ok: true, ruleVersion: 1 });
		expect(store.hasState()).toBe(true);
	});

	it("CAS：v+1 胜；重复/回退/跳跃 409 带 currentVersion", () => {
		const store = new GeoRulesStore(path);
		expect(store.putState(doc(1)).ok).toBe(true);

		const dup = store.putState(doc(1));
		expect(dup.ok).toBe(false);
		if (!dup.ok) {
			expect(dup.status).toBe(409);
			expect(dup.body.currentVersion).toBe(1);
		}

		const skip = store.putState(doc(3));
		expect(skip.ok).toBe(false);

		expect(store.putState(doc(2)).ok).toBe(true);
		// 旧代重放（回退）同样 409
		const stale = store.putState(doc(1));
		expect(stale.ok).toBe(false);
	});

	it("持久化：新实例从磁盘恢复；落盘内容为完整文档", () => {
		const store = new GeoRulesStore(path);
		store.putState(doc(1));
		const reopened = new GeoRulesStore(path);
		expect(reopened.getState()).toEqual(doc(1));
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(doc(1));
	});

	it("损坏文件：fail-open 视为无状态，且允许首写（覆盖坏文件）", () => {
		writeFileSync(path, "{not json");
		const store = new GeoRulesStore(path);
		expect(store.hasState()).toBe(false);
		expect(store.putState(doc(5)).ok).toBe(true);
	});

	it("schema 不过的文件：同样视为无状态", () => {
		writeFileSync(path, JSON.stringify({ version: 1, rules: "oops" }));
		const store = new GeoRulesStore(path);
		expect(store.hasState()).toBe(false);
	});
});
