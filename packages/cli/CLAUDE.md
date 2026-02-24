# packages/cli (herdctl)

Thin CLI wrapper around `@herdctl/core`'s FleetManager. This package defines the `herdctl` binary using commander.js -- each command parses options, instantiates a `FleetManager`, calls its methods, and formats the output. No business logic lives here.

## Structure

```
src/
  index.ts              # Entry point — defines all commander.js commands
  commands/             # One file per command (start, stop, status, trigger, etc.)
    __tests__/          # Unit tests for each command
  utils/
    colors.ts           # ANSI color helpers (respects NO_COLOR)
bin/
  herdctl.js            # Executable entry point
```

## Key Convention

**This is a thin client.** All orchestration, config parsing, scheduling, and state management belong in `@herdctl/core`. Command files here should only:
1. Parse CLI options
2. Create a `FleetManager` instance
3. Call FleetManager methods
4. Format and print output

If you find yourself writing business logic, it belongs in `@herdctl/core` instead.

## Development

```bash
pnpm build             # Compile TypeScript
pnpm dev               # Watch mode
pnpm test              # Unit tests (excludes smoke tests)
pnpm test:smoke        # Smoke tests (requires built binary)
pnpm typecheck         # Type checking only
pnpm lint              # Biome linter
```

## Testing

Tests live in `src/commands/__tests__/` adjacent to the command files. A top-level smoke test (`src/__tests__/smoke.test.ts`) validates the built binary. Tests use Vitest and mock `@herdctl/core` dependencies.
