import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @inquirer/prompts
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
}));

// Mock subcommands
vi.mock("../init-fleet.js", () => ({
  initFleetCommand: vi.fn(),
}));

vi.mock("../init-agent.js", () => ({
  initAgentCommand: vi.fn(),
}));

import { select } from "@inquirer/prompts";
import { initRouterAction } from "../init.js";
import { initAgentCommand } from "../init-agent.js";
import { initFleetCommand } from "../init-fleet.js";

const mockedSelect = vi.mocked(select);
const mockedInitFleet = vi.mocked(initFleetCommand);
const mockedInitAgent = vi.mocked(initAgentCommand);

describe("initRouterAction", () => {
  let consoleErrors: string[];
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    consoleErrors = [];
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));

    exitCode = undefined;
    originalProcessExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never;

    vi.clearAllMocks();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  it("shows select prompt when invoked without --yes", async () => {
    mockedSelect.mockResolvedValueOnce("fleet");
    mockedInitFleet.mockResolvedValueOnce(undefined);

    await initRouterAction({});

    expect(mockedSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "What would you like to initialize?",
      }),
    );
  });

  it("routes to fleet init when Fleet is selected", async () => {
    mockedSelect.mockResolvedValueOnce("fleet");
    mockedInitFleet.mockResolvedValueOnce(undefined);

    await initRouterAction({});

    expect(mockedInitFleet).toHaveBeenCalledWith({ force: undefined });
    expect(mockedInitAgent).not.toHaveBeenCalled();
  });

  it("routes to agent init when Agent is selected", async () => {
    mockedSelect.mockResolvedValueOnce("agent");
    mockedInitAgent.mockResolvedValueOnce(undefined);

    await initRouterAction({});

    expect(mockedInitAgent).toHaveBeenCalledWith(undefined, { force: undefined });
    expect(mockedInitFleet).not.toHaveBeenCalled();
  });

  it("passes force option through to subcommands", async () => {
    mockedSelect.mockResolvedValueOnce("fleet");
    mockedInitFleet.mockResolvedValueOnce(undefined);

    await initRouterAction({ force: true });

    expect(mockedInitFleet).toHaveBeenCalledWith({ force: true });
  });

  it("errors with --yes and no subcommand", async () => {
    await expect(initRouterAction({ yes: true })).rejects.toThrow("process.exit");
    expect(exitCode).toBe(1);
    expect(consoleErrors.some((e) => e.includes("specify a subcommand"))).toBe(true);
    expect(mockedSelect).not.toHaveBeenCalled();
  });
});
