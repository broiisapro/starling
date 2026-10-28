## Epic 103 Handback — Auditor round 2: lane traversal, command policy, verdict explanations

**Status:** Complete. Branch `epic/103-auditor-r2` @ `eeb9417`…`d5c24de` (6 commits, rebased onto `bea040e`), docs and this handback on top. Closes #113.

**Delivered:**
- **SEC-08 in the auditor.** `canonicalLanePath(raw) → { path, problem?: 'traversal' | 'absolute' | 'invalid' }` in `packages/auditor/src/lane.ts`: `\` → `/`, `normalizeGlobPath`, then `posix.normalize`; any raw `..` segment (even one that normalises back inside the lane), an absolute path (`/x`, `C:/x`, UNC), an empty path or a NUL byte is a violation **before** glob matching. `checkLane` uses it and reports the raw path as the violation; `isBookkeepingPath` uses it too, so `.starling/../package.json` is no longer exempt. Additive `LaneCheckResult.problems?: Record<string, 'traversal' | 'absolute' | 'invalid' | 'outside-lane'>`.
- **Three probes flipped** in `tools/security/auditor-lane.test.ts`: the `src/../`, backslash and deep-climb `test.failing` probes are now plain `test(`. No other change to that file (L36), so its header comment still describes the old state.
- **SEC-11 command policy.** New `packages/auditor/src/command-policy.ts`: `CommandPolicy`, `DEFAULT_COMMAND_POLICY = { mode: 'any', scrubEnv: true }`, a conservative `DEFAULT_ALLOWED_COMMANDS` table, `evaluateCommand` (word-boundary prefixes, no `;`/`&`/`|`/backticks/`$(`/redirection/newline), `scrubbedEnv` (clears `TOKEN|SECRET|PASSWORD|API_KEY|_KEY$`, `^GH_`, `^GITHUB_`, `^DEEPSEEK`, `^OPENAI`, `^ANTHROPIC`, always sets `CI=1`), `isSecretEnvName`, `resolveCommandPolicy`.
- **Policy wired into execution.** `runShellCommand(..., policy?, envSource?)` applies the policy and env; the single auditor `sh -c` site stays in `commands.ts` (no new shell call site; `exec-argv` probe still allow-lists exactly three files). `CommandResult` gains `blockedReason?` and `skippedReason?`; `describeCommand`/`commandSignal` render them.
- **`CreateAuditorOptions.commandPolicy?` and `requireWorktree?`** (both additive). `off` → `tests` check `ok: true`, detail `skipped: tests disabled by policy` (lint likewise). Blocked → `ok: false`, detail `blocked by command policy: <reason>`, plus an operator fix instruction. Lint follows the same policy (advisory unless `lintBlocking`).
- **Where the tests ran (70 F5 / Epic 40 CONTRACT REQUEST 1).** No `worktreePath` → detail ends `(no task worktree: ran in the hub repo)`; `requireWorktree: true` fails the check with a harness fix instruction instead. Both cases tested.
- **Verdict explanations.** New `packages/auditor/src/explain.ts` (type-only core imports, enforced by a test): `explainVerdict(v) → { level, headline, blocking, advisory, passed, nextStep? }` with `ExplainedCheck = { name, label, why, detailTail ≤ 300 }`, and `formatVerdictExplanation(e)` → ≤ 6 plain lines. `warn` covers non-blocking lint, the hub-repo fallback, a policy-skipped test command and a skipped reviewer; a blocked command and every other failure are blocking. Golden tests over **every** `audit.verdict` in `fixtures/runs/sky-todo-launch-day.jsonl` plus hand-made verdicts for `lane`, `non-empty`, `tests`, `missing-tests`, `lint`, `llm-review`.
- **Docs:** `docs/epic-103-auditor-r2.md` including the written SEC-11 accepted risk (repo commands run as the user; mitigated by worktree cwd, timeout, env scrub and the allowlist/off modes; explicitly not a sandbox).

**Key design decisions:**
- Flag `..` on the **raw** path, not after normalisation — `src/../src/a.ts` normalises back inside the lane, so an "did it escape?" test would miss it. Git never emits `..`, so every occurrence is hostile.
- Keep the raw string in `violations`/`problems` for problem paths (evidence an operator can act on) while ordinary violations stay canonical.
- Default policy stays `any` so today's repos are unaffected (L33); the env scrub is on by default because it cannot change whether a legitimate command succeeds.
- `off` passes the check (it is an operator choice) but `explainVerdict` reports `warn`, so `--no-tests` can never masquerade as an all-green audit.
- A blocked command fails with an **operator** fix instruction, not a code-rewrite instruction.
- `requireWorktree` defaults to false because Epic 100 is still filling `worktreePath`; the detail note fixes the silent part now.
- Browser-safe explain module: no runtime core import, no `node:`, no `bun:`; the whole feature is a pure projection of the locked contract.

**Verification (exact commands + results):**
- `bun install` (worktree): `Checked 180 installs across 225 packages (no changes)` after the rebase — `bun.lock` and root `package.json` unchanged (`git status` clean for both).
- `bun test packages/auditor`: **184 pass / 0 fail**, 1 snapshot, 652 expect() calls, 10 files. Baseline on this branch was 109 tests, so **75 new tests** (≥ 35 required).
- `bunx tsc --noEmit -p packages/auditor`: clean.
- `bun test tools/security/auditor-lane.test.ts tools/security/exec-argv.test.ts`: **13 pass / 0 fail**, 22 expect() calls — three traversal probes flipped, `exec-argv` still sees exactly `apps/cli/src/doctor.ts`, `packages/auditor/src/commands.ts`, `packages/merger/src/suite.ts`.
- `bash .orchestrator/bin/heavy.sh bun run test` (root, after rebasing onto `bea040e`): packages half `2049 pass, 5 skip, 0 fail` (`Ran 2054 tests across 229 files`); web half `581 pass, 0 fail` (`Ran 581 tests across 60 files`). Both summary lines reproduce verbatim above.
- `bash .orchestrator/bin/heavy.sh bun run check` (after the rebase): `biome check .` → `Checked 995 files in 249ms. No fixes applied.` then the per-workspace `tsc --noEmit` loop finished with exit 0 (no diagnostics).
- Fixture output, failing verdict (`theme`, attempt 1):
  ```
  ✘ Failed: 2 blocking checks.
    Tests: The repository test command failed. bun test: 1 failing test in src/features/theme
    Definition of done: The reviewer found at least one definition-of-done item unmet. Missing: toggle persists across reloads
  Next: Add a test that mounts initTheme() twice with a stubbed localStorage and asserts the second mount reads data-theme="dark". Keep the change inside src/features/theme/**.
  ```
- Fixture output, passing verdict (`dates-fix`):
  ```
  ✔ Passed: every check is green.
  ```

**Dependencies added:** none.

**Carryover done (`.orchestrator/fix-requests-w2.md`):**
- **69 / SEC-08 (auditor half)** — implemented in `lane.ts`; core half declined here (out of lane) and filed as FIX REQUEST 1 with the exact normalisation.
- **69 / SEC-11 (auditor half)** — implemented as `command-policy.ts` + wiring + the documented accepted risk in `docs/epic-103-auditor-r2.md`. No new shell site.
- **70 / F5 + Epic 40 CONTRACT REQUEST 1** — auditor half implemented: hub-repo fallback is labelled and `requireWorktree` can fail it. Filling `TaskRun.worktreePath` itself is an engine/CLI job (FIX REQUEST 2).
- **44's three FIX REQUESTS** — **not mine**: `evals/real.ts` (Epic 29), `tools/local-models/recommend.ts` (Epic 28/72), `apps/cli/src/compose.ts` (Epic 40). The composition note about `createAuditor({ llm: 'auto', bus })` now also applies to `commandPolicy`/`requireWorktree`; see FIX REQUEST 2.
- No other Wave 2 request targets `packages/auditor/**`.

**C3 wiring:** none. `packages/auditor/src/index.ts` is inside this lane, so the new exports (`canonicalLanePath`, `CommandPolicy`/`evaluateCommand`/`scrubbedEnv`/`DEFAULT_ALLOWED_COMMANDS`, `explainVerdict`/`formatVerdictExplanation`) are already public. No route, CLI flag, `App.tsx`, `program.ts`, `app.ts` or layout change is needed.

**FIX REQUESTS:**
1. **`packages/core/src/glob.ts` (Epic 202, Wave 3b).** Add a canonicalising helper next to `normalizeGlobPath` and use it in `matchesGlob`/`matchesAny` (or expose a strict `matchLanePath` used by the auditor):
   ```ts
   import { posix } from 'node:path';
   export type GlobPathProblem = 'traversal' | 'absolute' | 'invalid';
   export interface CanonicalGlobPath { path: string; problem?: GlobPathProblem }
   export function canonicalGlobPath(raw: string): CanonicalGlobPath {
     const slashed = raw.replace(/\\/g, '/');
     const normalized = normalizeGlobPath(raw);
     if (normalized === '' || slashed.includes('\0')) return { path: normalized, problem: 'invalid' };
     if (posix.isAbsolute(slashed) || /^[A-Za-z]:\//.test(slashed))
       return { path: posix.normalize(normalized), problem: 'absolute' };
     if (slashed.split('/').includes('..'))
       return { path: posix.normalize(normalized), problem: 'traversal' };
     return { path: posix.normalize(normalized) };
   }
   ```
   Then `matchesGlob` returns `false` for a problem path (and `globsOverlap` may normalise its inputs the same way). Tests already exist in `packages/auditor/src/lane.test.ts` to port; when it lands, the auditor's local copy should delegate and `LanePathProblem` can alias the core type.
2. **`packages/engine` / Epic 100 + `apps/cli/src/compose.ts` (Epic 40).** Fill `TaskRun.worktreePath` for every dispatched task (the core schema already has the field), then pass `requireWorktree: true` at the composition root. Also construct the auditor as `createAuditor({ llm: 'auto', bus, commandPolicy, requireWorktree })`; if config gains an `auditor.commandPolicy` key (nested under `auditor`, mirroring the type) and a `starling run --no-tests` flag, map the flag to `{ mode: 'off' }`. CLI/config changes are not this lane.
3. **`packages/merger` (Epic 104).** The merger's regression suite is the other repo-provided `sh -c` site (`packages/merger/src/suite.ts`). Per the brief it keeps its own copy of the policy table — do not import `@starling/auditor`; mirror `CommandPolicy`/`DEFAULT_ALLOWED_COMMANDS` and, at minimum, adopt `scrubEnv` semantics so a merge-gate command does not inherit `DEEPSEEK_API_KEY` either.

**Deliberately deferred / out of scope:**
- `packages/core/src/glob.ts` (the core half of SEC-08) — FIX REQUEST 1.
- Engine reaction to `warn`/outage verdicts and worktree plumbing — Epic 100.
- Merger command policy — Epic 104 (own table, per instruction).
- Reviewer prompt/model-choice changes and `evals/auditor` — Epic 162.
- A CLI `--no-tests` flag and a config key for `commandPolicy` — CLI/core lanes.
- A real sandbox/container executor for repo commands. The policy is a guard rail, not isolation; the accepted risk is documented in the epic doc.
- Dashboard wiring of `explainVerdict` — the function is ready and browser-safe; the shell/drawer lane owns rendering.

**Open questions / flagged tradeoffs:**
- `VerdictExplanation.passed` is an array of human labels (for display), while `blocking`/`advisory` carry both `name` and `label`. If the drawer needs to link passed checks, an additive `passedChecks: ExplainedCheck[]` is the clean next step; I did not add it without a consumer.
- A policy-disabled test command is reported as `warn`, not `pass`. That is the honest reading of `--no-tests`, but if the demo wants a "clean" deterministic run under `off`, the level rule in `explainVerdict` is one branch to change.
- `explainVerdict` infers blocking vs advisory lint from the auditor's `; non-blocking` detail marker. It is exact for verdicts this package produced; a hand-written `pass: false` lint-only verdict is treated as blocking.
- The allowlist is a policy, not a security boundary: `make test` and `pytest` execute repo code by design, and a custom `allow` list can allow anything. The threat model (LAN-only perch, user-owned repo) is unchanged from Epic 69.
