import { formatCompactNumber, formatDurationMs } from "@herdctl/chat";
import { getToolInputSummary, TOOL_EMOJIS } from "@herdctl/core";
import type { DiscordReplyEmbed, DiscordReplyEmbedField } from "./types.js";

export const DISCORD_EMBED_COLORS = {
  brand: 0x5865f2,
  working: 0x8b5cf6,
  success: 0x22c55e,
  error: 0xef4444,
  system: 0x6b7280,
  info: 0x3b82f6,
} as const;

export function buildFooter(agentName: string): { text: string } {
  const shortName = agentName.includes(".") ? agentName.split(".").pop()! : agentName;
  return { text: `herdctl · ${shortName}` };
}

// Re-export so existing callers (tests, snapshots) don't break.
export const formatDuration = formatDurationMs;

export function buildRunCardEmbed(params: {
  agentName: string;
  status: "running" | "success" | "error";
  message: string;
  traceLines?: string[];
}): DiscordReplyEmbed {
  const color =
    params.status === "running"
      ? DISCORD_EMBED_COLORS.working
      : params.status === "success"
        ? DISCORD_EMBED_COLORS.success
        : DISCORD_EMBED_COLORS.error;
  const fields =
    params.traceLines && params.traceLines.length > 0
      ? [
          {
            name: "Trace",
            value: params.traceLines.slice(-8).join("\n").slice(-1024),
            inline: false,
          },
        ]
      : undefined;

  return {
    description: params.message,
    color,
    fields,
    footer: buildFooter(params.agentName),
    timestamp: new Date().toISOString(),
  };
}

export function buildStatusEmbed(
  description: string,
  type: "system" | "info" | "error",
  agentName?: string,
): DiscordReplyEmbed {
  const color =
    type === "system"
      ? DISCORD_EMBED_COLORS.system
      : type === "info"
        ? DISCORD_EMBED_COLORS.info
        : DISCORD_EMBED_COLORS.error;
  return {
    description,
    color,
    footer: agentName ? buildFooter(agentName) : undefined,
  };
}

export function buildResultSummaryEmbed(params: {
  agentName: string;
  isError: boolean;
  durationMs?: number;
  numTurns?: number;
  totalCostUsd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}): DiscordReplyEmbed {
  const summaryParts: string[] = [];
  summaryParts.push(params.isError ? "**Task failed**" : "**Task complete**");
  if (params.durationMs !== undefined) {
    summaryParts[0] += ` in ${formatDuration(params.durationMs)}`;
  }
  if (params.numTurns !== undefined) {
    summaryParts.push(`${params.numTurns} turn${params.numTurns !== 1 ? "s" : ""}`);
  }
  if (params.totalCostUsd !== undefined) {
    summaryParts.push(`$${params.totalCostUsd.toFixed(4)}`);
  }
  if (params.usage) {
    const total = (params.usage.input_tokens ?? 0) + (params.usage.output_tokens ?? 0);
    summaryParts.push(`${formatCompactNumber(total)} tokens`);
  }
  return {
    description: summaryParts.join(" · "),
    color: params.isError ? DISCORD_EMBED_COLORS.error : DISCORD_EMBED_COLORS.success,
    footer: buildFooter(params.agentName),
    timestamp: new Date().toISOString(),
  };
}

export function buildErrorEmbed(message: string, agentName: string): DiscordReplyEmbed {
  return {
    description: `**Error:** ${message.length > 4000 ? `${message.substring(0, 4000)}…` : message}`,
    color: DISCORD_EMBED_COLORS.error,
    footer: buildFooter(agentName),
    timestamp: new Date().toISOString(),
  };
}

export function buildToolResultEmbed(params: {
  toolUse: { name: string; input?: unknown; startTime: number } | null;
  toolResult: { output: string; isError: boolean };
  agentName: string;
  maxOutputChars: number;
}): DiscordReplyEmbed {
  const toolName = params.toolUse?.name ?? "Tool";
  const emoji = TOOL_EMOJIS[toolName] ?? "🔧";
  const parts: string[] = [`${emoji} **${toolName}**`];
  const inputSummary = params.toolUse
    ? getToolInputSummary(params.toolUse.name, params.toolUse.input)
    : undefined;
  if (inputSummary) {
    const prefix = toolName === "Bash" || toolName === "bash" ? "> " : "";
    const truncated =
      inputSummary.length > 120 ? `${inputSummary.substring(0, 120)}…` : inputSummary;
    parts.push(`\`${prefix}${truncated}\``);
  }
  if (params.toolUse) {
    parts.push(`— ${formatDuration(Date.now() - params.toolUse.startTime)}`);
  }

  const fields: DiscordReplyEmbedField[] = [];
  const trimmedOutput = params.toolResult.output.trim();
  if (trimmedOutput.length > 0) {
    let outputText = trimmedOutput;
    if (outputText.length > params.maxOutputChars) {
      outputText =
        outputText.substring(0, params.maxOutputChars) +
        `\n… ${trimmedOutput.length.toLocaleString()} chars total`;
    }
    const lang = toolName === "Bash" || toolName === "bash" ? "ansi" : "";
    fields.push({
      name: params.toolResult.isError ? "Error" : "Output",
      value: `\`\`\`${lang}\n${outputText}\n\`\`\``,
      inline: false,
    });
  }

  return {
    description: parts.join(" "),
    color: params.toolResult.isError ? DISCORD_EMBED_COLORS.error : DISCORD_EMBED_COLORS.brand,
    fields: fields.length > 0 ? fields : undefined,
    footer: buildFooter(params.agentName),
  };
}
