#!/usr/bin/env bun
/**
 * vault-drift-sync — vault 漂移回灌（vault-verify 的姊妹动作）
 *
 * 背景（2026-10-26 实证）：agent 用脚本直写私有数据文件（如 python 改 taxonomy.md）
 * 会绕过 lib.ts writeFileAtomic 的自动加密镜像，vault-verify --workspace 于是报
 * 「已改未回灌」。本工具把这类漂移一键补齐：对工作区有、vault 内容落后的条目
 * 走 vault.ts 同源的 vaultPut 写回（幂等：hash 一致自动跳过）。
 *
 * 用法：bun tools/2026-10-26-vault-drift-sync/vault-drift-sync.ts [--dry]
 * 退出码：0 = 无漂移或回灌成功；1 = 环境/数据异常。只处理「vault 落后」方向；
 * 「工作区新增未入 vault」默认一并纳入（vaultPut 即入库），.bak 备份文件跳过。
 */
import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA_ROOT = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills");
const VAULT_FILE = path.join(DATA_ROOT, "vault.enc.sqlite");
const ENV_FILE = path.join(DATA_ROOT, ".env");
const DATA = path.join(DATA_ROOT, "data");
const KEY_LINE = "GAUBEE_SKILLS_VAULT_KEY";

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function readEnvKey(): string {
  if (!existsSync(ENV_FILE)) return "";
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(new RegExp(`^${KEY_LINE}=(.+)$`));
    if (m) return m[1]!.trim();
  }
  return "";
}

// 与 scripts/vault.ts 同源的派生/加解密（改那边必须同步这里）
function deriveKey(salt: string): Buffer {
  const material = readEnvKey();
  if (!material) throw new Error(`${ENV_FILE} 缺少 ${KEY_LINE}`);
  return scryptSync(Buffer.from(material, "utf8"), Buffer.from(salt, "utf8"), 32, {
    N: 16384,
    r: 8,
    p: 1,
  });
}
function openBytes(key: Buffer, blob: Uint8Array): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([decipher.update(blob.subarray(12, blob.length - 16)), decipher.final()]);
}
function sealBytes(key: Buffer, plain: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]);
}

function scanWorkspace(dir: string, base = dir): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      for (const [k, v] of scanWorkspace(p, base)) out.set(k, v);
    } else {
      out.set(path.relative(base, p), sha256(readFileSync(p)));
    }
  }
  return out;
}

function main(): number {
  const dry = process.argv.includes("--dry");
  if (!existsSync(VAULT_FILE)) {
    console.error(`vault 不存在：${VAULT_FILE}`);
    return 1;
  }
  const db = new Database(VAULT_FILE);
  const salt = (db.query("SELECT v FROM meta WHERE k='salt'").get() as { v: string } | null)?.v ?? "";
  let key: Buffer;
  try {
    key = deriveKey(salt);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }

  const rows = db.query("SELECT path, sha256 FROM files").all() as { path: string; sha256: string }[];
  const vaultMap = new Map(rows.map((r) => [r.path, r.sha256]));
  const ws = scanWorkspace(DATA);

  const drift: string[] = [];
  for (const [p, h] of vaultMap) {
    const wh = ws.get(p);
    if (wh !== undefined && wh !== h) drift.push(p);
  }
  for (const p of ws.keys()) {
    if (!vaultMap.has(p) && !/\.bak/.test(p)) drift.push(p);
  }

  if (!drift.length) {
    console.log("无漂移：vault 与工作区一致，无需回灌");
    db.close();
    return 0;
  }
  console.log(`漂移 ${drift.length} 条${dry ? "（dry，不写入）" : ""}：`);
  for (const p of drift) console.log(`  ${p}`);
  if (dry) {
    db.close();
    return 0;
  }

  const insert = db.query(
    "INSERT INTO files(path,sha256,blob) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET sha256=excluded.sha256, blob=excluded.blob",
  );
  let ok = 0;
  for (const rel of drift) {
    const plain = readFileSync(path.join(DATA, rel));
    const blob = sealBytes(key, plain);
    insert.run(rel, sha256(plain), blob);
    ok++;
  }
  console.log(`已回灌 ${ok} 条进 vault（写入即加密）`);
  db.close();
  return 0;
}

process.exit(main());
