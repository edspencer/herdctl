# herdctl Recipes

Ready-to-use code examples for common scenarios when using `@herdctl/core` as a library.

## Prerequisites

Make sure you have a valid `herdctl.yaml` configuration file in your project root with at least one agent configured.

## Examples

### One-Shot Execution

Run a single agent job and exit when complete.

```bash
npx tsx examples/recipes/one-shot.ts [agent-name] [prompt]
```

### Daemon Mode

Run herdctl as a background service with graceful shutdown.

```bash
npx tsx examples/recipes/daemon.ts
```

Press `Ctrl+C` to test graceful shutdown handling.

### CLI Wrapper

Custom CLI tool wrapping herdctl functionality.

```bash
# Show fleet status
npx tsx examples/recipes/cli-wrapper.ts status

# List agents
npx tsx examples/recipes/cli-wrapper.ts agents

# Trigger an agent
npx tsx examples/recipes/cli-wrapper.ts trigger my-agent -p "Custom prompt"
```

### Express Dashboard

REST API and web dashboard.

```bash
npx tsx examples/recipes/express-dashboard.ts
```

Then open http://localhost:3000 in your browser.

### Fastify Plugin

Integrate with existing Fastify server.

```bash
npx tsx examples/recipes/fastify-plugin.ts
```

### CI/CD Runner

For GitHub Actions and other CI systems.

```bash
INPUT_AGENT=my-agent INPUT_PROMPT="Run tests" npx tsx examples/recipes/ci-runner.ts
```

### Hot Reload

Watch for config changes and reload automatically.

```bash
npx tsx examples/recipes/hot-reload.ts
```

Then edit your `herdctl.yaml` or agent YAML files.

### Testing Patterns

Run the test examples with vitest:

```bash
npx vitest run examples/recipes/testing-patterns.test.ts
```

## Dependencies

Some examples require additional dependencies:

```bash
# For CLI wrapper
pnpm add commander

# For Express dashboard
pnpm add express
pnpm add -D @types/express

# For Fastify plugin
pnpm add fastify pino-pretty
```

## Documentation

See the full documentation at: https://herdctl.dev/guides/recipes/
