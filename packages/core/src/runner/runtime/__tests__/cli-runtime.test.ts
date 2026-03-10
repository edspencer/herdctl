import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "../../types.js";

const watchMessages: SDKMessage[] = [];
const flushMessages: SDKMessage[] = [];

vi.mock("../cli-session-path.js", () => ({
  getCliSessionDir: vi.fn(() => "/tmp/sessions"),
  getCliSessionFile: vi.fn(() => "/tmp/sessions/session-1.jsonl"),
  waitForNewSessionFile: vi.fn(async () => "/tmp/sessions/session-1.jsonl"),
}));

vi.mock("../cli-session-watcher.js", () => ({
  CLISessionWatcher: class {
    constructor(_path: string) {}

    async initialize(): Promise<void> {}

    async *watch(): AsyncIterable<SDKMessage> {
      for (const message of watchMessages) {
        yield message;
      }
    }

    async flushRemainingMessages(): Promise<SDKMessage[]> {
      return [...flushMessages];
    }

    stop(): void {}
  },
}));

import { CLIRuntime } from "../cli-runtime.js";

function makeSubprocess(exitCode = 0): Promise<{ exitCode: number }> & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
} {
  const promise = Promise.resolve({ exitCode }) as Promise<{ exitCode: number }> & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  promise.pid = 1234;
  promise.stdout = new EventEmitter();
  promise.stderr = new EventEmitter();
  promise.kill = vi.fn();
  return promise;
}

describe("CLIRuntime synthetic result aggregation", () => {
  beforeEach(() => {
    watchMessages.length = 0;
    flushMessages.length = 0;
  });

  it("deduplicates assistant snapshots when aggregating turns and usage", async () => {
    watchMessages.push(
      {
        type: "assistant",
        message: {
          id: "msg-1",
          stop_reason: null,
          usage: { input_tokens: 100, output_tokens: 25 },
          content: [{ type: "text", text: "partial" }],
        },
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "msg-1",
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 25 },
          content: [{ type: "text", text: "final one" }],
        },
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "msg-2",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: "text", text: "final two" }],
        },
      } as SDKMessage,
    );

    const runtime = new CLIRuntime({
      processSpawner: (() => makeSubprocess() as never) as never,
    });

    const messages: SDKMessage[] = [];
    for await (const message of runtime.execute({
      prompt: "Hello",
      agent: { name: "test-agent", configPath: "/tmp/agent.yaml" } as never,
    })) {
      messages.push(message);
    }

    const result = messages.find((m) => m.type === "result") as
      | (SDKMessage & {
          type: "result";
          num_turns?: number;
          usage?: { input_tokens?: number; output_tokens?: number };
        })
      | undefined;
    expect(result).toBeDefined();
    expect(result?.num_turns).toBe(2);
    expect(result?.usage?.input_tokens).toBe(110);
    expect(result?.usage?.output_tokens).toBe(30);
  });
});
