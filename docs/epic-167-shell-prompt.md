# Epic 167 — Integration: shell prompt segment

## Goal

Give Starling a one-line presence in the developer's shell: `🐦 12/30` while a run is flying, `🐦 ✓30` when
it lands, nothing when there is no run or no hub. It must work in zsh, bash (3.2, macOS default) and fish,
and it must never make the prompt wait — no forks on the prompt path, no network on the prompt path, and a
dead hub must cost nothing.

The whole feature lives in `integrations/shell/` and is self-contained: three snippets to `source`, one
`starling-prompt` helper, a cache directory, and tests.

## How it works

```
 every prompt                          every 2 s (background)
 ┌───────────────────────────┐         ┌──────────────────────────────────────────┐
 │ read prompt-<hash>.txt    │◄────────│ starling-prompt --refresh                │
 │ (shell builtin, no fork)  │  rename │  GET /api/runs → pickRun → countTasks →   │
 │ $STARLING_PROMPT = line   │         │  formatSegment → write .txt + .json       │
 └───────────────────────────┘         └──────────────────────────────────────────┘
```

**Files** (`integrations/shell/`):

| File | Role |
| --- | --- |
| `segment.ts` | Pure: `pickRun`, `countTasks`, `formatSegment`, run-status helpers. Type-only imports. |
| `cache.ts` | Cache paths (`FNV-1a` hash of the server URL), never-throwing reads, atomic writes. |
| `refresh.ts` | One `GET /api/runs` with `x-flock-token`, a 300 ms timeout, backoff on failure. Never throws. |
| `starling-prompt.ts` | CLI: read cache by default, `--refresh` for one refresh. Lazy-imports `refresh.ts`. |
| `starling-prompt` | POSIX `sh` shim: resolves its own symlink chain (macOS has no `readlink -f`) and execs `bun`. |
| `starling.zsh` | `precmd_functions+=`, `$EPOCHSECONDS`, `$(<file)`, detached `( … & )`. |
| `starling.bash` | `PROMPT_COMMAND` chaining, `$SECONDS`, `read` builtin, detached `( … & )`. |
| `starling.fish` | `starling_prompt_segment`, `--on-event fish_prompt`, `&` + `disown`. |
| `README.md` | The three install lines, what the numbers mean, opt-outs, why it is fast, limits. |

**Which run:** the newest (`startedAt`) run whose status is `mapping | planning | planned | running`;
otherwise the newest run that landed (`finished | failed | cancelled`, by `finishedAt ??
startedAt`) within the last 10 minutes; otherwise nothing. Ties keep the first entry, which is the server's
most-recent-first order.

**Counting:** `inFlight = running | auditing | fixing | merging`, `done = merged`,
`failed = failed | conflict`, `total` = every task. `pending`/`ready`/`cancelled` count only in the total,
so the numerator and denominator do not have to add up — the denominator is the plan.

**Formatting:**

| state | unicode | ASCII |
| --- | --- | --- |
| flying | `🐦 12/30` | `st 12/30` |
| failures | `🐦 12/30 ✗2` | `st 12/30 x2` |
| landed | `🐦 ✓30` | `st ok 30` |
| nothing | `''` | `''` |

`style: 'zsh'` wraps the ANSI colour in `%{…%}`, `'bash'` in `\[…\]` (so the prompt's width arithmetic
stays correct); `'plain'` never emits an escape at all, which is what the cache stores when `NO_COLOR` is
set.

**Cache:**

```
${XDG_CACHE_HOME:-~/.cache}/starling/prompt-<8 hex>.txt    the rendered line, verbatim
${XDG_CACHE_HOME:-~/.cache}/starling/prompt-<8 hex>.json   { updatedAt, failures }
```

Writes go to a same-directory temp file with mode `600` and are `rename`d into place, segment first and
state second, so a reader that sees a fresh `updatedAt` can trust the segment beside it.

**Refresh:** token header when configured (`STARLING_TOKEN`/`STARLING_FLOCK_TOKEN`/`--token`),
`AbortSignal.timeout(300)`, `/api/runs` → `pickRun` → `formatSegment` → cache. On any failure (HTTP status,
network, JSON) the segment is written as `''` and `failures` increments; the next attempt waits
`min(2^(n-1) s, 60 s)`. `--interval-ms` adds a caller-side throttle; the helper exits before dialling when
the last attempt is younger than it.

**CLI:** `starling-prompt [--refresh] [--ascii] [--style plain|zsh|bash] [--server URL] [--token T]
[--interval-ms N] [--path] [--help]`. The read path exits 0 and prints nothing when the cache is empty or
`STARLING_PROMPT=off`; a bad flag exits 2 with usage on stderr.

## Key decisions & reasoning

- **The cache is the API, not an optimisation.** The prompt path is `read` builtin + `$STARLING_PROMPT`
  assignment, so a hub that hangs, a slow DNS lookup or a crashed bun process can never show up as prompt
  latency. zsh reads with `$(<file)` (builtin), bash/fish with `read`.
- **`FNV-1a` in ten lines instead of `Bun.hash`.** The cache file name is a contract between the shell
  snippet (which asks `--path` once at source time), the CLI and the refresher. A pinned, documented hash
  with a test that hard-codes its output is easier to trust than a runtime function that could change.
- **The segment is cached already rendered, style included.** Rendering in the prompt would mean parsing
  JSON or formatting numbers per prompt. The cost: `--style`/`--ascii` only take effect on the next
  refresh (≤ 2 s), documented in the README.
- **Colour only in the two prompt styles.** `plain` is the safe capture form for `$()`, pipes, tests and
  `NO_COLOR`; it is the default, so an accidental invocation never leaks escape bytes into a log.
- **Backoff lives in the cache beside the segment.** No daemon, no in-memory state, no separate lock file:
  a `{ updatedAt, failures }` JSON that any process can read means two shells cannot both hammer a dead
  hub. The 2 s shell throttle and the backoff are independent (fast success, slow failure).
- **Failures clear the segment.** "Instead of showing stale numbers, disappear" is the honest reading of a
  prompt: a hub that is down should not keep claiming 12 tasks are flying.
- **`STARLING_PROMPT=off` is read at source time.** The same variable is the output (`$STARLING_PROMPT`
  feeds `PROMPT`), so runtime checking would be ambiguous — and after the first assignment the environment
  handed to the background refresh is no longer `off`. Documented in the README (re-source after changing).
- **No `zod`/`@starling/core` runtime import in `refresh.ts`.** The process lives for a couple of hundred
  milliseconds per refresh; pulling the whole contract module (zod, sqlite, config) in would cost more than
  the request. `Run` is a type-only import and `extractRuns` validates the four fields the segment reads.
- **No shell string built from user data.** Every helper invocation is an argv array (bash/zsh arrays,
  fish list) and the shim `exec`s `bun` with `"$@"`; a test greps the snippets for `eval`/`sh -c`.
- **bash 3.2 compatibility is a hard requirement** (macOS `/bin/bash` is 3.2): string `PROMPT_COMMAND`
  chaining rather than the bash 5 array form, `local -a` (3.1+), no `${var,,}`, no associative arrays.
- **The cache is keyed by hub URL only, not by shell.** This is what the brief specified (`prompt-<hash of
  server URL>`); the consequence (zsh and fish sharing a hub take turns overwriting the colour format) is
  documented rather than papered over with a second key.

## Interfaces for future epics

- `integrations/shell/starling-prompt` is the only supported entry point. Stable flags: `--refresh`,
  `--ascii`, `--style`, `--server`, `--token`, `--interval-ms`, `--path`. Additive changes only (L33).
- Environment: `STARLING_PROMPT` (`off`), `STARLING_PROMPT_ASCII`, `STARLING_PROMPT_SERVER`,
  `STARLING_PROMPT_BIN`, `STARLING_PROMPT_INTERVAL`, `STARLING_PROMPT_CACHE_DIR`, `STARLING_TOKEN`,
  `STARLING_FLOCK_TOKEN`, `NO_COLOR`.
- Cache format v1: `prompt-<hash>.txt` (one line) + `prompt-<hash>.json` (`{ updatedAt, failures }`).
  Anything reading the cache must tolerate a missing file, an empty string and malformed JSON.
- Exported TypeScript (for a future `starling prompt` subcommand or a web/desktop badge):
  `pickRun`, `countTasks`, `formatSegment`, `isActiveRunStatus`, `isLandedRunStatus`, `ACTIVE_RUN_STATUSES`,
  `TERMINAL_RUN_STATUSES`, `IN_FLIGHT_TASK_STATUSES`, `FINISHED_WINDOW_MS`, `TaskCounts`, `SegmentStyle`,
  `SegmentOptions`; `hashServerUrl`, `normalizeServerUrl`, `defaultCacheDir`, `locateCache`, `readSegment`,
  `readState`, `writeCache`, `CacheLocation`, `PromptState`; `refresh`, `backoffMs`, `runsUrl`,
  `extractRuns`, `FetchLike`, `RefreshOptions`, `RefreshOutcome`; `parseArgs`, `runCli`, `USAGE`, `CliOptions`.
- **C3 wiring: none.** The feature is a self-contained module under `integrations/shell/` plus its own
  README; no `App.tsx`, `program.ts`, `app.ts`, `index.ts`, `package.json` or root config is touched.

## Deviations from plan

- **The ASCII landed form is `st ok 30`**, not a transliteration of `🐦 ✓30` (which would be `st v30`).
  Two letters read better than a glyph substitute and match `st 12/30`'s spacing.
- **`planning`/`planned`/`mapping` runs render `🐦 0/N`.** The brief's `countTasks` has no "planning"
  bucket, and inventing one would change the shared type. A 0/N on the prompt right after `starling run`
  is also a useful signal that the plan exists but nothing is moving yet.
- **Landed runs include `failed` and `cancelled`**, not just `finished`, for the 10-minute window: a run
  that just died is exactly when the user wants the prompt to tell them `✗5`.
- **`--interval-ms` exists beyond the brief's CLI list.** Fish has no clock builtin; the alternative was a
  foreground `date +%s` fork on every prompt, which the brief forbids. zsh/bash pass it as well.
- **`--path` exists beyond the brief's CLI list.** The snippets need the exact cache path without
  re-implementing the hash in three languages; asking once at shell start (a fork at source time, not per
  prompt) is the smallest correct solution.
- **`refresh.ts` validates structurally instead of via `RunSchema`** — see Key decisions. The core zod
  schemas remain the source of truth for producers; this is a read-only glance at four fields.
- **A permission-denied refresh does not throw or crash the CLI.** It reports `ok: true` with the rendered
  segment because the hub *did* answer; the cache write is best-effort (`safeWrite`). The prompt then shows
  the previous segment until the directory is fixed — the alternative (blanking the prompt on a read-only
  `$HOME`) felt worse.

## Known limitations / deferred

- No PowerShell/CMD (out of scope). No starship module, no oh-my-zsh/p10k plugin, no long-running daemon.
- Fish is not installed on this machine, so its snippet is `fish -n`-checked by a skipped test and
  reviewed by hand; it is not executed. The fish refresh relies on the helper's own 2 s throttle because
  fish has no epoch builtin.
- `--style`/`--ascii` change the cache on the next refresh, not instantly.
- One hub per prompt: the cache is keyed by URL but the snippet reads one URL. Two hubs need two cache
  dirs or two shells.
- The 10-minute landed window is a constant (`FINISHED_WINDOW_MS`), not configurable; a knob would need a
  flag and an env var for a very small gain.
- `NO_COLOR` presence disables colour but does not disable the bird; `STARLING_PROMPT_ASCII=1` does.
- No `starling prompt` subcommand in `apps/cli` — FIX REQUEST for Wave 3b Epic 203.
