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

**Treat this as a thin client.** Delegate all orchestration, config parsing, scheduling, and state management to `@herdctl/core`. Command files must only:
1. Parse CLI options
2. Create a `FleetManager` instance
3. Call FleetManager methods
4. Format and print output

Move any business logic to `@herdctl/core`.

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

Place tests in `src/commands/__tests__/` adjacent to command files. Use the smoke test at `src/__tests__/smoke.test.ts` to validate the built binary. Mock `@herdctl/core` dependencies in tests.
