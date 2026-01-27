---
"@herdctl/core": minor
---

Add .env file support for environment variable loading

The config loader now automatically loads `.env` files from the config directory before interpolating environment variables. This makes it easier to manage environment-specific configuration without setting up shell environment variables.

Features:
- Automatically loads `.env` from the same directory as `herdctl.yaml`
- System environment variables take precedence over `.env` values
- New `envFile` option in `loadConfig()` to customize behavior:
  - `true` (default): Auto-load `.env` from config directory
  - `false`: Disable `.env` loading
  - `string`: Specify a custom path to the `.env` file

Example `.env.example` file added to the discord-chat-bot example.
