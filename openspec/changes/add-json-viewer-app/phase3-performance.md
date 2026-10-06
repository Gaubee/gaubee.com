# Phase 3 性能与部署评估（2026-10-06）

## 当前实测

基准命令：

```bash
pnpm exec tsx scripts/json-stream-benchmark.ts 10 100 1024 3072 \
  --parse-limit-mb=512 \
  --shapes=fragment,giant \
  --engines=JS-fallback,MoonBit-wasm,MoonBit-native,JSON.parse
```

环境：Node `v24.21.0`、Moon `0.1.20260824`、Apple Silicon 本地工作站。样本使用
2 MiB 窗口生成到 `/tmp/gaubee-json-bench`，每个谱形在 `finally` 中删除；每行的
`bytes` 均由生成器和 native helper 做精确硬断言。表中时间为单次打开/扫描耗时，
RSS 为该独立 worker/进程的峰值；不是同一进程叠加值。

### 打开耗时与峰值 RSS

单位：时间 ms，RSS MiB；格式为 `耗时 / RSS 峰值`。`JSON.parse` 超过 512 MiB
保护阈值时不执行，避免把宿主机内存压力误记为解析性能。

| 样本 | bytes | JSON.parse | JS-fallback | MoonBit-wasm | MoonBit-native |
| --- | ---: | ---: | ---: | ---: | ---: |
| 碎片 10 MB | 10485760 | 48.0 / 178.8 | 382.7 / 509.0 | 1471.8 / 154.4 | 547.7 / 97.5 |
| 巨值 10 MB | 10485760 | 10.3 / 96.7 | 73.4 / 84.2 | 135.6 / 81.0 | 134.2 / 14.3 |
| 碎片 100 MB | 104857600 | 605.4 / 937.7 | 3369.7 / 685.9 | 14102.8 / 195.9 | 6717.7 / 97.5 |
| 巨值 100 MB | 104857600 | 87.8 / 379.8 | 626.9 / 139.9 | 1074.9 / 138.8 | 980.1 / 14.3 |
| 碎片 1024 MB | 1073741824 | 跳过：>512 MiB | 33130.1 / 683.7 | 146027.4 / 215.9 | 51934.4 / 97.5 |
| 巨值 1024 MB | 1073741824 | 跳过：>512 MiB | 6206.7 / 142.7 | 10743.7 / 143.5 | 9675.2 / 14.3 |
| 碎片 3072 MB | 3221225472 | 跳过：>512 MiB | 103281.2 / 802.3 | 438945.0 / 209.8 | 155605.6 / 97.5 |
| 巨值 3072 MB | 3221225472 | 跳过：>512 MiB | 18639.0 / 139.4 | 32397.5 / 142.4 | 29219.0 / 14.3 |

3GB 两种谱形均输出并验证 `bytes=3221225472`。碎片型的 JS/wasm/native 分别为
103.3s/438.9s/155.6s；巨值型分别为 18.6s/32.4s/29.2s。3GB 文件跑完后临时目录
为空，`/tmp` 可用空间恢复到约 47 GiB。

### 分块与长任务边界

下面的 `maxChunkMs` 是 Node worker 内单个 2 MiB 窗口的处理峰值，用于观察分块
粒度，不等同于浏览器主线程 Long Task：

| 样本 | JS-fallback | MoonBit-wasm |
| --- | ---: | ---: |
| 碎片 10 MB | 103.9 | 335.5 |
| 巨值 10 MB | 15.5 | 49.3 |
| 碎片 100 MB | 104.6 | 335.8 |
| 巨值 100 MB | 15.5 | 48.4 |
| 碎片 1024 MB | 118.1 | 435.9 |
| 巨值 1024 MB | 26.4 | 49.1 |
| 碎片 3072 MB | 182.4 | 428.5 |
| 巨值 3072 MB | 15.6 | 49.5 |

浏览器主线程长任务、真实页面打开耗时和 JS heap 峰值未在本轮 Node 基准中采集；
该脚本把每个引擎放入独立 Node worker/进程，不能把 worker 计时冒充
`PerformanceObserver('longtask')` 证据。需要专用 preview + 浏览器性能机补测。

## 结论

- MoonBit classic wasm ABI 已可用：共享 `WebAssembly.Memory` 导入、ptr+len 分块、
  `step/reset` 导出均由 Node 实例化探针和上述 3GB wasm 路径验证；`wasm-tools validate`
  通过。
- MoonBit-native 的峰值 RSS 最低；MoonBit-wasm 与 JS fallback 在巨值型保持稳定，
  碎片型会随事件/状态累积而增大，但均完成 3GB 精确字节扫描。
- `JSON.parse` 在小档位耗时最低，但 1GB/3GB 受保护阈值跳过；不能据此声称流式
  路径更快，只能确认流式路径可在受控内存下处理 3GB。

## COOP/COEP 评估

- 首发采用 Transferable ArrayBuffer 双缓冲，协议把数据通道隔离在 Worker request/response
  类型中。
- 未向静态站点添加 `COOP`/`COEP` 响应头，因此不会改变第三方图片、OAuth、SSG 页面现有
  加载语义。
- SAB/shared WebAssembly.Memory 需要 `COOP: same-origin` 与 `COEP: credentialless`，
  应在独立域名或全站资源审计后由 Owner 决定；本轮不宣称 SAB 已上线。
