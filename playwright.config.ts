/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：内容阅读体验必须经过真实浏览器 E2E 验收。
 * 2. 未指定外部地址时，以当前 pnpm 工具链构建并启动静态预览服务。
 * 3. `PLAYWRIGHT_BASE_URL` 指向既有服务，供端口冲突或开发服务器复用。
 */
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testMatch: "**/*.e2e.{ts,js}",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm build && pnpm preview --host 127.0.0.1",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
