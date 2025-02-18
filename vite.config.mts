import react from "@vitejs/plugin-react";
import vike from "vike/plugin";
import { defineConfig } from "vite";
// import tailwindcss from "@tailwindcss/vite";
// console.log("tailwindcss", tailwindcss);
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig(() => {
  return {
    plugins: [
      //
      // tailwindcss(),
      react(),
      vike(),
      viteStaticCopy({
        targets: [
          { src: "img", dest: "./" }, // 将根目录下的 img 文件夹复制到 dist 文件夹
        ],
      }),
    ],
  };
});
