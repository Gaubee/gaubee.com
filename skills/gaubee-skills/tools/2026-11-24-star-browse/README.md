# star-browse — 按策展分类浏览收藏

## 是什么

把 taxonomy 的 16 个分类投影成可浏览的数据：每个分类多少仓库、累计多少星，
支持关键词按**仓库名 + 描述**过滤。

## 解决什么

kzf 常问「我收藏里有哪些 X 类的东西」。`stars-search` 要求他先想到关键词，
但真正要的是「按类目看全貌」。本工具补上这个入口，并且挂在 `/app/tools` 里可直接用。

## 怎么跑

```bash
bun tools/2026-11-24-star-browse/star-browse.ts            # 全分类总览
bun tools/2026-11-24-star-browse/star-browse.ts 视频        # 关键词过滤
```

## 真实示例输出（2026-11-24）

```text
$ bun tools/2026-11-24-star-browse/star-browse.ts
收藏分类浏览：16 个分类，184 个仓库

【AI Agent 与编码助手】62 个，累计 ★1546589
【AI/LLM 模型与应用】21 个，累计 ★261658
【前端框架与 UI 组件】13 个，累计 ★34700

$ bun tools/2026-11-24-star-browse/star-browse.ts 视频
「视频」在 1 个分类里有命中：

【AI Agent 与编码助手】1 个
  kangarooking/cangjie-skill  ★13260 Python
      把书、长视频、播客等高价值内容蒸馏成可执行的 Agent Skills
```

## 判读

- 分类是人工策展的 16 类（不是脚本关键词分类），所以「未分类」长尾不在这里。
- 星数取自公开投影（本地源不含 star 数），与站点一致。
- 形态：**webapp**，数据 `static/tools/data/taxonomy.json` + `stars.json`，浏览器里可跑。
