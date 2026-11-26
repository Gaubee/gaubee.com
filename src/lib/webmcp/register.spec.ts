/**
 * WebMCP 注册测试：两个工具同源注册、可取消、无 API 时为空操作。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerSiteTools } from "./register";

interface RegisteredTool {
  name: string;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registerSiteTools", () => {
  it("注册两个只读工具，取消时 abort 注册信号", () => {
    const registerTool = vi.fn();
    vi.stubGlobal("document", {
      modelContext: { registerTool },
    });

    const cancel = registerSiteTools();
    expect(registerTool).toHaveBeenCalledTimes(2);

    const tools = registerTool.mock.calls.map(([tool]) => tool as RegisteredTool);
    expect(tools.map((tool) => tool.name)).toEqual(["search_site", "read_article"]);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        untrustedContentHint: true,
      });
    }

    const options = registerTool.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.signal?.aborted).toBe(false);

    cancel();
    expect(options?.signal?.aborted).toBe(true);

    // 取消后可重新注册，不残留旧单例。
    const nextRegister = vi.fn();
    vi.stubGlobal("document", { modelContext: { registerTool: nextRegister } });
    const cancelNext = registerSiteTools();
    expect(nextRegister).toHaveBeenCalledTimes(2);
    cancelNext();
  });

  it("无 document / modelContext 时返回空函数且不抛", () => {
    const cancel = registerSiteTools();
    expect(() => cancel()).not.toThrow();
  });
});
