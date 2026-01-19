# PRD 2: State Management

## Overview

Implement the state management foundation for herdctl in `packages/core/src/state/`. This module manages the `.herdctl/` directory structure, providing persistent storage for fleet state, job metadata, job output logs, agent sessions, and runtime information. All state is file-based (no database required), using YAML for structured data and JSONL for streaming logs.

## User Stories

### US-1: Initialize State Directory Structure
**As a** fleet operator  
**I want to** have herdctl automatically create and manage the `.herdctl/` directory  
**So that** all state files are organized and accessible

**Acceptance Criteria:**
- Creates `.herdctl/` directory in the project root if it doesn't exist
- Creates subdirectories: `jobs/`, `sessions/`, `logs/`
- Creates `state.yaml` with empty/initial fleet state if it doesn't exist
- Validates directory structure on initialization
- Returns `StateDirectory` object with paths to all subdirectories
- Throws descriptive errors if directories cannot be created (e.g., permission denied)
- Supports custom state directory path via options (default: `.herdctl/` in CWD)

### US-2: Read/Write Fleet State (state.yaml)
**As a** fleet operator  
**I want to** persist fleet-wide state across restarts  
**So that** agents resume from their last known state

**Acceptance Criteria:**
- Reads `state.yaml` and validates against `FleetStateSchema`
- Returns typed `FleetState` object with:
  - `fleet.started_at` - when the fleet was started
  - `agents` - map of agent name to `AgentState`:
    - `status`: `idle` | `running` | `error`
    - `current_job`: job ID or null
    - `last_job`: job ID or null
    - `next_schedule`: schedule name or null
    - `next_trigger_at`: ISO timestamp or null
    - `container_id`: Docker container ID or null (if using Docker)
    - `error_message`: last error message or null
- Writes `FleetState` back to `state.yaml` atomically
- Handles missing file gracefully (returns default empty state)
- Handles corrupted file gracefully (logs warning, returns default state)
- Provides `updateAgentState(agentName, updates)` for partial updates

### US-3: Read/Write Job Metadata (job-<id>.yaml)
**As a** fleet operator  
**I want to** persist job metadata for history and debugging  
**So that** I can track what each job did and when

**Acceptance Criteria:**
- Creates job metadata file at `.herdctl/jobs/job-<id>.yaml`
- Validates against `JobMetadataSchema` with fields from SPEC.md:
  - `id`: unique job identifier (e.g., `job-2024-01-19-abc123`)
  - `agent`: agent name
  - `schedule`: schedule name that triggered this job
  - `trigger_type`: `interval` | `cron` | `webhook` | `chat` | `manual`
  - `status`: `pending` | `running` | `completed` | `failed` | `cancelled`
  - `exit_reason`: `success` | `error` | `timeout` | `manual_cancel` | null
  - `session_id`: Claude session ID for resume/fork
  - `forked_from`: parent session ID if forked, or null
  - `started_at`: ISO timestamp
  - `finished_at`: ISO timestamp or null
  - `duration_seconds`: number or null
  - `prompt`: the prompt that was sent to Claude
  - `summary`: extracted summary from final message (or null)
  - `output_file`: relative path to JSONL output file
- Provides `createJob()`, `updateJob()`, `getJob()`, `listJobs()` functions
- `updateJob()` uses atomic writes to prevent corruption
- `listJobs()` supports filtering by agent, status, and date range
- Generates unique job IDs with format: `job-YYYY-MM-DD-<random6>`

### US-4: Append to Job Output Logs (job-<id>.jsonl)
**As a** fleet operator  
**I want to** stream job output to a persistent log file  
**So that** I can replay, monitor, and debug job execution

**Acceptance Criteria:**
- Creates output file at `.herdctl/jobs/job-<id>.jsonl`
- Appends JSONL messages from Claude SDK streaming output
- Each line is a valid JSON object with at minimum: `type`, `timestamp`
- Supports SDK message types: `system`, `assistant`, `tool_use`, `tool_result`, `error`
- Provides `appendJobOutput(jobId, message)` function (single message)
- Provides `appendJobOutputBatch(jobId, messages)` function (multiple messages)
- Provides `readJobOutput(jobId)` async generator for streaming reads
- Provides `getJobOutputPath(jobId)` for direct file access
- Handles concurrent appends safely (uses append mode)
- Validates message structure before writing
- Does NOT buffer - writes immediately for real-time monitoring

### US-5: Atomic Writes to Prevent Corruption
**As a** fleet operator  
**I want to** ensure state files are never corrupted during writes  
**So that** my fleet state survives crashes and restarts

**Acceptance Criteria:**
- All YAML writes use atomic write pattern (write to temp file, then rename)
- Temp files are written to same directory as target (ensures same filesystem)
- Temp files use pattern: `.<filename>.tmp.<random>`
- Rename operation is atomic on POSIX systems
- On Windows, uses rename with retry logic for best-effort atomicity
- JSONL appends use `fs.appendFile` (atomic at message level on most systems)
- Provides `atomicWriteFile(path, content)` utility function
- Cleans up temp files on failure

### US-6: Session State Management
**As a** fleet operator  
**I want to** persist Claude session information per agent  
**So that** I can resume or fork sessions later

**Acceptance Criteria:**
- Stores session info at `.herdctl/sessions/<agent-name>.json`
- Validates against `SessionInfoSchema` with fields:
  - `agent_name`: the agent this session belongs to
  - `session_id`: current Claude session ID
  - `created_at`: when this session was created
  - `last_used_at`: when this session was last used
  - `job_count`: number of jobs run in this session
  - `mode`: `fresh_per_job` | `persistent` | `per_channel`
- Provides `getSessionInfo(agentName)`, `updateSessionInfo(agentName, info)`, `clearSession(agentName)`
- Handles missing file gracefully (returns null)

### US-7: Concurrent Read Safety
**As a** fleet operator  
**I want to** read state from multiple CLI instances simultaneously  
**So that** I can monitor agents while they're running

**Acceptance Criteria:**
- Read operations don't require locks
- Read operations handle file being written to (retry on partial read)
- YAML parsing handles empty/truncated files gracefully
- JSONL reading handles incomplete last line (truncates to last valid line)
- Provides `safeReadYaml(path)` utility with retry logic
- Provides `safeReadJsonl(path)` utility that handles partial lines

## Technical Specifications

### File Structure

```
packages/core/src/state/
├── index.ts              # Public exports
├── schemas/
│   ├── index.ts          # Schema exports
│   ├── fleet-state.ts    # FleetStateSchema, AgentStateSchema
│   ├── job.ts            # JobMetadataSchema, JobStatusSchema
│   └── session.ts        # SessionInfoSchema
├── directory.ts          # StateDirectory initialization and paths
├── fleet-state.ts        # readFleetState(), writeFleetState(), updateAgentState()
├── jobs.ts               # createJob(), updateJob(), getJob(), listJobs()
├── output.ts             # appendJobOutput(), readJobOutput()
├── sessions.ts           # getSessionInfo(), updateSessionInfo(), clearSession()
├── utils/
│   ├── atomic.ts         # atomicWriteFile(), atomicWriteYaml()
│   ├── safe-read.ts      # safeReadYaml(), safeReadJsonl()
│   └── job-id.ts         # generateJobId()
├── types.ts              # TypeScript types derived from schemas
└── errors.ts             # StateError, JobNotFoundError, etc.
```

### Zod Schemas

```typescript
// =============================================================================
// Agent State Schema
// =============================================================================

export const AgentStatusSchema = z.enum(['idle', 'running', 'error']);

export const AgentStateSchema = z.object({
  status: AgentStatusSchema.default('idle'),
  current_job: z.string().nullable().default(null),
  last_job: z.string().nullable().default(null),
  next_schedule: z.string().nullable().default(null),
  next_trigger_at: z.string().datetime().nullable().default(null),
  container_id: z.string().nullable().default(null),
  error_message: z.string().nullable().default(null),
});

// =============================================================================
// Fleet State Schema
// =============================================================================

export const FleetStateSchema = z.object({
  fleet: z.object({
    started_at: z.string().datetime().nullable().default(null),
  }).default({}),
  agents: z.record(z.string(), AgentStateSchema).default({}),
});

// =============================================================================
// Job Schemas
// =============================================================================

export const TriggerTypeSchema = z.enum([
  'interval',
  'cron',
  'webhook',
  'chat',
  'manual',
]);

export const JobStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const ExitReasonSchema = z.enum([
  'success',
  'error',
  'timeout',
  'manual_cancel',
]);

export const JobMetadataSchema = z.object({
  id: z.string(),
  agent: z.string(),
  schedule: z.string().nullable(),
  trigger_type: TriggerTypeSchema,
  status: JobStatusSchema.default('pending'),
  exit_reason: ExitReasonSchema.nullable().default(null),
  session_id: z.string().nullable().default(null),
  forked_from: z.string().nullable().default(null),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable().default(null),
  duration_seconds: z.number().nullable().default(null),
  prompt: z.string(),
  summary: z.string().nullable().default(null),
  output_file: z.string(),
});

// =============================================================================
// Job Output Message Schema
// =============================================================================

export const OutputMessageTypeSchema = z.enum([
  'system',
  'assistant',
  'tool_use',
  'tool_result',
  'error',
]);

export const OutputMessageSchema = z.object({
  type: OutputMessageTypeSchema,
  timestamp: z.string().datetime(),
  // Additional fields vary by type - use passthrough for flexibility
}).passthrough();

// =============================================================================
// Session Info Schema
// =============================================================================

export const SessionModeSchema = z.enum([
  'fresh_per_job',
  'persistent',
  'per_channel',
]);

export const SessionInfoSchema = z.object({
  agent_name: z.string(),
  session_id: z.string(),
  created_at: z.string().datetime(),
  last_used_at: z.string().datetime(),
  job_count: z.number().int().nonnegative().default(0),
  mode: SessionModeSchema.default('fresh_per_job'),
});
```

### Public API

```typescript
// =============================================================================
// Directory Management
// =============================================================================

export interface StateDirectoryPaths {
  root: string;          // .herdctl/
  stateFile: string;     // .herdctl/state.yaml
  jobsDir: string;       // .herdctl/jobs/
  sessionsDir: string;   // .herdctl/sessions/
  logsDir: string;       // .herdctl/logs/
}

export interface InitStateDirectoryOptions {
  /** Custom path for .herdctl directory (default: CWD/.herdctl) */
  path?: string;
  /** Create directories if they don't exist (default: true) */
  create?: boolean;
}

export async function initStateDirectory(
  options?: InitStateDirectoryOptions
): Promise<StateDirectoryPaths>;

export async function getStateDirectory(
  path?: string
): Promise<StateDirectoryPaths | null>;

// =============================================================================
// Fleet State
// =============================================================================

export async function readFleetState(
  stateDir: StateDirectoryPaths
): Promise<FleetState>;

export async function writeFleetState(
  stateDir: StateDirectoryPaths,
  state: FleetState
): Promise<void>;

export async function updateAgentState(
  stateDir: StateDirectoryPaths,
  agentName: string,
  updates: Partial<AgentState>
): Promise<FleetState>;

export async function getAgentState(
  stateDir: StateDirectoryPaths,
  agentName: string
): Promise<AgentState | null>;

// =============================================================================
// Job Management
// =============================================================================

export interface CreateJobOptions {
  agent: string;
  schedule: string | null;
  trigger_type: TriggerType;
  prompt: string;
  session_id?: string;
  forked_from?: string;
}

export async function createJob(
  stateDir: StateDirectoryPaths,
  options: CreateJobOptions
): Promise<JobMetadata>;

export async function updateJob(
  stateDir: StateDirectoryPaths,
  jobId: string,
  updates: Partial<Omit<JobMetadata, 'id' | 'agent' | 'output_file'>>
): Promise<JobMetadata>;

export async function getJob(
  stateDir: StateDirectoryPaths,
  jobId: string
): Promise<JobMetadata | null>;

export interface ListJobsOptions {
  agent?: string;
  status?: JobStatus | JobStatus[];
  after?: Date;
  before?: Date;
  limit?: number;
  offset?: number;
}

export async function listJobs(
  stateDir: StateDirectoryPaths,
  options?: ListJobsOptions
): Promise<JobMetadata[]>;

export async function deleteJob(
  stateDir: StateDirectoryPaths,
  jobId: string
): Promise<boolean>;

export function generateJobId(): string;

export function getJobMetadataPath(
  stateDir: StateDirectoryPaths,
  jobId: string
): string;

export function getJobOutputPath(
  stateDir: StateDirectoryPaths,
  jobId: string
): string;

// =============================================================================
// Job Output (JSONL)
// =============================================================================

export interface OutputMessage {
  type: OutputMessageType;
  timestamp: string;
  [key: string]: unknown;
}

export async function appendJobOutput(
  stateDir: StateDirectoryPaths,
  jobId: string,
  message: OutputMessage
): Promise<void>;

export async function appendJobOutputBatch(
  stateDir: StateDirectoryPaths,
  jobId: string,
  messages: OutputMessage[]
): Promise<void>;

export async function* readJobOutput(
  stateDir: StateDirectoryPaths,
  jobId: string
): AsyncGenerator<OutputMessage, void, unknown>;

export async function getJobOutputLineCount(
  stateDir: StateDirectoryPaths,
  jobId: string
): Promise<number>;

// =============================================================================
// Session Management
// =============================================================================

export async function getSessionInfo(
  stateDir: StateDirectoryPaths,
  agentName: string
): Promise<SessionInfo | null>;

export async function updateSessionInfo(
  stateDir: StateDirectoryPaths,
  agentName: string,
  info: Partial<SessionInfo>
): Promise<SessionInfo>;

export async function clearSession(
  stateDir: StateDirectoryPaths,
  agentName: string
): Promise<boolean>;

// =============================================================================
// Utility Functions
// =============================================================================

export async function atomicWriteFile(
  filePath: string,
  content: string
): Promise<void>;

export async function atomicWriteYaml(
  filePath: string,
  data: unknown
): Promise<void>;

export async function safeReadYaml<T>(
  filePath: string,
  schema: z.ZodType<T>,
  defaultValue: T
): Promise<T>;

export async function safeReadJsonl<T>(
  filePath: string,
  schema?: z.ZodType<T>
): AsyncGenerator<T, void, unknown>;
```

### Error Handling

```typescript
/**
 * Base error class for state management errors
 */
export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
  }
}

/**
 * Error thrown when state directory cannot be initialized
 */
export class StateDirectoryError extends StateError {
  public readonly path: string;
  
  constructor(path: string, cause?: Error) {
    const message = cause
      ? `Failed to initialize state directory '${path}': ${cause.message}`
      : `Failed to initialize state directory '${path}'`;
    super(message);
    this.name = 'StateDirectoryError';
    this.path = path;
    this.cause = cause;
  }
}

/**
 * Error thrown when a job is not found
 */
export class JobNotFoundError extends StateError {
  public readonly jobId: string;
  
  constructor(jobId: string) {
    super(`Job not found: '${jobId}'`);
    this.name = 'JobNotFoundError';
    this.jobId = jobId;
  }
}

/**
 * Error thrown when state file validation fails
 */
export class StateValidationError extends StateError {
  public readonly filePath: string;
  public readonly issues: Array<{ path: string; message: string }>;
  
  constructor(filePath: string, zodError: z.ZodError) {
    const issues = zodError.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    
    const issueMessages = issues
      .map((i) => `  - ${i.path}: ${i.message}`)
      .join('\n');
    
    super(`State validation failed for '${filePath}':\n${issueMessages}`);
    this.name = 'StateValidationError';
    this.filePath = filePath;
    this.issues = issues;
  }
}

/**
 * Error thrown when atomic write fails
 */
export class AtomicWriteError extends StateError {
  public readonly filePath: string;
  
  constructor(filePath: string, cause?: Error) {
    const message = cause
      ? `Atomic write failed for '${filePath}': ${cause.message}`
      : `Atomic write failed for '${filePath}'`;
    super(message);
    this.name = 'AtomicWriteError';
    this.filePath = filePath;
    this.cause = cause;
  }
}

/**
 * Error thrown when job output validation fails
 */
export class OutputValidationError extends StateError {
  public readonly jobId: string;
  public readonly lineNumber: number;
  
  constructor(jobId: string, lineNumber: number, message: string) {
    super(`Invalid output message for job '${jobId}' at line ${lineNumber}: ${message}`);
    this.name = 'OutputValidationError';
    this.jobId = jobId;
    this.lineNumber = lineNumber;
  }
}
```

### Job ID Generation

```typescript
import { randomBytes } from 'node:crypto';

/**
 * Generate a unique job ID with format: job-YYYY-MM-DD-XXXXXX
 * where XXXXXX is 6 random hex characters
 */
export function generateJobId(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const random = randomBytes(3).toString('hex'); // 6 hex chars
  return `job-${date}-${random}`;
}
```

### Atomic Write Implementation

```typescript
import { writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, basename, join } from 'node:path';

export async function atomicWriteFile(
  filePath: string,
  content: string
): Promise<void> {
  const dir = dirname(filePath);
  const base = basename(filePath);
  const random = randomBytes(4).toString('hex');
  const tempPath = join(dir, `.${base}.tmp.${random}`);
  
  try {
    // Write to temp file
    await writeFile(tempPath, content, 'utf-8');
    
    // Atomic rename
    await rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw new AtomicWriteError(filePath, error instanceof Error ? error : undefined);
  }
}
```

## Test Plan

### Unit Tests

```typescript
// packages/core/src/state/__tests__/

// schemas.test.ts
describe('FleetStateSchema', () => {
  it('validates minimal fleet state');
  it('validates fleet state with agents');
  it('applies defaults for missing fields');
  it('rejects invalid agent status');
  it('validates ISO datetime strings');
});

describe('JobMetadataSchema', () => {
  it('validates complete job metadata');
  it('validates all trigger types');
  it('validates all job statuses');
  it('validates all exit reasons');
  it('rejects invalid job ID format');
});

describe('SessionInfoSchema', () => {
  it('validates complete session info');
  it('validates all session modes');
  it('applies default job_count of 0');
});

// directory.test.ts
describe('initStateDirectory', () => {
  it('creates .herdctl directory structure');
  it('creates subdirectories (jobs, sessions, logs)');
  it('initializes empty state.yaml');
  it('returns paths object');
  it('handles existing directory (no-op)');
  it('respects custom path option');
  it('throws StateDirectoryError on permission denied');
});

describe('getStateDirectory', () => {
  it('returns paths for existing directory');
  it('returns null for non-existent directory');
});

// fleet-state.test.ts
describe('readFleetState', () => {
  it('reads and validates state.yaml');
  it('returns default state for missing file');
  it('returns default state for empty file');
  it('returns default state for corrupted file');
  it('preserves existing agent states');
});

describe('writeFleetState', () => {
  it('writes state.yaml atomically');
  it('validates state before writing');
  it('creates file if missing');
});

describe('updateAgentState', () => {
  it('updates single agent state');
  it('creates agent entry if missing');
  it('merges partial updates');
  it('preserves other agents');
  it('returns updated fleet state');
});

// jobs.test.ts
describe('createJob', () => {
  it('creates job metadata file');
  it('generates unique job ID');
  it('sets initial status to pending');
  it('creates output file reference');
  it('validates required fields');
});

describe('updateJob', () => {
  it('updates job metadata atomically');
  it('calculates duration_seconds on finish');
  it('throws JobNotFoundError for missing job');
  it('prevents modification of id and agent');
});

describe('getJob', () => {
  it('returns job metadata');
  it('returns null for missing job');
  it('validates schema on read');
});

describe('listJobs', () => {
  it('lists all jobs');
  it('filters by agent');
  it('filters by status');
  it('filters by date range');
  it('supports pagination (limit, offset)');
  it('sorts by started_at descending');
});

describe('generateJobId', () => {
  it('returns format job-YYYY-MM-DD-XXXXXX');
  it('generates unique IDs');
  it('uses current date');
});

// output.test.ts
describe('appendJobOutput', () => {
  it('appends JSON line to output file');
  it('creates file if missing');
  it('validates message structure');
  it('adds newline after each message');
});

describe('appendJobOutputBatch', () => {
  it('appends multiple messages efficiently');
  it('validates all messages before writing');
});

describe('readJobOutput', () => {
  it('yields parsed messages');
  it('handles empty file');
  it('skips invalid lines with warning');
  it('handles incomplete last line');
});

// sessions.test.ts
describe('getSessionInfo', () => {
  it('returns session info');
  it('returns null for missing session');
});

describe('updateSessionInfo', () => {
  it('creates session file if missing');
  it('updates existing session');
  it('increments job_count');
  it('updates last_used_at');
});

describe('clearSession', () => {
  it('deletes session file');
  it('returns true on success');
  it('returns false if not found');
});

// utils/atomic.test.ts
describe('atomicWriteFile', () => {
  it('writes file atomically');
  it('cleans up temp file on success');
  it('cleans up temp file on failure');
  it('throws AtomicWriteError on failure');
});

describe('atomicWriteYaml', () => {
  it('serializes and writes YAML');
  it('uses atomic write internally');
});

// utils/safe-read.test.ts
describe('safeReadYaml', () => {
  it('reads and validates YAML');
  it('returns default for missing file');
  it('returns default for corrupted file');
  it('retries on EBUSY error');
});

describe('safeReadJsonl', () => {
  it('yields valid JSON objects');
  it('skips invalid lines');
  it('handles partial last line');
});
```

### Integration Tests

```typescript
// Uses temp directories for full workflow testing
describe('State Integration', () => {
  it('full workflow: init → create job → update → append output → read');
  it('concurrent reads during write operations');
  it('recovery after simulated crash (temp file left behind)');
  it('handles rapid successive updates');
});
```

## Dependencies

From existing `package.json`:
- `yaml` (^2.3.0) - YAML serialization
- `zod` (^3.22.0) - Schema validation
- `vitest` (^1) - Testing

No additional dependencies needed. Uses Node.js built-ins:
- `node:fs/promises` - File operations
- `node:path` - Path manipulation
- `node:crypto` - Random ID generation
- `node:readline` - Line-by-line JSONL reading

## Out of Scope

- File locking for writes (atomic rename provides sufficient safety)
- Database backend option
- State compression or archiving
- Remote state synchronization
- State encryption
- Job output truncation/rotation
- Real-time file watching

## Quality Gates

These commands must pass for every user story:
- `pnpm typecheck` - Type checking passes in packages/core
- `pnpm test` - Tests pass with >90% coverage of state module

## Acceptance Criteria Summary

1. `pnpm typecheck` passes in packages/core
2. `pnpm test` passes with >90% coverage of state module
3. Can initialize `.herdctl/` directory structure with all subdirectories
4. Can read/write `state.yaml` with fleet and agent state
5. Can create, update, get, and list jobs with proper metadata
6. Can append and read JSONL output logs for jobs
7. All YAML writes are atomic (write temp + rename)
8. Handles missing/corrupted files gracefully (returns defaults)
9. Clear error messages for: permission denied, validation failures
10. Types are exported and usable by other packages

## Integration Points

This module will be used by:
- **Scheduler** (PRD 5) - Track `next_trigger_at` per agent
- **Runner** (PRD 3) - Create/update jobs, append output logs
- **CLI** (PRD 6) - Display status, list jobs, view logs
- **Web UI** (future) - Real-time state display

## Dependencies

This PRD depends on:
- **herdctl-core-config** (PRD 1) - Uses config types for agent names