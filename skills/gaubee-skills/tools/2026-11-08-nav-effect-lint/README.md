# nav-effect-lint — 后台保活视图「抢导航」静态检查

## 是什么

扫 `src/**/*.svelte` 里所有 `$effect`，凡是里面调用了导航（`navigateMain` / `navController.*` / `go({...})` / `history.pushState|replaceState`），就要求同一个 effect 里出现前台判断（`isActive` / `useActive`），否则报风险。外壳级例外用注释 `nav-effect-allow` 放行。

## 解决什么

2026-11-08 的真实事故：main 区按 tab 保活，后台应用同样常驻 DOM，而且拿到的是**全局 location**。EventView 的「月份必显式」规范化 effect 在后台看到 `urlMonth` 为空，就 REPLACE 回 `/app/event`——用户点「桌面」后地址栏刚变成 `/`，立刻又被拉回事件页，桌面永远回不去。修法是在 effect 里加 `if (!isActive) return`；这个工具把同一类写法在提交前拦下来。

## 怎么跑

```bash
bun tools/2026-11-08-nav-effect-lint/nav-effect-lint.ts                 # 默认扫站点仓库
bun tools/2026-11-08-nav-effect-lint/nav-effect-lint.ts --root <目录>    # 扫指定根（含 src/）
bun tools/2026-11-08-nav-effect-lint/nav-effect-lint.ts --json
```

退出码：0 = 全部设防；1 = 有风险；2 = 路径异常。纯本地只读。

## 真实示例输出（2026-11-08）

当前站点仓库（修复已落地，AreaOutlet 的 NotFound 重定向标了 `nav-effect-allow`）：

```text
扫描 196 个 .svelte（/…/gaubee.com）
OK：所有 effect 内导航都有前台判断（isActive/useActive）或 nav-effect-allow 标记
```

用修复前的 `EventView.svelte`（commit `1f02eaf4`）做回归，三处 effect 全被抓出：

```text
扫描 1 个 .svelte（/tmp/navlint-demo）
发现 3 处未设防的 effect 导航：
  src/lib/apps/views/EventView.svelte:146  go
    go({ month: months[0][0], hash: hashItem || undefined }, 'REPLACE')
  src/lib/apps/views/EventView.svelte:153  go
    go({ month: currentMonth, hash: urlItem }, 'REPLACE')
  src/lib/apps/views/EventView.svelte:160  go
    if (m !== currentMonth) go({ month: m, hash: hashItem }, 'REPLACE')
```

## 判读建议

- 规则只认「effect 里出现导航调用」这一件事，不判断业务正确性；`nav-effect-allow` 只该给外壳级重定向用。
- 新写后台保活视图的 URL 规范化时，先想清楚「我不在前台时这段 effect 该不该跑」。
