import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
/**
 * vault.ts — 私有数据加密保险库（bun:sqlite + node:crypto，零第三方依赖）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-05] kzf：跨设备痛点——私有数据挂本地没法同步；只保护 .env，其余数据用
 *   强随机密码（放 .env）整体加密，随单文件 vault 走任意同步通道（iCloud/Syncthing/私有 git）。
 * - 语义：写入即加密（lib.writeFileAtomic 镜像进 vault）、读取解密到内存/明文工作区、
 *   单文件 vault.enc.sqlite 即同步产物。SQLCipher 需原生编译违背零依赖；gocryptfs/FUSE
 *   需内核扩展；这里用 bun:sqlite 存每文件加密 blob（增量：只重加密变更文件）。
 * - 威胁模型：同步通道与云端的静态数据不可信；本机明文工作区可信（工作区明文默认保留，
 *   GAUBEE_SKILLS_AUTOLOCK=1 或 `vault.ts lock` 可清除，见 lock）。
 *
 * 路径说明：DATA/DATA_ROOT 与 lib.ts 同源推导（避免循环 import，三行有意重复）。
 * 运行：bun scripts/vault.ts init|unlock|lock|status
 */
import path from "node:path";

// 与 lib.ts 同源（有意重复，改这里必须同步改 lib.ts）
export const DATA_ROOT = process.env.GAUBEE_SKILLS_DATA ?? path.join(homedir(), ".gaubee-skills");
export const DATA = path.join(DATA_ROOT, "data");

const ENV_FILE = path.join(DATA_ROOT, ".env");
const VAULT_FILE = path.join(DATA_ROOT, "vault.enc.sqlite");
const KEY_LINE = "GAUBEE_SKILLS_VAULT_KEY";

// ---------- 密钥 ----------

function readEnvKey(): string {
  if (!existsSync(ENV_FILE)) return "";
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(new RegExp(`^${KEY_LINE}=(.+)$`));
    if (m) return m[1]!.trim();
  }
  return "";
}

let cachedKey: Buffer | null = null;
let cachedSalt = "";
/** scrypt 派生 AES-256 密钥（模块级缓存，一次派生全程复用） */
function deriveKey(salt: string): Buffer {
  if (cachedKey && cachedSalt === salt) return cachedKey;
  const material = readEnvKey();
  if (!material)
    throw new Error(`vault: ${ENV_FILE} 缺少 ${KEY_LINE}——先跑 bun scripts/vault.ts init`);
  cachedKey = scryptSync(Buffer.from(material, "utf8"), Buffer.from(salt, "utf8"), 32, {
    N: 16384,
    r: 8,
    p: 1,
  });
  cachedSalt = salt;
  return cachedKey;
}

/** AES-256-GCM 加密；blob = iv(12) || ciphertext || authTag(16) */
function sealBytes(key: Buffer, plain: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]);
}
function openBytes(key: Buffer, blob: Uint8Array): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(12, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// ---------- 库 ----------

let db: Database | null = null;
function openDb(): Database {
  if (db) return db;
  mkdirSync(DATA_ROOT, { recursive: true });
  db = new Database(VAULT_FILE, { create: true });
  db.run("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, sha256 TEXT, blob BLOB)");
  const salt = (db.query("SELECT v FROM meta WHERE k='salt'").get() as { v: string } | null)?.v;
  if (!salt) {
    const s = randomBytes(16).toString("hex");
    db.run("INSERT INTO meta(k,v) VALUES('salt',?)", [s]);
  }
  return db;
}

function currentSalt(): string {
  const row = openDb().query("SELECT v FROM meta WHERE k='salt'").get() as { v: string } | null;
  return row?.v ?? "";
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ---------- 核心操作 ----------

/** 写入即加密：单文件镜像进 vault（内容未变则跳过）。路径必须是 DATA 之下的相对路径。 */
export function vaultPut(relPath: string, plain: Uint8Array): void {
  if (relPath.startsWith("/") || relPath.includes(".."))
    throw new Error(`vault: 非法路径 ${relPath}`);
  const digest = sha256(plain);
  const d = openDb();
  const row = d.query("SELECT sha256 FROM files WHERE path=?").get(relPath) as {
    sha256: string;
  } | null;
  if (row?.sha256 === digest) return;
  const blob = sealBytes(deriveKey(currentSalt()), plain);
  d.run(
    "INSERT INTO files(path,sha256,blob) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET sha256=excluded.sha256, blob=excluded.blob",
    [relPath, digest, blob],
  );
}

export function vaultHas(): boolean {
  return existsSync(VAULT_FILE);
}

export function vaultCount(): number {
  if (!vaultHas()) return 0;
  return (openDb().query("SELECT COUNT(*) n FROM files").get() as { n: number }).n;
}

/** 解锁：vault → 明文工作区（已存在且内容一致的文件跳过写盘） */
export function vaultUnlock(): number {
  const d = openDb();
  const rows = d.query("SELECT path, blob FROM files").all() as {
    path: string;
    blob: Uint8Array;
  }[];
  const key = deriveKey(currentSalt());
  for (const r of rows) {
    const target = path.join(DATA, r.path);
    if (existsSync(target)) {
      if (sha256(readFileSync(target)) === sha256(openBytes(key, r.blob))) continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, openBytes(key, r.blob));
  }
  return rows.length;
}

/** 锁定：明文工作区 → vault（增量加密变更文件，删除已消失文件），成功后清除明文工作区。 */
export function vaultLock(wipePlain = true): { put: number; removed: number } {
  const d = openDb();
  const key = deriveKey(currentSalt());
  const seen = new Set<string>();
  let put = 0;
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(DATA, abs);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      seen.add(rel);
      const plain = readFileSync(abs);
      const digest = sha256(plain);
      const row = d.query("SELECT sha256 FROM files WHERE path=?").get(rel) as {
        sha256: string;
      } | null;
      if (row?.sha256 === digest) continue;
      d.run(
        "INSERT INTO files(path,sha256,blob) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET sha256=excluded.sha256, blob=excluded.blob",
        [rel, digest, sealBytes(key, plain)],
      );
      put++;
    }
  };
  walk(DATA);
  let removed = 0;
  for (const r of d.query("SELECT path FROM files").all() as { path: string }[]) {
    if (!seen.has(r.path)) {
      d.run("DELETE FROM files WHERE path=?", [r.path]);
      removed++;
    }
  }
  if (wipePlain) rmSync(DATA, { recursive: true, force: true });
  return { put, removed };
}

/** init：生成强随机密钥进 .env（已存在则跳过），并把现有明文 data/ 全量灌入 vault */
export function vaultInit(): { keyCreated: boolean; imported: number } {
  mkdirSync(DATA_ROOT, { recursive: true });
  let keyCreated = false;
  let env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  if (!readEnvKey()) {
    if (env && !env.endsWith("\n")) env += "\n";
    env += `${KEY_LINE}=${randomBytes(32).toString("hex")}\n`;
    writeFileSync(ENV_FILE, env);
    chmod600(ENV_FILE);
    keyCreated = true;
  }
  openDb();
  let imported = 0;
  if (existsSync(DATA)) {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs);
          continue;
        }
        vaultPut(path.relative(DATA, abs), readFileSync(abs));
        imported++;
      }
    };
    walk(DATA);
  }
  return { keyCreated, imported };
}

function chmod600(file: string): void {
  if (!existsSync(file)) return;
  chmodSync(file, 0o600);
}

// ---------- CLI ----------

if (import.meta.main) {
  const cmd = process.argv[2] ?? "status";
  try {
    if (cmd === "init") {
      const r = vaultInit();
      console.log(
        `vault init：${r.keyCreated ? "已生成新密钥写入 .env" : "密钥已存在"}；导入 ${r.imported} 个文件`,
      );
    } else if (cmd === "unlock") {
      if (!vaultHas()) {
        console.error("vault 不存在——先 init");
        process.exit(1);
      }
      console.log(`vault unlock：恢复 ${vaultUnlock()} 个文件到 ${DATA}`);
    } else if (cmd === "lock") {
      const wipe = !process.argv.includes("--keep");
      const r = vaultLock(wipe);
      console.log(
        `vault lock：加密更新 ${r.put} 个、清理 ${r.removed} 个${wipe ? "；明文工作区已清除" : "（明文保留 --keep）"}`,
      );
    } else if (cmd === "status") {
      console.log(
        `vault: ${VAULT_FILE}${vaultHas() ? `（${vaultCount()} 个文件）` : "（不存在，先 init）"}`,
      );
      console.log(`明文工作区: ${DATA}${existsSync(DATA) ? "（在）" : "（未解锁）"}`);
      console.log(`密钥: ${readEnvKey() ? "已在 .env" : "缺失（先 init）"}`);
    } else {
      console.error("用法：vault.ts init|unlock|lock [--keep]|status");
      process.exit(2);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
