/**
 * Shared utilities for herdctl init commands.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Update .gitignore to include .herdctl/ if it exists and doesn't already have it.
 */
export function updateGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, ".gitignore");

  if (!fs.existsSync(gitignorePath)) {
    return;
  }

  const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
  const linesToAdd: string[] = [];

  if (!gitignoreContent.includes(".herdctl/")) {
    linesToAdd.push(".herdctl/");
  }

  if (linesToAdd.length > 0) {
    const newContent = `${gitignoreContent.trimEnd()}\n\n# herdctl state directory\n${linesToAdd.join("\n")}\n`;
    fs.writeFileSync(gitignorePath, newContent, "utf-8");
  }
}
