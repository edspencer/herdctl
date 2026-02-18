import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/**/*.test.ts"],
      reporter: ["text", "json", "html"],
      thresholds: {
        // Lowered from 75% after moving DiscordManager (Phase 7) and SlackManager (Phase 8)
        // to their respective packages. The dynamic import paths in FleetManager are
        // harder to test in isolation.
        lines: 74,
        functions: 75,
        branches: 65,
        statements: 74,
      },
    },
  },
});
