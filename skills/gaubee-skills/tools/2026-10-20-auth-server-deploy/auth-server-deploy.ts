#!/usr/bin/env bun
/**
 * auth-server-deploy.ts — auth-server 一键部署器（自托管登录服务的迭代运维门）。
 *
 * 流程：本地交叉编译（bun-linux-x64）→ scp 到 /tmp 暂存 → 远端原子替换
 * （旧二进制备份为 .bak）→ systemctl restart → 健康断言 → 失败自动回滚。
 * 健康断言读 http://127.0.0.1:17090/ 的 JSON，须含 "gaubee-auth-server"。
 *
 * 运行：bun auth-server-deploy.ts [--dry-run] [--bad-health]
 *   --dry-run    只构建并打印将执行的远端命令
 *   --bad-health 部署后人为认定健康检查失败（演练回滚路径）
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const SRC = path.join(SITE, "auth-server", "src", "main.ts");
const DIST = path.join(SITE, "auth-server", "dist", "gaubee-auth-linux-x64");
const REMOTE_DIR = "/opt/gaubee-auth";
const REMOTE_BIN = `${REMOTE_DIR}/gaubee-auth`;
const SSH = "gaubee-cloud";
const HEALTH_URL = "http://127.0.0.1:17090/";

function sh(cmd: string[], opts: { remote?: boolean } = {}): { code: number; out: string } {
	const line = opts.remote ? ["ssh", SSH, cmd.join(" ")] : cmd;
	const p = Bun.spawnSync(line, { stdout: "pipe", stderr: "pipe" });
	return {
		code: p.exitCode,
		out: `${new TextDecoder().decode(p.stdout)}${new TextDecoder().decode(p.stderr)}`.trim(),
	};
}

async function main(): Promise<number> {
	const argv = process.argv;
	const dry = argv.includes("--dry-run");
	const badHealth = argv.includes("--bad-health");

	// 1. 构建
	if (!existsSync(SRC)) {
		console.error(`FAIL 找不到源码：${SRC}`);
		return 1;
	}
	console.log("[1/5] 交叉编译 bun-linux-x64 …");
	const build = Bun.spawnSync(["bun", "build", "--compile", "--target=bun-linux-x64", SRC, "--outfile", DIST], {
		cwd: path.join(SITE, "auth-server"),
		stdout: "pipe",
		stderr: "pipe",
	});
	if (build.exitCode !== 0) {
		console.error(`FAIL 构建失败：${new TextDecoder().decode(build.stderr).slice(0, 400)}`);
		return 1;
	}
	const sizeMB = (statSync(DIST).size / 1024 / 1024).toFixed(1);
	console.log(`      构建完成 ${DIST}（${sizeMB} MB）`);
	if (dry) {
		console.log("[dry-run] 将执行：");
		console.log(`  scp ${DIST} ${SSH}:/tmp/gaubee-auth.staging`);
		console.log(`  ssh ${SSH} 'cp ${REMOTE_BIN} ${REMOTE_BIN}.bak && mv /tmp/gaubee-auth.staging ${REMOTE_BIN} && chmod +x ${REMOTE_BIN} && systemctl restart gaubee-auth'`);
		console.log(`  ssh ${SSH} 'curl -s ${HEALTH_URL}'`);
		return 0;
	}

	// 2. 上传
	console.log("[2/5] scp 上传暂存 …");
	const up = sh(["scp", "-q", DIST, `${SSH}:/tmp/gaubee-auth.staging`]);
	if (up.code !== 0) {
		console.error(`FAIL 上传失败：${up.out.slice(0, 200)}`);
		return 1;
	}

	// 3. 原子替换 + 重启
	console.log("[3/5] 远端备份旧版 → 就位 → 重启 …");
	const swap = sh(
		[
			`sudo cp ${REMOTE_BIN} ${REMOTE_BIN}.bak`,
			`&& sudo mv /tmp/gaubee-auth.staging ${REMOTE_BIN}`,
			`&& sudo chmod +x ${REMOTE_BIN}`,
			`&& sudo systemctl restart gaubee-auth`,
			`&& sleep 1 && systemctl is-active gaubee-auth`,
		],
		{ remote: true },
	);
	if (swap.code !== 0 || !swap.out.includes("active")) {
		console.error(`FAIL 远端替换/重启失败：${swap.out.slice(0, 300)}`);
		return 1;
	}

	// 4. 健康断言（--bad-health 演练：跳过真实检查直接判失败）
	console.log("[4/5] 健康断言 …");
	let healthy = false;
	let healthBody = "";
	if (badHealth) {
		healthBody = "(--bad-health 演练：判定失败)";
	} else {
		const h = sh([`curl -s -m 5 ${HEALTH_URL}`], { remote: true });
		healthBody = h.out.slice(0, 120);
		healthy = h.code === 0 && h.out.includes("gaubee-auth-server");
	}

	// 5. 收据或回滚
	if (!healthy) {
		console.error(`      健康检查未过：${healthBody}`);
		console.log("[5/5] 回滚：恢复 .bak 并重启 …");
		const rb = sh(
			[`sudo mv ${REMOTE_BIN}.bak ${REMOTE_BIN}`, `&& sudo systemctl restart gaubee-auth`, `&& sleep 1 && curl -s -m 5 ${HEALTH_URL}`],
			{ remote: true },
		);
		const rolled = rb.code === 0 && rb.out.includes("gaubee-auth-server");
		console.error(`FAIL 部署失败，已回滚（回滚后健康=${rolled}）`);
		return 1;
	}
	console.log(`[5/5] 部署收据：${sizeMB} MB → ${REMOTE_BIN}；健康响应 ${healthBody}`);
	return 0;
}

const code = await main();
process.exit(code);
