import { defineConfig } from "vitest/config";

// worker 最小测试栈（cdn-media Phase 2 起建）：node 环境直跑 Hono app.request()，
// KV 用内存实现（GeoKV 结构面），GitHub /user 用 vi.stubGlobal 模拟——不依赖 workerd。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
