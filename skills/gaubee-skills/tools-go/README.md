# tools-go — 用 Go 写的工具（单二进制分发）

kzf 2026-11-23 裁决：需要服务端能力、常驻进程、或适合单二进制分发的工具优先 Go，
省内存省磁盘。站点侧不跑 Go（站点是 Rust + Svelte 静态），所以这里的工具通过
`gaubee-tool-<slug>` 仓库的 release 分发，WebApp 只给安装说明。

## 已迁移

| 工具 | 理由 | 体积 | 状态 |
| --- | --- | --- | --- |
| `llm-mem-fit` | 纯计算、无依赖、会被反复手跑 | 1.6MB 静态链接单二进制 | ✅ 与 TS 版口径一致 |

## 构建约定

```sh
cd tools-go/<slug>
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o <slug> .
```

`CGO_ENABLED=0` 保证静态链接（scratch 容器与任意 Linux 都能跑）；
`-trimpath` 去掉本机路径（避免把工作目录写进二进制）。

## 何时值得 Go 化

- 需要常驻/并发（轮询、服务端、长连接）
- 输入输出体积大（媒体、批量文件）
- 会被别人拿去用（单二进制分发比「装 bun 再跑脚本」友好得多）

已有的 TS 工具**不强制重写**，只在 `upgrade` 时顺带迁移。
