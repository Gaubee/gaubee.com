# media-meta-freshness — media-meta 悬空守卫

## 是什么

对照 cdn-media 当前代 manifest 与 media-meta.json 的键覆盖：manifest 里存在而 media-meta 缺失的媒体对象即「悬空缺口」，>0 则 exit 1 并给出样例与修复命令。

## 解决什么

2026-10-18 实证：media-meta.ts（裁决 16 的实现）写成后从未接入 cron 管道，manifest 已换代到 gen-13 而 media-meta.json 停在旧代——当日日报/归档的 `<video>` 一律裸标签（黑盒、无尺寸、布局跳动）。本工具是这条「实现了但没接线」事故的复发防线：media-pack 换代之后跑一次，缺口当场暴露。

## 怎么跑

```bash
bun tools/2026-10-19-media-meta-freshness/media-meta-freshness.ts
# 缺口非零时的修复：bun scripts/media-meta.ts
```

支持 `--manifest <file>` / `--meta <file>` 覆盖默认路径（fixture 演练用）。

## 真实示例输出（2026-10-19）

真实数据（media-meta 刚补跑过，期望 PASS）：

```
manifest: /Users/kzf/Dev/Github/gaubee.com/cdn-media/manifest/manifest-13.json
对象 4375，media-meta 覆盖 4375，悬空缺口 0
PASS：media-meta 全量覆盖当前 manifest
exit=0
```

合成缺口 fixture（截 manifest 前 3 对象 + 空 meta，期望 FAIL）：

```
manifest: /tmp/mm-fix/manifest.json
对象 3，media-meta 覆盖 0，悬空缺口 3

FAIL：3 个对象缺元数据（media-meta.ts 未随 manifest 换代重跑）。样例：
  - cdn-media/x/1970-01/1004445344514572290-poster.jpg
  - cdn-media/x/1970-01/1004875310460854272-poster.jpg
  - cdn-media/x/1970-01/1004991748744065029-poster.jpg
修复：bun scripts/media-meta.ts
exit=1
```
