# privacy-audit — 发布仓隐私红线体检

## 是什么

两条红线一次查完：
1. **私有数据不进 git**：`git ls-files` 里不允许出现 `data/sources/`、`data/profile.md`、`data/feedback-log.md`、`vault.enc.sqlite`、真 `.env`、私钥/证书。
2. **发布内容不带本机路径**：`reports/` 与 `src/content/events/` 里的正文不允许出现 `/Users/…` 或 `/Volumes/…`（这些会原样上公开站点）。

只读，不改仓库。

## 解决什么

SKILL §4 的隐私红线此前靠人工自觉：私有数据放 `~/.gaubee-skills`、日报里不写本机绝对路径。工具化之后，提交前跑一次就能证明「没有漏网」。首版还顺手暴露了两个误报——`.env.example` 与源码目录 `src/lib/content-pipeline/sources/` 被宽泛模式误伤，已收窄到 `data/` 布局。

## 怎么跑

```bash
bun tools/2026-11-11-privacy-audit/privacy-audit.ts
bun tools/2026-11-11-privacy-audit/privacy-audit.ts --root <仓库根>
```

退出码：0 = 干净；1 = 有违规；2 = 不是 git 仓库或目录缺失。

## 真实示例输出（2026-11-11）

首跑（模式未收窄时）抓到 4 条，全是误报：

```text
受控文件 2414 个；私有数据泄漏 4；发布内容绝对路径 0
  ✗ .env.example（.env 凭据）
  ✗ src/lib/content-pipeline/sources/_collection.ts（私有信号源数据）
  ✗ src/lib/content-pipeline/sources/articles.ts（私有信号源数据）
  ✗ src/lib/content-pipeline/sources/events.ts（私有信号源数据）
```

收窄为「只认 `data/` 布局 + 排除 `.env.example/.sample/.template`」后：

```text
受控文件 2414 个；私有数据泄漏 0；发布内容绝对路径 0

PRIVACY OK：私有数据未入 git，发布内容无本机绝对路径
```

## 判读建议

- 这是「提交前」的证明，不是「永远安全」的证明：新增私有目录时记得把模式补进 `FORBIDDEN`。
- 绝对路径扫描只覆盖发布内容（reports 与 events）；其它目录的本地路径不影响公开交付。
