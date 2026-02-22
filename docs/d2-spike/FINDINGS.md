# D2 Spike: Fleet Composition Diagram

**Date**: 2026-02-22
**D2 Version**: 0.7.1
**Goal**: Evaluate D2 as an alternative to Mermaid for the "fleet of fleets" diagram

## Summary

D2 is a significant upgrade over Mermaid for the fleet composition diagram. Its native container (nesting) syntax produces a visual that communicates hierarchy through **spatial containment** rather than arrows, which is exactly what the fleet-of-fleets concept needs. The result looks like a dashboard or infographic rather than a flowchart.

**Recommendation: Adopt D2 for hero/architecture diagrams.** Keep Mermaid for simple flowcharts where it works fine.

---

## What Worked

### Container nesting (the killer feature)
D2's nested container syntax maps perfectly to the fleet-of-fleets concept. Sub-fleets are literally drawn inside the super fleet, and agents are drawn inside their sub-fleets. No arrows needed -- the hierarchy is immediately obvious from spatial containment alone.

This is something Mermaid fundamentally cannot do. Mermaid's `subgraph` feature has limited nesting support and poor styling control. The current Mermaid diagram uses arrows (` --> `) to show parent-child relationships, which makes the diagram look like a dependency graph rather than a containment hierarchy.

### Grid layout
D2's `grid-columns` and `grid-rows` properties were essential for getting a balanced layout. Without them, the layout engines (dagre/ELK) stack items vertically since there are no connections to route. With `grid-columns: 4` on the outer container and `grid-columns: 2` / `grid-columns: 1` on sub-fleets, the diagram achieves a compact, balanced layout.

### Custom color support
D2 respects custom `style.fill`, `style.stroke`, and `style.font-color` properties, so the herdctl brand colors (indigo/blue/green) render correctly regardless of which theme is active.

### Multiple render modes
The same `.d2` source renders cleanly to SVG, PNG, and even sketch mode. The `--theme 200` dark theme variant looks particularly good for landing pages or dark-mode documentation.

### Fast compilation
All renders completed in under 400ms. The SVG output is clean and lightweight (~21KB for the final version).

---

## What Didn't Work (or needed workarounds)

### dagre layout engine drops outer container labels
With the default dagre engine, the outermost container's label ("Super Fleet: all-projects") was sometimes not rendered. ELK was more reliable, but ultimately the grid layout made both engines produce identical results since grid layout bypasses the layout engine's node placement.

### `direction` keyword has limited effect without connections
`direction: down` and `direction: right` only affect how the layout engine routes connections between nodes. Since the fleet diagram is pure containment (no arrows), the direction keyword had no visible effect. Grid layout was the solution.

### No fine-grained grid cell spanning
D2's grid layout doesn't support CSS Grid-style `grid-column: span 2`. This means you can't make the `herdctl` sub-fleet span two columns while `bragdoc` and `personal` each take one. The workaround was using `grid-columns: 4` with monitor as the fourth column, which actually produced a nice visual.

### 3D mode adds visual clutter
`style.3d: true` creates an isometric extrusion effect. While it looks interesting on individual boxes, applying it to nested containers creates visual noise -- the 3D offset on inner elements competes with the 3D offset on outer containers. The flat version is cleaner and more professional.

### Spacer hacks for grid alignment
To center the monitor agent below the three sub-fleets, I tried inserting a transparent spacer element. This worked but felt hacky. The better solution was making monitor a fourth column, which naturally communicates that it's a standalone root-level agent.

---

## Layout Engine Comparison

| Engine | Grid Support | Label Rendering | Speed | Notes |
|--------|-------------|-----------------|-------|-------|
| dagre (default) | Yes (D2-native) | Sometimes drops outer labels | ~90ms | Good for simple diagrams |
| ELK | Yes (D2-native) | More reliable | ~260ms | Better for complex nesting |

**Verdict**: For the grid-based fleet diagram, both produce identical output since grid layout is handled by D2 itself, not the layout engine. For non-grid diagrams with connections, ELK is the safer choice.

---

## Theme Comparison

| Theme | ID | Result |
|-------|----|--------|
| Default | 0 | Clean, white background. Best for light-mode docs. |
| Neutral default | 1 | Nearly identical to default with our custom colors. |
| Dark Mauve | 200 | Dark background (#1e1e2e). Excellent for landing pages and dark mode. **Best dark option.** |
| Terminal | 300 | Monospace font, ALL-CAPS labels. Too aggressive for documentation. |
| Themes 3-8 | 3-8 | All very similar to default since custom fill colors override theme colors. |

**Verdict**: Use default (0) for docs, dark mauve (200) for landing pages or dark-mode contexts.

---

## Styling Comparison

| Feature | Result |
|---------|--------|
| `style.border-radius: 16` | Nicely rounded outer container |
| `style.shadow: true` | Subtle drop shadow, adds depth without clutter |
| `style.3d: true` | Isometric extrusion. Fun but too heavy for nested containers. |
| `style.font-size` | Works well for creating visual hierarchy (28/20/14) |
| `style.stroke-width: 2` | Cleaner container borders |
| Sketch mode (`--sketch`) | Hand-drawn aesthetic with hatching. Fun for presentations. |

---

## Astro Integration

The `astro-d2` package (v0.9.0) provides Astro integration via a remark plugin. It transforms D2 code blocks in markdown into rendered diagrams at build time.

### Integration setup (not applied -- documenting only)

```javascript
// astro.config.mjs
import astroD2 from 'astro-d2'

export default defineConfig({
  integrations: [
    astroD2(),
    // ... other integrations
  ],
})
```

Then in any markdown file:

````markdown
```d2
all-projects: {
  label: "Super Fleet"
  herdctl: {
    security-auditor
    docs
  }
}
```
````

### Key considerations

- **Requires D2 CLI** at build time (or use `experimental.useD2js` for a JS-only runtime)
- **`skipGeneration` option** available for CI/CD environments without D2 installed
- **Works alongside rehype-mermaid** -- they handle different code block languages
- **Starlight compatible** -- `astro-d2` is built for Astro and tested with Starlight

### Verdict on Astro integration

It would work, but adds a build-time dependency on the D2 CLI. For one or two hero diagrams, pre-rendering to SVG and embedding the SVG directly in markdown (via an `<img>` tag) is simpler and avoids the build dependency. If D2 adoption expands to many pages, the integration would be worth adding.

---

## Output Files Reference

### Final recommended versions
- `fleet-composition.d2` -- Source file (grid layout, 4 columns)
- `fleet-composition-final.svg` -- SVG output (light background)
- `fleet-composition-final.png` -- PNG output (light background)
- `fleet-composition-theme200.svg` -- SVG with dark background
- `fleet-composition-theme200.png` -- PNG with dark background
- `fleet-composition-sketch.svg` -- Sketch (hand-drawn) mode

### Iteration history
- `fleet-composition.png` / `.svg` -- v1: basic nesting, no grid (too flat/wide)
- `fleet-composition-elk.*` -- v1 with ELK engine
- `fleet-composition-v2*` -- Added subtitle, font sizes (still too flat)
- `fleet-composition-v3*` -- Switched to `direction: right` (too tall/narrow)
- `fleet-composition-v4*` -- First grid attempt with `grid-rows: 2` (good but unbalanced)
- `fleet-composition-v5*` -- 3-column grid with spacer (monitor misplaced)
- `fleet-composition-v6.png` -- 4-column grid, final layout (winner)
- `fleet-composition-3d*` -- 3D variant (interesting but too heavy)
- `fleet-composition-theme*` -- Various theme explorations

### D2 variant files
- `fleet-composition.d2` -- Final flat version (recommended)
- `fleet-composition-3d.d2` -- 3D variant

---

## Comparison: D2 vs Mermaid for This Use Case

| Aspect | Mermaid | D2 |
|--------|---------|-----|
| Hierarchy representation | Arrows (dependency-graph style) | Spatial containment (dashboard style) |
| Visual clarity | Acceptable -- you can follow the arrows | Excellent -- hierarchy is immediately obvious |
| Color/styling | Per-node CSS-like `style` directives | Per-node properties, themes, sketch mode |
| Grid/layout control | None | `grid-columns`, `grid-rows`, `grid-gap` |
| Astro integration | rehype-mermaid (already configured) | astro-d2 (easy to add) |
| Build dependency | Client-side JS (CDN) or rehype plugin | CLI binary or JS library |
| Dark mode | Theme selection at runtime | Theme flag at render time (or generate both) |
| File size (SVG) | ~8KB (simpler but less visual) | ~21KB (richer visual) |

**Bottom line**: D2 produces a significantly better visualization for the fleet-of-fleets concept. The containment model is the correct visual metaphor for fleet hierarchy, and Mermaid simply cannot express it.

---

## Recommended Next Steps

1. **Use the pre-rendered SVG** (`fleet-composition-final.svg` or `fleet-composition-theme200.svg`) in the fleet composition docs page, referenced as an `<img>` tag.
2. **Keep Mermaid** for the simpler diagrams (merge priority flowchart, etc.) where it works well.
3. **Consider astro-d2** if D2 usage expands beyond one or two pages.
4. **Generate both light and dark variants** of the SVG for proper dark-mode support on herdctl.dev.
