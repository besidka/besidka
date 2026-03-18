import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "web-haptics/svelte": path.resolve(
        __dirname,
        "../../packages/web-haptics/src/svelte",
      ),
    },
  },
});
