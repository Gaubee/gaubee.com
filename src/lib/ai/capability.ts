/**
 * 正交意图：
 * 1. 原始需求（2026-11）：AI 入口只在浏览器内置模型可用时出现，不可用时完全隐藏。
 * 2. 同时探测全局 LanguageModel（Prompt API）与 WebMCP（document.modelContext）两条通道。
 * 3. 探测过程绝不抛异常，任何失败都归为 unavailable，避免影响搜索页。
 */

export type AiCapabilityState = "available" | "downloadable" | "unavailable";

export interface AiCapability {
  state: AiCapabilityState;
  /** WebMCP 工具注册通道是否可用（与 Prompt API 相互独立）。 */
  webmcp: boolean;
}

/**
 * 探测浏览器 AI 能力。
 *
 * - 仅 available / downloadable 视为可用；downloading / unavailable / 异常都隐藏入口。
 * - 语言固定用 en 探测：内置模型官方语言不含中文，符合 Chrome 的实际支持范围。
 */
export async function detectAiCapability(): Promise<AiCapability> {
  let webmcp = false;
  try {
    webmcp =
      typeof document !== "undefined" && typeof document.modelContext?.registerTool === "function";

    if (typeof LanguageModel === "undefined") {
      return { state: "unavailable", webmcp };
    }

    const state = await LanguageModel.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });

    if (state === "available" || state === "downloadable") {
      return { state, webmcp };
    }
    return { state: "unavailable", webmcp };
  } catch {
    return { state: "unavailable", webmcp };
  }
}
