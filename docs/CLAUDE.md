# docs/CLAUDE.md

Astro + Starlight documentation site. Deploys to herdctl.dev via Cloudflare Pages.

## Build & Preview

Run `pnpm build && pnpm preview` to see the site with Mermaid diagrams rendered.
Never rely on `pnpm dev` (`astro dev`) for visual verification — Mermaid diagrams do not render in dev mode.

## Content

Write all documentation pages as `.md` or `.mdx` files in `src/content/docs/`.
Use Mermaid code blocks for inline diagrams. Mermaid is configured via `rehype-mermaid` with client-side rendering.

## Sidebar

Manage the sidebar manually in `astro.config.mjs` under the `sidebar` array. Add new pages there explicitly — Starlight does not auto-discover content.

## Landing Page

Custom landing page components live in `src/components/landing/`. These use raw Tailwind and Inter font — they do NOT use `herd-*` design tokens from the web dashboard. Do not confuse these with `packages/web/` conventions.

## D2 Diagrams

D2 source files live in `docs/d2/`. Read `.claude/rules/diagrams.md` for the full D2 workflow, render commands, and the project color palette. Always use `--pad=20` when rendering.

## Redirects

Define URL redirects in `astro.config.mjs` under `redirects`. Update these when moving or renaming pages.

## Analytics

PostHog analytics are proxied through Cloudflare. Configuration is inline in `astro.config.mjs` head scripts.
