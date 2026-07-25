import { Buffer } from "buffer";

import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { mdsvex } from "mdsvex";
import { defineConfig } from "vitest/config";

// isomorphic-git 内部大量使用 Node.js Buffer（Buffer.from/Buffer.alloc/Buffer.isBuffer）。
// 浏览器无原生 Buffer，需全局 polyfill（isomorphic-git 不走 import 而是 JS 全局引用）。
// ZenFS 内部自带 polyfill，但 isomorphic-git 是独立包，需在此全局注入。
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as Record<string, unknown>).Buffer = Buffer;
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },
      // SPA 模式：编辑器路由由 NavController 接管，SvelteKit 只输出一个 index.html fallback。
      adapter: adapter({ fallback: "index.html", strict: false }),
      preprocess: [mdsvex({ extensions: [".svx", ".md"] })],
      extensions: [".svelte", ".svx", ".md"],
      // 预渲染时遇到坏链接（文章正文里的相对 .md 链接等）不中断构建，只警告。
      prerender: {
        handleHttpError: ({ path, referrer, message }) => {
          console.warn(`prerender 跳过坏链接: ${path}（来自 ${referrer}）— ${message}`);
        },
        handleMissingId: "warn",
        entries: ["*"],
      },
    }),
  ],
  // 本地开发：vite 经 portless 暴露为 https://gaubee.com.localhost，
  // Worker（wrangler dev，localhost:8787）的 /auth/* 与 /api/proxy/* 经 vite proxy 同源转发。
  // 这样前端与 Worker 同源，规避 CORS 与 secure cookie 跨子域（SameSite）问题。
  // 生产环境前端跨域直连 Worker（VITE_AUTH_BASE 指向 Worker 域名），此 proxy 仅 dev 生效。
  server: {
    proxy: {
      "/auth": {
        target: "http://localhost:8787",
        changeOrigin: true, // 必需：portless 反代下避免 508 循环检测
        secure: false,
      },
      "/api/proxy": {
        target: "http://localhost:8787",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  test: {
    expect: { requireAssertions: true },
    projects: [
      {
        extends: "./vite.config.ts",
        test: {
          name: "client",
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium", headless: true }],
          },
          include: ["src/**/*.svelte.{test,spec}.{js,ts}"],
          exclude: ["src/lib/server/**"],
        },
      },

      {
        extends: "./vite.config.ts",
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.{test,spec}.{js,ts}"],
          exclude: ["src/**/*.svelte.{test,spec}.{js,ts}"],
        },
      },
    ],
  },
});
