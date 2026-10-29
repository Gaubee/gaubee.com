#!/usr/bin/env bun
/**
 * ssh-channel-doctor — gaubee-cloud ssh 通道检查（lag-watch 前置早警）
 *
 * 背景（2026-10-25/26 实证）：known_hosts 被外部进程清掉、kaku ssh 包装函数在
 * 非交互 shell 缺失，lag-watch 连续两天先红一次。本工具一条命令把通道健康做成
 * 门禁：①known_hosts 是否含服务器主机键 ②kaku 包装函数是否可加载 ③BatchMode
 * 试连（不执行远程命令的 echo）。全部绿才建议跑 lag-watch。
 *
 * 用法：bun tools/2026-10-30-ssh-channel-doctor/ssh-channel-doctor.ts [--host gaubee-cloud]
 * 退出码：0 = 通道健康；1 = 有 FAIL 项。--fix 仅做 keyscan 补录（TOFU，服务器 IP
 * 为文档化地址且 TLS 直连可验证；修复后请 kzf 复核键指纹）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function sh(cmd: string, timeout = 20_000): { out: string; code: number } {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", timeout });
  return { out: ((r.stdout ?? "") + (r.stderr ?? "")).trim(), code: r.status ?? 1 };
}

function main(): number {
  const argv = process.argv.slice(2);
  const host = argv.indexOf("--host") >= 0 ? argv[argv.indexOf("--host") + 1]! : "gaubee-cloud";
  const fix = process.argv.includes("--fix");
  const known = path.join(os.homedir(), ".ssh", "known_hosts");
  const fails: string[] = [];

  // ① 主机键在册
  let keyCount = 0;
  if (existsSync(known)) keyCount = (readFileSync(known, "utf8").match(new RegExp(`(^|\\n)${host.split(".").join("\\.")}`, "g")) ?? []).length;
  // known_hosts 可能是 hashed 条目；键缺失以试连失败为准，这里只做快速预检
  console.log(`known_hosts 快检：${existsSync(known) ? `文件在（非 hashed 匹配 ${keyCount} 条）` : "文件缺失"}`);

  // ② kaku 包装可加载
  const kaku = path.join(os.homedir(), ".config", "kaku", "zsh", "kaku.zsh");
  if (existsSync(kaku)) console.log("kaku 包装：实现文件在（非交互 shell 需 source 后使用）");
  else console.log("kaku 包装：实现文件缺失（若仍在用 kaku 需留意）");

  // ③ BatchMode 试连（决定性证据）
  const probe = sh(`ssh -o ConnectTimeout=10 -o BatchMode=yes ${host} 'echo SSH-OK' 2>&1`);
  if (probe.code === 0 && probe.out.includes("SSH-OK")) {
    console.log("试连：OK（BatchMode 免交互连通）");
  } else {
    const why = probe.out.split("\n").slice(-2).join(" / ").slice(0, 160) || `exit ${probe.code}`;
    fails.push(`试连失败：${why}`);
    console.log(`试连：FAIL（${why}）`);
    if (fix && why.includes("Host key verification")) {
      const ip = sh(`ssh -G ${host} 2>/dev/null | awk '/^hostname /{print $2}'`).out.trim();
      if (ip) {
        const scan = sh(`ssh-keyscan -T 10 ${ip} >> ${known} 2>/dev/null; echo $?`);
        if (scan.code === 0) {
          const retry = sh(`ssh -o ConnectTimeout=10 -o BatchMode=yes ${host} 'echo SSH-OK' 2>&1`);
          if (retry.code === 0 && retry.out.includes("SSH-OK")) {
            console.log(`--fix：已 keyscan 补录 ${ip} 并复测连通（TOFU，请 kzf 复核键指纹）`);
            fails.pop();
          } else console.log("--fix：补录后仍不通");
        }
      }
    }
  }

  if (fails.length) {
    console.error(`FAIL ${fails.length} 项：${fails.join("；")}`);
    return 1;
  }
  console.log("通道健康：可以跑 lag-watch / 服务器侧验收");
  return 0;
}

process.exit(main());
