# @herdctl/web Design System

> **Purpose**: This document defines the visual language for the herdctl web dashboard. Every sub-agent session that touches UI code MUST read this file first and follow it precisely. This ensures visual consistency across all implementation phases.
>
> **What this is NOT**: This is not a feature spec or implementation plan. It describes *how the UI looks and feels*, not *what it does*.

---

## Design Philosophy

herdctl's web dashboard is a **professional developer tool with warmth**. It should feel like a well-crafted instrument — precise and functional, but not cold or clinical.

### Core Principles

1. **Warm, not cold.** Use warm neutrals (cream, stone, sand) instead of the typical cool gray developer tool palette. The UI should feel inviting, not sterile.
2. **Calm, not flashy.** Muted earth-tone accents instead of saturated primaries. The dashboard monitors long-running processes — it should feel settled and reliable, not anxious or attention-grabbing.
3. **Dense, not sprawling.** Information-dense layouts that respect the operator's screen real estate. No hero sections, no excessive whitespace, no padding bloat. Every pixel should earn its place.
4. **Clear, not clever.** Typography and layout should make information scannable at a glance. Status should be obvious from across the room. No ambiguity in visual hierarchy.
5. **Consistent, not surprising.** Every card, every button, every status indicator follows the same patterns. The user should never wonder "is this clickable?" or "what does this color mean?"

### What to Avoid

These are explicit anti-patterns. Do NOT use any of these:

- **Purple-to-blue gradients** — the hallmark of generic AI-generated UI
- **Inter, Roboto, or Arial** as primary fonts — overused and personality-free
- **Saturated blue as the primary accent** — too cold, too generic
- **Pure white (#FFFFFF) backgrounds** in light mode — too harsh, no warmth
- **Cool gray (#6B7280 etc.) for secondary text** — use warm grays instead
- **Excessive border-radius** (fully rounded cards, pill-shaped containers) — looks toy-like
- **Gradient backgrounds on cards or panels** — keep surfaces flat and solid
- **Shadow-heavy card stacking** — use borders for separation, shadows only for elevation (modals, dropdowns)
- **Animated gradients, floating particles, or decorative motion** — this is a monitoring tool, not a landing page

---

## Color System

Colors are defined as CSS custom properties using Tailwind v4's `@theme` directive. All colors use the `herd-` prefix for namespacing.

### Design Tokens

#### Light Mode (default)

| Token | Value | Usage |
|---|---|---|
| `--color-herd-bg` | `#F4F1EB` | Page background — warm parchment |
| `--color-herd-fg` | `#1C1B18` | Primary text — warm near-black |
| `--color-herd-card` | `#FDFCFA` | Card/panel surfaces — warm white |
| `--color-herd-sidebar` | `#EBE8E1` | Sidebar background — slightly darker than page bg |
| `--color-herd-border` | `rgba(0, 0, 0, 0.12)` | Borders — subtle, not harsh |
| `--color-herd-input-bg` | `#FDFCFA` | Input field backgrounds |
| `--color-herd-hover` | `rgba(0, 0, 0, 0.06)` | Hover state overlay |
| `--color-herd-active` | `rgba(0, 0, 0, 0.10)` | Active/pressed state overlay |
| `--color-herd-muted` | `#7A776D` | Secondary text — warm medium gray |
| `--color-herd-primary` | `#2D6A4F` | Primary accent — deep forest green |
| `--color-herd-primary-hover` | `#3A7D5E` | Primary hover — lighter green |
| `--color-herd-primary-muted` | `rgba(45, 106, 79, 0.10)` | Primary tinted backgrounds |
| `--color-herd-user-bubble` | `#DDD9D0` | User message bubble — warm light gray |
| `--color-herd-code-bg` | `#1E1E1E` | Code block background — VS Code dark |
| `--color-herd-code-fg` | `#D4D4D4` | Code block text |
| `--color-herd-status-running` | `#2D7D46` | Running/connected — green |
| `--color-herd-status-idle` | `#7A776D` | Idle/inactive — warm gray |
| `--color-herd-status-error` | `#C53030` | Error/failed — red |
| `--color-herd-status-pending` | `#B7791F` | Pending/starting — amber |

#### Dark Mode

| Token | Value | Usage |
|---|---|---|
| `--color-herd-bg` | `#1C1B18` | Page background — warm dark |
| `--color-herd-fg` | `#E8E6E1` | Primary text — warm off-white |
| `--color-herd-card` | `#252320` | Card surfaces — slightly lighter than bg |
| `--color-herd-sidebar` | `#1A1917` | Sidebar — slightly darker than bg |
| `--color-herd-border` | `rgba(255, 255, 255, 0.08)` | Borders — subtle light |
| `--color-herd-input-bg` | `#252320` | Input backgrounds |
| `--color-herd-hover` | `rgba(255, 255, 255, 0.05)` | Hover overlay |
| `--color-herd-active` | `rgba(255, 255, 255, 0.08)` | Active overlay |
| `--color-herd-muted` | `#8A877F` | Secondary text |
| `--color-herd-primary` | `#40916C` | Primary accent — slightly lighter green for dark bg |
| `--color-herd-primary-hover` | `#52A37E` | Primary hover |
| `--color-herd-primary-muted` | `rgba(64, 145, 108, 0.12)` | Primary tinted backgrounds |
| `--color-herd-user-bubble` | `#353330` | User message bubble |
| `--color-herd-code-bg` | `#141413` | Code blocks — darker |
| `--color-herd-code-fg` | `#D4D4D4` | Code text |
| `--color-herd-status-running` | `#48BB78` | Running — lighter green for dark bg |
| `--color-herd-status-idle` | `#8A877F` | Idle |
| `--color-herd-status-error` | `#FC8181` | Error — lighter red for dark bg |
| `--color-herd-status-pending` | `#F6E05E` | Pending — lighter amber for dark bg |

### Color Usage Rules

1. **Never use raw hex values in components.** Always reference `herd-*` tokens via Tailwind classes: `bg-herd-bg`, `text-herd-fg`, `border-herd-border`, etc.
2. **Status colors are semantic.** `status-running` always means "active and healthy." Do not repurpose status colors for decoration.
3. **Opacity modifiers for state feedback.** Use Tailwind's `/{opacity}` syntax for tinted backgrounds: `bg-herd-status-error/10` for error backgrounds, `bg-herd-primary/10` for selected states.
4. **The primary green is used sparingly.** It marks primary actions (CTA buttons, active navigation, links). It should NOT be used as a decorative color or background fill.

### Why Green?

herdctl manages *herds* of agents. The name evokes pastoral, agricultural imagery. Forest green (`#2D6A4F`) grounds this identity — natural, reliable, organic. It differentiates from Companion's terracotta while maintaining the same warm, non-corporate aesthetic.

---

## Typography

### Font Stacks

Define three font stacks as Tailwind utilities:

| Utility Class | Font Stack | Usage |
|---|---|---|
| `font-sans` | `"IBM Plex Sans", system-ui, -apple-system, sans-serif` | All UI chrome: navigation, labels, buttons, headers, tables |
| `font-mono` | `"IBM Plex Mono", "SF Mono", "Cascadia Code", "Fira Code", Menlo, monospace` | Code blocks, terminal output, job IDs, file paths |
| `font-serif` | `"Lora", Georgia, "Times New Roman", serif` | Agent response body text in chat view only |

### Why IBM Plex?

IBM Plex is open source (SIL license), has excellent weight range (100-700), purpose-built for technical interfaces, and has matched sans/mono variants for visual harmony. It has personality without being distracting. Load weights: 400, 500, 600 for sans; 400, 500 for mono.

### Why Lora for Chat Responses?

Agent responses are the primary content users read in chat mode. A serif font (Lora — also open source, Google Fonts) creates a subtle distinction between "UI chrome" and "content," improving readability for long responses. This is optional — if it feels too editorial, fall back to `font-sans`.

### Type Scale

Use Tailwind's default scale. These are the sizes that appear in our UI:

| Element | Size | Weight | Additional |
|---|---|---|---|
| Page title | `text-lg` (18px) | `font-semibold` (600) | — |
| Section header | `text-sm` (14px) | `font-semibold` (600) | `uppercase tracking-wide text-herd-muted` for subtle headers |
| Card title | `text-sm` (14px) | `font-medium` (500) | `text-herd-fg` |
| Body text | `text-sm` (14px) | `font-normal` (400) | `text-herd-fg` |
| Secondary text | `text-xs` (12px) | `font-normal` (400) | `text-herd-muted` |
| Tiny labels | `text-[11px]` | `font-medium` (500) | Status badges, counters |
| Code / mono | `text-xs` (12px) | `font-normal` (400) | `font-mono` |
| Chat message (user) | `text-sm` (14px) | `font-normal` (400) | `font-sans` |
| Chat message (agent) | `text-sm` (14px) | `font-normal` (400) | `font-serif` (Lora) |

### Typography Rules

1. **No text larger than `text-lg` (18px).** This is a dense monitoring tool, not a marketing page. The page title is the largest element.
2. **Prefer `font-medium` (500) over `font-bold` (700)** for emphasis. Bold is too heavy for small text.
3. **Muted text (`text-herd-muted`) for metadata.** Timestamps, IDs, counts, secondary descriptions.
4. **Monospace for machine-generated content.** Job IDs, file paths, commands, durations, session IDs.

---

## Spacing & Layout

### Spacing Scale

Use Tailwind's default spacing scale. These are the common values:

| Token | Value | Usage |
|---|---|---|
| `1` | 4px | Tight internal gaps (icon + label) |
| `1.5` | 6px | Compact vertical spacing in lists |
| `2` | 8px | Standard gap between related items |
| `3` | 12px | Gap between sections within a card |
| `4` | 16px | Card internal padding, gap between cards |
| `5` | 20px | Section padding on larger screens |
| `6` | 24px | Gap between major page sections |

### Layout Constants

| Element | Value |
|---|---|
| Sidebar width | `w-[260px]` |
| Detail panel width | `w-[280px]` |
| Content max-width | `max-w-5xl` (for tables/grids) |
| Chat max-width | `max-w-2xl` (for message feed) |
| App height | `h-dvh` (dynamic viewport height) |

### Layout Rules

1. **The app fills the viewport exactly.** `h-dvh` on the root, `overflow-hidden` on the shell, scrolling only within content areas.
2. **Sidebar is fixed-width, collapsible.** 260px on desktop, slides in/out on mobile with backdrop overlay.
3. **Detail panel is fixed-width, toggleable.** 280px, hidden by default on small screens.
4. **Main content is flexible.** `flex-1 min-w-0 overflow-hidden` — takes remaining space.
5. **Card padding: `p-4`** as the default. Use `p-3` for compact cards in dense views.
6. **Gap between cards: `gap-4`** in grids. `gap-3` for tighter lists.

---

## Border Radius

| Element | Radius | Class |
|---|---|---|
| Cards, panels, modals | 10px | `rounded-[10px]` |
| Buttons, inputs, badges | 8px | `rounded-lg` |
| Sidebar nav items | 8px | `rounded-lg` |
| Dropdowns, popovers | 10px | `rounded-[10px]` |
| Status dots | Full | `rounded-full` |
| Avatar/icon circles | Full | `rounded-full` |
| Tooltips | 6px | `rounded-md` |

### Border Radius Rules

1. **Two sizes cover 90% of cases.** `rounded-lg` (8px) for interactive elements, `rounded-[10px]` for containers.
2. **Never use `rounded-3xl` or larger** on rectangular elements. It looks toy-like.
3. **`rounded-full` only for circles** — status dots, avatars, icon buttons.

---

## Component Patterns

These are the canonical Tailwind class combinations for common elements. Sub-agents MUST use these exact patterns (adjusting only content/size as needed).

### Card

```html
<div class="bg-herd-card border border-herd-border rounded-[10px] p-4">
  <!-- card content -->
</div>
```

### Primary Button

```html
<button class="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors">
  Action
</button>
```

### Secondary / Ghost Button

```html
<button class="hover:bg-herd-hover text-herd-muted hover:text-herd-fg rounded-lg px-3 py-1.5 text-xs font-medium transition-colors">
  Action
</button>
```

### Outline Button

```html
<button class="border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-3 py-1.5 text-xs font-medium transition-colors">
  Action
</button>
```

### Disabled State (apply to any button)

```html
<button class="... disabled:opacity-50 disabled:cursor-not-allowed" disabled>
  Action
</button>
```

### Text Input

```html
<input class="bg-herd-input-bg border border-herd-border rounded-lg px-3 py-2 text-sm text-herd-fg placeholder:text-herd-muted focus:outline-none focus:border-herd-primary/60 transition-colors w-full" />
```

### Status Badge

```html
<!-- Running -->
<span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-herd-status-running">
  <span class="w-1.5 h-1.5 rounded-full bg-herd-status-running animate-pulse"></span>
  Running
</span>

<!-- Idle -->
<span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-herd-status-idle">
  <span class="w-1.5 h-1.5 rounded-full bg-herd-status-idle"></span>
  Idle
</span>

<!-- Error -->
<span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-herd-status-error">
  <span class="w-1.5 h-1.5 rounded-full bg-herd-status-error"></span>
  Error
</span>
```

### Sidebar Navigation Item

```html
<!-- Inactive -->
<a class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-herd-muted hover:bg-herd-hover hover:text-herd-fg transition-colors">
  <Icon class="w-4 h-4" />
  Label
</a>

<!-- Active -->
<a class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-herd-fg bg-herd-active font-medium transition-colors">
  <Icon class="w-4 h-4" />
  Label
</a>
```

### Table

```html
<table class="w-full text-sm">
  <thead>
    <tr class="border-b border-herd-border text-xs text-herd-muted font-medium uppercase tracking-wide">
      <th class="text-left py-2 px-3">Column</th>
    </tr>
  </thead>
  <tbody class="divide-y divide-herd-border">
    <tr class="hover:bg-herd-hover transition-colors">
      <td class="py-2 px-3 text-herd-fg">Value</td>
    </tr>
  </tbody>
</table>
```

### Status Feedback Banners

```html
<!-- Error -->
<div class="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-3 py-2 text-xs">
  Error message here
</div>

<!-- Success -->
<div class="bg-herd-status-running/10 border border-herd-status-running/20 text-herd-status-running rounded-lg px-3 py-2 text-xs">
  Success message here
</div>

<!-- Warning -->
<div class="bg-herd-status-pending/10 border border-herd-status-pending/20 text-herd-status-pending rounded-lg px-3 py-2 text-xs">
  Warning message here
</div>
```

### Modal / Dialog Overlay

```html
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
  <div class="bg-herd-card border border-herd-border rounded-[10px] p-5 max-w-md w-full mx-4 shadow-lg">
    <!-- modal content -->
  </div>
</div>
```

### Collapsible Tool Block (for agent output)

```html
<div class="border border-herd-border rounded-lg overflow-hidden">
  <!-- Header (always visible, clickable) -->
  <button class="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-herd-muted hover:bg-herd-hover transition-colors">
    <ChevronIcon class="w-3 h-3 transition-transform" />
    <ToolIcon class="w-3.5 h-3.5" />
    <span>Tool Name</span>
    <span class="ml-auto text-[11px] text-herd-muted/60">duration</span>
  </button>
  <!-- Body (collapsible) -->
  <div class="px-3 py-2 border-t border-herd-border bg-herd-code-bg text-herd-code-fg text-xs font-mono overflow-x-auto">
    <!-- tool output -->
  </div>
</div>
```

---

## Animation

Keep animations **minimal, fast, and purposeful**. This is a monitoring dashboard — motion should communicate state changes, not decorate.

### Defined Keyframes

```css
@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

### Usage Patterns

| Animation | Duration | Where Used |
|---|---|---|
| `fadeSlideIn` | 150ms ease-out | New messages appearing in chat, new items in lists |
| `fadeIn` | 150ms ease-out | Page transitions, modal appearance |
| `animate-pulse` | (Tailwind default) | Status dots for "running" state only |
| `animate-spin` | (Tailwind default) | Loading spinners only |
| `transition-colors` | 150ms | All interactive elements (buttons, links, nav items) |
| `transition-transform` | 150ms | Chevron rotation on collapsible sections |

### Animation Rules

1. **150ms for transitions, 200ms max for entrance animations.** Anything longer feels sluggish.
2. **Only animate opacity, transform, and color.** Never animate layout properties (width, height, padding).
3. **`animate-pulse` only on status dots** for running agents. Do not pulse buttons, cards, or text.
4. **No page transition animations.** Route changes should be instant.
5. **No skeleton loading shimmer.** Use simple `opacity-50 animate-pulse` on placeholder blocks if needed.

---

## Icons

Use **Lucide React** (`lucide-react`) for all icons. Lucide is MIT-licensed, tree-shakable, and has comprehensive coverage of developer tool concepts.

### Icon Sizing

| Context | Size | Class |
|---|---|---|
| Inline with text | 16px | `w-4 h-4` |
| Navigation items | 16px | `w-4 h-4` |
| Card action buttons | 16px | `w-4 h-4` |
| Tool block headers | 14px | `w-3.5 h-3.5` |
| Empty state illustrations | 48px | `w-12 h-12` |

### Icon Color

- Icons inherit `currentColor` by default
- Navigation icons: `text-herd-muted` (inactive) / `text-herd-fg` (active)
- Action button icons: `text-herd-muted` hover → `text-herd-fg`
- Status icons: use corresponding `text-herd-status-*` color

### Tool-Type Icon Mapping

| Tool Type | Lucide Icon | Color hint |
|---|---|---|
| Bash / terminal | `Terminal` | — |
| Read file | `FileText` | — |
| Write file | `FilePen` | — |
| Edit file | `FileCode` | — |
| Search / grep | `Search` | — |
| Web fetch | `Globe` | — |
| Task / agent | `Bot` | — |
| Unknown / other | `Wrench` | — |

---

## Responsive Behavior

### Breakpoints

| Breakpoint | Width | Behavior |
|---|---|---|
| Default (mobile) | < 768px | Sidebar hidden (hamburger toggle), detail panel hidden, full-width content |
| `md` | ≥ 768px | Sidebar visible, detail panel toggle available |
| `lg` | ≥ 1024px | Sidebar + detail panel both visible by default |

### Mobile Patterns

- Sidebar slides in from left with `bg-black/30` backdrop overlay
- Detail panel slides in from right with same backdrop
- Navigation condensed to bottom tab bar on mobile (optional — assess during implementation)
- Tables become card-based lists on small screens

---

## Dark Mode Implementation

Use Tailwind's class-based dark mode (`darkMode: 'class'`). The root `<html>` element gets a `dark` class.

### How It Works

1. CSS custom properties are defined in `:root` (light) and `.dark` (dark) blocks
2. Components use `bg-herd-bg`, `text-herd-fg`, etc. — the same classes work in both modes
3. Theme preference stored in `localStorage` key `herd-theme` (`"light"` | `"dark"` | `"system"`)
4. On load, read preference; if `"system"`, use `prefers-color-scheme` media query
5. Toggle updates `<html>` class and writes to localStorage

### Dark Mode Rules

1. **Never use Tailwind's `dark:` prefix on components.** All theming goes through CSS custom properties. Components should NOT have `dark:bg-gray-800` etc.
2. **The only place `dark:` appears is in the CSS file** where custom properties are defined.
3. **Code blocks use the same colors in both modes** — dark background with light text regardless of theme.

---

## File Structure for Styles

```
packages/web/src/client/
  src/
    index.css          ← Tailwind imports, @theme tokens, keyframes, a few global styles
    App.tsx            ← Wraps everything in layout, applies font class
    components/
      ui/              ← Reusable primitives (Button, Card, Badge, Input, etc.)
```

### index.css Structure

```css
@import "tailwindcss";

/* ===== Theme Tokens (Light Mode) ===== */
@theme {
  --color-herd-bg: #F4F1EB;
  --color-herd-fg: #1C1B18;
  /* ... all light mode tokens ... */
}

/* ===== Dark Mode Overrides ===== */
.dark {
  --color-herd-bg: #1C1B18;
  --color-herd-fg: #E8E6E1;
  /* ... all dark mode tokens ... */
}

/* ===== Font Faces ===== */
/* IBM Plex Sans and Mono loaded via Google Fonts link in index.html */
/* Lora loaded via Google Fonts link in index.html */

/* ===== Keyframes ===== */
@keyframes fadeSlideIn { /* ... */ }
@keyframes fadeIn { /* ... */ }

/* ===== Scrollbar Styling ===== */
/* Thin, warm-tinted scrollbars that match the theme */
```

---

## Summary Checklist for Sub-Agents

Before writing any UI component, verify:

- [ ] Using `herd-*` color tokens, never raw hex values
- [ ] Using the correct font utility (`font-sans` for UI, `font-mono` for code, `font-serif` for chat agent responses)
- [ ] Text sizes are within the scale (`text-[11px]`, `text-xs`, `text-sm`, `text-lg` — nothing else)
- [ ] Interactive elements have `transition-colors` and proper hover/active states
- [ ] Buttons follow one of the three patterns: primary, secondary/ghost, outline
- [ ] Cards use `rounded-[10px]`, buttons/inputs use `rounded-lg`
- [ ] Status indicators use `herd-status-*` tokens with correct semantic meaning
- [ ] Icons are from Lucide React, sized `w-4 h-4` (standard) or `w-3.5 h-3.5` (compact)
- [ ] No `dark:` prefix in component classes — theming is handled by CSS custom properties
- [ ] Animations are ≤200ms, CSS-only, applied only for state communication
- [ ] Layout follows the three-panel structure with fixed sidebar/detail widths
