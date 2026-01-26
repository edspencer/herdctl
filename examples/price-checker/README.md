# Price Checker Example

This example demonstrates a **price monitoring agent** that tracks product prices across multiple retailers and maintains a price history.

## Features

- **Multi-retailer monitoring** - checks prices across B&H, Adorama, Amazon, KEH
- **Persistent memory** via `context.md` - tracks price history across runs
- **Target price alerts** - reports when prices drop below threshold
- **Scheduled checks** every 4 hours
- **Configurable via system prompt** - easy to customize for any product

## Quick Start

### 1. Clone and Build

```bash
git clone https://github.com/edspencer/herdctl.git
cd herdctl
pnpm install
pnpm build
```

### 2. Set Your API Key

```bash
export ANTHROPIC_API_KEY="sk-ant-your-key-here"
```

### 3. Run the Price Check

```bash
cd examples/price-checker

# Run a price check
../../packages/cli/bin/herdctl.js trigger price-checker
```

### 4. Check the Context File

After running, the agent creates `context.md` with its findings:

```bash
cat context.md
```

## Customizing for Your Product

The product configuration lives in the **system prompt** of `agents/price-checker.yaml`. Edit these sections:

```yaml
system_prompt: |
  ## Your Configured Product

  **Product**: [Your Product Name]
  **Target Price**: $XXX or lower
  **Retailers to Check**:
  - retailer1.com
  - retailer2.com
```

### Examples

**Gaming Console:**
```yaml
**Product**: PlayStation 5 Slim
**Target Price**: $399 or lower
**Retailers to Check**:
- Best Buy (bestbuy.com)
- Walmart (walmart.com)
- GameStop (gamestop.com)
- Amazon (amazon.com)
```

**Bicycle:**
```yaml
**Product**: Canyon Aeroad CF SL 8 (Size M)
**Target Price**: $3,499 or lower
**Retailers to Check**:
- Canyon (canyon.com)
- Competitive Cyclist (competitivecyclist.com)
```

**Used Camera Lens:**
```yaml
**Product**: Sony 24-70mm f/2.8 GM II
**Target Price**: $1,800 or lower (used excellent condition)
**Retailers to Check**:
- KEH Camera (keh.com)
- MPB (mpb.com)
- UsedPhotoPro (usedphotopro.com)
```

## How It Works

1. **Agent reads context.md** (if it exists) to get history
2. **Searches each retailer** using WebSearch and WebFetch
3. **Compares prices** against target threshold
4. **Updates context.md** with new data
5. **Reports findings** - current best price, deal alerts

## Context File Structure

The agent maintains `context.md` with:

```markdown
# Price Checker Context

## Product Configuration
- **Product**: Fujifilm X-T5 (Body Only, Black)
- **Target Price**: $1,499
- **Retailers**: B&H, Adorama, Amazon, KEH

## Current Best Deal
- **Price**: $1,599 at B&H Photo
- **Status**: Above target (need $100 more discount)

## Price History
| Date | B&H | Adorama | Amazon | KEH (Used) | Notes |
|------|-----|---------|--------|------------|-------|
| 2026-01-26 | $1,599 | $1,699 | $1,649 | $1,399 (Exc) | KEH has best used price |
| 2026-01-25 | $1,699 | $1,699 | $1,699 | $1,449 (Exc) | All at MSRP |
```

## Notification Hooks

### Shell Hook (enabled by default)

Prints the agent's summary:

```yaml
hooks:
  after_run:
    - type: shell
      command: "jq -r '.result.output'"
```

### Discord Notifications

Get alerts in Discord when deals are found:

1. Create a Discord bot at https://discord.com/developers/applications
2. Set environment variables:
   ```bash
   export DISCORD_BOT_TOKEN="your-bot-token"
   export DISCORD_CHANNEL_ID="your-channel-id"
   ```
3. Uncomment the Discord hook in `agents/price-checker.yaml`

### Webhook Notifications

POST to any URL when the agent completes:

```yaml
hooks:
  after_run:
    - type: webhook
      url: "https://your-server.com/price-alert"
```

## Running on a Schedule

To run price checks every 4 hours automatically:

```bash
../../packages/cli/bin/herdctl.js start
```

The schedule is defined in the agent config:

```yaml
schedules:
  check:
    type: interval
    interval: 4h
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `DISCORD_BOT_TOKEN` | For Discord | Discord bot token |
| `DISCORD_CHANNEL_ID` | For Discord | Discord channel ID |
| `WEBHOOK_TOKEN` | For webhook | Auth token for webhook endpoint |

## Tips

- **Used gear sites** like KEH, MPB often have better prices - include them
- **Set realistic targets** - check historical prices on camelcamelcamel.com first
- **Add condition notes** for used gear (Excellent, Good, etc.)
- **Multiple products** - create separate agent configs for each item you're tracking
