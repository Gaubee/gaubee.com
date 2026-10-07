/**
 * GeoRulesDO —— geo 规则文档的单写入器 Durable Object（cdn-media Phase 2，r10 P1-1）。
 *
 * 为什么存在：KV 没有 compare-and-swap，「KV.get → 比较 current+1 → KV.put」在并发 owner
 * 写入时可以双双读到同一代、双双 200、后写覆盖先写（r10 P1-1）。Durable Object 天然串行：
 * 全网单实例（geo.ts 经 idFromName("geo-rules") 寻址），版本判定逻辑只活在这里——
 * 内存态 + storage 持久化（单 key，putAll/deleteAll 级别，无需 SQL）。
 *
 * RPC 面（极简 fetch 协议，geo.ts 之外无人可达）：
 * - GET  /state → 200 {version, rules}；无状态 → 404
 * - PUT  /state → body {version, rules}；先 schema 校验（复用 contract 的 validateGeoRules，
 *   防御纵深：不信任上游 worker），再做版本判定——
 *   已有状态时要求 version === current+1（重复/回退/跳跃 → 409 带 currentVersion）；
 *   首写接受任意正整数（0 与内置默认规则 v0 撞代次 → 400）。
 *
 * 并发/持久化语义（线性化的两道保险）：
 * 1. workerd input gate：storage 操作在途时不向对象投递任何其它事件，PUT 的
 *    storage.put 期间不可能插入第二个请求；
 * 2. 判定段同步化：「读内存态 → 版本比较 → 内存落定」之间没有任何 await，单线程
 *    解释器里天然原子；随后才 await storage.put 落盘。并发的两个 v+1 请求必是
 *    恰一胜一 409，最终文档只有一个确定胜者。
 * - 构造器 blockConcurrencyWhile：storage 恢复先于任何事件投递，保证判定前内存态就绪。
 * - 崩溃窗口：内存已落定、storage.put 未确认即崩溃 → 200 尚未发出，客户端重试即可；
 *   put 失败（不崩溃时）回滚内存态，不留半提交。
 */
import { validateGeoRules, type GeoRules } from "../../src/lib/geo/contract";

/** DO storage 中的唯一 key（单文档存储）。 */
const STORAGE_KEY = "geo_rules";

function json(value: unknown, status: number): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export class GeoRulesDO {
	private state: GeoRules | null = null;
	/** storage 恢复的完成信号：每个事件处理前 await，保证判定前内存态就绪（见下）。 */
	private readonly ready: Promise<void>;

	constructor(private readonly ctx: DurableObjectState, _env: unknown) {
		// 恢复先于任何请求事件：workerd 在 blockConcurrencyWhile 期间不投递事件；
		// 再把返回的 promise 存下并在 fetch 顶部 await——即使宿主不实现门语义
		//（如测试替身），恢复也严格先于处理逻辑，语义不依赖宿主细节。
		this.ready = this.ctx.blockConcurrencyWhile(async () => {
			this.state = (await this.ctx.storage.get<GeoRules>(STORAGE_KEY)) ?? null;
		});
	}

	async fetch(request: Request): Promise<Response> {
		await this.ready;
		const url = new URL(request.url);
		if (url.pathname !== "/state") {
			return json({ error: "not_found" }, 404);
		}
		if (request.method === "GET") {
			return this.state ? json(this.state, 200) : json({ error: "not_found" }, 404);
		}
		if (request.method === "PUT") {
			let body: unknown;
			try {
				body = await request.json();
			} catch {
				return json({ error: "invalid: body must be json" }, 400);
			}
			// 防御纵深：worker 已做过同一校验，DO 仍以 contract 为唯一信源再验一次。
			const parsed = validateGeoRules(body);
			if (!parsed.ok) {
				return json({ error: `invalid: ${parsed.error}` }, 400);
			}
			return this.writeVersioned(parsed.value);
		}
		return json({ error: "not_found" }, 404);
	}

	/** 版本判定 + 写入。判定与内存落定为同步段（无 await），单实例内原子；语义见文件头。 */
	private async writeVersioned(next: GeoRules): Promise<Response> {
		if (this.state) {
			const current = this.state.version;
			const expected = current + 1;
			if (next.version !== expected) {
				return json(
					{
						error: `version conflict: current ${current}, expected ${expected}`,
						currentVersion: current,
					},
					409,
				);
			}
		} else if (next.version < 1) {
			// 首写拒 0：与内置默认规则 version 0 撞代次，已缓存 v0 的 tab 分不清默认与自定义规则。
			return json({ error: "invalid: first write requires a positive integer version" }, 400);
		}
		const prev = this.state;
		this.state = next;
		try {
			await this.ctx.storage.put(STORAGE_KEY, next);
		} catch (e) {
			// put 失败回滚内存态（不留半提交）；异常上抛 → workerd 报 5xx，客户端重试。
			this.state = prev;
			throw e;
		}
		return json({ ok: true, ruleVersion: next.version }, 200);
	}
}
