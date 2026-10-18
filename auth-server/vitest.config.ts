import { defineConfig } from "vitest/config";

// 独立最小配置：阻断 vitest 向上解析仓库根的 sveltekit vite 配置
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
