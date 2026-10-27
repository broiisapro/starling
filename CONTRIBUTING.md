# Contributing to Starling

Thanks for stopping by. Starling is a small open-source project with an unusual habit: **it was built the way
it works** — by a flock of agents in parallel, non-overlapping lanes, every change audited before merge. That
method is also the contribution guide. Follow it and your PR will be easy to review, easy to merge, and hard
to conflict with someone else's work.

Bird puns are welcome. Correctness is more welcome. 🐦

## Setup

You need:

- **Bun 1.4.4** (1.3+ works) — `curl -fsSL https://bun.sh/install | bash`
- **Git 2.38+** — Starling uses `git merge-tree --write-tree`
- **[opencode](https://opencode.ai) 2.1+** — only for real agent sessions
- **Ollama** — optional; it runs the local auditor

```bash
git clone https://github.com/broiisapro/starling.git
cd starling
bun install
bun run starling doctor    # checks bun, git, opencode, gh, ollama, RAM and config
bun run test               # every workspace, 1,785 tests
bun run check              # Biome + typecheck
```

`bun run starling <command>` is the CLI from source. `bun run starling init` writes a config for your machine;
`bun run dev:server` + `bun run dev:web` open the dashboard.

## How the repo is organised

| Path | What lives there |
| --- | --- |
| `packages/core` | contracts, ports, config, event bus, ids, errors, test doubles — **frozen** |
| `packages/*` | one package per concern: llm, repomap, planner, prompts, workspace, runner, auditor, merger, github, store, engine, flock, perch |
| `apps/cli`, `apps/server`, `apps/web` | the three user surfaces |
| `skills/starling`, `integrations/` | Agent Skill and the opencode / Claude Code installers |
| `examples/sky-todo` | the demo target app — its own project, not part of the workspace |
| `docs/epic-*.md` | one doc per epic: goal, decisions, interfaces, limitations |
| `.orchestrator/` | the swarm's PRD, architecture, roadmap, epic prompts and handbacks |

Packages export TypeScript source directly (`"exports": {".": "./src/index.ts"}`), so there is no build step
between packages. Tests live beside the code as `*.test.ts`.

## Lanes: the one rule that makes parallel work safe

A **lane** is the set of files a task may create or modify. Starling's planner assigns lanes and validates
that, for any two tasks that can run at the same time, the `owns` globs are disjoint. Dependencies do **not**
save you: only a merged dependency serialises two tasks.

When you contribute, you are a task too. Declare your lane in the issue or PR:

> **Lane:** `packages/auditor/src/**`, `packages/auditor/test/**`
> **Reads:** `packages/core/src/contracts.ts` (no edits)

Then stay inside it. This is what lets ten people (or ten agents) work on one repo without merge pain.

Rules of thumb:

- **One concern per PR.** A feature plus a refactor plus a dependency bump is three PRs.
- **Never edit shared contracts to make your change fit.** `packages/core/src/contracts.ts`,
  `packages/core/src/ports.ts`, root `package.json`, `tsconfig*.json`, `biome.json` and `AGENTS.md` are
  owned centrally. Need a change there? Open a **contract request** (issue or PR comment) with the exact
  type/signature and why. Work around it locally until it lands.
- **Shared files need one owner.** If two tasks both need `src/index.ts` or a root registry, serialise them
  with `dependsOn`, or give one task the file and the other a read-only dependency.
- **Import siblings only through their public `src/index.ts`.** No reaching into another package's internals.
- **Pin dependencies exactly** (no `^`) and add them only to the package that needs them. Never hand-edit
  `bun.lock`; run `bun install` and let the lockfile follow.
- **No secrets, `.env`, `.starling/`, `*.db` or build output** in a commit.

## Finding something to work on

Start with the labelled issues:

```bash
gh issue list --label good-first-issue
gh issue list --label help-wanted
```

A good first issue usually touches **one package**, has a literal definition of done, and does not need a
contract change. Docs, tests, error messages, CLI output and the demo app are all excellent first PRs.

Before you start, comment on the issue with your lane. If two people want the same files, split the issue
instead of racing. If you are unsure whether an idea is in scope, open a short issue — planning is cheaper
than a rejected PR.

Branch naming follows the epic style:

```bash
git switch -c feat/auditor-verdict-timings
git switch -c fix/cli-status-empty-store
git switch -c docs/contributing-lanes
```

## Commits

[Conventional Commits](https://www.conventionalcommits.org), scoped to the package or area, imperative mood,
small and often:

```text
feat(auditor): report per-check duration
fix(workspace): handle a missing merge base
test(planner): cover overlapping lanes in a diamond DAG
docs(epic-16): record the verdict schema decision
chore(cli): pin commander
```

Avoid `wip`, `fixes`, and commits that mix formatting with behaviour. If a change is hard to describe in one
line, it is probably two commits.

## Tests and checks

The root scripts are the contract:

```bash
bun run test        # every workspace, in two halves
bun run check       # Biome + tsc --noEmit for every workspace
bun run format      # Biome, write mode
```

`bun run test` runs `test:packages` and `test:web` **in separate processes**. `apps/web` registers happy-dom
globally, which replaces `fetch`; the split keeps that out of server and package tests. If you add a client
in the web app, pass an explicit `fetch` implementation in tests instead of relying on the global.

Run one package while you work:

```bash
bun test packages/auditor
bun test apps/cli/src/commands.test.ts
```

House rules:

- **Unit tests make no network calls.** DeepSeek, Ollama, opencode, `gh` and GitHub are faked at the port.
  Tests that need the real thing use the suffix `*.live.test.ts` and only run with `STARLING_LIVE=1`.
- **No `any` without a `// reason:` comment.** No dead code. No TODO without an owner:
  `TODO(epic-42): ...`.
- **Errors are `StarlingError`** from core, with a code. Never swallow one silently.
- **Library code logs through the event bus**, not `console.log`. The CLI may print.
- TypeScript strict, ESM, named exports, small files, pure functions where possible.

If a test fails on `main` and not because of your change, say so in the PR — don't fix it outside your lane.

## The handback

Every Starling PR — human or agent — carries a **handback**: a short, auditable account of the change. Paste
it in the PR body:

```markdown
## Handback — <title>
**Status:** Complete | Partial (what is missing). Branch `feat/...` @ <short sha>.

**Delivered:**
- <specific: exported functions, files, behaviours>

**Key design decisions:**
- <decision> — <why, alternatives considered>

**Verification (exact commands + results):**
- `bun run test` (root): <N pass / N fail> — <summary line>
- `bun run check`: <result>
- <manual checks and their output>

**Dependencies added:** <pkg@version in package X> | none
**Contract requests:** <precise change + why> | none
**Deliberately deferred / out of scope:**
- ...
**Open questions / flagged tradeoffs:**
- ... | none
```

Why so formal? Because a reviewer should be able to check your claims without re-deriving them, and because
"done" is a list of evidence, not a feeling. It is also exactly the format the auditor asks a coding agent
for, so writing one is good practice.

## If you are an AI agent

Read [`AGENTS.md`](AGENTS.md) before you touch anything; it is binding, not aspirational. In short:

1. Your assignment is an epic prompt in `.orchestrator/prompts/`; its **Lane** and **Out of scope** win over
   everything else.
2. Write only inside your lane, plus your own `docs/epic-NN-slug.md` and
   `.orchestrator/handbacks/NN-slug.md`.
3. Never edit frozen contracts or root config. File a **CONTRACT REQUEST** / **FIX REQUEST** with the exact
   file, change and reason.
4. Commit small, run the root test and check scripts, then push your branch and open the PR with the handback
   as its body.
5. Do not merge, tag, or switch branches. The integrator owns `main` and `bun.lock`.
6. Do not invent behaviour to make a command look finished. If something is not wired, say "coming in v0.1"
   and name the epic that delivers it.

One agent per lane, one lane per worktree. If you find a bug in another lane, report it; do not fix it there.

## Review checklist

A PR is ready when:

- [ ] The lane is declared and respected.
- [ ] The definition of done is literal and met.
- [ ] `bun run test` is green at the root (both halves).
- [ ] `bun run check` is clean.
- [ ] New behaviour has a test; a bug fix has a regression test.
- [ ] Public interfaces are documented in `docs/epic-NN-slug.md`.
- [ ] No secrets, generated files or hand-edited lockfile.
- [ ] The handback lists verification commands and any deferred work.

Maintainers review for correctness first, then contracts, then style. A smaller PR with evidence beats a big
one with promises.

## Questions

Open a [discussion or issue](https://github.com/broiisapro/starling/issues). For security concerns, please
report privately rather than in a public issue.

Thanks for helping the flock fly. 🐦
