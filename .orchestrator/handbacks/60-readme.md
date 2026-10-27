## Epic 60 Handback — README, diagrams, CONTRIBUTING

**Status:** Complete. Branch `epic/60-readme` @ `7bed355` (will be rebased on `origin/main` before push; the PR
diff is the source of truth). Closes #42.

**Delivered:**
- `README.md` — logo line, one-sentence pitch, CI/MIT/Hacktoberfest/Bun badges, the 1920 px C1 dashboard
  screenshot, a v0.1-preview status callout, the four PRD problems, a six-stage "How it works", a fully
  copy-pasteable quickstart, a verified-command table, model routing (table + profiles + measured local model),
  flock mode, Agent Skill install, demo/replay, the package table, the "built by the flock" story with
  placeholders for Epic 68, roadmap and license.
- `CONTRIBUTING.md` — prerequisites and setup, repo map, lane rules (declare your lane, frozen contracts, one
  owner per shared file), how to pick a good first issue, Conventional Commits, the two-process test split and
  no-network rule, the handback format, binding instructions for AI agents, and a review checklist.
- `docs/assets/diagrams/pipeline.svg` — goal → map → plan/lanes → flock → audit → merge queue → integration,
  with the audit→fix loop and the disjoint-lane rule.
- `docs/assets/diagrams/flock-topology.svg` — hub (engine/scheduler/auditor/merger/store/server), two perches,
  `StartTaskOptions` + git bundles out, result bundle + `AgentEvents` back, mDNS/heartbeat/token spine.
- `docs/assets/diagrams/model-routing.svg` — six roles → DeepSeek V4.1 Flash and local Qwen → opencode/API and
  Ollama, plus the `deepseek` / `opencode` / `local` profiles.
- `docs/assets/diagrams/README.md` — palette with measured contrast on white and `#0d1117`, grid, accessibility
  and editing/rendering instructions.
- `docs/epic-60-readme.md` — decisions, interfaces for future epics, deferred items and the full verification
  table.

**Key design decisions:**
- **One mid-contrast palette, no `prefers-color-scheme`.** SVG-as-`<img>` media queries follow the OS scheme,
  not GitHub's theme class, so a dark-OS/light-GitHub reader could get light text on white. Mid-luminance inks
  (`#6f7b89` body, `#5a6673` headings) measure ≈4.1–5.9:1 against both backgrounds; accents were chosen for the
  same property. Verified by rendering each diagram on `#ffffff` and `#0d1117` in headless Chrome. Alternative
  considered: six theme-specific files + `<picture>` — rejected as double the maintenance for no extra
  legibility.
- **Honesty over polish.** The CLI is still on `compose({mode:'mock'})`, so the README says so in one status
  block and marks every un-wired surface `⏳ v0.1` (dash, perch, `--github`, `--fully-open`, real planner/run),
  and documents the two-terminal dashboard workaround. No command in the README is described as working unless
  it was run here.
- **Show the config default, footnote the benchmark.** `starling.config.example.yaml` ships
  `qwen3.6:35b-a3b`; Epic 28 measured `qwen3.8:27b-mlx` at ~17 tok/s. The table names the config default and
  points at `docs/epic-28-local-bench.md`, so docs and config cannot drift silently.
- **No invented swarm numbers.** The "Built by the flock" table is structurally real but its numbers are
  placeholders (`see the graph`); Epic 68 owns the collector. Hard-coding today's 1,785 tests or 28 PRs would be
  stale by judging day.
- **`bun run starling` in every example.** There is no published binary yet; an alias tip bridges the gap.
  CONTRIBUTING is longer than typical OSS docs because it carries the lane + handback method that makes this
  repo's parallel history reproducible.

**Verification (exact commands + results):**
- `bun install` → `Checked 162 installs across 221 packages (no changes) [22.00ms]`
- `bun run starling doctor` → `✔ 7 ok · ✘ 0 failed · ! 1 warning` (RAM warning, quoted verbatim in README)
- `bun run starling init` (temp dir) → `✔ wrote starling.config.yaml  profile opencode-go`
- `bun run starling plan "add CSV export and fix the overdue date bug" --repo examples/sky-todo` → 5 tasks, `✔ No issues`, exit 0
- `bun run starling run "…" --repo examples/sky-todo --dry-run` → `Dry run — no agents launched`, exit 0
- `bun run starling run "…" --repo examples/sky-todo --no-dash --record /tmp/starling-readme-run.jsonl` → `5 merged · 0 failed`, branch `starling/zqpmky/integration`, `recorded 76 events`
- `bun run starling status --file /tmp/starling-readme-run.jsonl` → run summary, 5 merged, `api $0.004 · local $0 · saved $0.002`
- `bun run starling replay /tmp/starling-readme-run.jsonl --speed 200` → `replayed 76 events`, exit 0
- `bun run starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 200` → `replayed 252 events … run 9w0x1y finished`, exit 0
- `bun run starling flock` → 2 mock nodes, join command `starling perch --hub http://localhost:7777 --code STAR-LING`
- `bun run starling dash` → prints URL and `waiting for apps/server + apps/web (wave 2)`
- `STARLING_PORT=7903 bun run dev:server` + `curl /api/health` → `{"ok":true,"version":"0.0.0"}`; `/api/runs` 200
- `bun run dev:web` + `curl localhost:5173` → 200, `<title>Starling — the sky is loading 🐦</title>`
- `cd apps/web && bun run build` → Vite build succeeds
- `integrations/opencode/install.sh --dry-run` → `skills/starling would install`, `commands/swarm.md would install`
- `bun run --cwd <repo> starling --version` → `0.0.0`
- **`bun run test` (root)** → packages: `1359 pass · 4 skip · 0 fail · Ran 1363 tests across 162 files [20.52s]`; web: `426 pass · 0 fail · Ran 426 tests across 39 files [2.63s]`; `EXIT=0`
- **`bun run check`** → `Checked 710 files in 818ms. No fixes applied.` + `tsc --noEmit` loop clean, `EXIT=0`
- `xmllint --noout docs/assets/diagrams/*.svg` → XML_OK
- Diagrams rendered at 1120 px on white and `#0d1117` in headless Chrome; both readable.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none.

**FIX REQUESTS:**
1. **Epic 52 (CI)** — keep the workflow filename `.github/workflows/ci.yml`; the README badge points at
   `https://github.com/broiisapro/starling/actions/workflows/ci.yml/badge.svg?branch=main`. If it needs a
   different name, ask me for a one-line README change rather than editing it. Make the workflow run
   `bun run check` and both `test:packages` + `test:web` halves so the badge means what the README says.
2. **Epic 40 / 42 / 61 (real wiring)** — when the CLI drops the mock composition, update the README's `⏳ v0.1`
   markers and the status callout. Search `README.md` for `v0.1`, `mock composition` and `two-terminal`. Also
   remove `apps/cli`'s footer "Wave 1 runs on the mock composition; real wiring lands in Epic 40" (not my
   lane) — it is the last stale Wave 1 string a user sees.
3. **Epic 68 (swarm stats)** — replace the placeholder table in `README.md` §"Built by the flock"
   (`| Waves | Epics | Agents | Laptops | PRs |`) and the sentence below it with collector output, then delete
   the "coming in v0.2" note.
4. **Epic 61 (onboarding)** — if `starling init` gains `--yes`/`--dry-run`, add them to the README quickstart
   and the CONTRIBUTING setup example.
5. **Epic 59 (landing site)** — reuse `docs/assets/diagrams/*.svg` and the palette rules in
   `docs/assets/diagrams/README.md`; do not fork a second diagram set.

**Deliberately deferred / out of scope:**
- Demo GIF (the brief allowed screenshot(s); a GIF needs a stable live dashboard owned by other lanes).
- Release notes / CHANGELOG, landing-site copy, a real logo mark, Windows instructions.
- Live swarm numbers — Epic 68 owns the collector; README keeps honest placeholders.
- Real-run screenshots — the only committed screenshot is the C1 demo run.

**Open questions / flagged tradeoffs:**
- **CI badge is dark until Epic 52 merges.** It resolves automatically once `.github/workflows/ci.yml` exists;
  the alternative was omitting the badge, which felt worse for a repo that is about to gate every PR.
- **Heading ink `#5a6673` is 3.2:1 on GitHub dark** — fine at 24 px/650 weight and for box titles, below 4.5
  for long body copy, which is why body text uses `#6f7b89` (4.1:1). A theme-aware SVG would allow more
  contrast but breaks under GitHub's theme/OS mismatch; the single-palette tradeoff is documented in
  `docs/assets/diagrams/README.md`.
- **Test count is stated as 1,785** (the exact root run on this base). It will move as Wave 2 merges; the README
  only uses it once, in CONTRIBUTING, and it is cheap to update.
