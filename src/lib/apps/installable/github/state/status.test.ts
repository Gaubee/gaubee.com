/**
 * 异步资源状态机派生逻辑测试（server project，纯函数，无 runes）。
 *
 * 覆盖 8 种拓扑状态的派生：idle/loading/refreshing/success/empty/error/stale-error。
 */
import { describe, expect, it } from "vitest";

import { deriveStatus, hasRenderableData, isErrorStatus, isPendingStatus } from "./status";

const neverEmpty = () => false;

describe("deriveStatus 基础拓扑", () => {
  it("idle：无 data 无 error 未加载", () => {
    expect(deriveStatus({ data: null, error: null, isLoading: false, hasData: false })).toBe(
      "idle",
    );
  });

  it("loading：无 data 未加载完", () => {
    expect(
      deriveStatus({
        data: null,
        error: null,
        isLoading: true,
        hasData: false,
      }),
    ).toBe("loading");
  });

  it("error：无 data 且异常", () => {
    expect(
      deriveStatus({
        data: null,
        error: "网络错误",
        isLoading: false,
        hasData: false,
      }),
    ).toBe("error");
  });
});

describe("deriveStatus 有数据区中间态（核心）", () => {
  it("refreshing：有 data 且加载中（背景刷新，不闪骨架）", () => {
    expect(
      deriveStatus({
        data: [1, 2],
        error: null,
        isLoading: true,
        hasData: true,
      }),
    ).toBe("refreshing");
  });

  it("success：有 data 无 error", () => {
    expect(
      deriveStatus({
        data: { a: 1 },
        error: null,
        isLoading: false,
        hasData: true,
      }),
    ).toBe("success");
  });

  it("stale-error：有 data 但异常（保留旧数据 + 错误条）", () => {
    expect(
      deriveStatus({
        data: [1, 2],
        error: "刷新失败",
        isLoading: false,
        hasData: true,
      }),
    ).toBe("stale-error");
  });
});

describe("deriveStatus 列表空态", () => {
  it("empty：有 data 但 isEmpty 判定为空（列表）", () => {
    const isEmpty = (d: unknown[]) => Array.isArray(d) && d.length === 0;
    expect(
      deriveStatus({
        data: [],
        error: null,
        isLoading: false,
        hasData: true,
        isEmpty,
      }),
    ).toBe("empty");
  });

  it("无 isEmpty 时列表空数据仍为 success（单值语义）", () => {
    // 单值资源不配 isEmpty，data 为 [] 视为有效数据 → success
    expect(
      deriveStatus({
        data: [],
        error: null,
        isLoading: false,
        hasData: true,
      }),
    ).toBe("success");
  });
});

describe("deriveStatus 优先级", () => {
  it("isLoading 优先于 error（加载中即便有 error 也先当 refreshing/loading）", () => {
    // 场景：刷新中，但旧 error 还没清。loading 应优先显示
    expect(
      deriveStatus({
        data: [1],
        error: "旧错误",
        isLoading: true,
        hasData: true,
      }),
    ).toBe("refreshing");
    expect(
      deriveStatus({
        data: null,
        error: "旧错误",
        isLoading: true,
        hasData: false,
      }),
    ).toBe("loading");
  });

  it("error 优先于 isEmpty（异常列表不显示空态）", () => {
    expect(
      deriveStatus({
        data: [],
        error: "失败",
        isLoading: false,
        hasData: true,
        isEmpty: (d) => Array.isArray(d) && d.length === 0,
      }),
    ).toBe("stale-error");
  });
});

describe("status 谓词函数", () => {
  it("isPendingStatus 识别 loading/refreshing", () => {
    expect(isPendingStatus("loading")).toBe(true);
    expect(isPendingStatus("refreshing")).toBe(true);
    expect(isPendingStatus("success")).toBe(false);
    expect(isPendingStatus("idle")).toBe(false);
  });

  it("isErrorStatus 识别 error/stale-error", () => {
    expect(isErrorStatus("error")).toBe(true);
    expect(isErrorStatus("stale-error")).toBe(true);
    expect(isErrorStatus("success")).toBe(false);
    expect(isErrorStatus("empty")).toBe(false);
  });

  it("hasRenderableData 识别可渲染状态", () => {
    expect(hasRenderableData("success")).toBe(true);
    expect(hasRenderableData("empty")).toBe(true);
    expect(hasRenderableData("refreshing")).toBe(true);
    expect(hasRenderableData("stale-error")).toBe(true);
    expect(hasRenderableData("loading")).toBe(false);
    expect(hasRenderableData("error")).toBe(false);
    expect(hasRenderableData("idle")).toBe(false);
  });
});

// 让 neverEmpty 被 import 引用（避免 unused 报错，同时留作示例）
void neverEmpty;
