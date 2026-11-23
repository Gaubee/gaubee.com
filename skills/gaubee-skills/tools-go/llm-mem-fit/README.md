# llm-mem-fit（Go 版）— 端侧 LLM 内存适配估算

「这个模型我的 16GB Mac 跑得动吗」的计算器。参数量 × 位宽估权重体积，
加 KV cache 上界与运行时余量，对比可用内存给三档判定。

## 为什么用 Go

原 TS 版（`tools/2026-10-31-llm-mem-fit/`）是纯计算无依赖，正是单二进制分发的理想对象：
编译后 1.6MB 静态链接，拷到任何 Linux/macOS 直接跑，不需要装 bun。

## 怎么跑

```sh
go build -trimpath -ldflags="-s -w" -o llm-mem-fit .
./llm-mem-fit -params 1.7 -bits 4 -ctx 8
./llm-mem-fit -params 7 -bits 8 -ctx 32 -avail 12
```

## 真实示例输出（2026-11-23 实跑）

```text
$ ./llm-mem-fit -params 1.7 -bits 4 -ctx 8
模型 1.7B / 4bit / 8K 上下文
  权重     0.85 GB
  KV 上界  0.94 GB（层数 14 × 隐藏维 2048，MHA 上界）
  运行时   0.13 GB（权重 × 15%）
  合计     1.92 GB / 可用 16.0 GB → 轻松

$ ./llm-mem-fit -params 7 -bits 8 -ctx 32 -avail 12
模型 7.0B / 8bit / 32K 上下文
  权重     7.00 GB
  KV 上界  12.88 GB（层数 24 × 隐藏维 4096，MHA 上界）
  运行时   1.05 GB（权重 × 15%）
  合计     20.93 GB / 可用 12.0 GB → 不可行
```

## 判读

- KV cache 是**传统 MHA 上界**；GQA / 线性注意力架构可低一个数量级，实际以引擎实测为准。
- 退出码：可行 0 / 不可行 1，可直接用在脚本里。
