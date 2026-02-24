/**
 * Tests for Environment Variable Scanner
 */

import { describe, expect, it } from "vitest";

import { type EnvScanResult, type EnvVariable, scanEnvVariables } from "../env-scanner.js";

// =============================================================================
// Basic Extraction Tests
// =============================================================================

describe("scanEnvVariables - basic extraction", () => {
  it("should extract simple ${VAR} references", () => {
    const content = `
name: my-agent
env:
  webhook: \${DISCORD_WEBHOOK_URL}
  token: \${API_TOKEN}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(2);
    expect(result.variables[0]).toEqual({ name: "API_TOKEN" });
    expect(result.variables[1]).toEqual({ name: "DISCORD_WEBHOOK_URL" });
  });

  it("should extract ${VAR:-default} references with defaults", () => {
    const content = `
name: my-agent
env:
  host: \${DB_HOST:-localhost}
  port: \${DB_PORT:-5432}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(2);
    expect(result.variables[0]).toEqual({ name: "DB_HOST", defaultValue: "localhost" });
    expect(result.variables[1]).toEqual({ name: "DB_PORT", defaultValue: "5432" });
  });

  it("should extract mixed simple and default references", () => {
    const content = `
name: my-agent
env:
  required: \${API_KEY}
  optional: \${CACHE_TTL:-3600}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(2);
    expect(result.variables[0]).toEqual({ name: "API_KEY" });
    expect(result.variables[1]).toEqual({ name: "CACHE_TTL", defaultValue: "3600" });
  });
});

// =============================================================================
// Deduplication Tests
// =============================================================================

describe("scanEnvVariables - deduplication", () => {
  it("should deduplicate variables with same name", () => {
    const content = `
name: my-agent
env:
  first: \${API_KEY}
  second: \${API_KEY}
  third: \${API_KEY}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toEqual({ name: "API_KEY" });
  });

  it("should prefer entry with default when same var appears with and without", () => {
    const content = `
name: my-agent
# First appearance without default
env:
  first: \${DATABASE_URL}
# Second appearance with default
  second: \${DATABASE_URL:-postgres://localhost/db}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toEqual({
      name: "DATABASE_URL",
      defaultValue: "postgres://localhost/db",
    });
  });

  it("should prefer entry with default even when default appears first", () => {
    const content = `
name: my-agent
env:
  first: \${API_KEY:-default}
  second: \${API_KEY}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toEqual({ name: "API_KEY", defaultValue: "default" });
  });

  it("should keep first default when same var appears multiple times with different defaults", () => {
    const content = `
name: my-agent
env:
  first: \${TIMEOUT:-30}
  second: \${TIMEOUT:-60}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    // Keeps the first default encountered
    expect(result.variables[0]).toEqual({ name: "TIMEOUT", defaultValue: "30" });
  });
});

// =============================================================================
// Sorting Tests
// =============================================================================

describe("scanEnvVariables - sorting", () => {
  it("should sort variables alphabetically by name", () => {
    const content = `
name: my-agent
env:
  z: \${ZEBRA}
  a: \${APPLE}
  m: \${MANGO}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(3);
    expect(result.variables[0].name).toBe("APPLE");
    expect(result.variables[1].name).toBe("MANGO");
    expect(result.variables[2].name).toBe("ZEBRA");
  });

  it("should sort consistently with localeCompare", () => {
    const content = `
name: my-agent
env:
  lower: \${abc}
  upper: \${ABC}
`;
    const result = scanEnvVariables(content);

    // localeCompare sorts case-insensitively by default
    // Just verify both are present and sorted consistently
    expect(result.variables).toHaveLength(2);
    expect(result.variables.map((v) => v.name.toUpperCase())).toEqual(["ABC", "ABC"]);
    // Verify they're sorted (lowercase 'abc' typically comes before 'ABC' in localeCompare)
    expect(result.variables[0].name).toBe("abc");
    expect(result.variables[1].name).toBe("ABC");
  });
});

// =============================================================================
// Partitioning Tests
// =============================================================================

describe("scanEnvVariables - partitioning", () => {
  it("should partition into required and optional arrays", () => {
    const content = `
name: my-agent
env:
  required1: \${API_KEY}
  optional1: \${HOST:-localhost}
  required2: \${SECRET}
  optional2: \${PORT:-8080}
`;
    const result = scanEnvVariables(content);

    expect(result.required).toHaveLength(2);
    expect(result.required[0]).toEqual({ name: "API_KEY" });
    expect(result.required[1]).toEqual({ name: "SECRET" });

    expect(result.optional).toHaveLength(2);
    expect(result.optional[0]).toEqual({ name: "HOST", defaultValue: "localhost" });
    expect(result.optional[1]).toEqual({ name: "PORT", defaultValue: "8080" });
  });

  it("should have required and optional that sum to variables", () => {
    const content = `
name: my-agent
env:
  a: \${A}
  b: \${B:-default}
  c: \${C}
  d: \${D:-other}
  e: \${E}
`;
    const result = scanEnvVariables(content);

    expect(result.variables.length).toBe(result.required.length + result.optional.length);
    expect(result.required.length).toBe(3); // A, C, E
    expect(result.optional.length).toBe(2); // B, D
  });

  it("should maintain sorting in required and optional arrays", () => {
    const content = `
name: my-agent
env:
  z: \${Z_VAR}
  a: \${A_VAR:-a}
  m: \${M_VAR}
  b: \${B_VAR:-b}
`;
    const result = scanEnvVariables(content);

    // Required should be sorted
    expect(result.required.map((v) => v.name)).toEqual(["M_VAR", "Z_VAR"]);
    // Optional should be sorted
    expect(result.optional.map((v) => v.name)).toEqual(["A_VAR", "B_VAR"]);
  });
});

// =============================================================================
// Empty and Edge Case Tests
// =============================================================================

describe("scanEnvVariables - empty and edge cases", () => {
  it("should handle empty content", () => {
    const result = scanEnvVariables("");

    expect(result.variables).toEqual([]);
    expect(result.required).toEqual([]);
    expect(result.optional).toEqual([]);
  });

  it("should handle content with no variables", () => {
    const content = `
name: my-agent
description: A simple agent with no env vars
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toEqual([]);
    expect(result.required).toEqual([]);
    expect(result.optional).toEqual([]);
  });

  it("should handle null input gracefully", () => {
    const result = scanEnvVariables(null as unknown as string);

    expect(result.variables).toEqual([]);
    expect(result.required).toEqual([]);
    expect(result.optional).toEqual([]);
  });

  it("should handle undefined input gracefully", () => {
    const result = scanEnvVariables(undefined as unknown as string);

    expect(result.variables).toEqual([]);
    expect(result.required).toEqual([]);
    expect(result.optional).toEqual([]);
  });
});

// =============================================================================
// YAML Comments Tests
// =============================================================================

describe("scanEnvVariables - YAML comments", () => {
  it("should extract variables from YAML comments", () => {
    const content = `
name: my-agent
# Set \${WEBHOOK_URL} to enable notifications
# Optional: \${DEBUG:-false}
env:
  key: \${API_KEY}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(3);
    expect(result.variables.map((v) => v.name)).toEqual(["API_KEY", "DEBUG", "WEBHOOK_URL"]);
  });

  it("should extract variables from inline comments", () => {
    const content = `
name: my-agent
env:
  key: value  # Use \${ALTERNATIVE_KEY} for production
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("ALTERNATIVE_KEY");
  });
});

// =============================================================================
// HERDCTL_ Exclusion Tests
// =============================================================================

describe("scanEnvVariables - HERDCTL_ exclusion", () => {
  it("should exclude HERDCTL_LOG_LEVEL", () => {
    const content = `
name: my-agent
env:
  log: \${HERDCTL_LOG_LEVEL}
  api: \${API_KEY}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("API_KEY");
  });

  it("should exclude all HERDCTL_ prefixed variables", () => {
    const content = `
name: my-agent
env:
  a: \${HERDCTL_CONFIG_DIR}
  b: \${HERDCTL_DEBUG}
  c: \${HERDCTL_TIMEOUT}
  d: \${USER_API_KEY}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("USER_API_KEY");
  });

  it("should exclude HERDCTL_ variables even with defaults", () => {
    const content = `
name: my-agent
env:
  log: \${HERDCTL_LOG_LEVEL:-info}
  debug: \${HERDCTL_DEBUG:-false}
  api: \${API_KEY:-default}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toEqual({ name: "API_KEY", defaultValue: "default" });
  });

  it("should not exclude variables that contain HERDCTL in the middle", () => {
    const content = `
name: my-agent
env:
  a: \${MY_HERDCTL_CONFIG}
  b: \${HERDCTL_SECRET}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("MY_HERDCTL_CONFIG");
  });
});

// =============================================================================
// Complex Default Values Tests
// =============================================================================

describe("scanEnvVariables - complex defaults", () => {
  it("should handle cron expression defaults", () => {
    const content = `
name: my-agent
schedule: "\${CRON_SCHEDULE:-*/5 * * * *}"
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toEqual({
      name: "CRON_SCHEDULE",
      defaultValue: "*/5 * * * *",
    });
  });

  it("should handle URL defaults", () => {
    const content = `
name: my-agent
env:
  db: \${DATABASE_URL:-postgres://user:pass@localhost:5432/mydb}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toEqual({
      name: "DATABASE_URL",
      defaultValue: "postgres://user:pass@localhost:5432/mydb",
    });
  });

  it("should handle defaults with spaces", () => {
    const content = `
name: my-agent
env:
  msg: \${WELCOME_MESSAGE:-Hello, World!}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toEqual({
      name: "WELCOME_MESSAGE",
      defaultValue: "Hello, World!",
    });
  });

  it("should handle defaults with colons", () => {
    const content = `
name: my-agent
env:
  time: \${DEFAULT_TIME:-12:00:00}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toEqual({
      name: "DEFAULT_TIME",
      defaultValue: "12:00:00",
    });
  });

  it("should handle empty default value", () => {
    const content = `
name: my-agent
env:
  prefix: \${PREFIX:-}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toEqual({
      name: "PREFIX",
      defaultValue: "",
    });
    expect(result.optional).toHaveLength(1);
  });

  it("should handle numeric defaults", () => {
    const content = `
name: my-agent
env:
  port: \${PORT:-8080}
  timeout: \${TIMEOUT:-30.5}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(2);
    expect(result.variables[0]).toEqual({ name: "PORT", defaultValue: "8080" });
    expect(result.variables[1]).toEqual({ name: "TIMEOUT", defaultValue: "30.5" });
  });
});

// =============================================================================
// Multiple Variables on One Line Tests
// =============================================================================

describe("scanEnvVariables - multiple variables on one line", () => {
  it("should extract multiple variables from a single line", () => {
    const content = `
name: my-agent
url: "\${PROTOCOL:-https}://\${HOST}:\${PORT:-443}"
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(3);
    expect(result.variables[0]).toEqual({ name: "HOST" });
    expect(result.variables[1]).toEqual({ name: "PORT", defaultValue: "443" });
    expect(result.variables[2]).toEqual({ name: "PROTOCOL", defaultValue: "https" });
  });

  it("should handle adjacent variables without separator", () => {
    const content = `
name: my-agent
combined: "\${FIRST}\${SECOND}\${THIRD}"
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(3);
    expect(result.variables.map((v) => v.name)).toEqual(["FIRST", "SECOND", "THIRD"]);
  });
});

// =============================================================================
// Variable Name Format Tests
// =============================================================================

describe("scanEnvVariables - variable name formats", () => {
  it("should extract variables starting with underscore", () => {
    const content = `
name: my-agent
env:
  a: \${_PRIVATE_VAR}
  b: \${__DOUBLE_UNDERSCORE}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(2);
    // localeCompare sorts underscore-prefixed names by their full string
    expect(result.variables.map((v) => v.name)).toEqual(["__DOUBLE_UNDERSCORE", "_PRIVATE_VAR"]);
  });

  it("should extract variables with numbers", () => {
    const content = `
name: my-agent
env:
  a: \${API_KEY_V2}
  b: \${REDIS_DB_0}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(2);
    expect(result.variables.map((v) => v.name)).toEqual(["API_KEY_V2", "REDIS_DB_0"]);
  });

  it("should not match variables starting with numbers", () => {
    const content = `
name: my-agent
env:
  a: \${2FA_SECRET}
`;
    const result = scanEnvVariables(content);

    // The regex requires starting with letter or underscore
    expect(result.variables).toHaveLength(0);
  });

  it("should handle single-character variable names", () => {
    const content = `
name: my-agent
env:
  a: \${A}
  b: \${_}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(2);
    // localeCompare sorts underscore before letters
    expect(result.variables.map((v) => v.name)).toEqual(["_", "A"]);
  });
});

// =============================================================================
// Type Tests
// =============================================================================

describe("scanEnvVariables - types", () => {
  it("should return correct interface structure for EnvScanResult", () => {
    const content = `
name: my-agent
env:
  required: \${REQUIRED_VAR}
  optional: \${OPTIONAL_VAR:-default}
`;
    const result: EnvScanResult = scanEnvVariables(content);

    // Verify structure
    expect(result).toHaveProperty("variables");
    expect(result).toHaveProperty("required");
    expect(result).toHaveProperty("optional");
    expect(Array.isArray(result.variables)).toBe(true);
    expect(Array.isArray(result.required)).toBe(true);
    expect(Array.isArray(result.optional)).toBe(true);
  });

  it("should return correct interface structure for EnvVariable", () => {
    const content = `
name: my-agent
env:
  a: \${VAR_WITH_DEFAULT:-value}
  b: \${VAR_WITHOUT_DEFAULT}
`;
    const result = scanEnvVariables(content);

    const withDefault: EnvVariable = result.variables[0];
    const withoutDefault: EnvVariable = result.variables[1];

    expect(withDefault.name).toBe("VAR_WITH_DEFAULT");
    expect(withDefault.defaultValue).toBe("value");

    expect(withoutDefault.name).toBe("VAR_WITHOUT_DEFAULT");
    expect(withoutDefault.defaultValue).toBeUndefined();
  });
});

// =============================================================================
// Real-World Example Tests
// =============================================================================

describe("scanEnvVariables - real-world examples", () => {
  it("should handle a typical agent.yaml file", () => {
    const content = `
# Website Monitor Agent
name: website-monitor
description: Monitors websites and sends alerts
version: "1.0.0"

# Environment configuration
env:
  # Required - must be set by user
  webhook_url: \${DISCORD_WEBHOOK_URL}
  api_key: \${MONITORING_API_KEY}

  # Optional with sensible defaults
  check_interval: \${CHECK_INTERVAL:-60}
  timeout: \${REQUEST_TIMEOUT:-30}
  log_level: \${HERDCTL_LOG_LEVEL:-info}

# Schedule (uses cron format)
schedule: "\${CRON_SCHEDULE:-*/5 * * * *}"

# Docker configuration
docker:
  image: website-monitor:latest
  network: bridge
`;
    const result = scanEnvVariables(content);

    // Should have 5 variables (excludes HERDCTL_LOG_LEVEL)
    expect(result.variables).toHaveLength(5);

    // Check required (no defaults)
    expect(result.required).toHaveLength(2);
    expect(result.required.map((v) => v.name)).toEqual([
      "DISCORD_WEBHOOK_URL",
      "MONITORING_API_KEY",
    ]);

    // Check optional (have defaults)
    expect(result.optional).toHaveLength(3);
    expect(result.optional.map((v) => v.name)).toEqual([
      "CHECK_INTERVAL",
      "CRON_SCHEDULE",
      "REQUEST_TIMEOUT",
    ]);
  });

  it("should handle multiline YAML with complex structure", () => {
    const content = `
name: data-processor
version: "2.0.0"

secrets:
  - name: database
    value: \${DATABASE_URL}
  - name: cache
    value: \${REDIS_URL:-redis://localhost:6379}

config:
  endpoints:
    primary: https://\${API_HOST:-api.example.com}/v1
    fallback: https://\${FALLBACK_HOST}/v1

  auth:
    token: \${AUTH_TOKEN}
    refresh_interval: \${REFRESH_INTERVAL:-3600}
`;
    const result = scanEnvVariables(content);

    expect(result.variables).toHaveLength(6);

    expect(result.required.map((v) => v.name)).toEqual([
      "AUTH_TOKEN",
      "DATABASE_URL",
      "FALLBACK_HOST",
    ]);

    expect(result.optional.map((v) => v.name)).toEqual([
      "API_HOST",
      "REDIS_URL",
      "REFRESH_INTERVAL",
    ]);
  });
});
