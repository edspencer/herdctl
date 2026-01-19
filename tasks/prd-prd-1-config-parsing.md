# PRD 1: Config Parsing

## Overview

Implement the configuration parsing foundation for herdctl in `packages/core/src/config/`. This module parses and validates fleet configuration (`herdctl.yaml`) and individual agent YAML files, providing a type-safe, validated configuration object for the rest of the system.

## User Stories

### US-1: Parse Fleet Configuration
**As a** fleet operator  
**I want to** load a `herdctl.yaml` file  
**So that** I can define my fleet's default settings and agent references

**Acceptance Criteria:**
- Parses valid `herdctl.yaml` files using the `yaml` package
- Returns typed `FleetConfig` object validated by Zod
- Throws descriptive errors for invalid YAML syntax
- Throws descriptive errors for schema validation failures
- Supports all fields from SPEC.md: `fleet`, `defaults`, `agents`, `workspace`, `chat`, `webhooks`, `docker`

### US-2: Parse Agent Configuration
**As a** fleet operator  
**I want to** define agents in separate YAML files  
**So that** I can organize my agent configurations modularly

**Acceptance Criteria:**
- Parses agent YAML files referenced by path in fleet config
- Returns typed `AgentConfig` object validated by Zod
- Supports all agent fields: `name`, `description`, `workspace`, `repo`, `identity`, `work_source`, `schedules`, `session`, `permissions`, `mcp_servers`, `chat`
- Handles relative paths resolved from fleet config location
- Throws descriptive errors with file path context

### US-3: Merge Defaults with Agent Overrides
**As a** fleet operator  
**I want to** define fleet-level defaults that agents can override  
**So that** I don't repeat common configuration across agents

**Acceptance Criteria:**
- Fleet `defaults` section merges into each agent config
- Agent-specific values override fleet defaults (deep merge)
- Merge applies to: `permissions`, `work_source`, `session`, `docker`, `model`, `max_turns`, `permission_mode`
- Nested objects merge recursively (e.g., `permissions.allowed_tools`)
- Arrays are replaced, not merged (agent's `allowed_tools` replaces defaults)

### US-4: Environment Variable Interpolation
**As a** fleet operator  
**I want to** use `${VAR}` syntax in YAML values  
**So that** I can inject secrets and environment-specific values

**Acceptance Criteria:**
- Interpolates `${VAR_NAME}` patterns in string values
- Supports `${VAR:-default}` syntax for default values
- Throws error for undefined variables without defaults
- Preserves non-string values (numbers, booleans, objects)
- Works at any nesting depth in the config

### US-5: Load Complete Configuration
**As a** developer using @herdctl/core  
**I want to** call a single function to load all config  
**So that** I get a fully resolved, validated configuration object

**Acceptance Criteria:**
- `loadConfig(configPath?: string)` function auto-discovers `herdctl.yaml`
- Searches current directory and parents (like git does)
- Loads fleet config, all referenced agents, merges defaults
- Returns `ResolvedConfig` with all agents fully resolved
- Validates entire config tree before returning

## Technical Specifications

### File Structure

```
packages/core/src/config/
├── index.ts              # Public exports
├── schemas/
│   ├── index.ts          # Schema exports
│   ├── fleet.ts          # FleetConfigSchema
│   ├── agent.ts          # AgentConfigSchema
│   ├── schedule.ts       # ScheduleSchema, TriggerSchema
│   ├── permissions.ts    # PermissionsSchema
│   ├── workspace.ts      # WorkspaceSchema
│   └── common.ts         # Shared schemas (work_source, mcp_servers, etc.)
├── loader.ts             # loadConfig(), loadFleetConfig(), loadAgentConfig()
├── merger.ts             # mergeDefaults()
├── interpolation.ts      # interpolateEnv()
├── types.ts              # TypeScript types derived from schemas
└── errors.ts             # ConfigError, ValidationError, etc.
```

### Zod Schemas

Define schemas based on SPEC.md. Key schemas:

```typescript
// Fleet config (herdctl.yaml)
const FleetConfigSchema = z.object({
  fleet: z.object({
    name: z.string(),
    description: z.string().optional(),
  }).optional(),
  defaults: DefaultsSchema.optional(),
  agents: z.record(z.string(), z.object({
    path: z.string(),
  })).optional(),
  workspace: WorkspaceConfigSchema.optional(),
  chat: ChatConfigSchema.optional(),
  webhooks: WebhooksConfigSchema.optional(),
  docker: DockerConfigSchema.optional(),
});

// Agent config
const AgentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  workspace: z.union([z.string(), WorkspaceSchema]).optional(),
  repo: z.string().optional(),
  identity: IdentitySchema.optional(),
  system_prompt: z.string().optional(),
  work_source: WorkSourceSchema.optional(),
  schedules: z.record(z.string(), ScheduleSchema).optional(),
  session: SessionSchema.optional(),
  permissions: PermissionsSchema.optional(),
  mcp_servers: z.record(z.string(), McpServerSchema).optional(),
  chat: AgentChatSchema.optional(),
  model: z.string().optional(),
  max_turns: z.number().optional(),
  permission_mode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']).optional(),
});

// Schedule config
const ScheduleSchema = z.object({
  type: z.enum(['interval', 'cron', 'webhook', 'chat']),
  interval: z.string().optional(),  // "5m", "1h", etc.
  expression: z.string().optional(), // cron expression
  prompt: z.string().optional(),
  work_source: WorkSourceSchema.optional(),
});

// Trigger (normalized from schedule)
const TriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('interval'), every: z.string() }),
  z.object({ type: z.literal('cron'), expression: z.string() }),
  z.object({ type: z.literal('webhook'), path: z.string().optional() }),
  z.object({ type: z.literal('chat'), /* chat-specific fields */ }),
]);
```

### Public API

```typescript
// Main entry point
export async function loadConfig(
  configPath?: string
): Promise<ResolvedConfig>;

// Lower-level APIs
export async function loadFleetConfig(
  configPath: string
): Promise<FleetConfig>;

export async function loadAgentConfig(
  agentPath: string
): Promise<AgentConfig>;

export function mergeDefaults(
  defaults: Defaults,
  agent: AgentConfig
): AgentConfig;

export function interpolateEnv(
  config: unknown,
  env?: Record<string, string>
): unknown;

// Types
export type FleetConfig = z.infer<typeof FleetConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ResolvedConfig = {
  fleet: FleetConfig;
  agents: Map<string, ResolvedAgentConfig>;
  configPath: string;
};
export type ResolvedAgentConfig = AgentConfig & {
  _resolved: true;
  _configPath: string;
};
```

### Error Handling

```typescript
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class ValidationError extends ConfigError {
  constructor(
    message: string,
    public readonly zodError: z.ZodError,
    filePath?: string
  ) {
    super(message, filePath);
    this.name = 'ValidationError';
  }
}

export class InterpolationError extends ConfigError {
  constructor(
    message: string,
    public readonly variable: string,
    filePath?: string
  ) {
    super(message, filePath);
    this.name = 'InterpolationError';
  }
}
```

### Environment Variable Interpolation

```typescript
// Pattern: ${VAR} or ${VAR:-default}
const ENV_PATTERN = /\$\{([^}:-]+)(?::-([^}]*))?\}/g;

function interpolateString(
  value: string,
  env: Record<string, string | undefined>
): string {
  return value.replace(ENV_PATTERN, (match, varName, defaultValue) => {
    const envValue = env[varName];
    if (envValue !== undefined) return envValue;
    if (defaultValue !== undefined) return defaultValue;
    throw new InterpolationError(
      `Environment variable '${varName}' is not defined`,
      varName
    );
  });
}
```

### Config Discovery

```typescript
async function findConfigFile(startDir: string): Promise<string | null> {
  const CONFIG_NAMES = ['herdctl.yaml', 'herdctl.yml'];
  let currentDir = startDir;
  
  while (true) {
    for (const name of CONFIG_NAMES) {
      const configPath = path.join(currentDir, name);
      if (await fileExists(configPath)) {
        return configPath;
      }
    }
    
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // Reached root
    currentDir = parentDir;
  }
  
  return null;
}
```

## Test Plan

### Unit Tests

```typescript
// packages/core/src/config/__tests__/

// schemas.test.ts
describe('FleetConfigSchema', () => {
  it('validates minimal fleet config');
  it('validates full fleet config with all fields');
  it('rejects invalid fleet config');
  it('provides helpful error messages');
});

describe('AgentConfigSchema', () => {
  it('validates minimal agent config');
  it('validates agent with schedules');
  it('validates agent with permissions');
  it('validates agent with mcp_servers');
  it('rejects invalid agent config');
});

// interpolation.test.ts
describe('interpolateEnv', () => {
  it('interpolates ${VAR} syntax');
  it('interpolates ${VAR:-default} with missing var');
  it('uses env value over default');
  it('throws for undefined var without default');
  it('preserves non-string values');
  it('handles nested objects');
  it('handles arrays');
});

// merger.test.ts
describe('mergeDefaults', () => {
  it('merges permissions from defaults');
  it('agent values override defaults');
  it('deep merges nested objects');
  it('replaces arrays (no merge)');
  it('handles missing defaults');
  it('handles missing agent fields');
});

// loader.test.ts
describe('loadConfig', () => {
  it('loads and resolves complete config');
  it('discovers herdctl.yaml in current dir');
  it('discovers herdctl.yaml in parent dirs');
  it('loads referenced agent files');
  it('merges defaults into agents');
  it('interpolates environment variables');
  it('throws ConfigError for missing file');
  it('throws ValidationError for invalid schema');
});
```

### Integration Tests

```typescript
// Uses example configs from examples/simple/
describe('Config Integration', () => {
  it('loads examples/simple/herdctl.yaml');
  it('loads examples/simple/agents/example-agent.yaml');
  it('resolves full example config');
});
```

## Dependencies

Already in `package.json`:
- `yaml` (^2.3.0) - YAML parsing
- `zod` (^3.22.0) - Schema validation
- `vitest` (^1) - Testing

No additional dependencies needed.

## Out of Scope

- Runtime validation of agent behavior
- File watching / hot reload
- Config generation / scaffolding CLI
- YAML writing (only reading)
- Config diffing / migration

## Acceptance Criteria Summary

1. ✅ `pnpm typecheck` passes in packages/core
2. ✅ `pnpm test` passes with >90% coverage of config module
3. ✅ Can load `examples/simple/herdctl.yaml` and resolve all agents
4. ✅ Environment interpolation works with `${VAR}` and `${VAR:-default}`
5. ✅ Fleet defaults properly merge with agent configs
6. ✅ Clear error messages for: missing files, invalid YAML, schema violations, undefined env vars
7. ✅ Types are exported and usable by other packages