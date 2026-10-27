# Starling — landing site

The one-page story judges can open from the submission: what Starling is, how a run works, the
open-weight story, flock mode, the build stats and the quickstart.

Static HTML, CSS and TypeScript, bundled by Bun. No framework, no CDN, no fonts fetched, no
analytics. The whole page is about 62 KB.

## Build and preview

```bash
bun run --cwd site build      # → site/dist/
bun run --cwd site serve      # http://localhost:4173
bun run --cwd site test       # boids, stats and copy helpers
bun run --cwd site typecheck
```

`site/dist/` is generated and git-ignored. Open it from any static server (a `file://` open works
too, minus the stats fetch and clipboard fallback).

## Layout

```
index.html          all the copy, sections and the canvas element
src/styles.css      the "dusk sky" theme, copied from the dashboard tokens
src/main.ts         boot: sky, copy buttons, reveal, stats
src/boids.ts        pure boids maths (separation, alignment, cohesion, roost + pointer)
src/sky.ts          canvas renderer: backdrop cache, DPR, visibility, reduced motion
src/stats.ts        tolerant normaliser for data/stats.json
src/copy.ts         copy-to-clipboard with a legacy fallback
src/reveal.ts       scroll reveal and the top-bar tint
data/stats.json     placeholder snapshot; Epic 68 regenerates it
screens/hero.png    the 1440×900 screenshot used for the submission
build.ts            Bun.build(HTML entry) + stats copy + size budget
serve.ts            tiny static server for the built page
```

## `data/stats.json`

The six tiles ("Built by the flock") read this file at runtime, so a collector can refresh them
without rebuilding the page. The canonical shape:

```json
{
  "generatedAt": "2026-10-27T18:00:00.000Z",
  "source": "tools/stats",
  "totals": {
    "epics": 28,
    "prs": 28,
    "tests": 1785,
    "agents": 35,
    "laptops": 2,
    "commits": 37
  }
}
```

The normaliser also accepts a flat object, numeric strings, `epicCount` / `pullRequests` /
`testCount` / `peakConcurrentAgents` / `machines` / `commitCount` aliases, and derives `epics` from
an `epics` array. Missing or broken fields fall back to the values already in `index.html`; the
page never shows a blank tile.

## Notes

- The hero murmuration is our own boids loop (`src/boids.ts`); it does not import `apps/web`.
- `prefers-reduced-motion: reduce` renders one pre-simulated still frame and skips the animation
  loop entirely. The loop also pauses when the hero scrolls out of view or the tab is hidden.
- The deploy workflow is owned by Epic 52; the exact GitHub Pages YAML is in
  `docs/epic-59-landing-site.md` and `.orchestrator/handbacks/59-landing-site.md`.
