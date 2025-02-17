import react from "@vitejs/plugin-react";
import vike from "vike/plugin";
import { defineConfig } from "vite";
// import tailwindcss from "@tailwindcss/vite";
// console.log("tailwindcss", tailwindcss);

export default defineConfig(() => {
  return {
    plugins: [
      //
      // tailwindcss(),
      react(),
      vike(),
    ],
  };
});
