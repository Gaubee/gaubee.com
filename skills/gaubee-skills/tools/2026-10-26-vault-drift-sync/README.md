# vault-drift-sync — vault 漂移回灌

## 是什么

vault-verify 的姊妹动作：对「工作区已改未回灌」「工作区新增未入 vault」两类漂移，走与 `scripts/vault.ts` 同源的 vaultPut 语义一键写回（写入即 AES-256-GCM 加密，hash 一致自动跳过）。`--dry` 只列漂移不写入。

## 解决什么

2026-10-26 实证根因：agent 用脚本直写私有数据文件（python 改 taxonomy.md、cron 工具直写 profile.md）会绕过 `lib.ts` writeFileAtomic 的自动加密镜像，vault 与工作区就此分叉。此前只能等下次 unlock 被动覆盖；本工具把「vault 与工作区最终一致」变成一条主动命令。首跑即修复了 vault-verify 首跑抓到的全部 3 条漂移。

## 怎么跑

```bash
bun tools/2026-10-26-vault-drift-sync/vault-drift-sync.ts --dry    # 只列漂移
bun tools/2026-10-26-vault-drift-sync/vault-drift-sync.ts          # 回灌
bun tools/2026-10-25-vault-verify/vault-verify.ts --workspace      # 复核
```

退出码：0 = 无漂移或回灌成功；1 = 环境/数据异常。

## 真实示例输出（2026-10-26 首跑）

```text
漂移 3 条（dry，不写入）：
  taxonomy.md
  feedback-log.md
  profile.md
已回灌 3 条进 vault（写入即加密）
```

复核（vault-verify --workspace）：一致 171｜vault 有工作区缺 0｜已改未回灌 0；剩余 3 条「工作区新增未入 vault」全是 `.bak` 备份文件，按设计跳过（writeFileAtomic 同样不镜像备份）。

## 边界

- 只处理「vault 落后于工作区」方向；「vault 有工作区缺」意味着明文被删，属 vault-verify 的报警范畴，本工具不逆推。
- 派生与加解密参数和 `scripts/vault.ts` 同源（scrypt N=16384/r=8/p=1，blob=iv(12)||ct||tag(16)），改动必须双向同步。
