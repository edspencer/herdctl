/**
 * Docker configuration security check
 *
 * Checks for dangerous Docker configuration patterns in the codebase:
 * - hostConfigOverride usage
 * - Privileged mode
 * - Dangerous capability additions
 * - Sensitive volume mounts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../scan.js";
import { grepForPattern, shouldSkipFile } from "../utils.js";

export async function checkDockerConfig(projectRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Check 1: hostConfigOverride usage in code
  findings.push(...checkHostConfigOverride(projectRoot));

  // Check 2: Privileged mode mentions
  findings.push(...checkPrivilegedMode(projectRoot));

  // Check 3: Capability additions
  findings.push(...checkCapabilityAdditions(projectRoot));

  // Check 4: Network mode settings
  findings.push(...checkNetworkMode(projectRoot));

  // Check 5: Volume mount patterns
  findings.push(...checkVolumeMounts(projectRoot));

  // Check 6: Example/config files for dangerous patterns
  findings.push(...checkConfigFiles(projectRoot));

  return findings;
}

function checkHostConfigOverride(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  const matches = grepForPattern(projectRoot, "hostConfigOverride", {
    fileTypes: "ts,js,yaml,yml,json",
  });

  for (const match of matches) {
    if (shouldSkipFile(match.file)) continue;

    // Skip type definitions/interfaces (those are fine)
    if (
      match.content.includes("interface") ||
      match.content.includes("type ") ||
      match.content.includes("?: ") ||
      match.content.includes("| undefined")
    ) {
      continue;
    }

    // Actual usage is concerning
    if (
      match.content.includes("hostConfigOverride:") ||
      match.content.includes("hostConfigOverride =") ||
      match.content.includes(".hostConfigOverride")
    ) {
      findings.push({
        severity: "high",
        location: `${match.file}:${match.line}`,
        description: "hostConfigOverride can bypass Docker security hardening",
        recommendation:
          "Ensure this is only used at fleet-level config, never from agent input",
      });
    }
  }

  return findings;
}

function checkPrivilegedMode(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  const matches = grepForPattern(projectRoot, "privileged", {
    fileTypes: "ts,js,yaml,yml,json",
  });

  for (const match of matches) {
    if (shouldSkipFile(match.file)) continue;

    // Skip Astro data stores and other build artifacts
    if (match.file.includes(".astro/") || match.file.includes("data-store")) {
      continue;
    }

    // Check if it's being set to true
    if (
      match.content.includes("privileged: true") ||
      match.content.includes("Privileged: true") ||
      match.content.includes("privileged=true")
    ) {
      findings.push({
        severity: "critical",
        location: `${match.file}:${match.line}`,
        description: "Privileged mode detected - provides full host access",
        recommendation:
          "Remove privileged mode unless absolutely necessary and document why",
      });
    }
  }

  return findings;
}

function checkCapabilityAdditions(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  const dangerousCaps = [
    "SYS_ADMIN",
    "SYS_PTRACE",
    "NET_ADMIN",
    "SYS_RAWIO",
    "DAC_OVERRIDE",
    "SETUID",
    "SETGID",
  ];

  for (const cap of dangerousCaps) {
    const matches = grepForPattern(projectRoot, cap, {
      fileTypes: "ts,js,yaml,yml",
    });

    for (const match of matches) {
      if (shouldSkipFile(match.file)) continue;

      // Check if it's in a CapAdd context
      if (
        match.content.includes("CapAdd") ||
        match.content.includes("cap_add") ||
        match.content.includes("cap-add")
      ) {
        findings.push({
          severity: "high",
          location: `${match.file}:${match.line}`,
          description: `Dangerous capability ${cap} being added to container`,
          recommendation: `Review if ${cap} is necessary - most containers should drop all capabilities`,
        });
      }
    }
  }

  return findings;
}

function checkNetworkMode(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Check for network: none (breaks Claude API access) - only in YAML configs
  const noneMatches = grepForPattern(projectRoot, 'network.*none', {
    fileTypes: "yaml,yml",
  });

  for (const match of noneMatches) {
    if (shouldSkipFile(match.file)) continue;

    // Skip YAML comments (lines starting with #)
    if (match.content.trim().startsWith("#")) continue;

    // Skip documentation that warns against this
    if (match.content.includes("NEVER") || match.content.includes("don't")) {
      continue;
    }

    // Only flag actual config usage
    if (
      match.content.includes('network: "none"') ||
      match.content.includes("network: none")
    ) {
      findings.push({
        severity: "high",
        location: `${match.file}:${match.line}`,
        description: "network: none will break Claude API access",
        recommendation:
          "Use network: bridge for Claude agents - they need API access",
      });
    }
  }

  // Check for network: host (less isolated) - only in YAML configs
  const hostMatches = grepForPattern(projectRoot, 'network.*host', {
    fileTypes: "yaml,yml",
  });

  for (const match of hostMatches) {
    if (shouldSkipFile(match.file)) continue;

    // Skip YAML comments
    if (match.content.trim().startsWith("#")) continue;

    if (
      match.content.includes('network: "host"') ||
      match.content.includes("network: host")
    ) {
      findings.push({
        severity: "medium",
        location: `${match.file}:${match.line}`,
        description: "network: host shares host network namespace",
        recommendation:
          "Use network: bridge unless host networking is specifically required",
      });
    }
  }

  return findings;
}

function checkVolumeMounts(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  const sensitivePathPatterns = [
    "/etc/shadow",
    "/etc/passwd",
    "/var/run/docker.sock",
    "docker.sock",
  ];

  for (const pattern of sensitivePathPatterns) {
    const matches = grepForPattern(projectRoot, pattern, {
      fileTypes: "ts,js,yaml,yml",
    });

    for (const match of matches) {
      if (shouldSkipFile(match.file)) continue;

      // Check if it's in a volume/mount context
      if (
        match.content.includes("volume") ||
        match.content.includes("Volume") ||
        match.content.includes("mount") ||
        match.content.includes("Mount") ||
        match.content.includes("Binds")
      ) {
        findings.push({
          severity: "critical",
          location: `${match.file}:${match.line}`,
          description: `Sensitive path ${pattern} potentially mounted in container`,
          recommendation:
            "Review if this mount is necessary - it may expose host system",
        });
      }
    }
  }

  return findings;
}

function checkConfigFiles(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Check example configs in examples/ directory
  const examplesDir = join(projectRoot, "examples");
  if (!existsSync(examplesDir)) {
    return findings;
  }

  // Look for YAML files with docker config
  const yamlMatches = grepForPattern(examplesDir, "docker:", {
    fileTypes: "yaml,yml",
  });

  for (const match of yamlMatches) {
    // This is expected - just verify no dangerous patterns
    const filePath = join(projectRoot, match.file);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");

      if (content.includes("privileged: true")) {
        findings.push({
          severity: "high",
          location: match.file,
          description: "Example config contains privileged: true",
          recommendation:
            "Remove privileged mode from examples - users may copy them",
        });
      }

      if (
        content.includes('network: "none"') ||
        content.includes("network: none")
      ) {
        findings.push({
          severity: "high",
          location: match.file,
          description: "Example config uses network: none which breaks Claude",
          recommendation:
            "Use network: bridge in examples for Claude agents",
        });
      }
    }
  }

  return findings;
}
