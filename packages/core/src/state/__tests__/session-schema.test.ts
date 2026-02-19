import { describe, it, expect } from "vitest";
import {
  SessionInfoSchema,
  SessionModeSchema,
  createSessionInfo,
  type SessionInfo,
  type SessionMode,
} from "../schemas/session-info.js";

describe("SessionModeSchema", () => {
  it("accepts valid modes", () => {
    const validModes = ["autonomous", "interactive", "review"];

    for (const mode of validModes) {
      const result = SessionModeSchema.safeParse(mode);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(mode);
      }
    }
  });

  it("rejects invalid modes", () => {
    const invalidModes = ["manual", "auto", "invalid", "", "AUTONOMOUS"];

    for (const mode of invalidModes) {
      const result = SessionModeSchema.safeParse(mode);
      expect(result.success).toBe(false);
    }
  });
});

describe("SessionInfoSchema", () => {
  const validSession: SessionInfo = {
    agent_name: "test-agent",
    session_id: "claude-session-abc123",
    created_at: "2024-01-15T10:00:00.000Z",
    last_used_at: "2024-01-15T12:30:00.000Z",
    job_count: 5,
    mode: "autonomous",
    runtime_type: "sdk",
    docker_enabled: false,
  };

  it("accepts valid session info", () => {
    const result = SessionInfoSchema.safeParse(validSession);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validSession);
    }
  });

  describe("agent_name validation", () => {
    it("rejects empty agent_name", () => {
      const result = SessionInfoSchema.safeParse({
        ...validSession,
        agent_name: "",
      });
      expect(result.success).toBe(false);
    });

    it("accepts any non-empty agent_name", () => {
      const names = ["a", "test-agent", "agent_with_underscores", "Agent123", "agent.with.dots"];

      for (const name of names) {
        const result = SessionInfoSchema.safeParse({
          ...validSession,
          agent_name: name,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("session_id validation", () => {
    it("rejects empty session_id", () => {
      const result = SessionInfoSchema.safeParse({
        ...validSession,
        session_id: "",
      });
      expect(result.success).toBe(false);
    });

    it("accepts any non-empty session_id", () => {
      const ids = [
        "x",
        "session-123",
        "claude-session-abc",
        "uuid-style-12345678-1234-1234-1234-123456789012",
      ];

      for (const id of ids) {
        const result = SessionInfoSchema.safeParse({
          ...validSession,
          session_id: id,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("created_at validation", () => {
    it("accepts valid ISO datetime strings", () => {
      // Zod's datetime() expects UTC format (Z suffix) by default
      const validDates = [
        "2024-01-15T10:00:00Z",
        "2024-01-15T10:00:00.000Z",
        "2024-12-31T23:59:59.999Z",
      ];

      for (const date of validDates) {
        const result = SessionInfoSchema.safeParse({
          ...validSession,
          created_at: date,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects datetime strings with timezone offsets", () => {
      // Zod's datetime() without offset option rejects non-Z timezones
      const offsetDates = ["2024-01-15T10:00:00+05:30", "2024-01-15T10:00:00-08:00"];

      for (const date of offsetDates) {
        const result = SessionInfoSchema.safeParse({
          ...validSession,
          created_at: date,
        });
        expect(result.success).toBe(false);
      }
    });

    it("rejects invalid datetime strings", () => {
      const invalidDates = [
        "not-a-date",
        "2024-01-15",
        "10:00:00",
        "2024/01/15T10:00:00Z",
        "",
        "Jan 15, 2024",
      ];

      for (const date of invalidDates) {
        const result = SessionInfoSchema.safeParse({
          ...validSession,
          created_at: date,
        });
        expect(result.success).toBe(false);
      }
    });
  });

  describe("last_used_at validation", () => {
    it("accepts valid ISO datetime strings", () => {
      const result = SessionInfoSchema.safeParse({
        ...validSession,
        last_used_at: "2024-01-20T15:30:00.000Z",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid datetime strings", () => {
      const result = SessionInfoSchema.safeParse({
        ...validSession,
        last_used_at: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("job_count validation", () => {
    it("accepts zero", () => {
      const result = SessionInfoSchema.safeParse({
        ...validSession,
        job_count: 0,
      });
      expect(result.success).toBe(true);
    });

    it("accepts positive integers", () => {
      const counts = [1, 10, 100, 1000, 999999];

      for (const count of counts) {
        const result = SessionInfoSchema.safeParse({
          ...validSession,
          job_count: count,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects negative numbers", () => {
      const result = SessionInfoSchema.safeParse({
        ...validSession,
        job_count: -1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integers", () => {
      const result = SessionInfoSchema.safeParse({
        ...validSession,
        job_count: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("mode validation", () => {
    it("accepts all valid modes", () => {
      const modes: SessionMode[] = ["autonomous", "interactive", "review"];

      for (const mode of modes) {
        const result = SessionInfoSchema.safeParse({
          ...validSession,
          mode,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid modes", () => {
      const result = SessionInfoSchema.safeParse({
        ...validSession,
        mode: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("required fields", () => {
    it("rejects missing agent_name", () => {
      const { agent_name, ...withoutAgentName } = validSession;
      const result = SessionInfoSchema.safeParse(withoutAgentName);
      expect(result.success).toBe(false);
    });

    it("rejects missing session_id", () => {
      const { session_id, ...withoutSessionId } = validSession;
      const result = SessionInfoSchema.safeParse(withoutSessionId);
      expect(result.success).toBe(false);
    });

    it("rejects missing created_at", () => {
      const { created_at, ...withoutCreatedAt } = validSession;
      const result = SessionInfoSchema.safeParse(withoutCreatedAt);
      expect(result.success).toBe(false);
    });

    it("rejects missing last_used_at", () => {
      const { last_used_at, ...withoutLastUsedAt } = validSession;
      const result = SessionInfoSchema.safeParse(withoutLastUsedAt);
      expect(result.success).toBe(false);
    });

    it("rejects missing job_count", () => {
      const { job_count, ...withoutJobCount } = validSession;
      const result = SessionInfoSchema.safeParse(withoutJobCount);
      expect(result.success).toBe(false);
    });

    it("rejects missing mode", () => {
      const { mode, ...withoutMode } = validSession;
      const result = SessionInfoSchema.safeParse(withoutMode);
      expect(result.success).toBe(false);
    });
  });
});

describe("createSessionInfo", () => {
  it("creates session with default values", () => {
    const session = createSessionInfo({
      agent_name: "test-agent",
      session_id: "session-123",
    });

    expect(session.agent_name).toBe("test-agent");
    expect(session.session_id).toBe("session-123");
    expect(session.job_count).toBe(0);
    expect(session.mode).toBe("autonomous"); // default
    expect(session.created_at).toBeDefined();
    expect(session.last_used_at).toBeDefined();
  });

  it("creates session with custom mode", () => {
    const session = createSessionInfo({
      agent_name: "test-agent",
      session_id: "session-123",
      mode: "interactive",
    });

    expect(session.mode).toBe("interactive");
  });

  it("creates session with all modes", () => {
    const modes: SessionMode[] = ["autonomous", "interactive", "review"];

    for (const mode of modes) {
      const session = createSessionInfo({
        agent_name: "test-agent",
        session_id: "session-123",
        mode,
      });
      expect(session.mode).toBe(mode);
    }
  });

  it("sets created_at and last_used_at to current time", () => {
    const before = new Date();
    const session = createSessionInfo({
      agent_name: "test-agent",
      session_id: "session-123",
    });
    const after = new Date();

    const createdAt = new Date(session.created_at);
    const lastUsedAt = new Date(session.last_used_at);

    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    expect(lastUsedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(lastUsedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it("sets created_at equal to last_used_at initially", () => {
    const session = createSessionInfo({
      agent_name: "test-agent",
      session_id: "session-123",
    });

    expect(session.created_at).toBe(session.last_used_at);
  });

  it("created session passes schema validation", () => {
    const session = createSessionInfo({
      agent_name: "test-agent",
      session_id: "session-123",
      mode: "review",
    });

    const result = SessionInfoSchema.safeParse(session);
    expect(result.success).toBe(true);
  });
});

describe("type inference", () => {
  it("SessionInfo type matches schema inference", () => {
    // This is a compile-time check - if the types don't match, TypeScript will error
    const session: SessionInfo = {
      agent_name: "test",
      session_id: "session",
      created_at: "2024-01-15T10:00:00Z",
      last_used_at: "2024-01-15T10:00:00Z",
      job_count: 0,
      mode: "autonomous",
      runtime_type: "sdk",
      docker_enabled: false,
    };

    const result = SessionInfoSchema.parse(session);
    const typed: SessionInfo = result;
    expect(typed).toBeDefined();
  });

  it("SessionMode type matches schema inference", () => {
    const modes: SessionMode[] = ["autonomous", "interactive", "review"];
    for (const mode of modes) {
      const result = SessionModeSchema.parse(mode);
      const typed: SessionMode = result;
      expect(typed).toBe(mode);
    }
  });
});
