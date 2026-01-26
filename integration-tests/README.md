# Integration Tests

End-to-end tests that verify herdctl works correctly with the real Claude SDK.

## Purpose

Unit tests mock the Claude SDK, which means they can't catch:
- SDK API changes
- Real agent execution issues
- Message format mismatches
- Actual job completion flows

These integration tests run against the **real SDK** to verify the system works.

## Prerequisites

1. **API Key**: Get one from [Anthropic Console](https://console.anthropic.com/dashboard)
2. Run `pnpm build` first to ensure CLI is up to date

### Setting Up Your API Key

**Option 1: .env file (recommended for local development)**

```bash
cp integration-tests/.env.example integration-tests/.env
# Edit .env and add your key
```

**Option 2: Environment variable**

```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
```

The `.env` file is gitignored, so your key stays local.

## Running Tests

```bash
# Run all integration tests
./integration-tests/run.sh

# Run a specific scenario
./integration-tests/run.sh scenarios/hello-world

# Run with verbose output
DEBUG=1 ./integration-tests/run.sh
```

## Creating Scenarios

Each scenario is a directory under `scenarios/` containing:

```
scenarios/my-scenario/
├── herdctl.yaml          # Fleet configuration
├── agents/               # Agent definitions (optional if inline)
│   └── my-agent.yaml
├── test.sh               # Test script (must be executable)
└── README.md             # Description of what this tests
```

The `test.sh` script should:
1. Use the harness library functions
2. Trigger agents and verify output
3. Exit 0 on success, non-zero on failure

## Harness Library

Source `integration-tests/lib/harness.sh` for common functions:

```bash
source "$(dirname "$0")/../lib/harness.sh"

# Initialize a test scenario
init_scenario "my-scenario"

# Trigger an agent and wait for completion
trigger_and_wait "my-agent"

# Check job output contains expected text
assert_output_contains "my-agent" "expected text"

# Cleanup
cleanup_scenario
```

## Cost Considerations

These tests make real API calls. To minimize costs:
- Keep prompts short and focused
- Use scenarios that complete quickly
- Don't run in CI on every commit (use manual triggers or nightly builds)
