import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import AstroPWA from "@vite-pwa/astro";
import { defineConfig } from "astro/config";
import rehypeMermaid from "rehype-mermaid";
import { rehypeLqip } from "./plugins/rehype-blurhash-placeholder/rehype-lqip-plugin";
import { rehypeResponsiveImages } from "./plugins/rehype-responsive-images";
import { rehypeWrapTables } from "./plugins/rehype-wrap-tables";

// https://astro.build/config
export default defineConfig({
  site: "https://gaubee.com",
  markdown: {
    syntaxHighlight: {
      type: "shiki",
      excludeLangs: ["mermaid", "math"],
    },
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
    },
    rehypePlugins: [
      [rehypeMermaid, { strategy: "img-svg" }],
      rehypeWrapTables,
      rehypeResponsiveImages,
      rehypeLqip,
    ],
  },
  integrations: [
    react(),
    mdx(),
    // astroLqip(),
    AstroPWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      workbox: {
        maximumFileSizeToCacheInBytes: 5242880, // 5 MB
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,jpg,avif}"],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "document",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "document-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 Days
              },
            },
          },
          {
            urlPattern: ({ request }) =>
              request.destination === "script" ||
              request.destination === "style",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-resources-cache",
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 Days
              },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "image-cache",
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 Days
              },
            },
          },
        ],
      },
      manifest: {
        name: "Gaubee's Blog",
        short_name: "Gaubee",
        description: "A blog about web development and life.",
        theme_color: "#ffffff",
        icons: [
          {
            src: "/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      devOptions: {
        enabled: false,
        navigateFallbackAllowlist: [/^\/$/],
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    format: "file",
  },
});
