/**
 * Permission modes security check
 *
 * Checks for usage of dangerous permission modes:
 * - bypassPermissions - Most dangerous, bypasses all safety checks
 * - acceptEdits - Auto-accepts file modifications
 *
 * Note: Example configs are treated differently - they demonstrate library
 * features and are not production code.
 */

import type { Finding } from "../scan.js";
import { grepForPattern, shouldSkipFile } from "../utils.js";

export async function checkPermissionModes(projectRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Check for bypassPermissions usage
  findings.push(...checkBypassPermissions(projectRoot));

  // Check for acceptEdits usage - skip examples entirely
  // (it's expected that examples demonstrate all features)
  findings.push(...checkAcceptEdits(projectRoot));

  // Check for dontAsk usage - skip examples
  findings.push(...checkDontAsk(projectRoot));

  return findings;
}

function isExampleFile(file: string): boolean {
  return file.startsWith("examples/") || file.includes("/examples/");
}

function checkBypassPermissions(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  const matches = grepForPattern(projectRoot, "bypassPermissions", {
    fileTypes: "ts,js,yaml,yml,json,md",
  });

  // Filter to actual usage (not schema definitions, docs, or comments)
  const usageMatches = matches.filter((match) => {
    if (shouldSkipFile(match.file)) return false;

    // Skip CLAUDE.md (project instructions)
    if (match.file === "CLAUDE.md") return false;

    // Skip YAML/code comments
    if (match.content.trim().startsWith("#") || match.content.trim().startsWith("//")) {
      return false;
    }

    // Skip schema definitions
    if (
      match.content.includes("PermissionModeSchema") ||
      match.content.includes("enum") ||
      match.content.includes("type ") ||
      match.content.includes("interface ")
    ) {
      return false;
    }

    // Skip test assertions
    if (
      match.content.includes("expect(") ||
      match.content.includes("toBe(")
    ) {
      return false;
    }

    return true;
  });

  // Separate example vs production config usages
  const configUsages = usageMatches.filter(
    (m) =>
      (m.file.endsWith(".yaml") ||
        m.file.endsWith(".yml") ||
        m.file.endsWith(".json")) &&
      !isExampleFile(m.file)
  );

  const exampleUsages = usageMatches.filter(
    (m) =>
      (m.file.endsWith(".yaml") ||
        m.file.endsWith(".yml") ||
        m.file.endsWith(".json")) &&
      isExampleFile(m.file)
  );

  // Production usage is HIGH severity
  if (configUsages.length > 0) {
    findings.push({
      severity: "high",
      location: configUsages.map((m) => `${m.file}:${m.line}`).join(", "),
      description: `bypassPermissions used in ${configUsages.length} production config file(s)`,
      recommendation:
        "bypassPermissions bypasses ALL safety checks. Review each usage carefully.",
    });
  }

  // Example usage is LOW severity (informational)
  if (exampleUsages.length > 0) {
    findings.push({
      severity: "low",
      location: exampleUsages.map((m) => `${m.file}:${m.line}`).join(", "),
      description: `bypassPermissions used in ${exampleUsages.length} example config(s) - consider adding Docker isolation`,
      recommendation:
        "Example configs with bypassPermissions should demonstrate Docker isolation for security.",
    });
  }

  // Code usage in non-schema files needs review
  const codeUsages = usageMatches.filter(
    (m) => m.file.endsWith(".ts") || m.file.endsWith(".js")
  );

  const nonSchemaCodeUsages = codeUsages.filter(
    (m) =>
      !m.file.includes("schema") &&
      !m.file.includes("types") &&
      !m.content.includes("PermissionMode")
  );

  if (nonSchemaCodeUsages.length > 0) {
    for (const match of nonSchemaCodeUsages) {
      findings.push({
        severity: "medium",
        location: `${match.file}:${match.line}`,
        description: "bypassPermissions referenced in code",
        recommendation:
          "Ensure this is only for schema/type definitions, not setting the value",
      });
    }
  }

  return findings;
}

function checkAcceptEdits(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  const matches = grepForPattern(projectRoot, "acceptEdits", {
    fileTypes: "yaml,yml,json",
  });

  // Only flag non-example configs
  const configUsages = matches.filter((match) => {
    if (shouldSkipFile(match.file)) return false;
    if (isExampleFile(match.file)) return false; // Skip examples
    return true;
  });

  if (configUsages.length > 0) {
    findings.push({
      severity: "medium",
      location: configUsages.map((m) => `${m.file}:${m.line}`).join(", "),
      description: `acceptEdits used in ${configUsages.length} config file(s)`,
      recommendation:
        "acceptEdits auto-accepts file modifications. Ensure this is intentional.",
    });
  }

  return findings;
}

function checkDontAsk(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  const matches = grepForPattern(projectRoot, "dontAsk", {
    fileTypes: "yaml,yml,json",
  });

  // Only flag non-example configs
  const configUsages = matches.filter((match) => {
    if (shouldSkipFile(match.file)) return false;
    if (isExampleFile(match.file)) return false; // Skip examples
    return true;
  });

  if (configUsages.length > 0) {
    findings.push({
      severity: "medium",
      location: configUsages.map((m) => `${m.file}:${m.line}`).join(", "),
      description: `dontAsk used in ${configUsages.length} config file(s)`,
      recommendation:
        "dontAsk allows all operations without prompting. Review each usage.",
    });
  }

  return findings;
}
