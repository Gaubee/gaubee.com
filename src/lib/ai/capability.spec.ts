/**
 * 能力探测测试：LanguageModel 状态归一化 + WebMCP 探测，任何异常都隐藏入口。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { detectAiCapability } from "./capability";

function stubLanguageModel(availability: () => Promise<string>): void {
  vi.stubGlobal("LanguageModel", { availability });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectAiCapability", () => {
  it("available / downloadable 视为可用", async () => {
    stubLanguageModel(async () => "available");
    await expect(detectAiCapability()).resolves.toEqual({
      state: "available",
      webmcp: false,
    });

    stubLanguageModel(async () => "downloadable");
    await expect(detectAiCapability()).resolves.toEqual({
      state: "downloadable",
      webmcp: false,
    });
  });

  it("downloading / unavailable 都归为 unavailable", async () => {
    stubLanguageModel(async () => "downloading");
    await expect(detectAiCapability()).resolves.toEqual({
      state: "unavailable",
      webmcp: false,
    });

    stubLanguageModel(async () => "unavailable");
    await expect(detectAiCapability()).resolves.toEqual({
      state: "unavailable",
      webmcp: false,
    });
  });

  it("缺少 LanguageModel 或 availability 抛错时不抛异常", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    await expect(detectAiCapability()).resolves.toEqual({
      state: "unavailable",
      webmcp: false,
    });

    stubLanguageModel(async () => {
      throw new Error("boom");
    });
    await expect(detectAiCapability()).resolves.toEqual({
      state: "unavailable",
      webmcp: false,
    });
  });

  it("独立探测 WebMCP 通道", async () => {
    stubLanguageModel(async () => "available");
    vi.stubGlobal("document", {
      modelContext: { registerTool: vi.fn() },
    });
    await expect(detectAiCapability()).resolves.toEqual({
      state: "available",
      webmcp: true,
    });
  });
});
