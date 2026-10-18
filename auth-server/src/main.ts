/**
 * main.ts —— auth-server 入口：读环境变量 → 建 geo 文件存储 → 起 HTTP 服务。
 *
 * 运行形态：bun build --compile 单二进制（bun-linux-x64），systemd 常驻，
 * 只绑 127.0.0.1，由 openresty（auth.gaubee.com vhost）终结 TLS 后反代。
 * 部署 runbook 见 auth-server/README.md。
 */
import { createApp } from "./app";
import { loadEnv } from "./env";
import { GeoRulesStore } from "./geo-store";

const env = loadEnv(process.env);
const store = new GeoRulesStore(env.GEO_RULES_PATH ?? "data/geo-rules.json");
const app = createApp(env, store);

const port = Number(env.PORT ?? 17090);

// Bun.serve 的 fetch 回调第二参是 Server 对象而非 Bindings；Hono 的 c.env 取自
// app.fetch 的第二参，必须显式传 env（否则路由里读到 undefined，OAuth client_id 缺失）
export default {
	port,
	fetch: (request: Request) => app.fetch(request, env),
};
