/**
 * geo-store.ts —— geo 规则文档的文件存储（worker/src/geo-rules-do.ts GeoRulesDO 的自托管移植）。
 *
 * 语义契约（与 DO 逐条对齐，见原文件头）：
 * - 单文档存储：{version, rules}；无状态 → 读接口报 not_found（geo-routes 落默认规则）。
 * - 版本单调 CAS：已有状态时要求写入 version === current+1（重复/回退/跳跃 → 409 带
 *   currentVersion）；首写接受任意正整数（拒 0，避免与内置默认规则 v0 撞代次）。
 * - 判定与内存落定之间无 await（单线程内原子）；落盘用 tmp + rename 原子替换——写盘失败
 *   回滚内存态并上抛（调用方 5xx，客户端重试），不留半提交。
 * - 恢复先于服务：启动时同步加载；文件不存在视为无状态；文件损坏（非法 JSON/schema 不过）
 *   视为无状态并审计（fail-safe：geo-routes 层落内置默认规则，绝不 500）。
 *
 * 与 DO 的差异（自托管单进程使然）：DO 用 workerd input gate 串行化并发；这里单进程
 * Node/Bun 事件循环内「读态 → 判定 → 内存落定」本就原子，唯一的 await 是结尾的
 * rename（此前内存已落定且不可逆），并发 v+1 请求同样恰一胜一 409。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { validateGeoRules, type GeoRules } from "../../src/lib/geo/contract";

export type GeoWriteResult =
	| { ok: true; ruleVersion: number }
	| { ok: false; status: 400 | 409; body: Record<string, unknown> };

export class GeoRulesStore {
	private state: GeoRules | null = null;

	constructor(private readonly filePath: string) {
		this.state = this.loadFromDisk();
	}

	/** 启动恢复：不存在/损坏 → null（无状态），损坏时审计。 */
	private loadFromDisk(): GeoRules | null {
		let raw: string;
		try {
			raw = readFileSync(this.filePath, "utf8");
		} catch {
			return null;
		}
		try {
			const parsed = validateGeoRules(JSON.parse(raw));
			if (!parsed.ok) {
				this.auditCorrupt(parsed.error);
				return null;
			}
			return parsed.value;
		} catch {
			this.auditCorrupt("invalid json");
			return null;
		}
	}

	private auditCorrupt(reason: string): void {
		console.log(JSON.stringify({ audit: "geo_rules.store_corrupt", at: new Date().toISOString(), path: this.filePath, reason }));
	}

	hasState(): boolean {
		return this.state !== null;
	}

	/** GET /state 语义：无状态返回 null（调用方转 404 / 默认规则）。 */
	getState(): GeoRules | null {
		return this.state;
	}

	/** PUT /state 语义：schema 校验后的文档做版本判定 + 原子落盘。 */
	putState(next: GeoRules): GeoWriteResult {
		if (this.state) {
			const current = this.state.version;
			if (next.version !== current + 1) {
				return {
					ok: false,
					status: 409,
					body: { error: `version conflict: current ${current}, expected ${current + 1}`, currentVersion: current },
				};
			}
		} else if (next.version < 1) {
			return { ok: false, status: 400, body: { error: "invalid: first write requires a positive integer version" } };
		}
		const prev = this.state;
		this.state = next;
		try {
			mkdirSync(dirname(this.filePath), { recursive: true });
			const tmp = `${this.filePath}.tmp`;
			// writeFileSync + renameSync：同目录原子替换，崩溃至多留下未 rename 的 tmp，不损原文档
			writeFileSync(tmp, JSON.stringify(next));
			renameSync(tmp, this.filePath);
		} catch (e) {
			this.state = prev;
			throw e;
		}
		return { ok: true, ruleVersion: next.version };
	}
}
