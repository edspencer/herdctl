import { describe, expect, it } from "vitest";
import { IntervalParseError, SchedulerError, ScheduleTriggerError } from "../errors.js";

// =============================================================================
// SchedulerError (Base Class)
// =============================================================================

describe("SchedulerError", () => {
  it("creates error with message", () => {
    const error = new SchedulerError("test error message");

    expect(error.message).toBe("test error message");
    expect(error.name).toBe("SchedulerError");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SchedulerError);
  });

  it("preserves cause when provided", () => {
    const cause = new Error("original error");
    const error = new SchedulerError("wrapped error", { cause });

    expect(error.message).toBe("wrapped error");
    expect(error.cause).toBe(cause);
  });

  it("has undefined cause when not provided", () => {
    const error = new SchedulerError("no cause");

    expect(error.cause).toBeUndefined();
  });
});

// =============================================================================
// IntervalParseError
// =============================================================================

describe("IntervalParseError", () => {
  it("creates error with message and input", () => {
    const error = new IntervalParseError("invalid interval", "5x");

    expect(error.message).toBe("invalid interval");
    expect(error.name).toBe("IntervalParseError");
    expect(error.input).toBe("5x");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SchedulerError);
    expect(error).toBeInstanceOf(IntervalParseError);
  });

  it("preserves input string exactly", () => {
    const inputs = ["", "  ", "5", "-5m", "1.5h", "invalid"];

    for (const input of inputs) {
      const error = new IntervalParseError("test", input);
      expect(error.input).toBe(input);
    }
  });

  it("preserves cause when provided", () => {
    const cause = new Error("original error");
    const error = new IntervalParseError("wrapped error", "5x", { cause });

    expect(error.cause).toBe(cause);
  });
});

// =============================================================================
// ScheduleTriggerError
// =============================================================================

describe("ScheduleTriggerError", () => {
  it("creates error with message, agentName, and scheduleName", () => {
    const error = new ScheduleTriggerError("trigger failed", "my-agent", "hourly-schedule");

    expect(error.message).toBe("trigger failed");
    expect(error.name).toBe("ScheduleTriggerError");
    expect(error.agentName).toBe("my-agent");
    expect(error.scheduleName).toBe("hourly-schedule");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SchedulerError);
    expect(error).toBeInstanceOf(ScheduleTriggerError);
  });

  it("preserves agent and schedule names exactly", () => {
    const error = new ScheduleTriggerError(
      "test",
      "agent-with-dashes",
      "schedule_with_underscores",
    );

    expect(error.agentName).toBe("agent-with-dashes");
    expect(error.scheduleName).toBe("schedule_with_underscores");
  });

  it("preserves cause when provided", () => {
    const cause = new Error("underlying failure");
    const error = new ScheduleTriggerError("trigger failed", "my-agent", "my-schedule", { cause });

    expect(error.cause).toBe(cause);
  });

  it("has undefined cause when not provided", () => {
    const error = new ScheduleTriggerError("trigger failed", "my-agent", "my-schedule");

    expect(error.cause).toBeUndefined();
  });

  it("can be caught as SchedulerError", () => {
    const error = new ScheduleTriggerError("failed", "agent", "schedule");

    let caught = false;
    try {
      throw error;
    } catch (e) {
      if (e instanceof SchedulerError) {
        caught = true;
      }
    }

    expect(caught).toBe(true);
  });

  it("can wrap another error as cause", () => {
    const networkError = new Error("Connection refused");
    const triggerError = new ScheduleTriggerError(
      `Failed to trigger agent: ${networkError.message}`,
      "remote-agent",
      "sync-schedule",
      { cause: networkError },
    );

    expect(triggerError.message).toBe("Failed to trigger agent: Connection refused");
    expect(triggerError.cause).toBe(networkError);
    expect(triggerError.agentName).toBe("remote-agent");
    expect(triggerError.scheduleName).toBe("sync-schedule");
  });
});
