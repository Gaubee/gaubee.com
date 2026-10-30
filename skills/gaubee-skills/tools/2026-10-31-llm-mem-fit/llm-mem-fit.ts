#!/usr/bin/env bun
/**
 * llm-mem-fit — 端侧 LLM 内存适配估算（16GB Mac 视角）
 *
 * 背景（本周 LFM3-1.7B / uzu / MLX 端侧三连信号 + profile「16GB 内存敏感」）：
 * 「这个模型我的机器跑得动吗」不需要猜——参数量 × 量化位宽给出权重体积，加上
 * KV cache 与运行时余量给出总占用，与可用内存对比即得结论。纯计算，零网络。
 *
 * 用法：bun tools/2026-10-31-llm-mem-fit/llm-mem-fit.ts <参数量B> [位宽bit] [上下文K]
 *   例：llm-mem-fit.ts 1.7 4 32      （1.7B、4bit、32K 上下文）
 * 退出码：0 = 正常；2 = 用法错误。假设值可改（--avail 12 等）。
 */
function main(): number {
  const a = process.argv.slice(2);
  const paramsB = Number(a[0]);
  if (!Number.isFinite(paramsB) || paramsB <= 0) {
    console.error("用法：llm-mem-fit.ts <参数量B> [位宽bit=4] [上下文K=8] [--avail 12]");
    return 2;
  }
  const kw = (flag: string, dflt: number) => {
    const i = a.indexOf(flag);
    return i >= 0 ? Number(a[i + 1]) || dflt : dflt;
  };
  const bits = kw("--bits", Number(a[1]) || 4);
  const ctxK = kw("--ctx", Number(a[2]) || 8);
  const availGB = kw("--avail", 12); // 16GB Mac 的典型可用（系统+其它应用后）

  const weightsGB = (paramsB * 1e9 * (bits / 8)) / 1024 ** 3;
  // KV cache 上界估：每 token 128KB（传统 MHA 中小模型的经验上界）；
  // GQA/滑动窗口/线性注意力（如 LFM3 的非标准注意力）可低一个数量级
  const kvGB = (ctxK * 1024 * 128 * 1024) / 1024 ** 3;
  const runtimeGB = 0.8; // 推理框架+激活的常备余量（保守）
  const totalGB = weightsGB + kvGB + runtimeGB;

  const verdict =
    totalGB <= availGB * 0.7
      ? "轻松：余量充足，可同时开其它大应用"
      : totalGB <= availGB
        ? "可跑：贴着可用内存，建议关掉大应用后独占运行"
        : "紧张/不可行：超出可用内存，需更低量化或更小模型";

  console.log(`模型 ${paramsB}B @ ${bits}bit，上下文 ${ctxK}K，可用内存按 ${availGB}GB 估：`);
  console.log(`  权重 ${weightsGB.toFixed(2)} GB + KV cache ${kvGB.toFixed(2)} GB + 运行时余量 ${runtimeGB} GB = 总占用 ${totalGB.toFixed(2)} GB`);
  console.log(`  判定：${verdict}`);
  console.log("（KV cache 与运行时为经验估算；实际以引擎实测为准——uzu/MLX/llama.cpp 各有差异）");
  return 0;
}

process.exit(main());
