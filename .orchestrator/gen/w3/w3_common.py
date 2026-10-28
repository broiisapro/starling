"""Wave 3 prompt header + renderer. Specs live in w3_specs_*.py (lists named SPECS of dicts)."""

HEADER = """# Epic {nn}: {title}

**Wave {wave_label} · Branch `epic/{nn}-{slug}` · Issue: `gh issue list --search "Epic {nn} in:title"` · Model: DeepSeek V4.1 Flash · Budget: {budget} of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-{nn}-{slug}.md` and `.orchestrator/handbacks/{nn}-{slug}.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => {{ ... }})`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
{extra_locked}

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.
{carryover}

## Your lane (you may write ONLY here)
{lane}
plus `docs/epic-{nn}-{slug}.md` and `.orchestrator/handbacks/{nn}-{slug}.md`. Read anything.

## Goal
{goal}

## Deliverables
{deliverables}

## Explicitly out of scope
{oos}

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
{dod}
{n_test}. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
{n_check}. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
{n_doc}. `docs/epic-{nn}-{slug}.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/{nn}-{slug}.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/{nn}-{slug}`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
"""

# Conventions reused in several specs (inserted via extra_locked).
WEB_FEATURE_CONVENTION = """- **L39 Web feature manifest (new feature folders).** Your folder's `index.ts` exports your components plus one manifest, so C3 can wire about 15 new features with one line each:
  ```ts
  import type {{ ComponentType }} from 'react';
  import type {{ SkyState }} from '../../data/reducer';
  export interface FeatureProps {{ state: SkyState; onSelectTask?(key: string): void; onSelectRun?(runId: string): void; onClose?(): void }}
  export const feature = {{
    id: '<folder-name>', title: 'Human title', description: 'One line for the command palette',
    kind: 'view' /* centre view like Sky/DAG */ | 'panel' /* side or bottom panel */ | 'overlay' /* modal, palette, toasts, tour */ | 'page' /* full page at ?page=<id> */,
    icon: '<lucide-react icon name>', hotkey: '<your assigned key or undefined>',
    Component: YourRootComponent as ComponentType<FeatureProps>,
  }} as const;
  ```
  Read state only through `FeatureProps` and the existing pure selectors in `apps/web/src/data/selectors.ts` (import, never edit). Build a `Playground.tsx` + `playground.html` (copy the pattern from `features/dag`) so the feature can be seen on its own with `fixtures/runs/*.jsonl` data. Use only the existing design tokens and components (`apps/web/src/components`, `index.css` tokens). Light **and** dark mode, keyboard reachable, `prefers-reduced-motion` respected.
  Hotkeys already taken: `1 2 b f ? Esc` and the arrows. Wave 3 assignments: report `r`, timeline `t`, lanes `l`, costs `c`, console `` ` ``, settings `,`, palette `mod+k`, compare `x`, export `e`, scrubber `.`, heatmap `h`, leaderboard `L`, stage `s`, topology `o`, health `!`. Everything else gets no hotkey."""

CLI_EXT_CONVENTION = """- **L39 CLI extension module.** `apps/cli/src/program.ts` and everything else in `apps/cli/src` belong to Epic 40 right now. You build a self-contained module in your own folder `apps/cli/src/ext/<name>/` that C3 registers with one line:
  ```ts
  import type {{ Command }} from 'commander';
  export interface ExtIo {{ out(line: string): void; err(line: string): void; cwd: string; env: Record<string, string | undefined> }}
  export const extension = {{
    name: '<command name>', summary: 'one line for --help',
    register(program: Command, io: ExtIo): void {{ /* program.command(...).option(...).action(...) */ }},
  }} as const;
  ```
  Depend only on `commander`, `@starling/core` and other packages' public `index.ts` exports, plus `node:*`/`bun` built-ins. Don't import from `apps/cli/src/*.ts` (it's changing under Epic 40), except types re-exported by core. Tests register your extension on a fresh `new Command()` with `exitOverride()` and an in-memory `ExtIo`. Add a tiny `apps/cli/src/ext/<name>/try.ts` entry (`bun apps/cli/src/ext/<name>/try.ts <args>`) so the command can be used before C3 wires it, and paste a real invocation's output in the handback."""

QA_CONVENTION = """- **L39 QA epics.** You are a bug hunter, not a fixer. Read the code and docs of your area, then write **behaviour tests** that pin down what the docs/contracts promise, importing only public exports (`packages/<x>/src/index.ts` by relative path, or the app's exported factories). Tests that pass are kept as regression tests. A confirmed bug becomes `test.todo('BUG <area>: …', () => {{ …real assertions… }})` plus a FIX REQUEST in your handback with file, line, a minimal repro, and a suggested fix. Aim for 40+ meaningful tests and every bug you can find. Don't invent behaviour the docs don't promise: if the contract is ambiguous, write it up as an **Open question** instead. Also write `REPORT.md` in your folder: what you covered, a bug table (id, severity, file:line, one-line repro), and what you'd test next."""

WAVE_LABEL = {"3": "3", "3b": "3b"}


def render(e):
    dod = "\n".join(f"{i+2}. {x}" for i, x in enumerate(e["dod"]))
    n = len(e["dod"]) + 2
    extra = e.get("extra_locked", "")
    conv = e.get("convention")
    if conv == "web":
        extra = WEB_FEATURE_CONVENTION + ("\n" + extra if extra else "")
    elif conv == "cli":
        extra = CLI_EXT_CONVENTION + ("\n" + extra if extra else "")
    elif conv == "qa":
        extra = QA_CONVENTION + ("\n" + extra if extra else "")
    # convention text is written with doubled braces for format(); unescape when injected directly
    extra = extra.replace("{{", "{").replace("}}", "}")
    carry = e.get("carryover", "").strip()
    out = HEADER.format(
        nn=e["nn"], slug=e["slug"], title=e["title"], wave_label=e.get("wave", "3"),
        budget=e.get("budget", "60–120 min"),
        extra_locked="@@EXTRA@@", carryover="@@CARRY@@",
        lane=e["lane"].strip(), goal=e["goal"].strip(), deliverables=e["deliverables"].strip(), oos=e["oos"].strip(),
        dod=dod, n_test=n, n_check=n + 1, n_doc=n + 2,
    )
    out = out.replace("@@EXTRA@@", extra).replace("@@CARRY@@", ("\nAlso, specifically for this epic:\n" + carry) if carry else "")
    return out
