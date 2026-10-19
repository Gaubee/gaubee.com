#!/usr/bin/env bun
/**
 * oauth-flow-smoke.ts — 登录链路冒烟断言（auth 自托管上线的回归门）。
 *
 * 背景：auth.gaubee.com 曾因 DNS 迁移静默失效两个月（2026-08-15 起全局 TLS 失败），
 * 2026-10-18 自托管到源站后上线本工具做回归门。五条断言：
 *   1. GET / 返回 JSON 且含 name 字段（健康自检）
 *   2. GET /auth/github 返回 302 且 Location 以 github authorize 开头
 *   3. Location 的 client_id 非空且不等于字面量 "undefined"（env 未注入事故实测形态）
 *   4. redirect_uri = <base>/auth/github/callback 且 scheme 是 https
 *   5. Set-Cookie 含 gh_oauth_state 且带 HttpOnly
 *
 * 运行：bun oauth-flow-smoke.ts [--base https://auth.gaubee.com]
 * 全过 exit 0 输出 PASS 摘要；任一失败输出 FAIL 明细 exit 1。
 */

interface Assert {
	name: string;
	ok: boolean;
	detail: string;
}

function parseArgs(argv: string[]): { base: string } {
	const i = argv.indexOf("--base");
	const base = i >= 0 ? argv[i + 1] : "https://auth.gaubee.com";
	return { base: (base ?? "").replace(/\/+$/, "") };
}

async function main(): Promise<number> {
	const { base } = parseArgs(process.argv);
	const asserts: Assert[] = [];
	let authorizeUrl = "";

	// 1. 健康自检
	try {
		const res = await fetch(`${base}/`, { redirect: "manual" });
		let name = "";
		try {
			name = ((await res.json()) as { name?: string }).name ?? "";
		} catch {
			/* 非 JSON */
		}
		asserts.push({
			name: "健康自检 GET /",
			ok: res.status === 200 && name.length > 0,
			detail: `status=${res.status} name=${JSON.stringify(name)}`,
		});
	} catch (e) {
		asserts.push({ name: "健康自检 GET /", ok: false, detail: `网络失败：${e instanceof Error ? e.message : String(e)}` });
	}

	// 2-5. OAuth 发起链
	try {
		const res = await fetch(`${base}/auth/github`, { redirect: "manual" });
		authorizeUrl = res.headers.get("location") ?? "";
		asserts.push({
			name: "GET /auth/github 302 → authorize",
			ok: res.status === 302 && authorizeUrl.startsWith("https://github.com/login/oauth/authorize?"),
			detail: `status=${res.status} location=${authorizeUrl.slice(0, 80) || "(空)"}`,
		});

		const u = new URL(authorizeUrl);
		const clientId = u.searchParams.get("client_id") ?? "";
		asserts.push({
			name: "client_id 非空且非字面量 undefined",
			ok: clientId.length > 0 && clientId !== "undefined",
			detail: `client_id=${clientId ? `${clientId.slice(0, 6)}…` : "(空)"}`,
		});

		const redirectUri = u.searchParams.get("redirect_uri") ?? "";
		const expected = `${base}/auth/github/callback`;
		asserts.push({
			name: "redirect_uri 为 https 回调地址",
			ok: redirectUri === expected && redirectUri.startsWith("https://"),
			detail: `redirect_uri=${redirectUri || "(空)"} 期望=${expected}`,
		});

		const setCookie = res.headers.get("set-cookie") ?? "";
		asserts.push({
			name: "state cookie 存在且 HttpOnly",
			ok: setCookie.includes("gh_oauth_state=") && /httponly/i.test(setCookie),
			detail: `set-cookie ${setCookie.includes("gh_oauth_state=") ? "含 gh_oauth_state" : "缺失"}；HttpOnly ${/httponly/i.test(setCookie) ? "✓" : "✗"}`,
		});
	} catch (e) {
		const msg = `网络失败：${e instanceof Error ? e.message : String(e)}`;
		for (const name of ["GET /auth/github 302 → authorize", "client_id 非空且非字面量 undefined", "redirect_uri 为 https 回调地址", "state cookie 存在且 HttpOnly"]) {
			asserts.push({ name, ok: false, detail: msg });
		}
	}

	const failed = asserts.filter((a) => !a.ok);
	for (const a of asserts) {
		console.log(`${a.ok ? "  ok  " : "  FAIL"} ${a.name}｜${a.detail}`);
	}
	if (failed.length > 0) {
		console.error(`\nSMOKE FAIL：${failed.length}/${asserts.length} 断言未过`);
		return 1;
	}
	console.log(`\nSMOKE PASS：${asserts.length}/${asserts.length} 断言全过（${base}）`);
	return 0;
}

const code = await main();
process.exit(code);
