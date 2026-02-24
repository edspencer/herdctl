---
globs: packages/web/**
---

# Web UI Design System

**When working on `packages/web/` (the @herdctl/web dashboard), you MUST read and follow `packages/web/DESIGN_SYSTEM.md` before writing any UI code.**

This design system defines colors, typography, spacing, component patterns, animation, and dark mode implementation. Every UI component must use `herd-*` color tokens (never raw hex values), follow the canonical component patterns, and pass the checklist at the bottom of the document.

Do not improvise visual design. Do not use default Tailwind colors. Do not use Inter/Roboto/Arial. The design system is the single source of truth for how the web app looks.
