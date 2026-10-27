# Epic 59 — Landing page for judges

**Status:** complete. Branch `epic/59-landing-site`. Lane: `site/**`.

## Goal

Give the submission a single page a judge can open and understand in twenty seconds: what Starling
is, the murmuration, how a run works, the open-weight story, flock mode, the build stats and the
quickstart — without a framework, a CDN, a build server or an internet connection.

## How it works

```
site/index.html            copy + sections + one <canvas>
  ├── src/styles.css       "dusk sky" theme, copied from the dashboard tokens
  └── src/main.ts          boot
        ├── boids.ts       pure sim: separation, alignment, cohesion, roost, pointer
        ├── sky.ts         canvas: cached dusk backdrop, stars, wires, DPR, pause/reduced motion
        ├── stats.ts       fetch + normalise data/stats.json, fill the six tiles
        ├── copy.ts        clipboard with a legacy fallback + live-region status
        └── reveal.ts      IntersectionObserver reveals, top-bar tint
```

`bun run --cwd site build` runs `build.ts`: one `Bun.build` HTML entrypoint (Bun follows the
`<link>` and `<script type="module">`, minifies CSS/TS, emits hashed names), copies
`data/stats.json`, prints every asset size and **fails the build over 300 KB**. Current output:

| asset | size |
| --- | --- |
| `index.html` | 24.6 KB |
| CSS | 24.4 KB |
| JS | 11.3 KB |
| `data/stats.json` | 0.5 KB |
| `favicon.svg` | 0.8 KB |
| **total** | **61.7 KB** |

`site/serve.ts` is a 40-line static server for previewing exactly what Pages will serve:
`bun run --cwd site build && bun run --cwd site serve` → `http://localhost:4173`.

### The hero murmuration

`site/src/boids.ts` is our own boids loop, not the dashboard's Sky:

- ~56 birds on a phone, ~210 on a laptop (`defaultCount` from viewport area), seeded so the opening
  frame is stable;
- three local rules with squared-distance neighbour scans (max ~210² = 44k pairs/frame — cheap);
- a slowly wandering roost plus a **personal roost slot per bird on a turning ellipse**. Local
  cohesion alone left two or three clumps drifting independently; the slots give the flock its
  ribbon shape without turning it into a rigid formation, and the turn makes it flow;
- a pointer scatters nearby birds (fine pointers only), soft edges plus hard rails keep every bird
  on canvas;
- `dt` is clamped to 1/30 so a backgrounded tab cannot explode the sim, and the renderer pauses on
  `IntersectionObserver`/`visibilitychange`.

`sky.ts` caches the static layer (dusk gradient, ~150 stars, two roost wires with perched
silhouettes) into an offscreen canvas and only repaints the birds each frame. DPR is capped at 2.
With `prefers-reduced-motion: reduce` it simulates 420 steps once and draws a single still—no
`requestAnimationFrame` at all.

## Key decisions & reasoning

1. **Bun's HTML entrypoint, no framework.** Bun 1.4.4 handles HTML → hashed JS/CSS with zero config
   and zero runtime. React/Vite would add hundreds of KB and a second toolchain to a page with one
   interactive behaviour.
2. **A bespoke boids loop, not the web app's Sky.** Importing `apps/web` would drag React, xyflow and
   the whole store into a static page. The sim is 190 lines, testable without a DOM, and visually
   tuned for a wide hero rather than a panel. The dashboard and the landing page can drift without
   coupling.
3. **Tokens copied, not imported.** The palette/type scale live in `apps/web/src/lib/tokens.pcss`
   and `index.css`; a static page cannot depend on a Vite/Tailwind build. The copied values are
   commented as such, so a future token change has an obvious second place to look.
4. **No webfonts and no CDNs.** "Works on venue wifi, from a USB stick" beats a font that arrives
   after the judge has scrolled. The stack lands on Inter if installed, otherwise SF Pro / Segoe.
   The page makes zero network requests beyond its own assets and the optional stats fetch.
5. **Stats hydrate, never blank.** The six tiles ship with real placeholder numbers in the HTML and
   upgrade from `site/data/stats.json` at runtime. A missing file (`file://`, collector not run,
   malformed JSON) leaves the fallback in place. The normaliser accepts a flat or `{totals}` shape,
   numeric strings and Epic 68's likely aliases, so the collector can land without a page rebuild.
6. **The stat note is honest.** "Snapshot of this build" rather than pretending the numbers are
   real-time; the JSON carries `source: "placeholder"` and a note pointing at Epic 68.
7. **Screenshot through the installed Playwright CLI, compressed with `pngquant`.** A committed
   Playwright dev-dependency would make the site heavier than its own output. The 1440×900 PNG is
   125 KB (limit 300 KB) and is also the `og:image` target.
8. **`site/` stays outside the Bun workspace.** Root `workspaces` are `packages/*` and `apps/*`;
   adding a site workspace would churn `bun.lock` and the root scripts for a dependency-free
   package. Tests/typecheck run explicitly (`bun run --cwd site test|typecheck`) and are filed for
   CI in the handback.
9. **Accessibility is structural, not a pass at the end.** Landmarks (`header`/`nav`/`main`/`footer`),
   skip link, one `h1`, labelled sections, `aria-hidden` canvas with the full story in text, copy
   buttons with labels and a `role="status"` announcement, visible focus rings, 16 px phone gutters,
   and a global reduced-motion rule.

## Interfaces for future epics

- **Stats contract.** `site/data/stats.json` is read at runtime. Canonical shape:

  ```json
  {
    "generatedAt": "2026-10-27T18:00:00.000Z",
    "source": "tools/stats",
    "totals": { "epics": 28, "prs": 28, "tests": 1785, "agents": 35, "laptops": 2, "commits": 37 }
  }
  ```

  Accepted aliases: `epicCount`, `pullRequests`, `prCount`, `testCount`, `peakAgents`,
  `peakConcurrentAgents`, `machines`, `nodes`, `commitCount`. `epics` may also be an array (length is
  used). A per-wave array can supply `agents` as a sum. Unknown/invalid values fall back per field.
- **Build / test commands.** `bun run --cwd site build`, `serve`, `test`, `typecheck`. `dist/` is
  git-ignored; asset filenames are hashed, so nothing should hardcode them.
- **Stable anchors.** `#top`, `#pitch`, `#how`, `#open-weights`, `#flock`, `#built-by`,
  `#quickstart`. The README/submission can deep-link to any of them.
- **Screenshot.** `site/screens/hero.png`, 1440×900, ≤300 KB, for the submission and for sharing.
- **Repo URL.** Hrefs and the `og:image` point at `github.com/broiisapro/starling`; if the repo moves,
  update `index.html` (single place).

## Deviations from plan

- **Google Fonts were skipped entirely** although allowed. The page reads well on the system stack
  and gains offline reliability; see decision 4.
- **The open-weight heading says "The judging stays home"**, not "on your own silicon": workers use
  the DeepSeek API by default, and only auditing/summarising run locally. The original line
  overclaimed. The lede still explains `--fully-open`.
- **A "20-second pitch" band** was added between hero and explainer so the judges' quote is explicit
  rather than implied by the hero lede.
- **The stats tiles show six numbers** (epics, PRs, tests, agents, laptops, commits) rather than
  inventing a velocity or hours metric; every number is checkable against the repo.
- **`hero.png` was captured with the Playwright CLI + `pngquant`** rather than a committed script.

## Known limitations / deferred

- Placeholder stats until Epic 68's collector writes `site/data/stats.json`; `source` is not rendered.
- No automated visual regression test and no Firefox/Safari screenshot. The page uses only
  long-supported APIs (`canvas`, `IntersectionObserver`, `matchMedia`, `visualViewport` not used);
  browsers without canvas simply keep the CSS dusk gradient.
- No deployment in this lane. GitHub Pages is an Epic 52 FIX REQUEST, with the exact workflow.
- The live dashboard is linked only through the quickstart command; embedding real run data would
  couple the static page to a running engine (deliberately out of scope).
- `site/dist/` is not committed. Regenerate with the build command above.
- The page's hero animation is decorative; the same information is present as text for assistive
  technology, and the page is complete with JavaScript disabled.
