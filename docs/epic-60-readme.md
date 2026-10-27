# Epic 60 — README, diagrams, CONTRIBUTING

**Status:** complete. Branch `epic/60-readme`. Lane: `README.md`, `CONTRIBUTING.md`,
`docs/assets/diagrams/**`.

## Goal

Write the front door: the README a judge or a Hacktoberfest contributor reads first, three diagrams that
explain the system without a wall of text, and a CONTRIBUTING that turns the swarm's lane methodology into an
on-ramp for humans and agents.

The README has to be honest as well as exciting. Waves 0, 1 and checkpoint C1 are merged and every package is
real, but the CLI still boots a **mock composition** until Epic 40. The README therefore documents every
command that runs today and marks the un-wired surfaces `⏳ v0.1` instead of describing behaviour that does not
exist.

## How it works

### README structure

1. Logo line, one-sentence pitch, four badges (CI, MIT, Hacktoberfest, Bun).
2. The C1 dashboard screenshot at 1920 px, above the fold.
3. **Status callout** — the v0.1-preview note that explains the mock composition up front.
4. **Why** — the four PRD problems, one line each.
5. **How it works** — the pipeline diagram plus six numbered stages (map, plan into lanes, flock, audit,
   merge queue, watch).
6. **Quickstart** — clone, `bun install`, `bun run starling doctor`, `init`, `plan`, `run`, dashboard, plus a
   verified-command table and an alias tip.
7. **Model routing** — role/model/where/why table, the measured local-model note, and the three
   `STARLING_LLM_PROFILE` routes.
8. **Flock mode** — hub and perch commands, discovery, scheduling, auth, failure and model-lending rules.
9. **Agent Skill** — three install targets (project, global, Claude Code) and `/swarm`.
10. **Demo and replay** — the recorded launch-day run and the `?demo=1` safety net.
11. **Architecture** — a compact ASCII map plus a one-line-per-package table.
12. **Built by the flock** — the meta-story, with a placeholder stats table for Epic 68.
13. **Roadmap**, **Contributing**, **License**.

Every code block was run on this checkout on 2026-10-27. Where output is shortened, the prose says so.

### The three diagrams

Hand-authored SVG, no generated assets, no external fonts or images, no dependencies:

| File | Shows |
| --- | --- |
| `docs/assets/diagrams/pipeline.svg` | goal → map → plan/lanes → flock → audit → merge queue → integration, including the audit→fix loop and the "lanes are disjoint" rule |
| `docs/assets/diagrams/flock-topology.svg` | hub with engine/auditor/merger/store/server, two perches, repo + result bundles, SSE events, discovery and heartbeat spine |
| `docs/assets/diagrams/model-routing.svg` | six roles fanned into DeepSeek V4.1 Flash (via opencode/API) and local Qwen (via Ollama), plus the three profiles |

Shared visual language: 1120 px viewBox, 12–16 px rounded boxes, a coloured cap per phase (teal for
understand, amber for run/audit, violet for merge), and one font stack (`ui-sans-serif` with system
fallbacks). Every SVG has `<title>` + `<desc>` and `role="img"`, so screen readers get the argument, not just
a list of shapes.

### CONTRIBUTING

Setup and prerequisites → repo map → **lanes** (declare them, freeze contracts, one owner per shared file) →
finding a good first issue → Conventional Commits → tests and checks (including the two-process web split
and the no-network rule) → the handback format → the binding rules for AI agents → a review checklist.

## Key decisions & reasoning

- **One palette for light and dark, not `prefers-color-scheme`.** The brief requires the SVGs to be readable
  on both GitHub themes with a transparent background. A media query inside an SVG-as-`<img>` follows the
  *OS* colour scheme, not GitHub's theme class, so a dark-OS/light-GitHub reader would get light text on
  white. Instead the diagrams use mid-luminance inks (`#6f7b89` body, `#5a6673` headings) that measure
  ≈4.1–4.6:1 against both `#ffffff` and GitHub's `#0d1117`, with accents picked for the same property
  (`#2f8f86` teal, `#c2740c` amber, `#8b5cf6` violet). Verified by rendering the SVGs on both backgrounds in
  headless Chrome. Cost: a little less contrast than a theme-aware pair would allow; benefit: one file each,
  correct in every combination.
- **Three files, not six.** Theme-specific variants would need `<picture>` wiring and would double the
  maintenance surface for a diagram set that changes with the architecture.
- **Honesty over polish.** `starling run` currently renders a scripted run; saying so in one compact status
  block is better than letting a judge discover it. The command table marks each surface `✅` or `⏳ v0.1`,
  and the quickstart shows the two-terminal dashboard workaround instead of pretending `starling dash` boots
  it.
- **Screenshot from C1, not a mockup.** `docs/assets/c1-dashboard-1920.png` is the real dashboard with two
  roosts, the murmuration, merge queue and cost meter. It is the only image the README embeds besides the
  diagrams.
- **The model table names the config default, not the newest measured candidate.** `starling.config.example`
  ships `qwen3.6:35b-a3b`; Epic 28 measured `qwen3.8:27b-mlx` at ~17 tok/s. The README shows the config
  default and a footnote pointing at the benchmark doc, so config and docs cannot drift apart.
- **No invented swarm numbers.** The "built by the flock" table has a real structure and placeholders
  (`see the graph`) because Epic 68 owns the collector. Inventing "1,785 tests, 78 PRs" would be stale the
  next day and wrong by the time a judge reads it.
- **CI badge points at `.github/workflows/ci.yml`.** That is the path Epic 52's prompt specifies. If the
  workflow lands under another name, the badge is a one-line README fix (see FIX REQUESTS).
- **`bun run starling` everywhere, not a bare `starling`.** There is no published binary yet; every example
  works from a fresh clone. The alias tip bridges the gap for people who run it daily.
- **Docs stay close to the lane.** No new images, no logo asset, no landing-page copy: Epic 59 owns the site,
  Epic 68 owns the stats, and duplicating either would create two sources of truth.

## Interfaces for future epics

- **Epic 59 (landing site):** reuse `docs/assets/diagrams/*.svg` by relative path or copy the files; do not
  fork the visual language. The README's model-routing and flock wording is the canonical short version.
- **Epic 52 (CI):** the badge URL is
  `https://github.com/broiisapro/starling/actions/workflows/ci.yml/badge.svg?branch=main`. Keep the workflow
  filename `ci.yml` and the badge resolves with no further work.
- **Epic 68 (swarm stats):** the placeholder table in "Built by the flock" is
  `| Waves | Epics | Agents | Laptops | PRs |`. Replace the four cells (and optionally add tests/lines) with
  collector output; the sentence about the placeholder must go at the same time.
- **Epic 40 / 42 / 61 (real wiring):** the `⏳ v0.1` markers live in the status callout, the command table, the
  planner output note, the dashboard paragraph, the perch snippet and the roadmap. When the CLI stops using
  `compose({mode:'mock'})`, search the README for `v0.1` and `mock composition` and flip them.
- **Epic 61 (onboarding):** `starling init` is documented with its current flags (`--profile`,
  `--force`). If `--yes`/`--dry-run` land, add them to the quickstart and the init snippet.

## Deviations from plan

- The brief mentioned a "demo GIF/screens"; the deliverable specified a screenshot, so there is one real
  screenshot and no GIF. A GIF needs a stable dashboard and a capture tool, both owned by other lanes.
- The three diagrams were rendered and checked in headless Chrome on light and dark backgrounds, but no
  PNG fallback is committed: GitHub renders SVG natively and the files are 5–8 KB each.
- `starling dash` is documented as two terminals. The command exists, but it only prints the URL and says the
  server is coming in Wave 2; the README says exactly that rather than documenting the intended behaviour as
  if it worked.
- CONTRIBUTING is longer than a typical OSS file because it carries the lane + handback methodology that
  makes this repo's parallel development reproducible. It is headed and table-driven so it stays scannable.

## Known limitations / deferred

- The README's "Built by the flock" numbers are deliberately placeholders until Epic 68 lands.
- The CI badge is dark until Epic 52's workflow exists on `main`. The badge itself cannot break the README.
- The dashboard screenshot shows the **demo** run (the badge in the top bar says `demo`), not a live
  DeepSeek run. That is the current C1 reality; Epic 53/41 will supply real-run screens.
- No `docs/assets/logo.svg`; the logo line is the emoji wordmark. A real mark is a design task, not this lane.
- The quickstart assumes macOS/Linux. Windows is explicitly out of scope for v0.1.
- Architecture diagrams describe the locked design (ARCHITECTURE §4/§6), including perch behaviour whose CLI
  wiring is still `⏳`; the README's status table is the source of truth for what runs today.

## Verification

Run in this worktree on 2026-10-27, macOS arm64, Bun 1.4.4.

| Check | Command | Result |
| --- | --- | --- |
| install | `bun install` | `Checked 162 installs across 221 packages (no changes)` |
| doctor | `bun run starling doctor` | 7 ok, 0 failed, 1 RAM warning (real output quoted in README) |
| init | `bun run starling init` (temp dir) | `✔ wrote starling.config.yaml  profile opencode-go` |
| plan | `bun run starling plan "add CSV export and fix the overdue date bug" --repo examples/sky-todo` | 5 tasks, no issues, exit 0 |
| dry run | `... run "..." --repo examples/sky-todo --dry-run` | "Dry run — no agents launched", exit 0 |
| run | `... run "..." --no-dash --record /tmp/starling-readme-run.jsonl` | 5 merged, 0 failed, branch `starling/zqpmky/integration`, 76 events recorded |
| status | `bun run starling status --file /tmp/starling-readme-run.jsonl` | run summary, 5 merged, token/cost split |
| replay | `bun run starling replay /tmp/starling-readme-run.jsonl --speed 200` | `replayed 76 events`, exit 0 |
| fixture replay | `bun run starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 200` | `replayed 252 events … run 9w0x1y finished`, exit 0 |
| flock | `bun run starling flock` | 2 mock nodes, join command with code `STAR-LING` |
| dash | `bun run starling dash` | prints URL and "waiting for apps/server + apps/web (wave 2)" |
| server | `STARLING_PORT=7903 bun run dev:server` + `curl /api/health` | `{"ok":true,"version":"0.0.0"}`, `/api/runs` 200 |
| web dev | `bun run dev:web` + `curl localhost:5173` | 200, `<title>Starling — the sky is loading 🐦</title>` |
| web build | `cd apps/web && bun run build` | Vite build succeeds, `dist/` |
| skill installer | `integrations/opencode/install.sh --dry-run` | both targets "would install" |
| alias tip | `bun run --cwd <repo> starling --version` | `0.0.0` |
| tests | `bun run test` | packages: **1359 pass, 4 skip, 0 fail**; web: **426 pass, 0 fail** (1,785 total) |
| check | `bun run check` | Biome clean (708 files), typecheck clean |

Tests and check were run against the merged Wave 1/C1 base plus this lane's Markdown and SVG only; no code
changed.
