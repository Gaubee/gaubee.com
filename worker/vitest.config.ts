import { defineConfig } from "vitest/config";

// worker 最小测试栈（cdn-media Phase 2 起建）：node 环境直跑 Hono app.request()，
// KV 用内存实现（GeoKV 结构面），GitHub /user 用 vi.stubGlobal 模拟——不依赖 workerd。
export default defineConfig({
  // 契约文件 src/lib/geo/contract.ts 在 worker 目录外，oxc 沿目录树发现的是根 tsconfig
  // （extends .svelte-kit/tsconfig.json，CI worker job 无此文件 → TSCONFIG_ERROR，
  // 2026-10-07 CI 实证）——显式钉住 worker 自己的 tsconfig，阻断向上发现。
  oxc: {
    tsconfig: "tsconfig.json",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
