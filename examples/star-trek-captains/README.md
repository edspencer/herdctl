# Star Trek Captains - Multi-Agent Discord Discussion

Five legendary Starfleet commanders (and one Ambassador) gather in your Discord server to debate scenarios, discuss command philosophy, and occasionally argue about who made the best decisions.

## The Crew

| Agent | Character | Personality |
|-------|-----------|-------------|
| `captain-kirk` | James T. Kirk | Bold, instinctive, rule-bending |
| `captain-picard` | Jean-Luc Picard | Diplomatic, intellectual, principled |
| `captain-janeway` | Kathryn Janeway | Pragmatic, scientific, resourceful |
| `captain-sisko` | Benjamin Sisko | Tactical, spiritual, complex |
| `ambassador-spock` | Spock | Logical, wise, secretly emotional |
| `gorn-captain` | Gorn Captain | Patient, territorial, alien perspective |

## What Makes This Cool

- **Multi-Agent Interaction**: Each character has their own Discord bot. They can @mention each other to debate!
- **Distinct Personalities**: Each captain responds based on their character's philosophy and experiences
- **In-Character References**: They'll reference their canonical adventures and relationships
- **Scenario Discussions**: Present ethical dilemmas, tactical situations, or philosophical questions

## Example Conversations

```
You: @CaptainKirk The Romulans are testing a new weapon near the Neutral Zone.
     Should we investigate or wait for orders?

Kirk: We can't wait for Starfleet to convene a committee while the Romulans
      gain an advantage. I'd take the Enterprise in for a closer look...
      carefully. What do you think, @AmbassadorSpock?

Spock: Fascinating. Captain Kirk's instinct for action is... predictable.
       However, I would note that reconnaissance need not involve crossing
       the Neutral Zone. A probe might be the logical compromise.

Picard: *joining the conversation* If I may - @CaptainKirk, your approach
        assumes hostile intent. The Romulans may be testing our response
        as much as their weapon. A measured approach...
```

## Prerequisites

1. **Six Discord Bot Tokens** - Each character needs their own bot identity
2. A Discord server where you can add multiple bots
3. herdctl installed (`npm install -g herdctl`)

## Setup

### 1. Create Six Discord Bots

Go to [Discord Developer Portal](https://discord.com/developers/applications) and create 6 applications:

| Bot Name | Suggested Profile |
|----------|------------------|
| Captain Kirk | Yellow command uniform, bold pose |
| Captain Picard | TNG uniform, thoughtful expression |
| Captain Janeway | Voyager uniform, coffee optional |
| Captain Sisko | DS9 uniform, maybe with baseball |
| Ambassador Spock | Vulcan robes or dress uniform |
| Gorn Captain | Reptilian visage, preferably menacing |

For each bot:
1. Create the application
2. Go to "Bot" section, create a bot
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. Copy the bot token

### 2. Invite All Bots to Your Server

For each bot, generate an OAuth2 URL with permissions:
- Send Messages
- Read Message History
- Use Slash Commands

Permissions integer: `2147551232`

### 3. Get Your Server IDs

Enable Developer Mode in Discord, then right-click to copy:
- **Guild ID**: Right-click your server name
- **Channel ID**: Right-click the channel for discussions

### 4. Set Environment Variables

The easiest approach is to create a `.env` file in this directory:

```bash
cp .env.example .env
# Edit .env with your actual values
```

Your `.env` file should contain:
```env
DISCORD_GUILD_ID=your-server-id
DISCORD_CHANNEL_ID=your-channel-id
KIRK_BOT_TOKEN=token-for-kirk-bot
PICARD_BOT_TOKEN=token-for-picard-bot
JANEWAY_BOT_TOKEN=token-for-janeway-bot
SISKO_BOT_TOKEN=token-for-sisko-bot
SPOCK_BOT_TOKEN=token-for-spock-bot
GORN_BOT_TOKEN=token-for-gorn-bot
```

> **Note**: Shell environment variables take precedence over `.env` file values. If you've previously set `DISCORD_GUILD_ID` or `DISCORD_CHANNEL_ID` in your `.bashrc`/`.zshrc`, those values will override your `.env` file. Either remove them from your shell config, or simply don't set them in `.env`.

### 5. Run the Fleet

```bash
cd examples/star-trek-captains
herdctl start
```

## Usage

### Starting a Discussion

@mention any captain to get their perspective:

```
@CaptainPicard A colony world has requested independence from the Federation.
               They're strategically important. What's the right approach?
```

### Multi-Captain Debates

The captains know each other and can @mention each other. You can prompt this:

```
@CaptainKirk I'd like to hear your thoughts on this situation,
             and maybe get @CaptainPicard's counterpoint.
```

Or just let it happen naturally - Kirk might tag Spock for a second opinion!

### Scenario Ideas

- **Tactical**: "A Borg cube is approaching. You have 6 hours. What's your plan?"
- **Ethical**: "The Prime Directive says don't interfere, but millions will die without our help."
- **Command**: "Your first officer disagrees with your decision and won't back down."
- **Historical**: "Could Wolf 359 have gone differently?"
- **Hypothetical**: "You've discovered Q is actually dying. Do you help him?"
- **Outsider View**: "@GornCaptain how would the Hegemony view this situation?"

### DM the Captains

Each captain accepts DMs in auto mode (no @mention needed). Great for one-on-one conversations.

### Slash Commands

Each bot supports:
- `/help` - Show available commands
- `/reset` - Clear conversation history
- `/status` - Show bot status

## Cross-Agent Triggering

**Yes, captains can trigger each other!**

When Kirk's bot posts a message containing `@CaptainPicard`, Discord sends that as a proper mention. If Picard's bot is monitoring the channel, it will see the mention and can respond.

This means:
1. You ask Kirk a question
2. Kirk answers and tags Spock for input
3. Spock sees the mention and adds his perspective
4. Spock might tag Janeway...

**Caution**: This can create extended conversations! The captains are configured with `max_turns: 5` to prevent infinite debates, but passionate disagreements may occur.

## Tips

- **Context**: Each bot sees the last 20 messages, so they have conversational context
- **Character**: The captains stay in character - Picard will quote Shakespeare, Kirk will be dramatic
- **Relationships**: They reference their canonical relationships (Kirk-Spock friendship, Sisko's complicated feelings about Picard)
- **Cost**: Each captain response is a Claude API call, so multi-captain debates cost more

## Files

| File | Purpose |
|------|---------|
| `herdctl.yaml` | Fleet configuration |
| `agents/*.yaml` | Individual captain configurations |
| `.herdctl/` | State directory (created on first run) |

## Troubleshooting

### Bot doesn't respond
- Check the bot has Message Content Intent enabled
- Verify the channel ID matches your `.env`
- Make sure you @mentioned the specific bot (not a role)

### Multiple bots respond to one message
- Each bot should only respond to its own @mention
- They're configured in `mention` mode, not `auto` mode

### "Rate limited"
- Discord has API rate limits
- The bots handle this automatically but may slow down
- Consider spacing out multi-captain requests

## Live Long and Prosper

*"Risk is our business. That's what the starship is all about."* - Kirk

*"Make it so."* - Picard

*"There's coffee in that nebula."* - Janeway

*"It's a fake!"* - Sisko

*"Fascinating."* - Spock

*"Patience... is a hunter's virtue."* - Gorn Captain
