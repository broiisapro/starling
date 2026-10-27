# Diagrams

Three hand-authored SVGs used by the top-level README (and reusable by the landing site). No generator, no
external fonts, images or scripts — edit the markup directly.

| File | Used for |
| --- | --- |
| `pipeline.svg` | the run loop: goal → repo map → plan/lanes → flock → audit → merge queue → integration |
| `flock-topology.svg` | hub + perches, git bundles, SSE, discovery and heartbeats |
| `model-routing.svg` | roles → DeepSeek V4.1 Flash / local Qwen → transports, plus the three profiles |

## Conventions

- **Transparent background.** No background `<rect>`; the host page supplies it.
- **One palette for light and dark.** GitHub renders these as `<img>`, so a `prefers-color-scheme` query
  would follow the reader's OS, not GitHub's theme. All inks are mid-luminance instead:

  | Token | Value | Contrast on `#ffffff` | Contrast on `#0d1117` |
  | --- | --- | --- | --- |
  | body ink | `#6f7b89` | ≈4.6:1 | ≈4.1:1 |
  | heading ink | `#5a6673` | ≈5.9:1 | ≈3.2:1 |
  | teal accent | `#2f8f86` | ≈3.9:1 | ≈4.8:1 |
  | amber accent | `#c2740c` | ≈3.6:1 | ≈5.2:1 |
  | violet accent | `#8b5cf6` | ≈4.2:1 | ≈4.4:1 |
  | structural stroke | `#6f7b89` at 0.55 opacity | — | — |

  Ratios are approximate (sRGB relative luminance). Keep new colours inside this band; do not use pure black,
  white or a single-theme brand colour.
- **Mid-contrast strokes.** Box strokes are `#6f7b89` at 55% opacity, arrows solid `#6f7b89`, accent caps
  3 px.
- **One viewBox width: 1120.** Heights are 420 / 520 / 520. GitHub scales to the content column, so body text
  is 11.5–14 px and headings 24 px in the source.
- **System font stack only.** `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial,
  sans-serif`; monospace tokens use `ui-monospace, SFMono-Regular, Menlo, monospace`.
- **Accessible.** Every SVG has a `<title>` and `<desc>` and `role="img"` with `aria-labelledby`. The desc
  carries the argument, not a shape inventory.
- **Arrow markers** are defined per file in `<defs>` (one per colour). Reuse `orient="auto-start-reverse"` so a
  line can point the other way without a second marker.
- **No `<foreignObject>`** and no HTML inside the SVG: GitHub sanitises both inconsistently.

## Editing

1. Change the markup by hand; keep the existing grid (32 px margins, 152 px stage pitch in `pipeline.svg`).
2. Validate: `xmllint --noout docs/assets/diagrams/*.svg`.
3. Render both themes in a browser. With Chrome installed:

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless=new --hide-scrollbars --window-size=1120,520 \
     --screenshot=/tmp/pipeline.png \
     "file://$PWD/docs/assets/diagrams/pipeline.svg"
   ```

   To check dark, wrap the file in an HTML page with `background:#0d1117` and screenshot that.
4. Keep the README alt text in sync with any semantic change.

If a fourth diagram is added, update this table, the README, and keep the 1120 px grid.
