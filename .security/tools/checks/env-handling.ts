/**
 * Environment variable handling security check
 *
 * Checks for potential secret exposure:
 * - Secrets in logs
 * - Hardcoded credentials
 * - Unvalidated environment variables
 */

import { readFileSync, existsSync } from "node:fs";
import type { Finding } from "../scan.js";
import { grepForPattern, shouldSkipFile } from "../utils.js";

export async function checkEnvHandling(projectRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Check for hardcoded secrets
  findings.push(...checkHardcodedSecrets(projectRoot));

  // Check for secrets in logs
  findings.push(...checkSecretsInLogs(projectRoot));

  // Check for proper env var handling in Docker
  findings.push(...checkDockerEnvHandling(projectRoot));

  return findings;
}

function checkHardcodedSecrets(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Patterns that might indicate hardcoded secrets
  const secretPatterns = [
    { pattern: "sk-[a-zA-Z0-9]{20,}", name: "OpenAI/Anthropic API key" },
    { pattern: "ghp_[a-zA-Z0-9]{36}", name: "GitHub personal access token" },
    { pattern: "github_pat_[a-zA-Z0-9_]{22,}", name: "GitHub fine-grained PAT" },
  ];

  for (const { pattern, name } of secretPatterns) {
    const matches = grepForPattern(projectRoot, pattern, {
      fileTypes: "ts,js,yaml,yml,json",
    });

    for (const match of matches) {
      if (shouldSkipFile(match.file)) continue;

      // Skip if it's in a test file checking for the pattern
      if (match.content.includes("regex") || match.content.includes("RegExp")) {
        continue;
      }

      // Skip environment variable references
      if (
        match.content.includes("process.env") ||
        match.content.includes("${")
      ) {
        continue;
      }

      findings.push({
        severity: "critical",
        location: `${match.file}:${match.line}`,
        description: `Potential ${name} found`,
        recommendation:
          "Use environment variables instead of hardcoding secrets",
      });
    }
  }

  return findings;
}

function checkSecretsInLogs(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Check for logging statements that might include secrets
  // We only care about actual interpolation of secret values, not string literals
  // mentioning secret names (like "set GITHUB_TOKEN env var")
  const logPatterns = ["console.log", "console.error", "logger.info", "logger.error"];
  const sensitiveVars = ["token", "secret", "password", "apiKey", "api_key", "credentials"];

  for (const logPattern of logPatterns) {
    const matches = grepForPattern(projectRoot, logPattern, {
      fileTypes: "ts,js",
    });

    for (const match of matches) {
      if (shouldSkipFile(match.file)) continue;

      // Skip comments
      if (match.content.trim().startsWith("//") || match.content.trim().startsWith("*")) {
        continue;
      }

      // Check if any sensitive variable is being INTERPOLATED (not just mentioned)
      for (const sensitiveVar of sensitiveVars) {
        // Check for actual variable interpolation patterns:
        // - Template literals: ${token}, ${apiKey}
        // - String concatenation: + token +, + token)
        // - Direct variable: console.log(token)

        const interpolationPatterns = [
          // Template literal interpolation: ${token} or ${ token }
          new RegExp(`\\$\\{\\s*${sensitiveVar}\\s*\\}`, "i"),
          // String concatenation: + token, token +
          new RegExp(`\\+\\s*${sensitiveVar}[\\s,)]`, "i"),
          new RegExp(`[\\s(]${sensitiveVar}\\s*\\+`, "i"),
          // Direct variable in function call (but not in a string)
          new RegExp(`\\(\\s*${sensitiveVar}\\s*[,)]`, "i"),
          // Object property access that might be a secret
          new RegExp(`\\.${sensitiveVar}[\\s,)\\]]`, "i"),
        ];

        const isInterpolated = interpolationPatterns.some((pattern) =>
          pattern.test(match.content)
        );

        if (isInterpolated) {
          // Skip if it's redacted
          if (
            match.content.includes("redact") ||
            match.content.includes("mask") ||
            match.content.includes("***")
          ) {
            continue;
          }

          findings.push({
            severity: "high",
            location: `${match.file}:${match.line}`,
            description: `Potential secret '${sensitiveVar}' interpolated in log statement`,
            recommendation:
              "Redact sensitive values before logging or remove from log",
          });
          break;
        }
      }
    }
  }

  return findings;
}

function checkDockerEnvHandling(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Check Dockerfile for secret handling
  const dockerfilePath = `${projectRoot}/Dockerfile`;
  if (existsSync(dockerfilePath)) {
    const content = readFileSync(dockerfilePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for ENV with sensitive values set directly
      if (line.startsWith("ENV ")) {
        const sensitivePatterns = [
          "TOKEN",
          "SECRET",
          "PASSWORD",
          "API_KEY",
          "APIKEY",
          "CREDENTIALS",
        ];

        for (const pattern of sensitivePatterns) {
          if (line.includes(pattern) && line.includes("=")) {
            // Check if it's setting a value (not just declaring)
            const parts = line.split("=");
            const value = parts[1]?.trim();
            if (value && value !== '""' && value !== "''" && !value.startsWith("$")) {
              findings.push({
                severity: "high",
                location: `Dockerfile:${lineNum}`,
                description: `Sensitive ENV variable ${pattern} set in Dockerfile`,
                recommendation:
                  "Pass secrets at runtime via docker run -e, not in Dockerfile",
              });
            }
          }
        }
      }

      // Check for ARG with secrets (build-time secrets can leak)
      if (line.startsWith("ARG ")) {
        const sensitivePatterns = ["TOKEN", "SECRET", "PASSWORD", "API_KEY"];

        for (const pattern of sensitivePatterns) {
          if (line.includes(pattern)) {
            findings.push({
              severity: "medium",
              location: `Dockerfile:${lineNum}`,
              description: `Sensitive ARG ${pattern} - may leak in image layers`,
              recommendation:
                "Use Docker BuildKit secrets or pass at runtime instead",
            });
          }
        }
      }
    }
  }

  return findings;
}
