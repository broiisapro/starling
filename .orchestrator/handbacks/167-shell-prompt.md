## Epic 167 Handback — shell prompt segment
**Status:** Complete. Branch `epic/167-shell-prompt` @ (see PR).
**Delivered:**
- `integrations/shell/segment.ts` — pure prompt core: `pickRun(runs, now)`, `countTasks(run)`,
  `formatSegment(counts, { ascii, finished, style })`, plus `isActiveRunStatus`, `isLandedRunStatus`,
  `ACTIVE_RUN_STATUSES`, `TERMINAL_RUN_STATUSES`, `IN_FLIGHT_TASK_STATUSES`, `FINISHED_WINDOW_MS`.
- `integrations/shell/cache.ts` — `hashServerUrl` (documented FNV-1a, pinned by a test), `locateCache`,
  `defaultCacheDir`, `readSegment`, `readState`, `writeCache` (temp file + rename, mode 600, segment then
  state). Reads never throw; a cold/corrupt cache reads as `''` / `{updatedAt:0,failures:0}`.
- `integrations/shell/refresh.ts` — one `GET /api/runs` with `x-flock-token` when configured, 300 ms
  `AbortSignal.timeout`, `/api/runs` → `pickRun` → `formatSegment` → cache. Any failure writes `''` and
  backs off 1 s → 2 s → 4 s … capped at 60 s. `--interval-ms` caller throttle. Never throws.
- `integrations/shell/starling-prompt.ts` + executable `integrations/shell/starling-prompt` (POSIX sh,
  resolves symlinks without `readlink -f`, execs `bun`): `--refresh`, `--ascii`, `--style plain|zsh|bash`,
  `--server`, `--token`, `--interval-ms`, `--path`, `--help`. The read path imports no HTTP code.
- `integrations/shell/starling.zsh` (precmd hook, `$EPOCHSECONDS`, `$(<file)`, detached `( … & )`),
  `starling.bash` (bash 3.2: `PROMPT_COMMAND` chaining, `$SECONDS`, `read` builtin, detach),
  `starling.fish` (`starling_prompt_segment`, `--on-event fish_prompt`, `&` + `disown`).
- Opt-outs in all three: `STARLING_PROMPT=off`, `STARLING_PROMPT_ASCII=1`, `NO_COLOR`.
- `integrations/shell/README.md` — the three one-line installs, segment meaning, opt-outs/knobs and a
  "why it's fast" note.
- `integrations/shell/tsconfig.json` (folder is outside the Bun workspace) + 5 test files, 102 tests.

**Key design decisions:**
- Cache is the prompt's API — the shell reads one file with a builtin; render/format/network never happen
  on the prompt path, so a hung hub cannot slow typing.
- The segment is cached already rendered (style included); `--style`/`--ascii` apply on the next refresh
  (≤ 2 s). Rendering per prompt would mean JSON/number work in the shell.
- FNV-1a 32 in 10 documented lines rather than `Bun.hash`: the file name is a contract between the three
  shells, the CLI and the refresher, and the test pins its output.
- Backoff state lives in the cache (`{ updatedAt, failures }`), so two shells cannot both hammer a dead
  hub; no daemon, no lock file, no memory.
- Failures blank the segment instead of showing stale counts; a hub that is down is a prompt with no bird.
- `refresh.ts` imports `Run` as a type only and validates four fields itself instead of calling
  `RunSchema`: the process lives a few hundred ms, and `@starling/core` would pull zod/sqlite/config into
  it. Core remains the producer's source of truth.
- Colour only for `style: 'zsh' | 'bash'` (wrapped `%{…%}` / `\[…\]`); `plain` is escape-free by design and
  is what `NO_COLOR` selects.
- `STARLING_PROMPT=off` is read when the snippet is sourced because the same variable is the output the
  snippet assigns. Documented in the README.
- No shell string is built from a URL or token: arrays in bash/zsh, a list in fish, and the shim execs
  `bun "$@"`. A test greps all three snippets for `eval`/`sh -c`/`bash -c`.

**Verification (exact commands + results):**
- `bun install`: `Checked 172 installs across 225 packages (no changes)`; `git status` shows `bun.lock`
  unmodified.
- `bun test integrations/shell`: `101 pass / 1 skip / 0 fail`, `Ran 102 tests across 5 files. [~650ms]`
  (the skip is `fish -n`, because fish is not installed on this machine).
- `bunx tsc --noEmit -p integrations/shell/tsconfig.json`: exit 0.
- `bunx biome check integrations/shell`: `Checked 11 files … No fixes applied`, exit 0.
- Hand-written cache, read path:
  `mkdir -p $TMP/starling && printf '🐦 12/30' > $TMP/starling/prompt-409ae7be.txt && XDG_CACHE_HOME=$TMP integrations/shell/starling-prompt`
  → `🐦 12/30`.
- No network on the read path: `XDG_CACHE_HOME=$TMP integrations/shell/starling-prompt --server http://127.0.0.1:9`
  returned in `0.013s` total with exit 0, and the test
  `the read path > a hub that is down costs nothing: the read path never dials it` injects a throwing
  `fetch` and asserts `calls === []` (also asserted in `prints exactly what the cache holds…`).
- `bash -n integrations/shell/starling.bash` → exit 0; `zsh -n integrations/shell/starling.zsh` → exit 0;
  `sh -n integrations/shell/starling-prompt` → exit 0. `fish -n` skipped (not installed).
- `bash .orchestrator/bin/heavy.sh bun run test`:
  `packages…`: `2039 pass / 5 skip / 0 fail — Ran 2044 tests across 228 files. [67.40s]`;
  `apps/web`: `581 pass / 0 fail — Ran 581 tests across 60 files. [4.50s]`.
- `bash .orchestrator/bin/heavy.sh bun run check`: `Checked 988 files in 449ms. No fixes applied.` and the
  per-workspace `tsc --noEmit -p` loop finished with no errors (exit 0). `integrations/shell` is outside
  the root typecheck loop (the folder is not a Bun workspace member), so its own
  `tsc -p integrations/shell/tsconfig.json` (above) is the gate.

**Dependencies added:** none.
**CONTRACT REQUESTS:** none. Every field the segment needs (`Run.status`, `Run.startedAt`,
`Run.finishedAt`, `Run.tasks[].status`) is already in the locked contract; no core, config or root file was
touched.

**Carryover done:** none — no request in `.orchestrator/fix-requests-w2.md` targets a file in
`integrations/shell/**` (grepped for `integrations/shell`, `shell-prompt`, `starling-prompt`). The
"shell" mentions in that file are the web shell (`apps/web/src/app`, Epic 41), which is not this lane.

**C3 wiring:** none. This epic ships a self-contained module under `integrations/shell/` (plus its own
tsconfig and README). No `App.tsx`, `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`,
`index.ts`, `package.json`, root config or CI file needs a line from C3.

**FIX REQUESTS:**
- **`apps/cli` (Wave 3b, Epic 203): add a `starling prompt` subcommand.** Thin wrapper around
  `integrations/shell/starling-prompt.ts` (`starling prompt [--refresh] [--ascii] [--style …] [--server …]`).
  Because `integrations/` is not a Bun workspace member, the clean form is a spawn of the shim (or a shared
  `packages/prompt` later); the flags and behaviour are documented in `docs/epic-167-shell-prompt.md`
  §Interfaces. Optional bonus: `starling doctor` printing the resolved cache path and whether the segment
  is stale.
- **Root `README.md` (Epic 60 lane): link the shell prompt.** One line under the quickstart, e.g.
  "**In your shell prompt:** `🐦 12/30` while a run is flying — see `integrations/shell/README.md`."
  Outside this lane, so not edited here.

**Deliberately deferred / out of scope:**
- Starship module, oh-my-zsh/powerlevel10k plugin, Windows shells, a long-running daemon (all explicitly
  out of scope in the brief; the README points at the three snippets instead).
- Editing `apps/cli`, `apps/server`, `integrations/opencode`, `integrations/claude-code`, `skills/`
  (other lanes). A `starling prompt` subcommand is filed as a FIX REQUEST above.
- A live hub in the tests: every refresh test uses a fake fetch and a fake clock (L37); no server, no
  network, no real model.
- A configurable landed window (10 min is a constant) and per-shell cache namespacing.

**Open questions / flagged tradeoffs:**
- **Cache is keyed by hub URL only, per the brief.** zsh and fish on the same hub therefore take turns
  overwriting each other's colour format (a fish refresh stores the plain form, a zsh refresh stores the
  `%{…%}` form). Harmless in practice (one shell per hub) and documented; a `prompt-<hash>-<style>.txt`
  would fix it if the orchestrator prefers.
- **`mapping|planning|planned` runs render `🐦 0/N`.** No bucket exists for "planned but not moving" in the
  locked counts, and adding one would change the shared shape; 0/N is an honest signal right after launch.
- **`failed` and `cancelled` runs are shown as landed for 10 minutes** (with their `✗` count), not just
  `finished`: that is exactly when a developer wants the prompt to say something went wrong.
- **`refresh.ts` does not use `RunSchema`** (type-only import + four-field guard). A contract change to
  those four fields would need a one-line update here; everything else in `Run` is irrelevant to a prompt.
- **`STARLING_PROMPT=off` is evaluated at source time**, because the variable doubles as the output. A
  runtime toggle would need a second variable name; re-sourcing is one keystroke and documented.
