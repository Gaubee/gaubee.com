# taxonomy-dedupe — 策展分类的重复仓库条目体检

## 是什么

扫 `~/.gaubee-skills/data/taxonomy.md` 的策展条目（`- [owner/name](https://github.com/...)`），按仓库名归组：
- **同分类重复**：同一个仓库在同一分类里出现两行（硬错，双计数、检索噪声）；
- **跨分类重复**：同一仓库挂在两个分类（提示，需要人工决定它的家）。

`--fix` 只处理同分类重复，保留首次出现、删掉后出现的行，走 `writeFileAtomic`（vault 镜像随写入）。

## 解决什么

分类是人工策展的，插入新星标时偶尔会重复。2026-11-12 首跑就抓到两个真实问题：
- `aimod-cc/Agent2API` 在「AI/LLM 模型与应用」里出现两行；
- `deeplethe/solid-glass` 同时挂在「AI Agent」与「前端框架」两个分类。

两个都当场修掉了（同分类的走 `--fix`，跨分类的人工决定归到「前端框架与 UI 组件」）。

## 怎么跑

```bash
bun tools/2026-11-12-taxonomy-dedupe/taxonomy-dedupe.ts
bun tools/2026-11-12-taxonomy-dedupe/taxonomy-dedupe.ts --fix
```

退出码：0 = 无同分类重复（跨分类重复只提示，不计失败）；1 = 有同分类重复；2 = taxonomy 缺失。

## 真实示例输出（2026-11-12）

首跑：

```text
taxonomy 条目 147｜同分类重复 1｜跨分类重复 1
  ✗ aimod-cc/Agent2API（同分类重复）：L75 / L80 @ AI/LLM 模型与应用
  △ deeplethe/solid-glass（跨分类）：AI Agent 与编码助手 / 前端框架与 UI 组件

修法：同分类重复跑 --fix（保留首次出现）；跨分类重复由人工决定归属后手动删一行。
```

`--fix` + 手工删掉跨分类的那行后：

```text
taxonomy 条目 145｜同分类重复 0｜跨分类重复 0

TAXONOMY DEDUPE OK：无同分类重复
```

## 判读建议

- 策展文件只有人工挑过的条目（约 150 行），不是全量 catalog；这里的重复才是检索层面的真重复。
- 跨分类重复不一定是错——但同一个仓库最好只有一个「家」，否则分类计数和检索都会重复。
