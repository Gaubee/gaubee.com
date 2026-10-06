# Phase 3 性能与部署评估（2026-10-06）

## 当前实测

基线命令：`pnpm exec tsx scripts/json-stream-benchmark.ts 1 10`。
样本为重复小键值对象，Node 22，Apple Silicon 本地工作站；RSS 为进程采样增量。

|  样本 | 路径                    |                                        打开耗时 |  RSS 增量 |
| ----: | ----------------------- | ----------------------------------------------: | --------: |
|  1 MB | `JSON.parse`            |                                         17.8 ms |  19.3 MiB |
|  1 MB | JS 分块状态机           |                                         84.4 ms |  38.1 MiB |
| 10 MB | `JSON.parse`            |                                        196.3 ms | 197.0 MiB |
| 10 MB | JS 分块状态机           |                                        552.6 ms | 191.2 MiB |
|  1 MB | MoonBit native 分块扫描 | 由 `moon bench` 输出 283.0 ms（含基准 harness） |    未采集 |

这组数据不支持“流式解析更快”的结论；它支持流式路径在大输入下控制主线程占用和峰值内存。当前 MoonBit 仅为有限词法扫描器，且 `moon bundle --target wasm --release --strip` 在工具链中因多个 producer panic，未产出可加载浏览器 ABI；native bench 只作为扫描循环基准，不冒充浏览器 WASM 数据。

## 生产谱形矩阵

10/100/1024/3072 MB 的碎片型与巨值型样本、主线程长任务计数、浏览器 RSS/JS heap 峰值，以及 2 GB 检查点重放仍需在专用性能机和真实 preview 上补跑。当前发布策略不依赖这些未采集数据。

## COOP/COEP 评估

- 首发采用 Transferable ArrayBuffer 双缓冲，协议把数据通道隔离在 Worker request/response 类型中。
- 未向静态站点添加 `COOP`/`COEP` 响应头，因此不会改变第三方图片、OAuth、SSG 页面现有加载语义。
- SAB/shared WebAssembly.Memory 需要 `COOP: same-origin` 与 `COEP: credentialless`，应在独立域名或全站资源审计后由 Owner 决定；本轮不宣称 SAB 已上线。
