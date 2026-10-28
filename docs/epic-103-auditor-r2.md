# Epic 103 — Auditor round 2: lane traversal, command policy, verdict explanations

**Wave 3 · `packages/auditor` · branch `epic/103-auditor-r2` · issue #113**

## Goal

The auditor is Starling's quality gate, and the lane check is the only thing that stops a worker (or
a hostile perch) from editing outside its assignment. Three things were missing:

1. **Robust lane paths.** `src/../secrets.env` matched `src/**`, because the lane check normalised
   slashes and `./` but never resolved `..` (SEC-08). `.starling/../package.json` was even exempt as
   framework bookkeeping.
2. **A written command policy.** The auditor runs the repo's own test/lint command through `sh -c`,
   with the auditor's full environment (SEC-11). That is accepted risk, but it was undocumented and
   all-or-nothing; there was no way to refuse a command, allow only test-shaped commands, or stop
   handing the child `DEEPSEEK_API_KEY`.
3. **A human explanation.** `AuditCheck.detail` is precise but terse. A dashboard or a judge needs
   "why did this fail, and what happens next" without reading six detail strings.

The epic also resolves the load-test finding F5 (70-load-test): when `TaskRun.worktreePath` is
missing, the audit silently graded the **hub repo** instead of the task branch, and nothing said so.

Great looks like: the three traversal probes flipped to green, no new shell call site, and an
`explainVerdict` that reads well on every verdict in the recorded launch-day fixture.

## How it works

### Canonical lane paths (`src/lane.ts`, SEC-08)

`canonicalLanePath(raw)` returns `{ path, problem? }`:

- `path` is `raw` with `\` → `/`, then `normalizeGlobPath` (core), then `posix.normalize`.
- `problem` is set **before** glob matching when the raw path cannot have come from a git diff:
  - `'traversal'` — any `..` segment after slash conversion. This includes
    `src/../src/a.ts`, which normalises *back inside* the lane: the signal is the `..`, not where
    normalisation lands.
  - `'absolute'` — a POSIX absolute path (`/x`), a Windows drive path (`C:/x`) or a UNC path.
  - `'invalid'` — an empty/whitespace-only path or one containing a NUL byte.

`checkLane` consults `canonicalLanePath` first, so a `problem` path is a violation no matter what
the lane owns. Violations for problem paths keep the **raw** string (trimmed), because that is the
evidence an operator needs; ordinary violations keep the canonical path. The additive
`LaneCheckResult.problems` map records `'traversal' | 'absolute' | 'invalid' | 'outside-lane'` per
violation, so a UI can distinguish a hostile path from a normal out-of-lane edit.

`isBookkeepingPath` uses the same canonicalisation and returns `false` for any problem path;
`.starling/../package.json` is therefore not exempt.

`packages/core/src/glob.ts` is untouched (Wave 3b owns it); the core half of SEC-08 is a FIX
REQUEST below.

### Command policy and environment (`src/command-policy.ts`, SEC-11)

```ts
interface CommandPolicy { mode: 'any' | 'allowlist' | 'off'; allow?: string[]; scrubEnv?: boolean }
```

The default is `{ mode: 'any', scrubEnv: true }`: every repo that works today still runs its own
command, but the child environment no longer carries credentials.

- **`any`** — the repo's command runs exactly as before (accepted risk, documented below).
- **`allowlist`** — the command must start with a `DEFAULT_ALLOWED_COMMANDS` prefix *at a word
  boundary* (`bun testy` is not `bun test`) and must contain no `;`, `&`, `|`, backticks, `$(`, `<`,
  `>` or newline. A custom `allow` list replaces the table. The table is deliberately
  test/lint/typecheck shaped: `bun test`, `bun run test`, `npm test`, `npm run test`, `pnpm test`,
  `yarn test`, `npx vitest`, `npx jest`, `pytest`, `python -m pytest`, `go test`, `cargo test`,
  `make test`, `biome check`, `eslint`, `ruff check`, plus the close variants (`bunx`/`npx` test
  runners, `bun run lint`, `npm run lint`, `make lint`, `go vet`, `cargo fmt --check`, `tsc`).
- **`off`** — the future `--no-tests`: nothing runs. The `tests`/`lint` checks pass with
  `skipped: tests disabled by policy` / `skipped: lint disabled by policy`, and `explainVerdict`
  reports the verdict as a **warning**, not a clean pass.

`scrubbedEnv(source)` returns overrides that set every secret-looking variable to `''`
(`TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `_KEY$`, `^GH_`, `^GITHUB_`, `^DEEPSEEK`, `^OPENAI`,
`^ANTHROPIC`, case-insensitive; `OPENCODE_SERVER_PASSWORD` is covered by `PASSWORD`) and always sets
`CI=1`. Overrides are the only mechanism available because core `exec` merges `opts.env` over
`process.env` (`packages/core/src/exec.ts:35`).

`runShellCommand(execFn, command, cwd, timeoutMs, policy?, envSource?)` applies the policy and
environment. It still owns the **only** auditor `sh -c` site; no call moved. A blocked command is
returned as `{ ran: false, blockedReason }` and fails the check with
`blocked by command policy: <reason>` plus an operator fix instruction ("this is a configuration
problem, not a problem with the diff"). A policy-disabled command is `{ ran: false, skippedReason }`.
Both `CommandResult` fields are additive.

`createAuditor({ commandPolicy, requireWorktree })` exposes both as additive options;
`ResolvedAuditorOptions` carries them. `resolveCommandPolicy` fills defaults for partial objects.

### Where the tests ran (F5 / Epic 40 CONTRACT REQUEST 1)

`audit()` already used `run.worktreePath ?? goal.repoPath`; the new part is that it says so: the
`tests` detail ends with `(no task worktree: ran in the hub repo)`. The new
`CreateAuditorOptions.requireWorktree` (default `false`) turns that fallback into a failed check with
a harness fix instruction ("re-dispatch the task or set `TaskRun.worktreePath`"). Epic 100 starts
filling `worktreePath`; until then the default keeps the existing behaviour while making it visible.

### Verdict explanations (`src/explain.ts`)

`explainVerdict(verdict)` returns:

```ts
{ level: 'pass' | 'warn' | 'fail', headline, blocking: ExplainedCheck[], advisory: ExplainedCheck[],
  passed: string[], nextStep? }
// ExplainedCheck = { name, label, why, detailTail }   // detailTail ≤ 300 chars
```

- `fail` when the verdict failed; `warn` when it passed with an advisory failure or an advisory
  note; `pass` only when every check is green with no caveat.
- **Advisory failures** are a failed `lint` whose detail carries the auditor's `; non-blocking`
  marker, or a failed lint on a passing verdict. A blocking lint (no marker) is a blocker.
- **Advisory notes** are checks that passed with a caveat: tests that ran in the hub repo, tests
  skipped by policy, and a skipped reviewer.
- `nextStep` prefers the first line of `fixInstructions` (the auditor's own numbered instruction),
  falls back to a per-check hint, and is absent on a clean pass.
- `formatVerdictExplanation` renders at most six plain lines, one line per check, with `(+N more)`
  when capped. It collapses whitespace so a multi-line test tail cannot break the layout.

The module has **type-only** imports from `@starling/core` (a test reads the source to enforce it),
so `apps/web` can import it later without Bun or `node:path`.

## Key decisions & reasoning

- **Flag `..` on the raw path, not on the normalised one.** `src/../src/a.ts` normalises inside the
  lane, so a "does it still escape?" check would pass it. Git never emits a `..` segment at all, so
  every occurrence is a signal (hostile perch, buggy agent, path-injection attempt). This is the
  core of SEC-08 and the reason the fix lives in the auditor rather than in the glob matcher.
- **Report the raw path for a problem entry.** The canonical `path` is what the glob matcher sees,
  but `secrets.env` is a poor explanation for `src/../secrets.env`. Keeping the raw string in
  `violations`/`problems` preserves the evidence; the existing probe
  (`['../escape.ts']`) is unchanged.
- **Default stays `any`.** A default allowlist would break real repos whose test command is a shell
  line (`bun test && bun run lint`), which is a product regression in a wave where 100 branches
  merge (L33). The policy is opt-in; the environment scrub is not, because it cannot change whether
  a legitimate command succeeds.
- **Word-boundary prefixes and no shell syntax.** A naive `startsWith` allowlist accepts `bun testy`
  and `bun test; curl evil`. Prefix-at-boundary plus a metacharacter screen is the smallest rule set
  that is still meaningful, and a custom `allow` list covers repos with unusual commands.
- **Policy `off` passes the check but warns the explanation.** `--no-tests` is a deliberate
  operator choice, so it must not fail the audit; hiding it as "all green" would be dishonest, so
  `explainVerdict` reports `warn` with the skip as advisory.
- **A blocked command fails and is not a code problem.** The fix instruction says so explicitly, so
  an agent does not waste an attempt rewriting working code to satisfy an operator's allowlist.
- **`requireWorktree` defaults to false.** Epic 100 is still filling `TaskRun.worktreePath`; failing
  every audit today would be a wave-wide outage. The detail note fixes the silent part immediately,
  and a caller that knows it always has a worktree can make it strict.
- **Explain by projection, not by changing the contract.** `AuditCheck`/`AuditVerdict` are locked;
  everything the explanation needs (names, ok, detail, fixInstructions) is already on the verdict.
  The lint advisory signal is the auditor's own `; non-blocking` detail marker, which avoids a
  contract change for one boolean.
- **The reviewer prompt now names policy outcomes.** `commandSignal` says
  "blocked by command policy (…)" and "skipped (disabled by policy)" instead of a bare "skipped", so
  the model does not treat a policy skip as a green test. The committed prompt snapshot is unchanged
  because it uses a passing command result.

## Interfaces for future epics

- `canonicalLanePath(raw) → { path, problem? }` and
  `LaneCheckResult.problems?: Record<string, 'traversal' | 'absolute' | 'invalid' | 'outside-lane'>`
  — for any caller that wants to explain a lane violation (engine, web drawer, a future core glob
  normaliser).
- `CommandPolicy`, `DEFAULT_COMMAND_POLICY`, `DEFAULT_ALLOWED_COMMANDS`, `evaluateCommand`,
  `scrubbedEnv`, `isSecretEnvName`, `resolveCommandPolicy` — exported from `@starling/auditor` for
  the composition root. `createAuditor({ commandPolicy })` is the wiring point; a future
  `starling.config.yaml` key and CLI `--no-tests` map onto `mode: 'off'`.
- `CreateAuditorOptions.requireWorktree` — Epic 100 should pass `true` once every task run carries a
  `worktreePath`; today the default keeps the hub-repo fallback but labels it.
- `runShellCommand(execFn, command, cwd, timeoutMs, policy?, envSource?)` — additive; existing
  three-/four-argument calls are unchanged.
- `CommandResult.blockedReason` / `CommandResult.skippedReason` — additive; a policy refusal is data,
  not an exception.
- `explainVerdict(v)`, `formatVerdictExplanation(e)`, `CHECK_LABELS`, `DETAIL_TAIL_CHARS`,
  `ExplainedCheck`, `VerdictExplanation` — the dashboard hook (Epic 41 / 55 / 68) can import
  `@starling/auditor` in the server or copy the type-only module into the browser bundle.
- C3 wiring: **none**. `packages/auditor/src/index.ts` is inside this lane; no shared registration
  file, route, CLI flag or `App.tsx` change is required.

## Deviations from plan

- **No `packages/core` change.** The shared `normalizeGlobPath` still does not resolve `..`; the
  auditor canonicalises locally as instructed. The exact core change is a FIX REQUEST below.
- **A literal argv in a comment tripped the static probe.** `commands.ts`'s doc comment originally
  repeated `['sh', '-c', command]`; `tools/security/exec-argv.test.ts` matches that text anywhere in
  a production file, so it saw two sites. The comment now says "`sh -c` argv" and the probe sees one
  site. No code moved.
- **One existing assertion changed** in `commands.test.ts`: `opts` is no longer exactly
  `{ cwd, timeoutMs }` because the default policy supplies `env` (`CI=1` and cleared secrets). The
  test now asserts the meaningful subset plus the env. No snapshot changed; the committed prompt
  snapshot is byte-identical.
- **`problems` is always present** on a `LaneCheckResult` (possibly `{}`); the type keeps it
  optional so older consumers are unaffected.
- **Lint gets the same policy treatment as tests**, including the `; non-blocking` suffix on a
  blocked-but-advisory lint. The brief only named the tests check; leaving the lint path able to run
  an arbitrary command would have left the hole open.

## Known limitations / deferred

- **Accepted risk (SEC-11).** The repo's own test/lint command runs as the invoking user, with the
  user's cwd permissions, through `sh -c`. Mitigations: the command is repo-map/config-derived (never
  a request value — enforced by `tools/security/exec-argv.test.ts`), it runs with `cwd` set to the
  task worktree, a hard timeout (default 10 min) kills a hang, the child environment has credential
  variables cleared and `CI=1` set, and `commandPolicy: { mode: 'allowlist' }` (or `'off'`) exists
  for untrusted repos. It is **not** a sandbox: `make test`, `pytest` and a repo's `package.json`
  scripts can still execute arbitrary code by design. A container/seccomp executor is a future epic,
  not a policy string. The merger keeps its own copy of the policy (Epic 104) by instruction; the
  two are not shared.
- No CLI `--no-tests` flag and no `starling.config.yaml` key; both are outside this lane. The API
  (`commandPolicy`) is ready for them.
- Lint still runs in the hub repo when no worktree exists; only the tests check carries the
  hub-repo note and the strict `requireWorktree` failure. Lint is advisory by default, so the
  exposure is smaller.
- `explainVerdict` infers "blocking lint" from the absence of the auditor's `; non-blocking`
  marker. A hand-written verdict without that marker and `pass: true` is classified as advisory
  anyway (passing verdict + lint), but a hand-written `pass: false` lint-only verdict is reported as
  blocking even if it was meant to be advisory.
- The traversal guard treats *any* `..` as hostile, including a legitimate-looking
  `dir/../other.ts`; git never produces one, so this is a false-positive only for hand-built
  `TaskResult` data, and failing closed is the right direction.
- No real model call was made (L23/L37). All reviewer paths are exercised with `MockLLM`; the fixture
  contains recorded old-format verdicts and is used read-only.
- `isBookkeepingPath` canonicalises and then `checkLane` canonicalises again; a negligible duplicate
  for clarity (the exported helper must also be safe on its own).
