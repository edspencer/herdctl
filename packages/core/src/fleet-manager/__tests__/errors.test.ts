/**
 * Tests for fleet-manager error classes
 *
 * Tests all error classes, their constructors, properties, and type guards.
 */

import { describe, expect, it } from "vitest";
import {
  AgentNotFoundError,
  ConcurrencyLimitError,
  ConfigurationError,
  FleetManagerError,
  FleetManagerErrorCode,
  FleetManagerShutdownError,
  FleetManagerStateDirError,
  InvalidStateError,
  isAgentNotFoundError,
  isConcurrencyLimitError,
  isConfigurationError,
  // Type guards
  isFleetManagerError,
  isInvalidStateError,
  isJobCancelError,
  isJobForkError,
  isJobNotFoundError,
  isScheduleNotFoundError,
  JobCancelError,
  JobForkError,
  JobNotFoundError,
  ScheduleNotFoundError,
} from "../errors.js";

describe("FleetManagerError classes", () => {
  // ===========================================================================
  // FleetManagerError (base class)
  // ===========================================================================
  describe("FleetManagerError", () => {
    it("creates error with message", () => {
      const error = new FleetManagerError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.name).toBe("FleetManagerError");
      expect(error.code).toBe(FleetManagerErrorCode.FLEET_MANAGER_ERROR);
    });

    it("creates error with custom code", () => {
      const error = new FleetManagerError("Test error", {
        code: FleetManagerErrorCode.CONFIGURATION_ERROR,
      });
      expect(error.code).toBe(FleetManagerErrorCode.CONFIGURATION_ERROR);
    });

    it("creates error with cause", () => {
      const cause = new Error("Original error");
      const error = new FleetManagerError("Wrapped error", { cause });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // ConfigurationError
  // ===========================================================================
  describe("ConfigurationError", () => {
    it("creates error with message only", () => {
      const error = new ConfigurationError("Config failed");
      expect(error.message).toContain("Config failed");
      expect(error.name).toBe("ConfigurationError");
      expect(error.code).toBe(FleetManagerErrorCode.CONFIGURATION_ERROR);
      expect(error.configPath).toBeUndefined();
      expect(error.validationErrors).toEqual([]);
    });

    it("creates error with config path", () => {
      const error = new ConfigurationError("Config failed", {
        configPath: "/path/to/config.yaml",
      });
      expect(error.message).toContain("Config failed");
      expect(error.message).toContain("/path/to/config.yaml");
      expect(error.configPath).toBe("/path/to/config.yaml");
    });

    it("creates error with validation errors", () => {
      const error = new ConfigurationError("Validation failed", {
        validationErrors: [
          { path: "agents[0].name", message: "Name is required" },
          { path: "agents[0].model", message: "Invalid model", value: "unknown" },
        ],
      });
      expect(error.message).toContain("Validation errors:");
      expect(error.message).toContain("agents[0].name");
      expect(error.message).toContain("Name is required");
      expect(error.validationErrors).toHaveLength(2);
    });

    it("hasValidationErrors returns true when errors exist", () => {
      const error = new ConfigurationError("Validation failed", {
        validationErrors: [{ path: "test", message: "error" }],
      });
      expect(error.hasValidationErrors()).toBe(true);
    });

    it("hasValidationErrors returns false when no errors", () => {
      const error = new ConfigurationError("Config failed");
      expect(error.hasValidationErrors()).toBe(false);
    });

    it("creates error with cause", () => {
      const cause = new Error("YAML parse error");
      const error = new ConfigurationError("Config failed", { cause });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // AgentNotFoundError
  // ===========================================================================
  describe("AgentNotFoundError", () => {
    it("creates error with agent name", () => {
      const error = new AgentNotFoundError("my-agent");
      expect(error.message).toContain("my-agent");
      expect(error.message).toContain("not found");
      expect(error.name).toBe("AgentNotFoundError");
      expect(error.code).toBe(FleetManagerErrorCode.AGENT_NOT_FOUND);
      expect(error.agentName).toBe("my-agent");
      expect(error.availableAgents).toBeUndefined();
    });

    it("creates error with available agents list", () => {
      const error = new AgentNotFoundError("missing", {
        availableAgents: ["agent-a", "agent-b", "agent-c"],
      });
      expect(error.message).toContain("Available agents:");
      expect(error.message).toContain("agent-a");
      expect(error.availableAgents).toEqual(["agent-a", "agent-b", "agent-c"]);
    });

    it("shows message for empty agents list", () => {
      const error = new AgentNotFoundError("missing", {
        availableAgents: [],
      });
      expect(error.message).toContain("No agents are configured");
    });

    it("creates error with cause", () => {
      const cause = new Error("Lookup failed");
      const error = new AgentNotFoundError("my-agent", { cause });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // JobNotFoundError
  // ===========================================================================
  describe("JobNotFoundError", () => {
    it("creates error with job ID", () => {
      const error = new JobNotFoundError("job-2024-01-15-abc123");
      expect(error.message).toContain("job-2024-01-15-abc123");
      expect(error.message).toContain("not found");
      expect(error.name).toBe("JobNotFoundError");
      expect(error.code).toBe(FleetManagerErrorCode.JOB_NOT_FOUND);
      expect(error.jobId).toBe("job-2024-01-15-abc123");
    });

    it("creates error with cause", () => {
      const cause = new Error("File not found");
      const error = new JobNotFoundError("job-123", { cause });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // ScheduleNotFoundError
  // ===========================================================================
  describe("ScheduleNotFoundError", () => {
    it("creates error with agent and schedule names", () => {
      const error = new ScheduleNotFoundError("my-agent", "hourly");
      expect(error.message).toContain("hourly");
      expect(error.message).toContain("my-agent");
      expect(error.message).toContain("not found");
      expect(error.name).toBe("ScheduleNotFoundError");
      expect(error.code).toBe(FleetManagerErrorCode.SCHEDULE_NOT_FOUND);
      expect(error.agentName).toBe("my-agent");
      expect(error.scheduleName).toBe("hourly");
      expect(error.availableSchedules).toBeUndefined();
    });

    it("creates error with available schedules list", () => {
      const error = new ScheduleNotFoundError("my-agent", "missing", {
        availableSchedules: ["hourly", "daily", "weekly"],
      });
      expect(error.message).toContain("Available schedules:");
      expect(error.message).toContain("hourly");
      expect(error.availableSchedules).toEqual(["hourly", "daily", "weekly"]);
    });

    it("shows message for empty schedules list", () => {
      const error = new ScheduleNotFoundError("my-agent", "missing", {
        availableSchedules: [],
      });
      expect(error.message).toContain("has no schedules configured");
    });

    it("creates error with cause", () => {
      const cause = new Error("Config error");
      const error = new ScheduleNotFoundError("agent", "schedule", { cause });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // InvalidStateError
  // ===========================================================================
  describe("InvalidStateError", () => {
    it("creates error with single expected state", () => {
      const error = new InvalidStateError("start", "uninitialized", "initialized");
      expect(error.message).toContain("Cannot start");
      expect(error.message).toContain("uninitialized");
      expect(error.message).toContain("initialized");
      expect(error.name).toBe("InvalidStateError");
      expect(error.code).toBe(FleetManagerErrorCode.INVALID_STATE);
      expect(error.operation).toBe("start");
      expect(error.currentState).toBe("uninitialized");
      expect(error.expectedState).toBe("initialized");
    });

    it("creates error with multiple expected states", () => {
      const error = new InvalidStateError("reload", "uninitialized", [
        "initialized",
        "running",
        "stopped",
      ]);
      expect(error.message).toContain("initialized or running or stopped");
      expect(error.expectedState).toEqual(["initialized", "running", "stopped"]);
    });

    it("creates error with cause", () => {
      const cause = new Error("State transition failed");
      const error = new InvalidStateError("start", "error", "initialized", { cause });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // ConcurrencyLimitError
  // ===========================================================================
  describe("ConcurrencyLimitError", () => {
    it("creates error with agent name and limits", () => {
      const error = new ConcurrencyLimitError("my-agent", 3, 3);
      expect(error.message).toContain("my-agent");
      expect(error.message).toContain("concurrency limit");
      expect(error.message).toContain("3/3");
      expect(error.name).toBe("ConcurrencyLimitError");
      expect(error.code).toBe(FleetManagerErrorCode.CONCURRENCY_LIMIT);
      expect(error.agentName).toBe("my-agent");
      expect(error.currentJobs).toBe(3);
      expect(error.limit).toBe(3);
    });

    it("isAtLimit returns true when at capacity", () => {
      const error = new ConcurrencyLimitError("agent", 5, 5);
      expect(error.isAtLimit()).toBe(true);
    });

    it("isAtLimit returns true when over capacity", () => {
      const error = new ConcurrencyLimitError("agent", 6, 5);
      expect(error.isAtLimit()).toBe(true);
    });

    it("isAtLimit returns false when under capacity", () => {
      const error = new ConcurrencyLimitError("agent", 2, 5);
      expect(error.isAtLimit()).toBe(false);
    });

    it("creates error with cause", () => {
      const cause = new Error("Queue full");
      const error = new ConcurrencyLimitError("agent", 3, 3, { cause });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // FleetManagerStateDirError
  // ===========================================================================
  describe("FleetManagerStateDirError", () => {
    it("creates error with message and state directory", () => {
      const error = new FleetManagerStateDirError(
        "Failed to create directory",
        "/path/to/.herdctl",
      );
      expect(error.message).toBe("Failed to create directory");
      expect(error.name).toBe("FleetManagerStateDirError");
      expect(error.code).toBe(FleetManagerErrorCode.STATE_DIR_ERROR);
      expect(error.stateDir).toBe("/path/to/.herdctl");
    });

    it("creates error with cause", () => {
      const cause = new Error("Permission denied");
      const error = new FleetManagerStateDirError("Access denied", "/tmp/state", {
        cause,
      });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // FleetManagerShutdownError
  // ===========================================================================
  describe("FleetManagerShutdownError", () => {
    it("creates error with timedOut true", () => {
      const error = new FleetManagerShutdownError("Shutdown timed out", {
        timedOut: true,
      });
      expect(error.message).toBe("Shutdown timed out");
      expect(error.name).toBe("FleetManagerShutdownError");
      expect(error.code).toBe(FleetManagerErrorCode.SHUTDOWN_ERROR);
      expect(error.timedOut).toBe(true);
    });

    it("creates error with timedOut false", () => {
      const error = new FleetManagerShutdownError("Shutdown failed", {
        timedOut: false,
      });
      expect(error.timedOut).toBe(false);
    });

    it("isTimeout returns correct value", () => {
      const timedOutError = new FleetManagerShutdownError("Timeout", {
        timedOut: true,
      });
      const normalError = new FleetManagerShutdownError("Error", {
        timedOut: false,
      });

      expect(timedOutError.isTimeout()).toBe(true);
      expect(normalError.isTimeout()).toBe(false);
    });

    it("creates error with cause", () => {
      const cause = new Error("Jobs still running");
      const error = new FleetManagerShutdownError("Shutdown failed", {
        timedOut: true,
        cause,
      });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // JobCancelError
  // ===========================================================================
  describe("JobCancelError", () => {
    it("creates error for not_running reason", () => {
      const error = new JobCancelError("job-123", "not_running");
      expect(error.message).toContain("not running");
      expect(error.name).toBe("JobCancelError");
      expect(error.code).toBe(FleetManagerErrorCode.JOB_CANCEL_ERROR);
      expect(error.jobId).toBe("job-123");
      expect(error.reason).toBe("not_running");
    });

    it("creates error for process_error reason", () => {
      const error = new JobCancelError("job-456", "process_error");
      expect(error.message).toContain("Failed to terminate");
      expect(error.reason).toBe("process_error");
    });

    it("creates error for timeout reason", () => {
      const error = new JobCancelError("job-789", "timeout");
      expect(error.message).toContain("Timeout");
      expect(error.reason).toBe("timeout");
    });

    it("creates error for unknown reason", () => {
      const error = new JobCancelError("job-abc", "unknown");
      expect(error.message).toContain("Unknown error");
      expect(error.reason).toBe("unknown");
    });

    it("uses custom message when provided", () => {
      const error = new JobCancelError("job-123", "process_error", {
        message: "Custom cancellation message",
      });
      expect(error.message).toBe("Custom cancellation message");
    });

    it("creates error with cause", () => {
      const cause = new Error("SIGKILL failed");
      const error = new JobCancelError("job-123", "process_error", { cause });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // JobForkError
  // ===========================================================================
  describe("JobForkError", () => {
    it("creates error for no_session reason", () => {
      const error = new JobForkError("job-123", "no_session");
      expect(error.message).toContain("no session ID");
      expect(error.name).toBe("JobForkError");
      expect(error.code).toBe(FleetManagerErrorCode.JOB_FORK_ERROR);
      expect(error.originalJobId).toBe("job-123");
      expect(error.reason).toBe("no_session");
    });

    it("creates error for job_not_found reason", () => {
      const error = new JobForkError("job-456", "job_not_found");
      expect(error.message).toContain("not found");
      expect(error.reason).toBe("job_not_found");
    });

    it("creates error for agent_not_found reason", () => {
      const error = new JobForkError("job-789", "agent_not_found");
      expect(error.message).toContain("Agent");
      expect(error.message).toContain("not found");
      expect(error.reason).toBe("agent_not_found");
    });

    it("creates error for unknown reason", () => {
      const error = new JobForkError("job-abc", "unknown");
      expect(error.message).toContain("Unknown error");
      expect(error.reason).toBe("unknown");
    });

    it("uses custom message when provided", () => {
      const error = new JobForkError("job-123", "no_session", {
        message: "Custom fork error message",
      });
      expect(error.message).toBe("Custom fork error message");
    });

    it("creates error with cause", () => {
      const cause = new Error("Session lookup failed");
      const error = new JobForkError("job-123", "no_session", { cause });
      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // Type Guards
  // ===========================================================================
  describe("Type Guards", () => {
    describe("isFleetManagerError", () => {
      it("returns true for FleetManagerError", () => {
        const error = new FleetManagerError("test");
        expect(isFleetManagerError(error)).toBe(true);
      });

      it("returns true for all subclasses", () => {
        expect(isFleetManagerError(new ConfigurationError("test"))).toBe(true);
        expect(isFleetManagerError(new AgentNotFoundError("test"))).toBe(true);
        expect(isFleetManagerError(new JobNotFoundError("test"))).toBe(true);
        expect(isFleetManagerError(new ScheduleNotFoundError("a", "b"))).toBe(true);
        expect(isFleetManagerError(new InvalidStateError("a", "b", "c"))).toBe(true);
        expect(isFleetManagerError(new ConcurrencyLimitError("a", 1, 1))).toBe(true);
        expect(
          isFleetManagerError(new FleetManagerShutdownError("test", { timedOut: false })),
        ).toBe(true);
        expect(isFleetManagerError(new JobCancelError("test", "unknown"))).toBe(true);
        expect(isFleetManagerError(new JobForkError("test", "unknown"))).toBe(true);
      });

      it("returns false for regular Error", () => {
        expect(isFleetManagerError(new Error("test"))).toBe(false);
      });

      it("returns false for non-error values", () => {
        expect(isFleetManagerError(null)).toBe(false);
        expect(isFleetManagerError(undefined)).toBe(false);
        expect(isFleetManagerError("error")).toBe(false);
        expect(isFleetManagerError({ message: "error" })).toBe(false);
      });
    });

    describe("isConfigurationError", () => {
      it("returns true for ConfigurationError", () => {
        const error = new ConfigurationError("test");
        expect(isConfigurationError(error)).toBe(true);
      });

      it("returns false for other FleetManagerError types", () => {
        expect(isConfigurationError(new FleetManagerError("test"))).toBe(false);
        expect(isConfigurationError(new AgentNotFoundError("test"))).toBe(false);
      });

      it("returns false for non-error values", () => {
        expect(isConfigurationError(null)).toBe(false);
        expect(isConfigurationError(new Error("test"))).toBe(false);
      });
    });

    describe("isAgentNotFoundError", () => {
      it("returns true for AgentNotFoundError", () => {
        const error = new AgentNotFoundError("test");
        expect(isAgentNotFoundError(error)).toBe(true);
      });

      it("returns false for other error types", () => {
        expect(isAgentNotFoundError(new FleetManagerError("test"))).toBe(false);
        expect(isAgentNotFoundError(new JobNotFoundError("test"))).toBe(false);
        expect(isAgentNotFoundError(null)).toBe(false);
      });
    });

    describe("isJobNotFoundError", () => {
      it("returns true for JobNotFoundError", () => {
        const error = new JobNotFoundError("test");
        expect(isJobNotFoundError(error)).toBe(true);
      });

      it("returns false for other error types", () => {
        expect(isJobNotFoundError(new FleetManagerError("test"))).toBe(false);
        expect(isJobNotFoundError(new AgentNotFoundError("test"))).toBe(false);
        expect(isJobNotFoundError(null)).toBe(false);
      });
    });

    describe("isScheduleNotFoundError", () => {
      it("returns true for ScheduleNotFoundError", () => {
        const error = new ScheduleNotFoundError("agent", "schedule");
        expect(isScheduleNotFoundError(error)).toBe(true);
      });

      it("returns false for other error types", () => {
        expect(isScheduleNotFoundError(new FleetManagerError("test"))).toBe(false);
        expect(isScheduleNotFoundError(new AgentNotFoundError("test"))).toBe(false);
        expect(isScheduleNotFoundError(null)).toBe(false);
      });
    });

    describe("isInvalidStateError", () => {
      it("returns true for InvalidStateError", () => {
        const error = new InvalidStateError("op", "current", "expected");
        expect(isInvalidStateError(error)).toBe(true);
      });

      it("returns false for other error types", () => {
        expect(isInvalidStateError(new FleetManagerError("test"))).toBe(false);
        expect(isInvalidStateError(new AgentNotFoundError("test"))).toBe(false);
        expect(isInvalidStateError(null)).toBe(false);
      });
    });

    describe("isConcurrencyLimitError", () => {
      it("returns true for ConcurrencyLimitError", () => {
        const error = new ConcurrencyLimitError("agent", 3, 3);
        expect(isConcurrencyLimitError(error)).toBe(true);
      });

      it("returns false for other error types", () => {
        expect(isConcurrencyLimitError(new FleetManagerError("test"))).toBe(false);
        expect(isConcurrencyLimitError(new AgentNotFoundError("test"))).toBe(false);
        expect(isConcurrencyLimitError(null)).toBe(false);
      });
    });

    describe("isJobCancelError", () => {
      it("returns true for JobCancelError", () => {
        const error = new JobCancelError("job-123", "not_running");
        expect(isJobCancelError(error)).toBe(true);
      });

      it("returns false for other error types", () => {
        expect(isJobCancelError(new FleetManagerError("test"))).toBe(false);
        expect(isJobCancelError(new JobNotFoundError("test"))).toBe(false);
        expect(isJobCancelError(null)).toBe(false);
      });
    });

    describe("isJobForkError", () => {
      it("returns true for JobForkError", () => {
        const error = new JobForkError("job-123", "no_session");
        expect(isJobForkError(error)).toBe(true);
      });

      it("returns false for other error types", () => {
        expect(isJobForkError(new FleetManagerError("test"))).toBe(false);
        expect(isJobForkError(new JobNotFoundError("test"))).toBe(false);
        expect(isJobForkError(new JobCancelError("test", "unknown"))).toBe(false);
        expect(isJobForkError(null)).toBe(false);
      });
    });
  });

  // ===========================================================================
  // Error Codes
  // ===========================================================================
  describe("FleetManagerErrorCode", () => {
    it("contains all expected error codes", () => {
      expect(FleetManagerErrorCode.FLEET_MANAGER_ERROR).toBe("FLEET_MANAGER_ERROR");
      expect(FleetManagerErrorCode.CONFIGURATION_ERROR).toBe("CONFIGURATION_ERROR");
      expect(FleetManagerErrorCode.CONFIG_LOAD_ERROR).toBe("CONFIG_LOAD_ERROR");
      expect(FleetManagerErrorCode.AGENT_NOT_FOUND).toBe("AGENT_NOT_FOUND");
      expect(FleetManagerErrorCode.JOB_NOT_FOUND).toBe("JOB_NOT_FOUND");
      expect(FleetManagerErrorCode.SCHEDULE_NOT_FOUND).toBe("SCHEDULE_NOT_FOUND");
      expect(FleetManagerErrorCode.INVALID_STATE).toBe("INVALID_STATE");
      expect(FleetManagerErrorCode.STATE_DIR_ERROR).toBe("STATE_DIR_ERROR");
      expect(FleetManagerErrorCode.CONCURRENCY_LIMIT).toBe("CONCURRENCY_LIMIT");
      expect(FleetManagerErrorCode.SHUTDOWN_ERROR).toBe("SHUTDOWN_ERROR");
      expect(FleetManagerErrorCode.JOB_CANCEL_ERROR).toBe("JOB_CANCEL_ERROR");
      expect(FleetManagerErrorCode.JOB_FORK_ERROR).toBe("JOB_FORK_ERROR");
    });
  });
});
