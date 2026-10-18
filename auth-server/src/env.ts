/**
 * env.ts —— auth-server 环境变量（与 worker/src/env.ts 字段对齐，运行时从 process.env 读）。
 *
 * 三方一致性：WORKER_ORIGIN / 前端 VITE_AUTH_BASE / GitHub OAuth App callback URL
 * 三处必须同域（见 worker/wrangler.toml 同名清单）。自托管后该域为
 * https://auth.gaubee.com（openresty vhost 终结 TLS，反代本服务）。
 */
export interface Env {
	/** OAuth 成功后回跳的前端 origin（CORS 与 redirect 目标白名单用）。 */
	APP_ORIGIN: string;
	/** 本服务对外域名（构造 OAuth redirect_uri 用，反代下 c.req.url 不可靠）。 */
	WORKER_ORIGIN: string;
	/** production 时 state cookie 加 Secure、CORS 严格白名单。 */
	ENVIRONMENT: string;
	/** geo 规则唯一允许的 GitHub login（大小写不敏感）。 */
	OWNER_LOGIN: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	/** geo 规则文档落盘路径（默认 ./data/geo-rules.json）。 */
	GEO_RULES_PATH?: string;
	/** 监听端口（默认 17090，只绑 127.0.0.1，由 openresty 反代）。 */
	PORT?: string;
}

export function loadEnv(processEnv: Record<string, string | undefined>): Env {
	const required = ["APP_ORIGIN", "WORKER_ORIGIN", "ENVIRONMENT", "OWNER_LOGIN", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const;
	for (const key of required) {
		if (!processEnv[key]) throw new Error(`missing required env: ${key}`);
	}
	return {
		APP_ORIGIN: processEnv.APP_ORIGIN!,
		WORKER_ORIGIN: processEnv.WORKER_ORIGIN!,
		ENVIRONMENT: processEnv.ENVIRONMENT!,
		OWNER_LOGIN: processEnv.OWNER_LOGIN!,
		GITHUB_CLIENT_ID: processEnv.GITHUB_CLIENT_ID!,
		GITHUB_CLIENT_SECRET: processEnv.GITHUB_CLIENT_SECRET!,
		GEO_RULES_PATH: processEnv.GEO_RULES_PATH,
		PORT: processEnv.PORT,
	};
}
