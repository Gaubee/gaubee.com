// llm-mem-fit（Go 版）— 端侧 LLM 内存适配估算
//
// 迁移背景（2026-11-23，kzf 裁决）：需要分发给别人用的工具优先 Go，
// 单二进制静态链接、省内存省磁盘。本工具纯计算无依赖，是最合适的迁移对象。
//
// 口径与 TS 版一致（见 tools/2026-10-31-llm-mem-fit/README.md）：
//   权重体积 = 参数量 × 位宽 / 8
//   KV cache 上界 = 2 × 层数 × 上下文 × 隐藏维 × 精度字节（传统 MHA 上界；
//     GQA / 线性注意力可低一个数量级，实际以引擎实测为准）
//   运行时余量 = 权重 × 15%
//
// 用法：
//   llm-mem-fit -params 1.7 -bits 4 -ctx 8
//   llm-mem-fit -params 7 -bits 8 -ctx 32 -avail 12
package main

import (
	"flag"
	"fmt"
	"os"
)

const (
	// 经验层数与隐藏维：按参数量粗估（TS 版同口径）
	kvOverheadFactor = 0.15
)

// estArch 按参数量粗估层数与隐藏维：约 sqrt(params*1e9/12) 做层数，隐藏维取 2048 起。
func estArch(paramsB float64) (layers int, hidden int) {
	p := paramsB * 1e9
	layers = int(12.0 * float64(1) * (1 + p/1e9/7.0))
	if layers < 12 {
		layers = 12
	}
	if layers > 80 {
		layers = 80
	}
	switch {
	case paramsB < 1:
		hidden = 1024
	case paramsB < 4:
		hidden = 2048
	case paramsB < 9:
		hidden = 4096
	default:
		hidden = 8192
	}
	return
}

func main() {
	params := flag.Float64("params", 0, "参数量（单位 B，如 1.7 表示 1.7B）")
	bits := flag.Int("bits", 4, "量化位宽（4 / 8 / 16）")
	ctx := flag.Int("ctx", 8, "上下文长度（单位 K）")
	avail := flag.Float64("avail", 16, "可用内存（GB）")
	flag.Parse()

	if *params <= 0 {
		fmt.Fprintln(os.Stderr, "用法：llm-mem-fit -params 1.7 [-bits 4] [-ctx 8] [-avail 16]")
		os.Exit(2)
	}

	weightsGB := *params * float64(*bits) / 8.0
	layers, hidden := estArch(*params)
	// KV cache：2 (K+V) × layers × ctx × hidden × bytes(fp16=2)
	kvGB := 2.0 * float64(layers) * float64(*ctx*1024) * float64(hidden) * 2 / 1e9
	runtimeGB := weightsGB * kvOverheadFactor
	total := weightsGB + kvGB + runtimeGB

	verdict := "不可行"
	switch {
	case total <= *avail*0.6:
		verdict = "轻松"
	case total <= *avail*0.9:
		verdict = "可跑"
	}

	fmt.Printf("模型 %.1fB / %dbit / %dK 上下文\n", *params, *bits, *ctx)
	fmt.Printf("  权重     %.2f GB\n", weightsGB)
	fmt.Printf("  KV 上界  %.2f GB（层数 %d × 隐藏维 %d，MHA 上界）\n", kvGB, layers, hidden)
	fmt.Printf("  运行时   %.2f GB（权重 × %.0f%%）\n", runtimeGB, kvOverheadFactor*100)
	fmt.Printf("  合计     %.2f GB / 可用 %.1f GB → %s\n", total, *avail, verdict)
	if verdict == "不可行" {
		os.Exit(1)
	}
}
