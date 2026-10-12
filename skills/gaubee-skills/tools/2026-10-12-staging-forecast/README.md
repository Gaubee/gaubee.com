# staging-forecast — staging 到期预报

## 是什么
只读工具：与 staging-clean 完全同源（`loadCurrentState` + `walkStagingX` + `RETENTION_MS`），
把 staging/x 里「已入卷且已发布」的文件按 mtime + 7 天的到期日做未来分布表，
并单列不受保留期影响的滞留（未入卷/未发布）。不删除任何文件；
删除的唯一执行者仍是 staging-clean（四安全条件 fail-closed）。

## 解决什么
2026-10-12 实证：周一 staging-clean dry-run 显示 895 文件 / 226 MB 全部「未满 7 天」
（将删 0）——即下周一它们将一次性到期。清理此前是黑盒：要么每周空操作，
要么某周突然删除数百文件。预报把删除曲线提前摊开，周一 cron 可在执行清理前
先跑本工具核对预期规模，异常脉冲（如数千文件、未入卷堆积）提前暴露。

## 怎么跑
```bash
bun tools/2026-10-12-staging-forecast/staging-forecast.ts
```
退出码：0 = 正常预报；1 = manifest 状态异常（fail-closed，与 staging-clean 同口径）。

## 真实示例输出（2026-10-12 实跑）
```
[staging-forecast] manifest gen 7：已发布卷 210/210
[staging-forecast] staging/x 共 895 文件 / 226.1 MB
  立即可删（已满保留期）：0 文件 / 0 B
  到期预报（mtime + 7 天，按到期日）：
    2026-10-14：1 文件 / 232 KB
    2026-10-15：1 文件 / 178 KB
    2026-10-16：859 文件 / 73.4 MB
    2026-10-17：11 文件 / 55.5 MB
    2026-10-18：11 文件 / 45.2 MB
    2026-10-19：12 文件 / 51.5 MB
  不受保留期影响（需人工跟进）：未入卷 0 / 0 B · 未发布 0 / 0 B
```
读法：下周一（10-19）cron 将面对 10-14~10-19 全部到期 ≈ 895 文件 / 226 MB，
属预期脉冲（上周连续三代补丁卷的合理结果），非异常。

## 状态
proposed。可并入 staging-clean 作为 `--forecast` 旗标（复用同一次扫描），
或保持独立只读工具由 cron 周一步骤 7 先行调用。
