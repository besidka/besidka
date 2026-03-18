import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  optimizeDeps: {
    exclude: ["@node-rs/argon2"],
  },
  plugins: [
    react(),
    {
      name: "simpleanalytics",
      transformIndexHtml(html) {
        const file = mode === "development" ? "latest.dev.js" : "latest.js";
        return {
          html,
          tags: [
            {
              tag: "script",
              attrs: {
                async: true,
                src: `https://scripts.simpleanalyticscdn.com/${file}`,
              },
              injectTo: "head",
            },
          ],
        };
      },
    },
  ],
}));
