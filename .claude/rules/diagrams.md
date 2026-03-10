---
globs: docs/**
---

# Diagrams

We use two diagramming tools at different quality tiers.

## Mermaid

For inline diagrams in documentation pages. Rendered at build time via `rehype-mermaid` (configured in `docs/astro.config.mjs` with `img-svg` strategy and dark mode). Use standard ` ```mermaid ` code blocks in markdown. Good for flowcharts, sequence diagrams, and simple architecture diagrams.

Note: Mermaid diagrams don't render in `astro dev` mode — use `pnpm dev` (which runs `astro build && astro preview`) to see them.

## D2

For high-quality, professional diagrams where Mermaid's rendering isn't good enough (complex hierarchies, nested containers, landing page hero diagrams).

### D2 Workflow

Prerequisites: `brew install d2`

1. Source files live in `docs/d2-spike/` (`.d2` extension)
2. Render to SVG and PNG:
   ```bash
   cd docs/d2-spike
   d2 --pad=20 my-diagram.d2 my-diagram.svg
   d2 --pad=20 my-diagram.d2 my-diagram.png
   ```
3. Always use `--pad=20` for tight, professional framing (default padding is too generous)
4. Embed the rendered SVG/PNG in docs pages via `<img>` tags or markdown image syntax

### Reference Implementation

See `docs/d2-spike/fleet-composition-subteams.d2` for the canonical example using the full palette with individually-colored agents.

## Diagram Color Palette

See `docs/diagram-color-palette.md` for the full color palette. Use herdctl brand colors consistently in all diagrams.
