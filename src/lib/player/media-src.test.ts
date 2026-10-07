/**
 * media-src 单测（node，r9 P1-2 失效广播 + P1-4 响应严格校验）：
 * - 两级缓存读取/写入：内存单例 + sessionStorage（head 指针 + 版本条目）。
 * - broadcastGeoInvalidation：本 tab 立即清内存与 sessionStorage 并重拉；广播报文进
 *   "cdn-media-geo" 频道并携带规则版本号。
 * - 跨 tab 接收：BroadcastChannel stub 收到合法失效消息 → 清缓存重拉；非法消息/解绑后不触发。
 * - 飞行中失效：旧 fetch 结果按失效代次丢弃，原 promise 转链到新拉取（旧值不回填缓存）。
 * - /api/geo 响应严格校验：mediaBase 非 origin 形态 / ruleVersion 非法 → 按失败处理。
 * DOM 层（action 重写/还原、MutationObserver）由 tests/media-geo.e2e.ts 在浏览器覆盖。
 * 全局（sessionStorage/BroadcastChannel/fetch）经 vi.stubGlobal 结构注入；模块级单例状态
 * 用 vi.resetModules + 动态 import 在用例间隔离。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

interface GeoPayload {
	mediaBase: string;
	ruleVersion: number;
}

/** 内存 sessionStorage（node 环境无此全局）。 */
class MemSessionStorage {
	private store = new Map<string, string>();
	getItem(key: string): string | null {
		return this.store.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.store.set(key, String(value));
	}
	removeItem(key: string): void {
		this.store.delete(key);
	}
	key(index: number): string | null {
		return [...this.store.keys()][index] ?? null;
	}
	get length(): number {
		return this.store.size;
	}
}

/** BroadcastChannel stub：记录 postMessage 报文，测试侧可模拟其它 tab 广播到达。 */
class ChannelStub {
	static instances: ChannelStub[] = [];
	name: string;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	messages: unknown[] = [];
	constructor(name: string) {
		this.name = name;
		ChannelStub.instances.push(this);
	}
	postMessage(data: unknown): void {
		this.messages.push(data);
	}
	/** 测试辅助：模拟其它 tab 广播的消息到达本 tab。 */
	receive(data: unknown): void {
		this.onmessage?.({ data });
	}
}

/** geo 载荷 → 同步 Response（fetch stub 的返回体）。 */
function geoResp(payload: GeoPayload): Response {
	return new Response(JSON.stringify(payload), { status: 200 });
}

/** fetch 注入口：每个用例自行赋值（可换 payload / 可控挂起）。 */
let fetchImpl: () => Response | Promise<Response>;

/** 安装全局 stub（sessionStorage/BroadcastChannel/fetch），返回 sessionStorage 供断言。 */
function installGlobals(): MemSessionStorage {
	const storage = new MemSessionStorage();
	ChannelStub.instances = [];
	vi.stubGlobal("sessionStorage", storage);
	vi.stubGlobal("BroadcastChannel", ChannelStub);
	vi.stubGlobal("fetch", () => fetchImpl());
	return storage;
}

/** 重置模块注册表后动态导入，拿到全新模块级状态（cachedBase/generation/listeners）。 */
async function freshModule(): Promise<typeof import("./media-src")> {
	vi.resetModules();
	return await import("./media-src");
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("getGeoMediaBase 两级缓存", () => {
	it("fetch 成功 → 返回 base；内存缓存生效（第二次调用不再发请求）；sessionStorage 写 head+版本条目", async () => {
		const storage = installGlobals();
		let calls = 0;
		fetchImpl = () => {
			calls += 1;
			return geoResp({ mediaBase: "https://a.test", ruleVersion: 1 });
		};
		const m = await freshModule();
		expect(await m.getGeoMediaBase()).toBe("https://a.test");
		expect(await m.getGeoMediaBase()).toBe("https://a.test");
		expect(calls).toBe(1);
		expect(storage.getItem("media-src:geo:head")).toBeTruthy();
		expect(JSON.parse(storage.getItem("media-src:geo:v1") as string).mediaBase).toBe("https://a.test");
	});

	it("跨模块实例共享 sessionStorage 缓存（新实例命中条目，不再发请求）", async () => {
		installGlobals();
		let calls = 0;
		fetchImpl = () => {
			calls += 1;
			return geoResp({ mediaBase: "https://a.test", ruleVersion: 1 });
		};
		const m1 = await freshModule();
		expect(await m1.getGeoMediaBase()).toBe("https://a.test");
		const m2 = await freshModule();
		expect(await m2.getGeoMediaBase()).toBe("https://a.test");
		expect(calls).toBe(1);
	});
});

describe("/api/geo 响应严格校验（r9 P1-4）", () => {
	it("mediaBase 带 path（非 origin 形态）→ 按失败处理：null 且不写 sessionStorage", async () => {
		const storage = installGlobals();
		fetchImpl = () => geoResp({ mediaBase: "https://a.test/cdn", ruleVersion: 1 });
		const m = await freshModule();
		await expect(m.getGeoMediaBase()).resolves.toBeNull();
		expect(storage.getItem("media-src:geo:head")).toBeNull();
		expect(storage.getItem("media-src:geo:v1")).toBeNull();
	});

	it("ruleVersion 非法（负数/小数）→ null（非法载荷不得进缓存、不得拼进引用 URL）", async () => {
		installGlobals();
		fetchImpl = () => geoResp({ mediaBase: "https://a.test", ruleVersion: -1 });
		const m1 = await freshModule();
		await expect(m1.getGeoMediaBase()).resolves.toBeNull();

		fetchImpl = () => geoResp({ mediaBase: "https://a.test", ruleVersion: 1.5 });
		const m2 = await freshModule();
		await expect(m2.getGeoMediaBase()).resolves.toBeNull();
	});
});

describe("broadcastGeoInvalidation 失效重拉（r9 P1-2）", () => {
	it("本 tab 广播：立即清内存+sessionStorage，下次调用重拉新 base；报文进 cdn-media-geo 频道并带版本号", async () => {
		const storage = installGlobals();
		let payload: GeoPayload = { mediaBase: "https://a.test", ruleVersion: 1 };
		let calls = 0;
		fetchImpl = () => {
			calls += 1;
			return geoResp(payload);
		};
		const m = await freshModule();
		expect(await m.getGeoMediaBase()).toBe("https://a.test");
		expect(calls).toBe(1);

		payload = { mediaBase: "https://b.test", ruleVersion: 2 };
		m.broadcastGeoInvalidation(2);

		// 广播报文：频道名 + 规则版本号
		const ch = ChannelStub.instances[0];
		expect(ch.name).toBe("cdn-media-geo");
		expect(ch.messages).toEqual([{ type: "invalidate", ruleVersion: 2 }]);

		// 本 tab 立即生效：sessionStorage 条目已清
		expect(storage.getItem("media-src:geo:head")).toBeNull();
		expect(storage.getItem("media-src:geo:v1")).toBeNull();

		// 下次调用重拉（服务端 no-store，拿到的就是新规则）；新版本再入两级缓存
		expect(await m.getGeoMediaBase()).toBe("https://b.test");
		expect(calls).toBe(2);
		expect(await m.getGeoMediaBase()).toBe("https://b.test");
		expect(calls).toBe(2);
	});

	it("跨 tab 接收：channel 收到合法失效消息 → 清缓存重拉并通知监听者；非法消息与解绑后不触发", async () => {
		const storage = installGlobals();
		let payload: GeoPayload = { mediaBase: "https://a.test", ruleVersion: 1 };
		let calls = 0;
		fetchImpl = () => {
			calls += 1;
			return geoResp(payload);
		};
		const m = await freshModule();
		let notified = 0;
		const off = m.onGeoInvalidation(() => {
			notified += 1;
		});
		expect(await m.getGeoMediaBase()).toBe("https://a.test");

		payload = { mediaBase: "https://b.test", ruleVersion: 2 };
		const ch = ChannelStub.instances[0];
		expect(ch.name).toBe("cdn-media-geo");
		ch.receive({ type: "invalidate", ruleVersion: 2 });

		expect(notified).toBe(1);
		expect(storage.getItem("media-src:geo:head")).toBeNull();
		expect(await m.getGeoMediaBase()).toBe("https://b.test");
		expect(calls).toBe(2);

		// 非法消息不触发失效（缓存仍命中，无新请求）
		ch.receive({ type: "bogus" });
		ch.receive(null);
		expect(await m.getGeoMediaBase()).toBe("https://b.test");
		expect(calls).toBe(2);
		expect(notified).toBe(1);

		// 解绑后不再通知（但缓存清理照常）
		off();
		ch.receive({ type: "invalidate", ruleVersion: 3 });
		expect(notified).toBe(1);
		expect(storage.getItem("media-src:geo:head")).toBeNull();
	});

	it("飞行中失效：旧 fetch 结果按代次丢弃，原 promise 转链到新拉取（旧值不回填缓存）", async () => {
		installGlobals();
		let releaseA: (payload: GeoPayload) => void = () => {};
		fetchImpl = () =>
			new Promise<Response>((resolve) => {
				releaseA = (payload) => resolve(geoResp(payload));
			});
		const m = await freshModule();
		const pending = m.getGeoMediaBase(); // 发起 A（挂起）

		// A 尚未返回时发生失效；此后 fetch 返回 B
		let calls = 0;
		fetchImpl = () => {
			calls += 1;
			return geoResp({ mediaBase: "https://b.test", ruleVersion: 2 });
		};
		m.broadcastGeoInvalidation(2);
		releaseA({ mediaBase: "https://a.test", ruleVersion: 1 }); // 迟到的旧结果

		// 原 promise 拿到的是失效后的新拉取结果，而非迟到的旧值
		await expect(pending).resolves.toBe("https://b.test");
		expect(calls).toBe(1);
		// 旧值没有回填缓存：后续调用命中新值，且无新请求
		expect(await m.getGeoMediaBase()).toBe("https://b.test");
		expect(calls).toBe(1);
	});
});
