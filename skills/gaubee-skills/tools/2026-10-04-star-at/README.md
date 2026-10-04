# star-at — 收藏序号查询

## 是什么

star `order` 字段（kzf 2026-10-04 数据模型裁决：时间优先、顺序兜底）的第一个消费者。正查：第 N 个收藏是什么；反查：某仓库是第几个收藏。

## 解决什么

- “我的第 1000 个收藏是什么？”——order 作为收藏的身份性序号。
- 同秒批量导入（现有 319 组）的歧义由 order 唯一区分。

## 怎么跑

```sh
bun tools/2026-10-04-star-at/star-at.ts 1000      # 正查
bun tools/2026-10-04-star-at/star-at.ts colinhacks/zod   # 反查
```

## 示例输出（真实运行）

```sh
$ bun tools/2026-10-04-star-at/star-at.ts 1000
#1000 · [redwoodjs/graphql](https://github.com/redwoodjs/graphql)
  收藏于 2023-12-16 · ⭐17592
  RedwoodGraphQL

$ bun tools/2026-10-04-star-at/star-at.ts colinhacks/zod
colinhacks/zod 是第 888 个收藏（共 1640 个）· 收藏于 2023-06-27
```

## 状态

proposed（2026-10-04，等 kzf 裁决）
