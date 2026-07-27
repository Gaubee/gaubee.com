/**
 * Resource createResource runes 行为测试（client project，浏览器环境支持 runes）。
 *
 * 覆盖：idle→loading→success/error 状态流转、refreshing 保留旧数据、stale-error、
 * silent 静默失败、seq 竞态丢弃、setData mutation、reset、isEmpty 列表空态。
 *
 * 注意：必须在 .svelte.test.ts（client project）跑 —— runes 依赖 svelte 编译器，
 * server project（node 环境）无法编译 $state/$derived。
 */
import { describe, expect, it } from "vitest";

import { createResource } from "./resource.svelte";

// 辅助：让 fetcher 延迟返回，便于构造并发窗口
function delayed<T>(value: T, ms = 10): () => Promise<T> {
  return () => new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe("createResource 基础状态流转", () => {
  it("初始为 idle，run 后经 loading 到 success", async () => {
    const r = createResource(() => Promise.resolve([1, 2, 3]));
    expect(r.status).toBe("idle");
    expect(r.data).toBe(null);

    const p = r.run();
    expect(r.status).toBe("loading");
    await p;
    expect(r.status).toBe("success");
    expect(r.data).toEqual([1, 2, 3]);
  });

  it("失败时无旧数据 → error", async () => {
    const r = createResource(() => Promise.reject(new Error("网络错误")));
    await r.run();
    expect(r.status).toBe("error");
    expect(r.error).toBe("网络错误");
    expect(r.data).toBe(null);
  });

  it("非 Error 抛出用 errorMessage 兜底", async () => {
    const r = createResource(() => Promise.reject("字符串错误"), {
      errorMessage: "加载失败",
    });
    await r.run();
    expect(r.status).toBe("error");
    expect(r.error).toBe("加载失败");
  });
});

describe("createResource refreshing / stale-error（核心）", () => {
  it("有数据时重新 run → refreshing（保留旧 data）", async () => {
    let call = 0;
    const r = createResource(async () => {
      call++;
      return [{ id: call }];
    });
    await r.run();
    expect(r.status).toBe("success");
    expect(r.data).toEqual([{ id: 1 }]);

    // 第二次加载：refreshing，旧数据仍在
    const p = r.run();
    expect(r.status).toBe("refreshing");
    expect(r.data).toEqual([{ id: 1 }]); // 旧数据保留
    await p;
    expect(r.status).toBe("success");
    expect(r.data).toEqual([{ id: 2 }]);
  });

  it("刷新失败 → stale-error（保留旧 data，不清空）", async () => {
    let call = 0;
    const r = createResource(async () => {
      call++;
      if (call === 1) return [{ id: 1 }];
      throw new Error("刷新失败");
    });
    await r.run();
    expect(r.data).toEqual([{ id: 1 }]);

    await r.run();
    expect(r.status).toBe("stale-error");
    expect(r.error).toBe("刷新失败");
    expect(r.data).toEqual([{ id: 1 }]); // 旧数据保留，未清空
  });
});

describe("createResource silent 静默失败", () => {
  it("silent 失败不设 error，保留旧 data", async () => {
    let call = 0;
    const r = createResource(
      async () => {
        call++;
        if (call === 1) return { ok: true };
        throw new Error("失败");
      },
      { silent: true },
    );
    await r.run();
    expect(r.status).toBe("success");

    await r.run();
    // silent 失败：无 error，保留旧 data，status 回 success
    expect(r.error).toBe(null);
    expect(r.data).toEqual({ ok: true });
    expect(r.status).toBe("success");
  });

  it("silent 无旧数据失败 → idle（非 error）", async () => {
    const r = createResource(() => Promise.reject(new Error("失败")), {
      silent: true,
    });
    await r.run();
    expect(r.status).toBe("idle");
    expect(r.error).toBe(null);
  });
});

describe("createResource seq 竞态防护", () => {
  it("后发请求先回，丢弃前一个过期结果", async () => {
    let resolveFirst!: (v: string) => void;
    const firstPromise = new Promise<string>((r) => (resolveFirst = r));
    let resolveSecond!: (v: string) => void;
    const secondPromise = new Promise<string>((r) => (resolveSecond = r));

    let call = 0;
    const r = createResource<string>(() => {
      call++;
      return call === 1 ? firstPromise : secondPromise;
    });

    // 发起第一次（未 resolve）
    const p1 = r.run();
    expect(r.status).toBe("loading");

    // 紧接着发起第二次（seq 递增，第一次结果将过期）
    const p2 = r.run();
    expect(r.status).toBe("loading");

    // 第二次先 resolve
    resolveSecond("second");
    await p2;
    expect(r.data).toBe("second");

    // 第一次后 resolve，应被丢弃
    resolveFirst("first-stale");
    await p1;
    expect(r.data).toBe("second"); // 仍是 second，未被 first 覆盖
  });
});

describe("createResource isEmpty 列表空态", () => {
  it("空列表 → empty 状态", async () => {
    const r = createResource(() => Promise.resolve([] as number[]), {
      isEmpty: (d) => d.length === 0,
    });
    await r.run();
    expect(r.status).toBe("empty");
    expect(r.data).toEqual([]);
  });

  it("非空列表 → success", async () => {
    const r = createResource(() => Promise.resolve([1]), {
      isEmpty: (d) => d.length === 0,
    });
    await r.run();
    expect(r.status).toBe("success");
  });
});

describe("createResource setData mutation", () => {
  it("直接设值", async () => {
    const r = createResource(() => Promise.resolve([1, 2]));
    await r.run();
    r.setData([1, 2, 3]);
    expect(r.data).toEqual([1, 2, 3]);
    expect(r.status).toBe("success");
  });

  it("函数式更新（追加评论场景）", async () => {
    const r = createResource(() => Promise.resolve([{ id: 1 }]));
    await r.run();
    r.setData((prev) => [...(prev ?? []), { id: 2 }]);
    expect(r.data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("setData 清除旧 error", async () => {
    const r = createResource(() => Promise.resolve([1]));
    await r.run();
    r.setData([2]);
    expect(r.error).toBe(null);
  });
});

describe("createResource reset", () => {
  it("reset 清空 data/error 回 idle", async () => {
    const r = createResource(() => Promise.resolve([1, 2]));
    await r.run();
    expect(r.status).toBe("success");

    r.reset();
    expect(r.status).toBe("idle");
    expect(r.data).toBe(null);
    expect(r.error).toBe(null);
    expect(r.isLoading).toBe(false);
  });

  it("reset 让在途请求失效", async () => {
    const r = createResource(delayed("late", 20));
    const p = r.run();
    r.reset();
    await p;
    // reset 后 seq 已变，late 结果应被丢弃，data 仍为 null
    expect(r.data).toBe(null);
  });
});

describe("createResource initialData", () => {
  it("initialData 让初始即为 success（保活场景）", () => {
    const r = createResource(() => Promise.resolve([]), {
      initialData: [{ x: 1 }] as Array<{ x: number }>,
    });
    expect(r.status).toBe("success");
    expect(r.data).toEqual([{ x: 1 }]);
  });
});

void delayed;
