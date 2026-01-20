# PRD: herdctl-core-cron

## Overview

Add cron expression support to the herdctl scheduler module alongside existing interval-based scheduling. This enables users to trigger agents at specific times (e.g., "every day at 9am", "weekdays at 9:30am") using standard cron syntax.

## Background

The herdctl scheduler (`packages/core/src/scheduler/`) currently supports interval-based scheduling (e.g., "5m", "1h"). The config schema already defines cron as a valid schedule type with an `expression` field, but the scheduler skips cron schedules with reason `"not_interval"`.

This enhancement implements the cron execution path to complete the scheduling feature set.

## Goals

- Enable precise time-based agent scheduling using standard cron expressions
- Maintain full backward compatibility with interval schedules
- Provide clear validation errors for misconfigured cron expressions
- Follow existing patterns in the scheduler module for consistency

## Non-Goals

- 6-field cron expressions (seconds precision)
- Per-schedule timezone configuration
- Jitter support for cron (future enhancement)
- Catch-up execution for missed schedules
- Cron expression builder UI

---

## User Stories

### US-1: Parse Cron Expressions

**As a** developer configuring agents  
**I want** to use standard cron expressions in my schedule config  
**So that** I can trigger agents at specific times

**Acceptance Criteria:**
- [ ] New `cron.ts` module alongside `interval.ts`
- [ ] `parseCronExpression(expression: string)` function using `cron-parser` library
- [ ] Support standard 5-field cron: `minute hour day-of-month month day-of-week`
- [ ] Support common shorthands: `@daily`, `@hourly`, `@weekly`, `@monthly`, `@yearly`
- [ ] Throws `CronParseError` for invalid expressions

**Example Config:**
```yaml
schedules:
  daily-report:
    type: cron
    expression: "0 9 * * *"  # Every day at 9:00 AM
    prompt: "Generate the daily report"

  weekday-standup:
    type: cron
    expression: "30 9 * * 1-5"  # Weekdays at 9:30 AM
    prompt: "Post standup summary"

  hourly-check:
    type: cron
    expression: "@hourly"
    prompt: "Check system status"
```

---

### US-2: Calculate Next Cron Trigger

**As a** scheduler  
**I want** to calculate when a cron schedule should next trigger  
**So that** agents run at the correct times

**Acceptance Criteria:**
- [ ] `calculateNextCronTrigger(expression: string, after?: Date): Date` function
- [ ] Returns next occurrence after the given date (defaults to now)
- [ ] Uses system timezone (consistent with interval behavior)
- [ ] Handles edge cases: month boundaries, leap years, DST transitions

**Test Cases:**
```typescript
// Daily at 9:00 AM
const expr = "0 9 * * *";
const morning = new Date("2024-01-15T08:00:00");
calculateNextCronTrigger(expr, morning)  // → 2024-01-15T09:00:00

const afterRun = new Date("2024-01-15T09:00:00");
calculateNextCronTrigger(expr, afterRun)  // → 2024-01-16T09:00:00

// Every 15 minutes
const frequent = "*/15 * * * *";
const midHour = new Date("2024-01-15T10:07:00");
calculateNextCronTrigger(frequent, midHour)  // → 2024-01-15T10:15:00
```

---

### US-3: Integrate Cron into Scheduler

**As a** scheduler  
**I want** to handle both interval and cron schedules  
**So that** users can choose the scheduling method that fits their needs

**Acceptance Criteria:**
- [ ] Update `schedule-runner.ts` to check `schedule.type`
- [ ] Route to `calculateNextCronTrigger()` when `type === "cron"`
- [ ] Route to existing `calculateNextTrigger()` when `type === "interval"`
- [ ] Update `ScheduleSkipReason` type: replace `"not_interval"` with `"unsupported_type"`
- [ ] Skip `webhook` and `chat` types with `"unsupported_type"` reason
- [ ] No catch-up for missed cron triggers - skip to next scheduled time

**Behavior on Missed Schedule:**
If the system was down when a cron trigger should have fired, the scheduler calculates the next future occurrence from the current time, not from the missed time.

---

### US-4: Validate Cron Expressions

**As a** user writing config  
**I want** clear error messages for invalid cron expressions  
**So that** I can fix configuration mistakes

**Acceptance Criteria:**
- [ ] `CronParseError` class in `errors.ts` extending `FleetManagerError`
- [ ] Validation at config load time (fail fast)
- [ ] Additional validation when scheduler starts (defense in depth)
- [ ] Error messages include what's wrong and a valid example

**Example Errors:**
```
CronParseError: Invalid cron expression "0 25 * * *" - hour must be 0-23
  Example valid expression: "0 9 * * *" (daily at 9:00 AM)

CronParseError: Invalid cron expression "* * *" - expected 5 fields, got 3
  Example valid expression: "* * * * *" (every minute)

CronParseError: Invalid cron expression "0 9 * * 8" - day-of-week must be 0-7
  Example valid expression: "0 9 * * 1-5" (weekdays at 9:00 AM)
```

---

### US-5: Update Documentation

**As a** user learning herdctl  
**I want** documentation on cron scheduling  
**So that** I understand how to configure time-based triggers

**Acceptance Criteria:**
- [ ] Update `docs/src/content/docs/configuration/agent-config.mdx`
- [ ] Add cron schedule examples
- [ ] Explain cron vs interval use cases
- [ ] Document supported cron shorthands

**Documentation Content:**
```markdown
### Cron Schedules

Use cron expressions for precise time-based scheduling:

| Expression | Description |
|------------|-------------|
| `0 9 * * *` | Daily at 9:00 AM |
| `30 9 * * 1-5` | Weekdays at 9:30 AM |
| `0 */2 * * *` | Every 2 hours |
| `0 0 1 * *` | First day of each month |

Supported shorthands: `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`

**When to use cron vs interval:**
- **Cron**: Specific times matter (daily reports, business hours)
- **Interval**: Regular frequency matters (health checks, polling)
```

---

## Technical Design

### File Changes

**New Files:**
| File | Purpose |
|------|---------|
| `packages/core/src/scheduler/cron.ts` | Cron parsing and next trigger calculation |
| `packages/core/src/scheduler/__tests__/cron.test.ts` | Cron module tests |

**Modified Files:**
| File | Changes |
|------|---------|
| `packages/core/src/scheduler/errors.ts` | Add `CronParseError` class |
| `packages/core/src/scheduler/schedule-runner.ts` | Handle cron type routing |
| `packages/core/src/scheduler/types.ts` | Update `ScheduleSkipReason` |
| `packages/core/src/scheduler/index.ts` | Export cron functions |
| `packages/core/package.json` | Add `cron-parser` dependency |
| `docs/src/content/docs/configuration/agent-config.mdx` | Add cron examples |

### Dependencies

```json
{
  "dependencies": {
    "cron-parser": "^4.9.0"
  }
}
```

### Module Structure

```typescript
// cron.ts
import { parseExpression, CronExpression } from 'cron-parser';

export function parseCronExpression(expression: string): CronExpression;
export function calculateNextCronTrigger(expression: string, after?: Date): Date;
export function isValidCronExpression(expression: string): boolean;
```

---

## Quality Gates

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes with coverage thresholds (85% lines/functions/statements, 65% branches)
- [ ] All cron parsing edge cases tested
- [ ] Invalid expression error messages tested
- [ ] Integration test: cron schedule triggers at correct time
- [ ] Documentation builds successfully (`pnpm build` in docs/)

---

## Test Plan

### Unit Tests (cron.test.ts)

**Parsing:**
- Valid 5-field expressions
- Shorthand expressions (@daily, @hourly, etc.)
- Invalid expressions (wrong field count, out of range values)
- Edge cases (*/n syntax, ranges, lists)

**Next Trigger Calculation:**
- Same-day future trigger
- Next-day rollover
- Month boundary crossing
- Year boundary crossing
- Specific day-of-week calculations

**Error Messages:**
- Include invalid input in error
- Include helpful example in error
- Proper error type discrimination

### Integration Tests

- Scheduler correctly routes cron vs interval
- Cron schedule state persists correctly
- Missed schedules skip to next occurrence (no catch-up)

---

## Constraints

- Use `cron-parser` library - no custom cron parsing
- 5-field cron only (minute, hour, day-of-month, month, day-of-week)
- System timezone only (no per-schedule timezone)
- No jitter for cron schedules (can be added later)
- Maintain backward compatibility with all existing interval schedules

---

## Future Enhancements (Out of Scope)

- Jitter support for cron schedules
- Per-schedule timezone configuration
- 6-field cron (seconds)
- Cron expression builder in web UI
- Catch-up execution for missed schedules