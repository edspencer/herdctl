import { describe, expect, it, vi } from "vitest";
import {
  buildErrorEmbed,
  buildResultSummaryEmbed,
  buildRunCardEmbed,
  buildStatusEmbed,
  buildToolResultEmbed,
} from "../embeds.js";

describe("embeds", () => {
  it("builds run card embeds with trace lines", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:00:00.000Z"));
    const embed = buildRunCardEmbed({
      agentName: "herdctl.test-agent",
      status: "running",
      message: "Running · 🔧 Bash",
      traceLines: ["🔧 Bash · ls -la", "✓ Bash · completed"],
    });
    expect(embed).toMatchSnapshot();
    vi.useRealTimers();
  });

  it("builds result summary embeds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:00:00.000Z"));
    const embed = buildResultSummaryEmbed({
      agentName: "herdctl.test-agent",
      isError: false,
      durationMs: 2140,
      numTurns: 3,
      totalCostUsd: 0.0123,
      usage: { input_tokens: 1200, output_tokens: 300 },
    });
    expect(embed).toMatchSnapshot();
    vi.useRealTimers();
  });

  it("builds status and error embeds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:00:00.000Z"));
    expect(
      buildStatusEmbed("Compacting context…", "system", "herdctl.test-agent"),
    ).toMatchSnapshot();
    expect(buildErrorEmbed("Boom", "herdctl.test-agent")).toMatchSnapshot();
    vi.useRealTimers();
  });

  it("builds tool result embed with truncated output", () => {
    const embed = buildToolResultEmbed({
      toolUse: { name: "Bash", input: { command: "echo hi" }, startTime: Date.now() - 2000 },
      toolResult: { output: "line\n".repeat(200), isError: false },
      agentName: "herdctl.test-agent",
      maxOutputChars: 120,
    });
    expect(embed).toMatchSnapshot();
  });
});
