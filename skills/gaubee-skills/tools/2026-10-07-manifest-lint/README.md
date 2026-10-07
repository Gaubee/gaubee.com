# manifest-lint

## 是什么

cdn-media 媒体分发管线（`openspec/specs/cdn-media/spec.md` R4）的清单体检器：`manifest/current.json`（git 指针）与 `manifest-<gen>.json`（对象→卷映射）会随每日补丁频繁换代，坏清单一旦被 static-server 的 cdn-base 拉取会污染整条媒体链。本工具做发布前后的一键体检。

## 解决什么

kzf 正在推进 cdn-media 架构（GitHub Releases 分卷兜底），cron 每日补丁换代后需要机械校验防坏 manifest 进 cdn-base——人工不可能核对 3413 个对象。

## 怎么跑

```sh
bun skills/gaubee-skills/tools/2026-10-07-manifest-lint/manifest-lint.ts [--assets N]
```

- 默认校验：指针 sha256 一致性、每对象 offset 512 对齐与越界、key 三段格式、指针/清单卷集合一致。
- `--assets N`：额外抽前 N 卷经 `gh api`（Accept: application/octet-stream）整卷拉取，比对 size+sha256（需 gh 已登录；整卷比对强于 1KB 头比对）。
- 退出码：0 全过 / 1 有病 / 2 用法错。

## 真实示例输出（2026-10-07，3413 对象 / 104 卷）

```
(a) 指针 sha256 一致: gen=1, manifest=c891afdb83c67d22…
(b) offset 对齐违规 0，越界 0（对象 3413）
(c) key 格式违规 0
(a2) 指针/清单卷集合一致: 104 卷

[OK] 全部校验通过
```
退出码 0。
