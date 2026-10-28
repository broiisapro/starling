# Demo UI glow-up: make the Starling dashboard look incredible (hard limit: 20 minutes)

You are working in the Starling monorepo (Bun 1.4.4, React 19, Vite, Tailwind v4, zustand, @xyflow/react, lucide-react). Starling is an open-weight swarm-of-coding-agents harness: one goal → a task DAG → a flock of opencode agents working in parallel git worktrees (on this laptop and on other laptops called "perches") → audits → a merge queue. The dashboard (`apps/web`) shows it as a **murmuration**: each agent is a bird in the Sky view, laptops are roosts.

**The dashboard works, but it looks bland and generic.** In about one hour it gets shown live to hackathon judges on a projector. Your job: make it look stunning, cinematic and polished. Think Linear × Vercel × a night sky full of starlings. Change only visuals and layout. The data layer is not your concern.

## Hard rules
- **Time box: 20 minutes.** Ship the biggest visual win first, commit, then keep improving. Commit after each meaningful step (`git commit -am "style(web): …"`), so whatever exists at minute 20 is demo-ready.
- **Don't touch `apps/web/src/data/**`** (store, reducer, selectors, SSE, demo player) or anything outside `apps/web/`. Keep every component's exported name and props, so the wiring keeps working.
- No new dependencies. Use what's installed: Tailwind v4, lucide-react, CSS, canvas.
- It must work in both live mode and demo mode, at 1280×720 (projector) and 1440×900, in dark mode (the demo default). Light mode just must not break.
- Respect `prefers-reduced-motion`.

## How to see it
1. In one terminal, leave `bun run starling dash` running (serves `apps/web/dist` on port 7777), or use `cd apps/web && bun run dev` for hot reload.
2. Open **http://localhost:7777/?demo=1** (or the Vite dev URL with `?demo=1`). This plays a recorded real run on a loop.
3. After changes, `cd apps/web && bun run build` so port 7777 serves the new version.

## Read first (5 minutes max)
`apps/web/src/index.css` (design tokens), `src/App.tsx`, `src/app/{Layout,TopBar,AppShell}.tsx`, `src/components/*`, then skim `src/features/{sky,dag,queue,metrics,flock,agents}/` root components.

## What "incredible" means here (in priority order)
1. **Design tokens and atmosphere (biggest win).** A deep night-sky palette: near-black blue backgrounds with a subtle radial gradient and a faint star-field or noise texture. One luminous accent (warm amber/gold, like dusk light on starlings) plus a cool secondary (teal/cyan) for "live". Crisp typography: Inter or system UI, tight letter-spacing on headings, tabular numerals for every number. Glassy panels: translucent surfaces, 1px hairline borders at about 8% white, soft inner glow, generous radius, consistent spacing scale. Update the tokens in `index.css` so every panel inherits them.
2. **The Sky (the hero).** It should fill the centre and feel alive. Birds as soft glowing points or tiny chevrons with motion trails. Roosts (laptops) as labelled glowing nests with a subtle pulse when busy. Colour birds by state (working = accent, auditing = cyan, merged = brief gold flash, failed = soft red). Add a vignette. Keep the existing simulation logic: restyle the rendering only.
3. **Top bar.** Starling wordmark with a tiny bird glyph, run name, a pulsing LIVE / DEMO pill, big tabular counters (agents flying · tasks merged / total · elapsed · $ spent), and the Sky/DAG toggle as a segmented control.
4. **Merge queue and metrics strip.** Cards with status chips, smooth enter/exit transitions, a small progress bar per task, and a satisfying "merged ✓" moment.
5. **Flock rail.** Each laptop as a card (name, sessions used/free as a mini bar, CPU/RAM chips, online dot). The join code big and copyable, as if inviting someone into the flock.
6. **DAG view.** Nodes as glass pills coloured by status, animated edges on the critical path, dark xyflow background with dots.
7. **Agent drawer.** Clean tabs, a monospace log with subtle syntax colouring, and a diff with green/red gutters.

## Finish (last 3 minutes)
- `cd apps/web && bun run build` must succeed.
- `cd apps/web && bun test`: fix failures caused by changed text or classes only when the fix is quick. If a snapshot or class-name assertion fails purely because of styling, update the test. Don't spend more than 3 minutes here; the demo matters more.
- Commit, then print a 5-line summary of what changed and which views look best for the demo.
