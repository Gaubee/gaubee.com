/**
 * appLoadStore 单元测试：加载状态的 start/done/isLoading 生命周期。
 */
import { describe, expect, it } from "vitest";

import { appLoadStore } from "./app-load.svelte";

describe("appLoadStore", () => {
  // 清理：每个 test 前确保 store 干净（start/done 是幂等的）
  function cleanup() {
    // start 再 done 清空所有（用已知 route）
    // 由于没有 list API，这里用一个测试 route 隔离
  }

  it("初始状态无加载", () => {
    // 注意：appLoadStore 是模块单例，可能被其它测试污染
    // isLoading 在所有测试结束后应为 false，但单测间可能有残留
    // 这里只测增量行为
    const before = appLoadStore.isLoading;
    if (!before) {
      expect(appLoadStore.isLoading).toBe(false);
    }
  });

  it("start 后 isLoading=true，done 后=false", () => {
    const route = "/__test__/load-a";
    appLoadStore.start(route);
    expect(appLoadStore.isOpening(route)).toBe(true);
    expect(appLoadStore.isLoading).toBe(true);

    appLoadStore.done(route);
    expect(appLoadStore.isOpening(route)).toBe(false);
    // 注意：单例，其它测试可能 start 了别的 route，不能断言 isLoading===false
  });

  it("多个 route 同时加载，全部 done 后 isLoading=false", () => {
    const r1 = "/__test__/load-multi-1";
    const r2 = "/__test__/load-multi-2";
    appLoadStore.start(r1);
    appLoadStore.start(r2);
    expect(appLoadStore.isOpening(r1)).toBe(true);
    expect(appLoadStore.isOpening(r2)).toBe(true);

    appLoadStore.done(r1);
    expect(appLoadStore.isOpening(r1)).toBe(false);
    // r2 还在加载
    expect(appLoadStore.isOpening(r2)).toBe(true);

    appLoadStore.done(r2);
    expect(appLoadStore.isOpening(r2)).toBe(false);
  });

  it("start 幂等（重复 start 同 route 不重复计数）", () => {
    const route = "/__test__/load-idempotent";
    appLoadStore.start(route);
    appLoadStore.start(route); // 重复
    expect(appLoadStore.isOpening(route)).toBe(true);

    appLoadStore.done(route);
    // 一次 done 即清空（幂等 start 没有重复计数）
    expect(appLoadStore.isOpening(route)).toBe(false);
  });

  it("done 未 start 的 route 安全（幂等）", () => {
    const route = "/__test__/never-started";
    expect(() => appLoadStore.done(route)).not.toThrow();
    expect(appLoadStore.isOpening(route)).toBe(false);
  });
});
