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
        lines: 75,
        functions: 75,
        // Lowered from 70% after moving DiscordManager to @herdctl/discord package
        // The dynamic import paths in FleetManager are harder to test in isolation
        branches: 65,
        statements: 75,
      },
    },
  },
});
