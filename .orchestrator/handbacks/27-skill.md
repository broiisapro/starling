## Epic 27 Handback — Agent Skill + opencode integration

**Status:** Complete. Branch `epic/27-skill` @ `12c2e4c` (this handback commit on top).
**Delivered:**
- `skills/starling/SKILL.md` — 173-line portable Agent Skill. Frontmatter: `name: starling` (matches the
  directory and the spec regex), a 564-char description that triggers on "parallelise this",
  "parallelize this", "split into tasks" and "run a swarm" and explicitly excludes one-file fixes,
  `license: MIT`, `compatibility` (≤500), `metadata.version: "0.1"`. Body: when to use / not use, the four
  steps (plan → review lanes → confirm + dry-run + run → watch/report), goal-writing rules, result reading,
  safety and a reference index.
- `skills/starling/reference/{goals,lanes,flock,troubleshooting}.md` — 87/93/80/135 lines. Goal anatomy and
  examples, lane review and the five plan-issue classes, hub/perch scheduling and failure modes, and a
  troubleshooting guide with the wrapper exit codes.
- `skills/starling/scripts/lib.sh` — CLI resolver (`$STARLING_BIN` → `PATH` → repo checkout with Bun →
  `bunx starling`), argv runner with labelled failure reporting, block-YAML `budget.maxUsd` reader, numeric
  guard.
- `skills/starling/scripts/plan.sh` — JSON by default (`--pretty` opt-out; an explicit `--json` is not
  duplicated), forwards `--repo`, exits 2 with usage when no goal.
- `skills/starling/scripts/run.sh` — parses `--budget <usd>` and `--yes`, forwards every other `starling run`
  flag, refuses a real run without a numeric `budget.maxUsd` (exit 2 with the exact YAML to add), enforces
  `--budget` as a stricter entry cap, skips the check for `--dry-run`, distinguishes a missing goal from a
  missing budget.
- `skills/starling/scripts/status.sh` — passthrough with usage and 127 handling.
- `skills/starling/scripts/replay-demo.sh` — replays `fixtures/runs/sky-todo-launch-day.jsonl` at `--speed`
  (default 4), validates the speed, refuses unknown flags, exits 2 if the fixture is missing.
- `skills/starling/examples/{launch-day,lane-repair}.md` — two clearly labelled illustrative transcripts. The
  second deliberately shows a `lane-overlap` stop sign and a re-plan rather than an unsafe launch.
- `integrations/opencode/commands/swarm.md` — `/swarm` command: `$ARGUMENTS` is the goal; resolves the scripts
  from project/global opencode/global Claude paths; plans, shows the lane table, stops on issues, asks for
  confirmation, dry-runs, runs, reports by exception.
- `integrations/opencode/install.sh` — `--project` (default), `--global`, `--dir <path>`, `--dry-run`, `--help`.
  Installs `skills/starling/` (12 files, tests excluded) and `commands/swarm.md`. Content-based idempotency
  (`diff -rq -x '*.test.ts'`, `cmp -s`), never touches unrelated commands, preserves executable bits.
- `integrations/opencode/README.md` + `integrations/claude-code/README.md` — install/use docs for both agents;
  Claude Code one-liner is `integrations/opencode/install.sh --dir ~/.claude`.
- `skills/biome.json`, `integrations/biome.json` — lane-local Biome configs (`extends: "//"`, Markdown
  formatter disabled) because Biome 2.6 rewrites YAML frontmatter and breaks `SKILL.md`.
- Tests: `skills/starling/skill.test.ts`, `skills/starling/scripts/scripts.test.ts`,
  `integrations/opencode/install.test.ts` — 40 offline tests.
- `docs/epic-27-skill.md` — research links (Agent Skills spec, opencode v1/v2 docs, Claude Code), discovery
  table, exact interfaces, decisions, deviations and limits.

**Key design decisions:**
- **Portable-first, opencode-second.** The skill is standard `SKILL.md` + `reference/` + `scripts/`; the
  opencode command and installer are adapters. Claude Code uses the same files. Verified discovery paths
  against the installed `opencode v2.1.2` (`opencode --version`, `opencode debug paths/config`) and the live
  global skill at `~/.config/opencode/skills/ui-ux-pro-max/SKILL.md`.
- **Commands go to `commands/` (plural).** v2 docs say plural for new files and still read the legacy
  singular `command/`; choosing plural now avoids rot.
- **JSON is the default for `plan.sh`.** The caller is an agent; humans opt into `--pretty`. The wrapper does
  not parse plan JSON, so an envelope change is a one-line `jq` update in the caller, not four script edits.
- **Budget is a preflight, not a pretend guarantee.** The locked CLI has no `--budget` flag, so `run.sh`
  reads `budget.maxUsd`, refuses a paid run without one, and treats `--budget` as a stricter entry cap. The
  docs and skill say the CLI/engine enforces the real cap. A CONTRACT REQUEST asks Epic 22 to add the flag so
  the wrapper can forward it.
- **Content-based idempotency.** A second `install.sh` run reports `unchanged` and touches no mtimes content;
  tests assert byte-identical snapshots and preserved unrelated commands.
- **No new dependencies.** Tests parse YAML with `Bun.YAML` and spawn with `Bun.spawnSync`; bash stays 3.2
  compatible (macOS default).
- **Illustrative transcripts.** Recordings would be stale before the engine exists; they are labelled and
  mirror `examples/sky-todo/demo-goals/launch-day.expected.md`.

**Verification (exact commands + results):**
- `bun install`: `Checked 133 installs across 192 packages (no changes)`.
- `bun test skills integrations`: `40 pass / 0 fail, 149 expect() calls, Ran 40 tests across 3 files`.
- `bun run test` (root): `227 pass / 0 fail, 937 expect() calls, Ran 227 tests across 40 files`.
- `bun run typecheck`: all 18 workspaces pass (no output).
- `bunx biome check skills integrations docs/epic-27-skill.md`: `Checked 16 files in 6ms. No fixes applied.`
- `bun run check`: **9 errors, all pre-existing outside this lane** — `docs/epic-01-demo-target.md`,
  `docs/epic-02-repo-ops.md`, `tools/local-models/{host,ollama,smoke}.ts`, `tools/local-models/ollama.test.ts`
  and two `tools/local-models/results/*.json`. Verified by exporting `main` with `git archive` into a temp
  directory and running the same Biome binary: `Checked 150 files ... Found 9 errors`, same list. Nothing in
  this lane is reported.
- `bash -n` on `lib.sh` and all four wrappers: ok (also asserted by the test suite).
- `bash integrations/opencode/install.sh --project` in a temp copy of `examples/sky-todo`:
  ```
  Starling → opencode install (project)
    source  /Users/moksh/Code/starling-wt/27-skill
    base    /var/folders/.../sky-todo-install2.bTg72E/.opencode
    skills/starling              installed (12 files)
    commands/swarm.md            installed
  Done. Reload opencode (`opencode reload`) or restart it, then run /swarm <goal>.
  ```
  Second run: `skills/starling unchanged (12 files)` / `commands/swarm.md unchanged`.
  Installed listing:
  ```
  .opencode/commands/swarm.md
  .opencode/skills/starling/SKILL.md
  .opencode/skills/starling/examples/lane-repair.md
  .opencode/skills/starling/examples/launch-day.md
  .opencode/skills/starling/reference/flock.md
  .opencode/skills/starling/reference/goals.md
  .opencode/skills/starling/reference/lanes.md
  .opencode/skills/starling/reference/troubleshooting.md
  .opencode/skills/starling/scripts/lib.sh
  .opencode/skills/starling/scripts/plan.sh
  .opencode/skills/starling/scripts/replay-demo.sh
  .opencode/skills/starling/scripts/run.sh
  .opencode/skills/starling/scripts/status.sh
  ```
- No live/network calls: every script test uses a fake `starling` on `PATH`; the 127 test uses a PATH with
  only `dirname`. The installer tests run entirely in `mkdtemp` sandboxes.

**Dependencies added:** none.

**CONTRACT REQUESTS:**
1. **CLI (Epic 22), ARCHITECTURE §6 `starling run`:** add `--budget <usd>` that overrides
   `budget.maxUsd` for this run and is enforced by the engine/ledger. Why: the skill's safety story needs a
   per-run cap that a shell wrapper cannot enforce mid-run. Once it exists, `run.sh` can drop its preflight
   arithmetic and forward the flag.
2. **CLI (Epic 22), `starling plan --json`:** guarantee that stdout contains only the plan object
   (`{ plan, issues }` or a bare `Plan`) and that progress/logs go to stderr. The skill's documented parsing
   (`jq '.plan // .'`, `jq '.issues // []'`) depends on this; it is already implied by "print the raw plan"
   but worth pinning down in the CLI tests.

**Deliberately deferred / out of scope:**
- CLI implementation, engine behaviour and real swarm execution — Epic 22/20; this epic targets the locked
  surface with a fake binary.
- Live end-to-end `/swarm` from opencode, and replacing the illustrative transcripts with a real recording —
  Epic 50 (skill dogfood). No `*.live.test.ts` is added here because it would need `opencode serve`.
- Marketplace/publishing, `skills-ref validate` as a committed check, and Windows support.
- Fixing the 9 pre-existing Biome failures outside this lane (docs/epic-01, docs/epic-02, tools/local-models).

**Open questions / flagged tradeoffs:**
- **Budget semantics:** is `--budget` an override (my request) or a hard ceiling that refuses to exceed the
  config? I implemented the latter as a preflight because it is safe either way; Epic 22 should pick one and
  wire the engine to it.
- **Plan envelope:** `{plan,issues}` vs bare plan is tolerated today. If the CLI settles on a third shape,
  the skill and `/swarm` need the same one-line `jq` change.
- **Custom install dirs:** `/swarm` resolves `.opencode`, `~/.config/opencode` and `~/.claude`; an
  `install.sh --dir /opt/foo` install needs `SKILL_SCRIPTS` set manually. I did not add a generated path
  because the command file must stay portable.
- **Markdown formatting:** nested Biome configs disable the Markdown formatter for this lane rather than
  editing the orchestrator-owned root config. If the root config later disables `markdown.formatter` or
  `formatEmbeds`, these two files can be deleted.

Closes #21
