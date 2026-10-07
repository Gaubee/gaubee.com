/**
 * geo 契约单测（node，纯函数）—— schema 校验 / 解析算法 / 拼接幂等。
 * 覆盖 cdn-media-bootstrap Phase 2 的规则引擎核心；HTTP 层见 worker/src/index.test.ts。
 */
import { describe, expect, it } from "vitest";

import {
	DEFAULT_GEO_RULES,
	isValidMediaBase,
	isValidRuleVersion,
	joinMediaBase,
	resolveGeoBase,
	validateGeoRules,
} from "./contract";

describe("validateGeoRules", () => {
	it("合法文档通过（含 countries + default 两类规则）", () => {
		const r = validateGeoRules({
			version: 3,
			rules: [
				{ match: { countries: ["CN"], continents: ["AS"] }, mediaBase: "https://esa.example.com" },
				{ match: { default: true }, mediaBase: "" },
			],
		});
		expect(r.ok).toBe(true);
	});

	it("非对象 / 数组拒绝", () => {
		expect(validateGeoRules(null).ok).toBe(false);
		expect(validateGeoRules("x").ok).toBe(false);
		expect(validateGeoRules([]).ok).toBe(false);
	});

	it("version 非负整数，否则拒绝", () => {
		expect(validateGeoRules({ version: -1, rules: [] }).ok).toBe(false);
		expect(validateGeoRules({ version: 1.5, rules: [] }).ok).toBe(false);
		expect(validateGeoRules({ version: "1", rules: [] }).ok).toBe(false);
	});

	it("未知字段拒绝（严格模式防 typo 静默 no-op）", () => {
		expect(validateGeoRules({ version: 1, rules: [], extra: 1 }).ok).toBe(false);
		expect(
			validateGeoRules({ version: 1, rules: [{ match: { default: true }, mediaBase: "", base: "x" }] })
				.ok,
		).toBe(false);
		expect(
			validateGeoRules({ version: 1, rules: [{ match: { default: true, region: "x" }, mediaBase: "" }] })
				.ok,
		).toBe(false);
	});

	it("mediaBase 必须是空串或 http(s) origin（拒绝带路径/非 http）", () => {
		expect(validateGeoRules({ version: 1, rules: [{ match: { default: true }, mediaBase: "" }] }).ok).toBe(
			true,
		);
		expect(
			validateGeoRules({ version: 1, rules: [{ match: { default: true }, mediaBase: "https://c.test" }] })
				.ok,
		).toBe(true);
		expect(
			validateGeoRules({
				version: 1,
				rules: [{ match: { default: true }, mediaBase: "https://c.test/path" }],
			}).ok,
		).toBe(false);
		expect(
			validateGeoRules({ version: 1, rules: [{ match: { default: true }, mediaBase: "ftp://c.test" }] })
				.ok,
		).toBe(false);
		expect(
			validateGeoRules({ version: 1, rules: [{ match: { default: true }, mediaBase: "c.test" }] }).ok,
		).toBe(false);
	});

	it("match 空条件拒绝；国家码/大陆码格式校验", () => {
		expect(validateGeoRules({ version: 1, rules: [{ match: {}, mediaBase: "" }] }).ok).toBe(false);
		expect(validateGeoRules({ version: 1, rules: [{ match: { countries: ["cn"] }, mediaBase: "" }] }).ok).toBe(
			false,
		);
		expect(
			validateGeoRules({ version: 1, rules: [{ match: { continents: ["XX"] }, mediaBase: "" }] }).ok,
		).toBe(false);
		expect(validateGeoRules({ version: 1, rules: [{ match: { default: false }, mediaBase: "" }] }).ok).toBe(
			false,
		);
	});

	it("rules 超上限拒绝", () => {
		const rules = Array.from({ length: 65 }, () => ({ match: { default: true }, mediaBase: "" }));
		expect(validateGeoRules({ version: 1, rules }).ok).toBe(false);
	});
});

describe("resolveGeoBase", () => {
	it("默认规则：全球同源（A8）", () => {
		expect(resolveGeoBase(DEFAULT_GEO_RULES, "CN", "AS")).toEqual({
			mediaBase: "",
			ruleVersion: 0,
		});
	});

	it("country 命中取对应规则；未命中落到 default", () => {
		const rules = validateGeoRules({
			version: 7,
			rules: [
				{ match: { countries: ["CN"] }, mediaBase: "https://cn.example.com" },
				{ match: { default: true }, mediaBase: "" },
			],
		});
		if (!rules.ok) throw new Error(rules.error);
		expect(resolveGeoBase(rules.value, "cn")).toEqual({ mediaBase: "https://cn.example.com", ruleVersion: 7 });
		expect(resolveGeoBase(rules.value, "US")).toEqual({ mediaBase: "", ruleVersion: 7 });
		expect(resolveGeoBase(rules.value)).toEqual({ mediaBase: "", ruleVersion: 7 });
	});

	it("continent 命中；声明顺序即优先级", () => {
		const rules = validateGeoRules({
			version: 2,
			rules: [
				{ match: { countries: ["US"] }, mediaBase: "https://us.example.com" },
				{ match: { continents: ["AS"] }, mediaBase: "https://as.example.com" },
			],
		});
		if (!rules.ok) throw new Error(rules.error);
		expect(resolveGeoBase(rules.value, "JP", "AS").mediaBase).toBe("https://as.example.com");
	});

	it("无任何命中 → 空串兜底（含 rules 为空数组的全球同源语义）", () => {
		const rules = validateGeoRules({ version: 9, rules: [] });
		if (!rules.ok) throw new Error(rules.error);
		expect(resolveGeoBase(rules.value, "CN", "AS")).toEqual({ mediaBase: "", ruleVersion: 9 });
	});
});

describe("joinMediaBase", () => {
	it("空串 = 同源原样返回；非空剥尾斜杠拼接", () => {
		expect(joinMediaBase("", "/cdn-media/x/a.jpg")).toBe("/cdn-media/x/a.jpg");
		expect(joinMediaBase("https://cdn.example.com", "/cdn-media/x/a.jpg")).toBe(
			"https://cdn.example.com/cdn-media/x/a.jpg",
		);
		expect(joinMediaBase("https://cdn.example.com/", "/cdn-media/x/a.jpg")).toBe(
			"https://cdn.example.com/cdn-media/x/a.jpg",
		);
	});

	it("内置默认规则版本（v0 = 未写规则的全球同源代次）", () => {
		expect(DEFAULT_GEO_RULES.version).toBe(0);
		expect(DEFAULT_GEO_RULES.rules).toEqual([{ match: { default: true }, mediaBase: "" }]);
	});
});

describe("isValidMediaBase / isValidRuleVersion（r9 P1-4：/api/geo 响应防御校验共用）", () => {
	it("mediaBase：空串与 http(s) origin 通过；带路径/裸 host/非字符串拒绝", () => {
		expect(isValidMediaBase("")).toBe(true);
		expect(isValidMediaBase("https://cdn.example.com")).toBe(true);
		expect(isValidMediaBase("http://localhost:8080")).toBe(true);
		expect(isValidMediaBase("https://cdn.example.com/path")).toBe(false);
		expect(isValidMediaBase("https://cdn.example.com?q=1")).toBe(false);
		expect(isValidMediaBase("cdn.example.com")).toBe(false);
		expect(isValidMediaBase("ftp://cdn.example.com")).toBe(false);
		expect(isValidMediaBase(1)).toBe(false);
		expect(isValidMediaBase(null)).toBe(false);
	});

	it("ruleVersion：非负整数通过；负数/小数/字符串/NaN 拒绝", () => {
		expect(isValidRuleVersion(0)).toBe(true);
		expect(isValidRuleVersion(7)).toBe(true);
		expect(isValidRuleVersion(-1)).toBe(false);
		expect(isValidRuleVersion(1.5)).toBe(false);
		expect(isValidRuleVersion("1")).toBe(false);
		expect(isValidRuleVersion(Number.NaN)).toBe(false);
	});
});
