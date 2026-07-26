import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { mdsvex } from "mdsvex";
import { defineConfig } from "vitest/config";

// 注：isomorphic-git 的 Buffer polyfill 在 +layout.svelte 运行时注入（globalThis.Buffer）。

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
  // Worker（wrangler dev，localhost:8787）的 /auth/* 经 vite proxy 同源转发。
  // 前端 OAuth 跳转走相对路径 /auth/github，vite proxy 转发到 Worker。
  // 新架构前端直连 api.github.com（不走 proxy），Worker 仅处理 OAuth + 图片上传。
  server: {
    proxy: {
      "/auth": {
        target: "http://localhost:8787",
        changeOrigin: true, // 必需：portless 反代下避免 508 循环检测
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
