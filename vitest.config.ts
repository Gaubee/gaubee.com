/// <reference types="vitest" />

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { getViteConfig } from "astro/config";

export default getViteConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    globals: false,
    environment: "jsdom",
    setupFiles: ["./vitest-setup.js"],
  },
});
