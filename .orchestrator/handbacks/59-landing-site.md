## Epic 59 Handback — Landing page for judges

**Status:** Complete. Branch `epic/59-landing-site`; PR #105.

**Delivered:**
- `site/` — a static one-page landing site, bundled by Bun with no framework and no external
  requests. Built output is **61.7 KB total** (HTML 24.6, CSS 24.4, JS 11.3, stats 0.5, favicon 0.8).
- Hero with a live canvas murmuration: our own boids (`site/src/boids.ts`, ~190 lines: separation,
  alignment, cohesion, wandering roost, per-bird roost slots, pointer scatter, soft edges, hard
  rails) rendered by `site/src/sky.ts` on a cached dusk backdrop (gradient, ~150 stars, roost wires
  with perched silhouettes). DPR capped at 2; pauses off-screen and on hidden tabs; one still frame
  under `prefers-reduced-motion`.
- Sections: **hero** (headline, 20-second pitch band, run command, CTAs), **One goal in, a flock
  out** (3 steps + dashboard status legend), **open-weight story** (DeepSeek V4.1 Flash MIT weights /
  Qwen3.8 27B MLX Apache-2.0, 18.3 tok/s warm, ~19 GB resident, $0/verdict from
  `tools/local-models/results`), **flock mode** (hub/perch diagram, bundle/heartbeat/reschedule
  facts, `starling perch` command), **built by the flock** (six tiles hydrated from
  `site/data/stats.json`), **quickstart** (clone/install, `starling init`, `starling run`, `dash`)
  plus the Agent Skill `/swarm` one-liner, and a footer with repo links, MIT and the Hacktoberfest
  badge text.
- `site/data/stats.json` — placeholder snapshot with the canonical shape and a `source` note;
  `site/src/stats.ts` normalises it at runtime and falls back per field, so Epic 68 can regenerate
  the file without touching the page.
- `site/src/copy.ts` — copy buttons for every command strip, comment lines stripped, clipboard
  fallback, `role="status"` announcement.
- `site/src/reveal.ts` — scroll reveals and the top-bar tint; both progressive enhancements.
- `site/build.ts` — Bun HTML-entry build, copies the stats file, prints sizes, **fails over 300 KB**.
  `site/serve.ts` — static preview server for exactly the bytes Pages serves.
- `site/screens/hero.png` — 1440×900, **125 KB** (Playwright 1.61 + pngquant), also referenced from
  `og:image`.
- `site/README.md` — build/preview commands, file map, stats contract.
- `docs/epic-59-landing-site.md` — goal, how it works, decisions, interfaces, deviations, limitations.
- 21 unit tests (`site/src/boids.test.ts`, `stats.test.ts`, `copy.test.ts`) covering determinism,
  speed envelope, dt clamping, pointer scatter, edge containment, roost attraction, stats aliasing
  and fallbacks, and command-text extraction.

**Key design decisions:**
- **No framework / no CDN / no webfonts** — Bun's HTML entrypoint produces hashed assets with zero
  runtime; the page works offline from a USB stick, which matters on venue wifi.
- **Own boids rather than importing the dashboard Sky** — avoids React/xyflow in a static page and
  keeps the simulation testable without a DOM; the pure sim is split from the canvas renderer.
- **Personal roost slots on a turning ellipse** — plain local-cohesion boids split into several
  drifting clumps on a 1440 px canvas; a per-bird slot gives the flock a ribbon shape while the
  local rules keep it organic. This was tuned against bounding-box measurements, not vibes.
- **Tokens copied, not imported** — a static page cannot depend on the app's Vite/Tailwind pipeline;
  the copied values are commented as such.
- **Stats hydrate with HTML fallbacks** — the tiles are never blank, even on `file://` or before
  Epic 68's collector has run; the normaliser tolerates flat/nested shapes and common aliases.
- **`site/` stays outside the Bun workspace** — no `bun.lock` or root-script churn for a package with
  zero dependencies; tests and typecheck are explicit commands (filed for CI below).
- **Honest open-weight copy** — "The judging stays home"; workers use the DeepSeek API by default,
  local Qwen does auditing/summarising, and `--fully-open` moves workers local too.

**Verification (exact commands + results):**
- `bun install` (root): `Checked 162 installs across 221 packages (no changes) [38.00ms]`
- `bun run --cwd site test`: `21 pass`, `0 fail`, `681 expect() calls`, 3 files
- `bun run --cwd site typecheck`: clean (`tsc --noEmit -p site/tsconfig.json`)
- `bun run --cwd site build`:
  ```
  site/dist
      24.4 KB  chunk-kjymhbgt.css
      11.3 KB  chunk-ndjtt866.js
       0.5 KB  data/stats.json
       0.8 KB  favicon-ceyh0nen.svg
      24.6 KB  index.html
      61.7 KB  total
  ```
- `bun run test` (root): packages/apps/cli/skills/tools half:
  `1359 pass, 4 skip, 0 fail — Ran 1363 tests across 162 files [28.59s]`;
  web half: `426 pass, 0 fail — Ran 426 tests across 39 files [2.46s]`. **1,785 pass total, 0 fail.**
- `bun run check` (root): `Checked 723 files in 177ms. No fixes applied.`; per-workspace
  `tsc --noEmit` loop completed with no output (clean).
- `playwright screenshot --viewport-size="1440,900"` → `site/screens/hero.png`, **125 KB**
  (limit 300 KB), quantised with pngquant 70–90.
- Responsive spot checks with Chromium at 1440×900, 768×1024 and 390×844; fixed the one horizontal
  overflow found (quickstart terminal tracks now `minmax(0, 1fr)`, code wraps) and the phone stat
  note layout. No horizontal scroll at 390 px.
- Biome a11y checks on the HTML/CSS are clean (semantic legend list, labelled copy buttons,
  `aria-hidden` decorative SVGs, skip link, landmarks).
- **Re-verified after the resume:** `bun install` → `Checked 162 installs across 221 packages (no
  changes)`; `bun run --cwd site test` → `21 pass, 0 fail`; root `bun run test` →
  `1359 pass, 4 skip, 0 fail` + `426 pass, 0 fail`; `bun run check` → `Checked 723 files`, tsc clean;
  build → `61.7 KB total`; Chromium at 390/768/1440 px → no horizontal scroll.

**Dependencies added:** none. (Site uses Bun built-ins; screenshot tooling was the machine's
Playwright CLI and a local pngquant install, neither added to the repo.)

**CONTRACT REQUESTS:** none.

**FIX REQUESTS (changes needed outside `site/**`):**
1. **Epic 52 — deploy the site to GitHub Pages.** Add `.github/workflows/pages.yml`:

   ```yaml
   name: pages

   on:
     push:
       branches: [main]
       paths:
         - 'site/**'
         - '.github/workflows/pages.yml'
     workflow_dispatch:

   permissions:
     contents: read
     pages: write
     id-token: write

   concurrency:
     group: pages
     cancel-in-progress: true

   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v2
           with:
             bun-version: 1.4.4
         - run: bun install --frozen-lockfile
         - run: bun run --cwd site typecheck
         - run: bun run --cwd site test
         - run: bun run --cwd site build
         - uses: actions/configure-pages@v5
         - uses: actions/upload-pages-artifact@v3
           with:
             path: site/dist

     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       steps:
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

   Relative asset URLs mean the project-page path (`/starling/`) works without a `base` setting.
2. **Epic 52 — include the site in `ci.yml`.** `site/` is outside the Bun workspace, so root
   `bun run check` does not typecheck it and root `bun run test` does not run its 21 tests. Add a
   `site` job (same four commands as the Pages build job above).
3. **Root-script owner (E00/integrator, if you prefer CI-free local parity).** Exact additions to
   root `package.json`:
   ```json
   "test": "bun run test:packages && bun run test:web && bun run test:site",
   "test:site": "bun test site/src",
   "check": "biome check . && bun run typecheck:site && bun run typecheck",
   "typecheck:site": "bunx tsc --noEmit -p site/tsconfig.json"
   ```
4. **Epic 68 — write the stats file.** Path: `site/data/stats.json`. Canonical shape:
   `{ generatedAt, source, totals: { epics, prs, tests, agents, laptops, commits } }`. Aliases and
   array-derived values are tolerated by `site/src/stats.ts`; see `site/README.md`.
5. **Epic 60 — link the page/screenshot** from the README (`site/`, `site/screens/hero.png`), and
   reuse the screenshot's `og:image` idea if useful. No change needed in this lane.

**Deliberately deferred / out of scope:**
- Actual deployment and custom domain/canonical URL (Epic 52 / release).
- Root README and docs hub (Epic 60).
- Live run data or an embedded dashboard; the page only shows the build snapshot and links the
  `starling dash` command.
- Automated visual regression (a screenshot script and browser matrix would add dependencies).
- Rendering Epic 68's full wave timeline; the About page owns that richer view.

**Open questions / flagged tradeoffs:**
- **Placeholder stats**: epics 28, PRs 28, tests 1,785, agents 35, laptops 2, commits 37 are a
  snapshot of this branch's history. They will read as stale until Epic 68 runs; the note on the page
  says "Snapshot of this build" rather than implying live data.
- **Repo URL is hardcoded** (`github.com/broiisapro/starling`) in links and `og:image`. If the
  submission repo moves, that is one file (`site/index.html`) plus `site/README.md`.
- **`og:image` uses `raw.githubusercontent.com`** so sharing cards work before Pages is deployed. If
  Pages lands at a stable URL, switching to that absolute URL would be marginally more robust.
- **No Firefox/Safari screenshots** were captured; the APIs used are broadly supported, but a
  browser matrix belongs with the Epic 71 e2e work if judges will use non-Chromium browsers.
- **The hero is decorative by design**: the canvas has no textual equivalent beyond the story around
  it. That keeps the page readable for screen readers and non-canvas browsers, at the cost of not
  describing individual birds.
