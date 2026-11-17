import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version?: string };

// The Hub is the only backend the portal talks to. Keep the dev server on a
// fixed port so the Hub and the docs never have to guess where the portal is.
export default defineConfig({
  plugins: [react()],
  define: {
    __PORTAL_VERSION__: JSON.stringify(packageJson.version ?? "0.0.0"),
  },
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8780",
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8780",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  // Keep the check honest: a missing __PORTAL_VERSION__ define should fail at
  // build time instead of silently rendering an empty badge.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
