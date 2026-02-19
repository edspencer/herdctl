import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// @herdctl/core dynamically imports @herdctl/discord, @herdctl/slack, and
// @herdctl/web. Vite's import-analysis plugin fails when resolving these from
// core's compiled output in CI. This plugin short-circuits resolution for all
// @herdctl/* packages found via dynamic import in core's fleet-manager.
function externalizeOptionalDeps(): Plugin {
  const externals = new Set(["@herdctl/discord", "@herdctl/slack", "@herdctl/web"]);
  return {
    name: "externalize-optional-deps",
    enforce: "pre",
    resolveId(source) {
      if (externals.has(source)) {
        return { id: source, external: true };
      }
    },
  };
}

export default defineConfig({
  plugins: [externalizeOptionalDeps(), react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/client/src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Server tests are pure Node.js (Fastify, WebSocket handler) — use node
    // environment instead of jsdom.
    environmentMatchGlobs: [["src/server/**/*.test.ts", "node"]],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.d.ts", "**/*.config.*", "**/test-setup.ts"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src/client/src"),
    },
  },
});
