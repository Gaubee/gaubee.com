# vault-verify — vault 完整性校验（只读）

## 是什么

跨设备同步（iCloud/Syncthing/私有 git）送回的 `vault.enc.sqlite` 是否完好、明文工作区与 vault 是否一致，此前只能靠「unlock 时炸不炸」。本工具三条只读校验：逐行 AES-256-GCM 解密（authTag 校验）、解密明文 sha256 与表内哈希比对、`--workspace` 时与明文工作区双向对账。输出只含路径与统计，不输出密钥与明文。

## 解决什么

「同步后我的数据没坏」需要可验证的收据；另外写入侧 `writeFileAtomic` 的自动加密镜像可能存在漂移窗口，需要独立对账器发现「已改未回灌」的文件。首跑即抓到真实漂移（工具价值自证）。

## 怎么跑

```bash
bun tools/2026-10-25-vault-verify/vault-verify.ts                # 只验 vault 本体
bun tools/2026-10-25-vault-verify/vault-verify.ts --workspace    # 加明文工作区对账
```

退出码：0 vault 完整且无漂移；1 vault 损坏；2 工作区有漂移。

## 真实示例输出（2026-10-25 首跑，--workspace）

```text
vault vault.enc.sqlite：171 行｜解密+哈希一致 171｜tag 失败 0｜行内 hash 不符 0
工作区对账：一致 168｜vault 有工作区缺 0｜已改未回灌 3｜工作区新增未入 vault 3
  工作区已改未回灌：taxonomy.md
  工作区已改未回灌：feedback-log.md
  工作区已改未回灌：profile.md
  工作区新增未入 vault：sources/x-likes/x.json.bak-全库纠正-2026-10-09
  …
```

## 判读与边界

- vault 本体 171 行全绿（密钥对、密文完好）；`.bak` 备份文件不入 vault 属预期（writeFileAtomic 只镜像正式数据路径）。
- 首跑抓到 taxonomy/profile/feedback-log 三条「已改未回灌」——近两日 cron 的策展与蒸馏写入尚未镜像进 vault；下次触发 unlock/写入时自然会回灌，若长期漂移则说明镜像条件有缺口，值得排查 lib.ts 的写入路径约定。
- 派生参数与 `scripts/vault.ts` 同源（scrypt N=16384/r=8/p=1，blob=iv(12)||ct||tag(16)），改动必须双向同步。
