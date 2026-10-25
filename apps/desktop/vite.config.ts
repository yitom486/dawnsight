import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@dawnsight/player-ui": path.resolve(import.meta.dirname, "../../packages/player-ui/src"),
      "@dawnsight/transcript-ui": path.resolve(import.meta.dirname, "../../packages/transcript-ui/src"),
      "@dawnsight/chat-ui": path.resolve(import.meta.dirname, "../../packages/chat-ui/src"),
      "@dawnsight/ui": path.resolve(import.meta.dirname, "../../packages/ui/src"),
    },
  },
  // Dev cold start: pre-bundle heavy deps at server boot (parallel + cached
  // in node_modules/.vite) instead of discovering them one by one during the
  // first page load (that waterfall was the multi-second dev white screen).
  // Production builds are unaffected (rollup path).
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "zustand",
      "zustand/middleware",
      "@tanstack/react-query",
      "streamdown",
      "@streamdown/math",
      "@streamdown/cjk",
      "use-stick-to-bottom",
      "remark-math",
      "rehype-katex",
      "katex",
      "lucide-react",
      "clsx",
      "tailwind-merge",
      "@base-ui/react",
      "@tauri-apps/api",
      "@tauri-apps/api/core",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-opener",
    ],
  },
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1422,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "../../packages/*/src/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "happy-dom",
          // Rendered blackbox flows finish in well under a second alone, but
          // full-suite parallel load pushed them past the 5s default. A hung
          // test still fails.
          testTimeout: 15_000,
          include: ["src/**/*.test.tsx", "../../packages/*/src/**/*.test.tsx"],
          exclude: ["**/node_modules/**", "**/dist/**"],
          setupFiles: ["src/test/setup.ts"],
        },
      },
    ],
  },
});
