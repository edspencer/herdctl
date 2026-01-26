# Hello World Example

The simplest herdctl agent - just responds to greetings.

## Quick Start

```bash
cd examples/hello-world

# Trigger without a prompt (uses default_prompt from config)
../../packages/cli/bin/herdctl.js trigger hello-world

# Trigger with a custom greeting
../../packages/cli/bin/herdctl.js trigger hello-world --prompt "Hi, I'm Alice!"

# Suppress output (just show job info)
../../packages/cli/bin/herdctl.js trigger hello-world --quiet
```

## What This Example Demonstrates

- Minimal agent configuration
- No tools required (pure conversation)
- Custom system prompt
- Using `default_prompt` for when triggered without `--prompt`
- Using `max_turns` to limit agent behavior
- Default output display in CLI (truncated at 20,000 characters)
