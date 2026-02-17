/**
 * Shared utilities for security checks
 */

import { execSync } from "node:child_process";

/**
 * Patterns for files that should be skipped during security scans
 */
export const SKIP_PATTERNS = [
  // Build artifacts
  "/dist/",
  ".d.ts",
  // Test files
  "__tests__",
  ".test.",
  ".spec.",
  // Scanner itself
  ".security/",
  // Runtime job artifacts
  ".herdctl/",
  // Dependencies
  "node_modules",
  // Package manager files
  "pnpm-lock.yaml",
  "package-lock.json",
  // Documentation builds
  "docs/.astro/",
  "docs/dist/",
  // Coverage
  "coverage/",
  // Cache
  ".turbo/",
  ".cache/",
];

/**
 * Check if a file should be skipped based on common patterns
 */
export function shouldSkipFile(file: string): boolean {
  return SKIP_PATTERNS.some((pattern) => file.includes(pattern));
}

/**
 * Check if a file is a source file (not build output)
 */
export function isSourceFile(file: string): boolean {
  // Skip dist/ directories
  if (file.includes("/dist/")) return false;

  // Skip type declaration files (generated)
  if (file.endsWith(".d.ts")) return false;

  // Skip build/cache directories
  if (file.includes(".astro/") || file.includes(".turbo/")) return false;

  return true;
}

/**
 * Run grep and parse results, excluding build artifacts
 */
export function grepForPattern(
  projectRoot: string,
  pattern: string,
  options: {
    fileTypes?: string;
    includeDistFiles?: boolean;
  } = {}
): Array<{ file: string; line: number; content: string }> {
  const { fileTypes = "ts,js", includeDistFiles = false } = options;
  const results: Array<{ file: string; line: number; content: string }> = [];

  try {
    // Build grep command with file type includes
    const extensions = fileTypes
      .split(",")
      .map((ext) => `--include="*.${ext.trim()}"`)
      .join(" ");

    // Exclude patterns
    const excludes = [
      '--exclude-dir="node_modules"',
      '--exclude-dir=".git"',
      '--exclude-dir="coverage"',
      '--exclude-dir=".turbo"',
      '--exclude-dir=".herdctl"',
    ];

    if (!includeDistFiles) {
      excludes.push('--exclude-dir="dist"');
      excludes.push('--exclude="*.d.ts"');
    }

    const grepCmd = `grep -rn "${pattern}" ${extensions} ${excludes.join(" ")} . 2>/dev/null || true`;

    const output = execSync(grepCmd, {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    for (const line of output.split("\n").filter(Boolean)) {
      // Format: ./path/to/file:123:content
      const match = line.match(/^\.\/(.+?):(\d+):(.*)$/);
      if (match) {
        const file = match[1];

        // Additional filtering for build artifacts
        if (!includeDistFiles && !isSourceFile(file)) {
          continue;
        }

        // Skip security scanner files
        if (file.includes(".security/")) {
          continue;
        }

        results.push({
          file,
          line: parseInt(match[2], 10),
          content: match[3].trim(),
        });
      }
    }
  } catch {
    // Grep might fail if no matches - that's fine
  }

  return results;
}
