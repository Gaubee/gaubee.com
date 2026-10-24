#!/usr/bin/env bun
/**
 * vault-verify — vault.enc.sqlite 完整性校验（只读，跨设备同步后的第一件事）
 *
 * 同步通道（iCloud/Syncthing/私有 git）送来的 vault 单文件是否完好、明文工作区
 * 是否与 vault 一致，此前只能靠「unlock 时有没有炸」。本工具做三条只读校验：
 *   1. 逐行 AES-256-GCM 解密（authTag 校验，密钥错/密文坏即刻暴露）
 *   2. 解密明文的 sha256 与表内 sha256 字段比对（行内一致性）
 *   3. --workspace：明文工作区 data/ 与 vault 的 sha256 对账（双向漂移清单）
 * 输出只含路径与统计，不输出密钥与任何明文内容。
 *
 * 用法：bun tools/2026-10-25-vault-verify/vault-verify.ts [--workspace]
 * 退出码：0 = 完整（且 --workspace 时零漂移）；1 = 有损坏/漂移/环境缺失。
 */
import { Database } from "bun:sqlite";
import { createDecipheriv, createHash, scryptSync } from "node:crypto";
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

/** 与 scripts/vault.ts 同源的派生参数（改那边必须同步这里） */
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
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(12, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** 明文工作区 data/ 之下全部文件的 {相对路径 → sha256} */
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
  const wantWorkspace = process.argv.includes("--workspace");
  if (!existsSync(VAULT_FILE)) {
    console.error(`vault 不存在：${VAULT_FILE}`);
    return 1;
  }
  const db = new Database(VAULT_FILE, { readonly: true });
  const salt = (db.query("SELECT v FROM meta WHERE k='salt'").get() as { v: string } | null)?.v ?? "";
  if (!salt) {
    console.error("vault 缺 salt 元数据（空库或损坏）");
    return 1;
  }
  let key: Buffer;
  try {
    key = deriveKey(salt);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }

  const rows = db.query("SELECT path, sha256, blob FROM files").all() as {
    path: string;
    sha256: string;
    blob: Uint8Array;
  }[];
  let ok = 0;
  let tagFail = 0;
  let hashMismatch = 0;
  const bad: string[] = [];
  for (const r of rows) {
    try {
      const plain = openBytes(key, r.blob);
      if (sha256(plain) !== r.sha256) {
        hashMismatch++;
        bad.push(`hash 不符：${r.path}`);
      } else {
        ok++;
      }
    } catch {
      tagFail++;
      bad.push(`GCM 校验失败：${r.path}`);
    }
  }

  console.log(`vault ${path.basename(VAULT_FILE)}：${rows.length} 行｜解密+哈希一致 ${ok}｜tag 失败 ${tagFail}｜行内 hash 不符 ${hashMismatch}`);
  for (const b of bad.slice(0, 10)) console.error(`  ${b}`);
  if (bad.length > 10) console.error(`  … 共 ${bad.length} 条`);

  let exit = tagFail + hashMismatch > 0 ? 1 : 0;

  if (wantWorkspace && exit === 0) {
    const vaultMap = new Map(rows.map((r) => [r.path, r.sha256]));
    const ws = scanWorkspace(DATA);
    let matched = 0;
    let wsMissing = 0;
    let wsModified = 0;
    const drift: string[] = [];
    for (const [p, h] of vaultMap) {
      const wh = ws.get(p);
      if (wh === undefined) {
        wsMissing++;
        drift.push(`vault 有 / 工作区缺：${p}`);
      } else if (wh !== h) {
        wsModified++;
        drift.push(`工作区已改未回灌：${p}`);
      } else {
        matched++;
      }
    }
    const vaultPaths = new Set(vaultMap.keys());
    let wsOnly = 0;
    for (const p of ws.keys()) {
      if (!vaultPaths.has(p)) {
        wsOnly++;
        if (wsOnly <= 5) drift.push(`工作区新增未入 vault：${p}`);
      }
    }
    console.log(`工作区对账：一致 ${matched}｜vault 有工作区缺 ${wsMissing}｜已改未回灌 ${wsModified}｜工作区新增未入 vault ${wsOnly}`);
    for (const d of drift.slice(0, 10)) console.error(`  ${d}`);
    if (drift.length > 10) console.error(`  … 共 ${drift.length} 条`);
    if (drift.length > 0) exit = 2;
  }
  db.close();
  return exit;
}

process.exit(main());
