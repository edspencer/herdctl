/**
 * Job Output Mapper
 *
 * Shared translation of a runtime {@link SDKMessage} into a
 * {@link JobOutputPayload} for the `job:output` fleet event. Both the scheduled
 * execution path ({@link ScheduleExecutor}) and the manual trigger path
 * ({@link JobControl.trigger}) stream output through this so the payloads they
 * emit are identical.
 *
 * @module job-output-mapper
 */

import type { SDKMessage } from "../runner/index.js";
import type { JobOutputPayload } from "./types.js";

/**
 * Map an SDK message type to the `job:output` output type discriminator.
 */
export function mapMessageTypeToOutputType(
  messageType: string,
): "stdout" | "stderr" | "assistant" | "tool" | "system" {
  switch (messageType) {
    case "assistant":
      return "assistant";
    case "tool_use":
    case "tool_result":
      return "tool";
    case "system":
      return "system";
    case "error":
      return "stderr";
    default:
      return "stdout";
  }
}

/**
 * Extract a human-readable content string from an SDK message, or `null` when
 * the message carries no meaningful content to stream.
 */
export function extractMessageContent(message: SDKMessage): string | null {
  // Handle different message types
  if (message.content && typeof message.content === "string") {
    return message.content;
  }

  if (message.message && typeof message.message === "string") {
    return message.message;
  }

  // For tool_use messages, stringify the input
  if (message.type === "tool_use" && message.name && message.input) {
    return `Tool: ${message.name}\n${JSON.stringify(message.input, null, 2)}`;
  }

  // For tool_result messages
  if (message.type === "tool_result" && message.content) {
    return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
  }

  return null;
}

/**
 * Build a {@link JobOutputPayload} from an SDK message.
 *
 * Returns `null` when the message has no meaningful content — callers should
 * skip emitting `job:output` in that case.
 *
 * @param jobId - The id of the job producing the output
 * @param agentName - The qualified name of the agent executing the job
 * @param message - The SDK message to translate
 * @returns A ready-to-emit payload, or `null` when there is nothing to emit
 */
export function buildJobOutputPayload(
  jobId: string,
  agentName: string,
  message: SDKMessage,
): JobOutputPayload | null {
  const output = extractMessageContent(message);
  if (!output) {
    return null;
  }

  return {
    jobId,
    agentName,
    output,
    outputType: mapMessageTypeToOutputType(message.type),
    timestamp: new Date().toISOString(),
  };
}
