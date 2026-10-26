# data-write — 私有数据安全写包装

## 是什么

`~/.gaubee-skills/data` 之下文件的带镜像写入通道：内部走 `lib.ts` 的 `writeFileAtomic`（内容未变自动去重，vault「写入即加密」镜像随写生效）。支持文件参数与 stdin（`-`）。目标必须在 data/ 之下，越界拒绝。

## 解决什么

vault 漂移的**根因侧**治理。2026-10-25/26 连续实证：agent 用 python/perl 直写私有数据文件（taxonomy.md、profile.md）会绕过加密镜像，vault 与工作区分叉，只能靠 vault-drift-sync 事后补救。本工具给 agent 一个等价但安全的写法——脚本里把 `open(p,'w').write(...)` 换成一条 data-write 调用即可。

## 怎么跑

```bash
bun tools/2026-10-27-data-write/data-write.ts taxonomy.md /tmp/taxonomy-new.md
cat x.json | bun tools/2026-10-27-data-write/data-write.ts sources/x-likes/x.json -
bun tools/2026-10-25-vault-verify/vault-verify.ts --workspace   # 复核镜像
```

## 真实示例输出（2026-10-27 验证）

```text
已写 data/tmp-data-write-test.md（64 字节；新建；vault 镜像随写入生效）
```

对账验证：写入后 vault-verify 计入且一致；随后用 data-write 重写当天被 python 直写绕过的 taxonomy.md（输出「内容与盘上相同，镜像层自行去重」），`已改未回灌` 从 1 归 0——**盘写去重时镜像层仍会对账**，所以 data-write 也兼作强制对账入口。验证后测试文件已从工作区与 vault 双侧删除，现状一致 185、漂移 0。

## 边界

- 只管「写」；删除与移动仍需手动处理 vault（删工作区文件后 vault 侧残行要手动 DELETE）。
- 追加语义没有：整文件覆盖为主（与 writeFileAtomic 一致）。
