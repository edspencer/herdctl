# Contributing to herdctl

Contributions are welcome. Whether it's a bug fix, new feature, documentation improvement, or test coverage, we appreciate the help.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/) (used for workspace management)

## Development Setup

```bash
# Clone the repo
git clone https://github.com/edspencer/herdctl
cd herdctl

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## Project Structure

The repository is a pnpm monorepo with packages under `packages/`:

- `packages/core/` — `@herdctl/core` (fleet management library)
- `packages/cli/` — `herdctl` (CLI)
- `packages/web/` — `@herdctl/web` (web dashboard)
- `packages/chat/` — `@herdctl/chat` (shared chat infrastructure)
- `packages/discord/` — `@herdctl/discord` (Discord connector)
- `packages/slack/` — `@herdctl/slack` (Slack connector)
- `docs/` — documentation site (Astro/Starlight)

## Changesets

Every change to a published package requires a changeset. Without one, the release pipeline will not publish new versions.

After making changes to any package under `packages/`:

```bash
pnpm changeset
```

Select the affected packages, the semver bump type (`patch`, `minor`, or `major`), and write a short description. Commit the generated `.changeset/*.md` file along with your code.

## Quality Gates

All of the following must pass before a PR can be merged:

- `pnpm typecheck` — no TypeScript errors
- `pnpm test` — tests pass with coverage thresholds met
- `pnpm build` — all packages build successfully

## Submitting Changes

1. Fork the repository and create a feature branch.
2. Make your changes and add a changeset if applicable.
3. Ensure all quality gates pass locally.
4. Open a pull request with a clear description of the change.

For large changes or new features, please open an issue or start a [GitHub Discussion](https://github.com/edspencer/herdctl/discussions) first so we can align on the approach before you invest significant effort.

## Community

- [Discord](https://discord.gg/d2eXZKtNrh) — chat with the community
- [GitHub Discussions](https://github.com/edspencer/herdctl/discussions) — ask questions, share ideas
