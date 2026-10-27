# Epic 27 — Agent Skill + opencode integration

## Goal

Ship Starling as a portable **Agent Skill** (`SKILL.md`) and an opencode **`/swarm` command**, so a coding
agent can hand a multi-part goal to the flock instead of grinding through it serially. The skill has to be
good enough to trigger on the right requests, teach the four-step workflow (plan → review lanes → run →
report), and fail safely when the plan or the budget is wrong.

Everything here is Markdown and bash. No model is called and no swarm is launched in this epic; the scripts
target the CLI surface locked in ARCHITECTURE §6 (Epic 22 implements it).

## How it works

### Layout

```text
skills/
├── biome.json                     # lane-local Biome config (see key decisions)
└── starling/
    ├── SKILL.md                   # 171 lines, frontmatter + workflow + safety
    ├── reference/
    │   ├── goals.md               # how to phrase a splittable goal
    │   ├── lanes.md               # reading/reviewing lanes and plan issues
    │   ├── flock.md               # perches, capacity, failure behaviour
    │   └── troubleshooting.md     # exit codes, stalls, audits, conflicts
    ├── scripts/
    │   ├── lib.sh                 # resolver, runner, budget parser, exit codes
    │   ├── plan.sh                # read-only plan, JSON by default
    │   ├── run.sh                 # budget preflight, then starling run
    │   ├── status.sh              # starling status passthrough
    │   └── replay-demo.sh         # fixture replay, offline
    ├── examples/
    │   ├── launch-day.md          # seven-task worked transcript (illustrative)
    │   └── lane-repair.md         # stop-sign-on-overlap worked transcript
    └── skill.test.ts              # frontmatter, links, examples, modes
integrations/
├── biome.json                     # lane-local Biome config
├── opencode/
│   ├── README.md
│   ├── commands/swarm.md          # /swarm — the command source
│   ├── install.sh                 # project/global/dir installer, idempotent
│   └── install.test.ts            # install matrix, idempotency, dry-run
└── claude-code/
    └── README.md                  # one-liner + discovery differences
```

### Research: where agents look for skills and commands

Installed tool: `opencode v2.1.2` (`opencode --version`). `opencode debug paths` reports the config root as
`~/.config/opencode`; `opencode debug config` lists both the global config directory and the project
`.opencode` directory. The machine already has a global skill at
`~/.config/opencode/skills/ui-ux-pro-max/SKILL.md`, which confirms that path is live on this install.

| Thing              | Source                              | Discovery                                                                                                                  |
| ------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Skill, global      | opencode v2 docs, Agent Skills spec | `~/.config/opencode/skills/<id>/SKILL.md`; compatibility dirs `~/.claude/skills`, `~/.agents/skills`                       |
| Skill, project     | opencode v2 docs                    | `.opencode/skills/<id>/SKILL.md`; walks up to the project root; `.claude/skills`, `.agents/skills` also read               |
| Command, global    | opencode v2 docs                    | `~/.config/opencode/commands/<name>.md`                                                                                    |
| Command, project   | opencode v2 docs                    | `.opencode/commands/<name>.md`; legacy singular `command/` is still discovered; nested dirs become `/team/review`          |
| Skill, Claude Code | Claude Code docs                    | `~/.claude/skills/<name>/SKILL.md` (personal), `.claude/skills/<name>/SKILL.md` (project); commands are merged into skills |

Links:

- Agent Skills specification: <https://agentskills.io/specification>
- opencode v2 Agent Skills: <https://opencode.ai/v2/docs/skills/>
- opencode v2 commands: <https://opencode.ai/v2/docs/commands/>
- opencode v1 skills (legacy `skill({name})` API): <https://opencode.ai/docs/skills/>
- opencode v1 commands: <https://opencode.ai/docs/commands/>
- Claude Code skills: <https://docs.claude.com/en/docs/claude-code/skills>

What this means in practice:

- The portable part is `SKILL.md` + `reference/` + `scripts/` + `examples/`; all three agents read the same
  files. The skill ID is `starling` in both v1 and v2 because the directory name and frontmatter `name`
  match.
- For opencode v2 we install commands under **`commands/` (plural)**. v2 still discovers the legacy singular
  `command/`, but the docs say to use plural for new files, so the installer does.
- opencode v2 does not enforce the spec's name regex or description limit at runtime; Claude Code and the
  spec do. The skill satisfies the strict version (name regex, description ≤1024, compatibility ≤500).
- v2 loads the skill body and gives the agent the skill's base directory plus a sample of supporting files.
  That is why the body can point at `reference/*.md` and `scripts/*.sh` instead of inlining everything.

### The skill's contract

Frontmatter:

```yaml
name: starling
description: "…multi-part… parallelise this … split into tasks … run a swarm … one-file fix"
license: MIT
compatibility: "Requires git and the `starling` CLI, or a Starling checkout with Bun >= 1.4. …"
metadata:
  version: "0.1"
```

The description names the trigger phrases and, just as importantly, the **negative** case (a one-file fix).
The 171-line body covers when to use it, when not to, the four-step workflow, how to write a goal, how to read
the result, safety, and a reference table. Detail lives in four reference files so a model that only needs the
workflow does not pay for the flock internals.

### The four-step workflow

1. `plan.sh --json "<goal>"` — read-only; maps the repo and prints the plan (tasks, lanes, DAG, issues).
2. Review the lanes — disjoint `owns` for concurrent tasks, non-empty DoD, real dependencies, no shared
   integration file. Any `lane-overlap`/`cycle`/`missing-dep`/`empty-dod`/`empty-lane` is a stop sign.
3. Confirm with the human, `run.sh --dry-run`, then `run.sh`.
4. `status.sh` and report by exception; finish with the integration branch, verdicts, cost and next step.

The skill never asks the model to hand-decompose the goal. That is the planner's job, and hand-edited plans
are re-validated (and rejected) by the engine anyway.

### `scripts/lib.sh` and the four wrappers

`lib.sh` is the only place that knows how to find and run the CLI:

1. `$STARLING_BIN` if set and executable (clear error if not);
2. `starling` on `PATH`;
3. `apps/cli/src/index.ts` from this checkout, run with Bun (`bun` via `$BUN_BIN`, `PATH`, or
   `~/.bun/bin/bun`);
4. `bunx starling` (or `bun x starling` when only Bun is present).

If none work it exits **127** and prints every location it tried plus the troubleshooting reference. This is
the difference between "the skill is broken" and "install the CLI".

| Script           | Behaviour                                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan.sh`        | forces `--json` unless `--pretty`; accepts an explicit `--json` without duplicating it; forwards `--repo` and the goal; usage/exit 2 with no goal                                                                                |
| `run.sh`         | parses `--budget <usd>` and `--yes` itself, forwards everything else (`--dry-run`, `--repo`, `--max-parallel`, `--github`, `--fully-open`, `--record`, `--no-dash`); validates the goal is a positional argument, not just flags |
| `status.sh`      | pass-through to `starling status [runId]`                                                                                                                                                                                        |
| `replay-demo.sh` | replays `fixtures/runs/sky-todo-launch-day.jsonl` at `--speed` (default 4), refuses other flags and bad speeds, errors if the fixture is missing                                                                                 |

All are bash 3.2 (the macOS default), use `set -euo pipefail`, quote paths, and report the CLI's exit code.
None of them parse or rewrite plan JSON; that stays the caller's job (`jq '.plan // .'`), so a future CLI
change to the plan envelope does not require editing four scripts.

### Budget preflight

The locked CLI surface has `budget.maxUsd` in `starling.config.yaml` but no `--budget` flag. The assignment
asks for a budget flag in the safety section, so `run.sh` implements an honest wrapper-level check:

- read `budget.maxUsd` from `<repo>/starling.config.yaml` (simple block YAML, comments and quotes tolerated);
- a real run with no numeric budget is **refused** (exit 2) with the exact YAML to add; `--yes` accepts the
  CLI default and warns;
- `--budget <usd>` is an entry cap: if the configured budget is **higher**, the run is refused; `--dry-run`
  skips the check.

The wrapper cannot enforce spend mid-run. That belongs to the CLI/engine (see the contract request in the
handback), and the skill says so instead of implying a guarantee it cannot make.

### `/swarm`

`commands/swarm.md` is an opencode v2 command template. `$ARGUMENTS` is the goal. It instructs the agent to:

0. resolve the scripts from `.opencode/skills`, `~/.config/opencode/skills` or `~/.claude/skills`;
1. reject an empty goal or a one-file goal;
2. plan JSON, then show a task/lane table;
3. stop on any validation issue and offer a re-plan or a split;
4. ask for confirmation;
5. dry-run, then run (and never pass `--yes` on the user's behalf);
6. report by exception and finish with the integration branch and verdicts.

The command does not hard-code a project path, which is what makes `install.sh --global` work. It also warns
against nested swarms, hand-edited plans and treating the integration branch as shipped.

### `install.sh`

Targets:

- `--project` (default): `<cwd>/.opencode/skills/starling/` + `<cwd>/.opencode/commands/swarm.md`;
- `--global`: `${XDG_CONFIG_HOME:-~/.config}/opencode/...`;
- `--dir <path>`: an explicit config directory (used for Claude Code: `--dir ~/.claude`);
- `--dry-run`: report, write nothing.

Idempotency is content-based, not timestamp-based: a directory is untouched when `diff -rq` reports no
difference, and a command file is untouched when `cmp -s` passes. Otherwise the destination skill is replaced
(so deleted source files do not linger) but **unrelated commands are never touched**. The script prints the
source, the target, and `installed`/`unchanged` plus a file count for each item. It is re-run after every skill
edit.

### Tests (offline)

`bun test skills integrations` runs 40 tests across three files:

- `skill.test.ts` — parses frontmatter with `Bun.YAML`, checks name/dir/regex, description length and trigger
  phrases, compatibility length, metadata, body length; walks every Markdown link and asserts the target
  exists; checks the four references, examples and executable wrappers.
- `scripts/scripts.test.ts` — `bash -n` for every script, `--help` for each wrapper, argv assertions through
  a fake `starling` on `PATH` (plan JSON default, `--pretty`, budget accept/refuse, `--yes`, status, replay
  speed), usage errors, and a 127 path with `PATH` stripped to a directory containing only `dirname`.
- `install.test.ts` — project/global/dir installs, faithful copies, executable bits, second-run idempotency,
  unrelated files preserved, dry-run writes nothing, and the installed `SKILL.md`/command still parse.

No test starts a server, loads a model, calls opencode, or touches GitHub.

## Key decisions & reasoning

- **The skill is portable-first, opencode-second.** Everything that matters is in `SKILL.md` and its sibling
  directories; the opencode command and installer are thin adapters. Claude Code works with the same files,
  and so will any agent that follows the Agent Skills spec.
- **`name` matches the directory and the description carries the negative case.** v2 uses the path as the ID
  (frontmatter `name` is only a display label), v1 and Claude Code use the name. Matching the directory keeps
  all three consistent. The description says "do not use for a one-file fix" because the most expensive
  failure mode is launching a swarm for a typo.
- **171-line SKILL.md, four references.** The spec recommends <500 lines and progressive disclosure; the
  assignment asked for ~300. Keeping the body short means a model that decides _not_ to use the skill pays
  almost nothing, and the reference files stay focused enough to load individually.
- **JSON by default in `plan.sh`.** The primary caller is an agent; humans get `--pretty`. `plan.sh` also
  tolerates an explicit `--json` so copied commands do not double the flag.
- **Thin wrappers, not a second CLI.** Parsing flags in bash duplicates Commander and drifts. Only `--budget`
  and `--yes` are intercepted because they are safety, not transport. Everything else is forwarded verbatim.
- **The budget check is a preflight, and the docs say so.** Pretending a wrapper can enforce a run-wide spend
  cap would be worse than not checking: the skill tells the user to set `budget.maxUsd` and files the real
  enforcement as a CLI contract request.
- **`commands/` (plural) for opencode v2, with the legacy dir still supported by opencode.** The v2 docs are
  explicit that plural is for new files; installing into `command/` would work today and rot later.
- **Content-based idempotency (`diff -rq`, `cmp -s`).** It is O(files) but the skill is tiny, and it means a
  re-run after no edits is genuinely a no-op instead of a timestamp rewrite that pollutes a repo's git status.
- **Markdown is not formatted by Biome inside this lane.** Biome 2.6's Markdown formatter treats YAML
  frontmatter as an embedded YAML block (`formatEmbeds` defaults to `true`) and rewrites `metadata.version`
  and the opening `---`, which breaks the skill. Rather than edit the orchestrator-owned root `biome.json`,
  `skills/biome.json` and `integrations/biome.json` use `"extends": "//"` to inherit the root rules and disable
  only the Markdown formatter. JS/TS in the lane is still formatted and linted by the root config.
- **Bash 3.2, no dependencies.** macOS ships 3.2. No `mapfile`, associative arrays, `${var,,}`, globstar or
  `rsync` dependency. The tests use Bun's built-ins (`Bun.YAML`, `Bun.spawnSync`) rather than adding packages.
- **Illustrative transcripts, clearly labelled.** They show the judgement calls (wide vs narrow DAG, a
  `lane-overlap` stop sign) that a raw command list cannot. They are not recordings and say so in the first
  line; Epic 50 replaces them with a real `/swarm` session.

## Interfaces for future epics

### Skill package (read-only for consumers)

```text
skills/starling/SKILL.md                  # frontmatter: name=starling, description≤1024, license, compatibility, metadata.version
skills/starling/reference/{goals,lanes,flock,troubleshooting}.md
skills/starling/scripts/{lib,plan,run,status,replay-demo}.sh
skills/starling/examples/{launch-day,lane-repair}.md
```

Discovery targets (opencode v2.1.2 and Claude Code):

```text
.opencode/skills/starling/SKILL.md
~/.config/opencode/skills/starling/SKILL.md
.claude/skills/starling/SKILL.md
~/.claude/skills/starling/SKILL.md
.opencode/commands/swarm.md
~/.config/opencode/commands/swarm.md
.claude/commands/swarm.md
~/.claude/commands/swarm.md
```

### Executable interfaces

```bash
plan.sh   [--repo <path>] [--pretty] "<goal>"
          # stdout: plan JSON (see below); stderr: diagnostics
          # exit: 0 ok · 2 usage · 127 CLI not found · other: CLI exit code

run.sh    [--dry-run] [--budget <usd>] [--yes] [starling-run flags] "<goal>"
          # starling-run flags: --repo, --max-parallel, --github, --fully-open,
          #                     --record, --no-dash
          # exit: 0 run finished · 2 usage/preflight refusal · 1 CLI failure · 127 not found

status.sh [runId]
          # stdout: the CLI's status report (human-readable until the CLI adds --json)
          # exit: 0 ok · 2 usage · 127 not found · other: CLI exit code

replay-demo.sh [--speed <factor>]      # default 4; fixture: fixtures/runs/sky-todo-launch-day.jsonl
          # exit: 0 ok · 2 usage/missing fixture · 127 not found

install.sh [--project|--global] [--dir <path>] [--dry-run]
          # exit: 0 ok · 2 usage · 1 missing source
          # writes: <base>/skills/starling/**, <base>/commands/swarm.md
```

Environment:

| Variable          | Used by                | Meaning                                                        |
| ----------------- | ---------------------- | -------------------------------------------------------------- |
| `STARLING_BIN`    | all wrappers           | explicit executable path; wins over `PATH`; must be executable |
| `BUN_BIN`         | lib fallback           | explicit Bun path when falling back to a checkout              |
| `XDG_CONFIG_HOME` | `install.sh --global`  | overrides `~/.config`                                          |
| `HOME`            | all wrappers/installer | Bun fallback and global install target                         |

Plan JSON contract consumed by the skill (normalise both shapes):

```bash
plan_json="$("$SKILL_SCRIPTS/plan.sh" --repo "$repo" "$goal")"
plan="$(printf '%s' "$plan_json" | jq '.plan // .')"
issues="$(printf '%s' "$plan_json" | jq '.issues // []')"
```

The object is `{ plan: Plan, issues: PlanIssue[] }` when the planner returns issues, or a bare `Plan`. Epic 22
should make `starling plan --json` print exactly this and nothing else on stdout.

### opencode command interface

`commands/swarm.md`:

- file name → `/swarm`;
- frontmatter: `description` only (agent/model default to the session);
- body is the template; `$ARGUMENTS` is the full goal string;
- step 0 resolves `SKILL_SCRIPTS` from project `/.opencode`, global opencode, or global Claude Code;
- it must never call `--yes`, never edit a plan, and never launch a nested run.

### Usage snippet for a future epic (e.g. E50 dogfood)

```bash
# From an opencode session in the target repo, after install.sh --project:
/swarm Add dark mode, live search, CSV export, due-date badges and fix the date bugs

# Or script it directly:
goal='Add dark mode, live search, CSV export and fix the date bugs'
"$repo/.opencode/skills/starling/scripts/plan.sh" --repo "$repo" "$goal" > /tmp/plan.json
jq -e '(.issues // []) | length == 0' /tmp/plan.json
"$repo/.opencode/skills/starling/scripts/run.sh" --repo "$repo" --record "$repo/.starling/run.jsonl" "$goal"
"$repo/.opencode/skills/starling/scripts/status.sh"
```

## Deviations from plan

- **No live end-to-end run.** The CLI is a stub until Epic 22, so every check uses a fake `starling` on
  `PATH`. The scripts target the locked surface; they are not integration-tested against a real engine yet.
  This is the assignment's explicit out-of-scope.
- **`--budget` is a wrapper preflight, not CLI enforcement.** The locked CLI surface has no budget flag; the
  assignment asked for one in the skill's safety section. `run.sh` reads `budget.maxUsd` and caps entry; a
  CONTRACT REQUEST asks Epic 22 to add `--budget <usd>` so the wrapper can simply forward it and the engine
  can enforce it mid-run.
- **Biome's Markdown formatter is disabled in this lane via nested configs.** The alternative was to edit the
  orchestrator-owned root `biome.json` (forbidden) or leave Markdown unformatted and fail `bun run check`.
  Nested configs with `extends: "//"` inherit every root rule except Markdown formatting.
- **`install.sh` has two bonus flags, `--dir` and `--dry-run`.** `--dir` lets the same installer serve Claude
  Code (`--dir ~/.claude`) and any future agent; `--dry-run` makes the install auditable. Neither changes the
  required behaviour.
- **The two examples are hand-written.** Recordings would be stale before the engine exists; they are labelled
  illustrative and mirror the expected decompositions in `examples/sky-todo/demo-goals/`.
- **Skill body is 171 lines, not ~300.** The assignment said "under ~300"; shorter is better for progressive
  disclosure, and the detail lives in the four references.
- **`bun run check` still fails on pre-existing files outside this lane.** The failures are
  `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host,ollama,smoke}.ts`,
  `tools/local-models/ollama.test.ts` and two `tools/local-models/results/*.json`; `main` alone reports the
  same 9 errors. This epic's files pass `biome check` and the root typecheck. Fixing the rest belongs to the
  epic that owns those files.

## Known limitations / deferred

- **Unix only.** The wrappers need bash 3.2+ and POSIX tools; Windows is out of scope (the repo is macOS/Linux).
- **Plan envelope is not schema-validated in bash.** The skill tolerates `{plan,issues}` or a bare plan. If
  Epic 22 changes the envelope, update the one `jq` line in the skill/command, not four scripts.
- **`status.sh` has no machine-readable mode.** The locked CLI surface does not define `--json` for `status`;
  agents should read `.starling/*.jsonl` or the dashboard until Epic 15/22 adds one.
- **Custom install directories are not auto-discovered by `/swarm`.** Step 0 checks the three standard roots.
  For `--dir /somewhere`, run the scripts by absolute path or set `SKILL_SCRIPTS` manually.
- **Budget parser is deliberately simple.** It handles a block-style `budget:\n  maxUsd: N` and inline
  comments, not YAML anchors, flow maps or multiple documents. A malformed config is treated as missing.
- **No live tests.** There is no `*.live.test.ts` here; a real opencode skill-discovery test needs
  `opencode serve`, which is Epic 50's dogfood run. The unit tests make no network calls by construction.
- **The description's trigger phrases are English.** "parallelise/parallelize", "split into tasks" and
  "run a swarm" are covered; other phrasings rely on the model's judgement.
- **The command's `"$ARGUMENTS"` is substituted textually.** A goal containing a double quote or shell
  metacharacter can break the suggested command; the agent should pass the goal as one shell argument and
  escape it. The skill instructs the agent to write the goal to a variable if it is awkward; the CLI itself
  takes `argv`, so this is a shell quoting issue, not an injection path in Starling.
- **Marketplace/publishing is out of scope.** No `skills-ref validate` run is committed; the tests implement
  the spec checks they need (name regex, description/compatibility limits, links, frontmatter parse).
