# Diagram Color Palette

Colors are derived from the herdctl logo blue (`#326CE5`). All diagrams use these colors consistently.

## Primary colors — for containers and structural hierarchy

| Role | Fill | Stroke | Text | Usage |
|------|------|--------|------|-------|
| Top-level container | `#1e3a5f` | `#142842` | `#ffffff` | Super fleets, outermost containers |
| Major components | `#326CE5` | `#2857b8` | `#ffffff` | Sub-fleets, core modules (logo blue) |
| Secondary groupings | `#2a9d8f` | `#21867a` | `#ffffff` | Team groups, processing components |

## Secondary colors — for leaf nodes, agents, and individual elements

Each agent should get its own distinct color to aid visual identification. For non-agent diagrams, pick from this set for variety.

| Name | Fill | Stroke | Text |
|------|------|--------|------|
| White | `#f8fafc` | `#cbd5e1` | `#1e293b` |
| Slate | `#94a3b8` | `#64748b` | `#0f172a` |
| Light blue | `#93c5fd` | `#60a5fa` | `#1e293b` |
| Sky | `#38bdf8` | `#0ea5e9` | `#0c4a6e` |
| Peach | `#fdba74` | `#f59e0b` | `#451a03` |
| Amber | `#fbbf24` | `#d97706` | `#451a03` |
| Coral | `#f87171` | `#ef4444` | `#ffffff` |
| Rose | `#fda4af` | `#fb7185` | `#4c0519` |
| Lavender | `#c4b5fd` | `#a78bfa` | `#2e1065` |
| Mint | `#6ee7b7` | `#34d399` | `#064e3b` |
| Sand | `#d6d3d1` | `#a8a29e` | `#1c1917` |
| Warm gray | `#78716c` | `#57534e` | `#ffffff` |
| Cyan | `#22d3ee` | `#06b6d4` | `#083344` |
| Lime | `#a3e635` | `#84cc16` | `#1a2e05` |
| Orange | `#fb923c` | `#f97316` | `#431407` |
| Steel | `#475569` | `#334155` | `#ffffff` |

## Guidelines

- In agent diagrams, give each agent a unique secondary color so they're visually distinct.
- In non-agent diagrams (architecture, flows, state machines), pick secondary colors for variety and contrast rather than using a single color for all leaf nodes.
- Text color varies per secondary color (some are light-on-dark, some dark-on-light) — always use the text color from the table above.
