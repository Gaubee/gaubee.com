/**
 * Worker 环境绑定类型（wrangler.toml vars/bindings 的 TS 投影）。
 *
 * - GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET：wrangler secret put，不入库。
 * - OWNER_LOGIN：geo 规则写接口的 owner GitHub login（wrangler.toml [vars]，非敏感）。
 * - GEO_RULES：规则 KV binding（worker/src/geo.ts 读写；类型取最小结构面，测试用内存实现即可满足）。
 */
/** geo 规则存储的最小 KV 结构面（真实 KVNamespace 结构兼容）。 */
export interface GeoKV {
	get(key: string): Promise<string | null>;
	put(key: string, value: string): Promise<void>;
}

export interface Env {
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	APP_ORIGIN: string;
	/**
	 * Worker 自身的对外 origin，用于构造 OAuth redirect_uri。
	 * 反代（portless / Cloudflare）下 c.req.url 的 Host 不可靠，必须显式指定。
	 * 未配置时回退到 c.req.url.origin（仅适合无反代的直连场景）。
	 */
	WORKER_ORIGIN?: string;
	/** 部署环境：dev 时允许 localhost CORS，prod 严格白名单。 */
	ENVIRONMENT?: string;
	/** geo 规则写接口的 owner GitHub login（大小写不敏感比较；未配置 = 拒绝一切写入）。 */
	OWNER_LOGIN?: string;
	/** geo 规则 KV binding（wrangler.toml kv_namespaces；缺失时 /api/geo 走内置默认规则）。 */
	GEO_RULES?: GeoKV;
}
