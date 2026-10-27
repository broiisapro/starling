# Browser end-to-end tests (Epic 71)

Playwright drives the real dashboard in Chromium: the recorded launch-day run at 16×, every region,
the keyboard, the Sky's canvas birds, reduced motion, and visual snapshots at both stage sizes.

## One-time setup

Playwright's browser binary is not an npm dependency — install it once per machine:

```bash
cd apps/web
bunx playwright install chromium
```

(`@playwright/test` itself is pinned in `apps/web/package.json`.)

## Run

```bash
bun run --cwd apps/web e2e
```

The suite starts the Vite dev server itself on a port derived from the worktree path (override with
`STARLING_E2E_PORT=…`), so several worktrees can run it at once without colliding. It needs no
Starling server, no API key and no network: `?demo=1` replays the checked-in
`fixtures/runs/sky-todo-launch-day.jsonl`.

Expect ~1.5–2 minutes: two tests pay the full ~22 s replay (one for behaviour, one per viewport for
the snapshots), everything else injects the same end state into the store and runs in a second.

## Snapshots

Baselines live in `e2e/__screenshots__/` (`end-1280x720.png`, `end-1920x1080.png`).

```bash
bun run --cwd apps/web e2e:update   # re-record after an intentional visual change
```

The Sky's canvas is masked: boids are the only deliberately moving pixels, and the Sky has no pause
hook yet (FIX REQUEST to Epic 47). Fonts fall back to the platform stack, so the baselines are
recorded on macOS/darwin — a Linux CI runner will need its own set (FIX REQUEST to Epic 52).

## Not part of `bun run test`

Files are named `*.pw.ts`, which Bun's test runner never matches. CI wiring is out of scope for this
epic (FIX REQUEST to Epic 52).
