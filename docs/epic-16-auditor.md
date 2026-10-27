# Epic 16 — Auditor: tests + lanes + local LLM verdict

**Wave 1 · package `@starling/auditor` · branch `epic/16-auditor`**

## Goal

Starling's quality gate. When an agent says a task is done, the auditor decides **pass or fail with
exact fix instructions**. It combines hard deterministic checks (lane respected, tests green,
optional lint) with a reviewer model reading the diff against the task's definition of done. The
demo moment — "the local model caught the missing test" — is this package.

The auditor never edits code, never merges and never runs the fix loop; it produces one
`AuditVerdict` per attempt and the engine decides what happens next.

## How it works

### The five checks, in order

| #   | name         | what it does                                                                                 | fails when                                                                  |
| --- | ------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `lane`       | every changed file must match `task.lane.owns` via core `matchesAny`                         | any file is outside the lane (and is not Starling bookkeeping)              |
| 2   | `non-empty`  | the diff must contain at least one changed file and a non-blank patch                        | the diff is empty                                                           |
| 3   | `tests`      | runs `ctx.testCommand` as `sh -c <cmd>` with `cwd = run.worktreePath` and `commandTimeoutMs` | non-zero exit, timeout, spawn failure                                       |
| 4   | `lint`       | runs `ctx.map.lintCommand` the same way; **advisory unless `lintBlocking`**                  | the command fails — but only blocks the verdict when `lintBlocking`         |
| 5   | `llm-review` | `LLM.completeJson` as role `auditor` against the DoD                                         | the reviewer says `pass: false`, or passes while a DoD item is `met: false` |

Each `AuditCheck` carries its duration in the detail trailer (`… (412 ms)`) because the frozen
`AuditCheck` contract has only `name`, `ok`, `detail`. A check failure is recorded, never thrown.
All five checks always appear, in this order, even when one is skipped (`ok: true`,
`detail: "skipped: …"`).

**Lane exceptions.** Starling's own bookkeeping paths are allowed without being owned:
`.starling/**` (SQLite store, per-run JSONL event logs, recordings) and `.starling-worktrees/**`
(only when `worktreeRoot` is inside the target repo). Lockfiles are **not** exempt: a dependency
change is a real change that the integrator should see. The list is exported as
`STARLING_BOOKKEEPING_GLOBS` and documented in `src/lane.ts`.

**Command execution.** `runShellCommand` uses the injected `ExecFn`, defaults to core `exec`, and
runs `['sh', '-c', command]` with a hard timeout (default 600 000 ms). It returns
`{ran, code, timedOut, error, output, tail, durationMs}` and keeps the last 4 KB (`tail`) for the
reviewer and the verdict. stdout and stderr are combined in that order. The worktree is mandatory:
grading the hub repo would grade the integration branch, not the task.

### Reviewer prompt and diff budgeting

`buildAuditPrompt` assembles one deterministic user message: task brief, out-of-scope list,
numbered DoD, plan-level locked decisions, lane, deterministic signals, changed-file stats, test
output tail, and the unified diff. It contains no clocks, ids or durations, so the whole prompt is
snapshot-tested (`src/__snapshots__/prompt.test.ts.snap`).

Two signals are computed from the changed-file list:

- `test files changed: yes | no` — matching `*.test.ts`, `*.spec.ts`, `__tests__/`, `tests/`,
  `*_test.go`, `test_*.py` across the common languages.
- `NEW BEHAVIOUR WITHOUT NEW TESTS: YES | no` — true when the diff touches executable source
  (`.ts`, `.js`, `.py`, `.go`, …) but no test file. Tests, `*.d.ts` and `*.config.*` are excluded.
  This is the seeded `will-fail-audit` miss: export code, no test file.

Diffs are capped at `maxDiffChars` (default 60 000). A diff that already fits is returned
byte-for-byte. When it does not, `prioritiseDiff` emits lane-owned file blocks first, then the
rest, keeping every included block's `diff --git` / `---` / `+++` header. A block cut mid-way gets
an inline `… [truncated: path]` marker; fully omitted files are named in the prompt's
`omitted files:` signal, and the changed-file list always shows every path and stat.

### Verdict rules

```text
pass = lane.ok
    && !emptyDiff
    && tests.ok
    && (lintBlocking ? lint.ok : true)
    && (reviewer consulted ? reviewerPass : true)
```

- **Reviewer unavailable** (no LLM configured, thrown `LLM_ERROR`, timeout, unparsable JSON):
  `llm-review` is recorded as skipped with the reason and the deterministic checks decide. The
  verdict carries `model: { provider: 'starling', model: 'deterministic' }`.
- **Reviewer contradiction:** `pass: true` with any DoD entry `met: false` is rejected. The check
  detail says so and the verdict fails. This guard exists because the DoD evidence rule is the
  reviewer's main failure mode; passing while admitting an unmet item is never safe.
- **Empty diff:** the reviewer is not called (nothing to review, tokens saved). The audit fails
  deterministically on `non-empty`.
- **Model provenance:** a consulted reviewer's `LLMResponse.model` is copied into the verdict;
  `ts` comes from the injected `Clock`.

### Fix instructions

`buildFixInstructions` produces one numbered list, deterministic facts first:

1. one per lane violation — "Revert or move the change to `path`: it is outside this task's lane (…)"
2. empty diff — the deliverables to implement
3. failing tests — exit code plus the last 1 200 characters of output in a fenced block
4. blocking lint failure — same shape
5. one per unmet DoD item — the item and the reviewer's evidence
6. the reviewer's own instructions, split on lines and stripped of `1.` / `-` markers

Instructions are deduped case-insensitively (the reviewer repeating a lane instruction yields one
item). If a reviewer fails a task without giving instructions, its summary becomes the instruction.

### Options

| option             | default       | meaning                                                       |
| ------------------ | ------------- | ------------------------------------------------------------- |
| `llm`              | `undefined`   | reviewer (role `auditor`); absent = fully deterministic audit |
| `exec`             | core `exec`   | command runner, injected by tests                             |
| `clock`            | `systemClock` | `AuditVerdict.ts`                                             |
| `commandTimeoutMs` | `600_000`     | kill tests/lint after this                                    |
| `lintBlocking`     | `false`       | failing lint fails the audit                                  |
| `maxDiffChars`     | `60_000`      | reviewer diff budget                                          |

## The auditor system prompt

Sent verbatim as `LLMRequest.system`; exported as `AUDITOR_SYSTEM_PROMPT`.

```text
You are Starling's auditor. A coding agent has just finished one task from a plan whose tasks run in parallel lanes. You decide whether the work is safe to merge into the integration branch.

You are given the task's definition of done (DoD), its lane, the unified diff, the deterministic check results (lane, test command, optional lint) and the tail of the test output.

Rules, in priority order:

1. Judge only against the task. Ignore style preferences, unrelated improvements and everything listed under "Out of scope". A correct, tested, in-lane change passes even if you would have written it differently.
2. Every DoD item needs evidence in the diff. Set "met": true only when a file path, symbol, hunk or a passing test that exercises the new code demonstrates the item. Put that evidence in "evidence" — a short quote or path, not a restatement of the item. If you cannot point at evidence, set "met": false and say exactly what is missing.
3. New behaviour requires tests. When the deterministic signals say "NEW BEHAVIOUR WITHOUT NEW TESTS: YES", treat it as a strong presumption that "pass" must be false. Fail unless the diff is a pure refactor, rename, formatting or type-only edit that the existing tests already exercise, and say which tests cover it. A green existing suite is not coverage: it can pass without executing the new code. When you fail for this reason, name the missing test cases and the test file to add.
4. Deterministic failures are not yours to overrule. If the lane check, the test command or a blocking lint failed, "pass" must be false. You may add fix instructions; you may never remove theirs.
5. Do not invent files, tests, output or requirements that are not in this request. Do not fail a task for a problem that predates its diff.
6. "fixInstructions" is required when "pass" is false and must be a numbered list a competent agent can follow without asking questions. Name files, test cases, commands and the expected result. No vague advice such as "improve quality". Omit it when "pass" is true.
7. "dod" must contain exactly one entry per DoD item, in the order given, even when the item is unmet. "summary" is one or two plain sentences for the dashboard.

Respond with JSON only — no prose, no markdown fences — matching this shape:
{"pass": boolean, "summary": string, "dod": [{"item": string, "met": boolean, "evidence": string}], "fixInstructions"?: string}
```

The user message ends with the DoD in numbered form, the lane, the deterministic signals, the
changed-file table, the test output tail and the fenced diff (see the snapshot for the exact text).

## Worked example — sky-todo `csv-export`, first attempt

The worker shipped the serializer but no test file (the seeded `will-fail-audit` miss). Tests and
lint are green and the lane is clean, so only the reviewer can catch it. This JSON was produced by
running the real `createAuditor` with a scripted reviewer and a fake `exec`; durations are one
process's real timings.

```json
{
  "taskKey": "csv-export",
  "attempt": 1,
  "pass": false,
  "checks": [
    {
      "name": "lane",
      "ok": true,
      "detail": "all 1 changed file(s) match the lane (src/features/export/**) (0 ms)"
    },
    {
      "name": "non-empty",
      "ok": true,
      "detail": "diff touches 1 file(s), +14/-0 lines (0 ms)"
    },
    {
      "name": "tests",
      "ok": true,
      "detail": "tests: exit 0; Ran 12 tests across 2 files. (0 ms)"
    },
    {
      "name": "lint",
      "ok": true,
      "detail": "lint: exit 0; Checked 34 files in 22ms. No fixes applied. (0 ms)"
    },
    {
      "name": "llm-review",
      "ok": false,
      "detail": "ollama/qwen3.6:35b-a3b: The serializer is in place but the required round-trip coverage is missing, so the no-tests miss stands. (1 ms)"
    }
  ],
  "laneViolations": [],
  "summary": "Audit failed llm-review. The serializer is in place but the required round-trip coverage is missing, so the no-tests miss stands. See fix instructions.",
  "model": {
    "provider": "ollama",
    "model": "qwen3.6:35b-a3b"
  },
  "ts": 1731000300000,
  "fixInstructions": "1. Definition of done not met — \"A round-trip test covers commas, quotes and newlines\": no test file appears in the diff.\n2. Add src/features/export/index.test.ts with a round-trip test for a title containing a comma, one containing a double quote, and one containing a newline.\n3. Assert the header row and the empty-list case, then re-run bun test."
}
```

The engine feeds `fixInstructions` back through `PromptCompiler.fixer`; attempt 2 adds
`src/features/export/index.test.ts`, the reviewer's DoD evidence then points at that file, and the
audit passes.

## Key decisions & reasoning

- **Deterministic checks are law; the model only adds judgment.** Lane, empty-diff and test results
  are not up for debate, which is also rule 4 of the prompt. This keeps the gate honest when the
  local model is weak or unavailable.
- **The no-tests rule is reviewer-enforced via an explicit signal, not a hidden sixth check.** The
  changed-file heuristics are surfaced as `NEW BEHAVIOUR WITHOUT NEW TESTS: YES`, and the system
  prompt makes it a strong presumption. A deterministic gate was rejected for v1: refactors,
  renames, config edits and docs legitimately change code without adding tests, and a false fail
  burns a retry (and a merge slot). Epic 44 can add a tuned guard once real-model data exists; the
  signal and test-path helpers are exported for that.
- **Advisory lint is recorded honestly.** A failing non-blocking lint shows `ok: false` with
  `; non-blocking` in the detail, while the pass formula only consults it when `lintBlocking` is
  set. Hiding the failure would make the dashboard lie; failing on it would ignore the option.
- **The contradiction guard rejects "pass with an unmet DoD item".** Small models sometimes emit a
  friendly `pass: true` and an honest `met: false`. Trusting the boolean defeats the evidence rule,
  so the verdict fails and the item appears in the fix instructions.
- **An empty diff does not call the model.** There is nothing to judge, the deterministic failure is
  already decisive, and the local model may be the most expensive thing in the process.
- **Prompt budget prioritises in-lane evidence and keeps headers.** The reviewer needs the lanes it
  is grading more than the violation it is told to revert; every kept block still begins with its
  file header, and omitted files are listed by name so the verdict cannot silently miss a file.
- **Instructions are deduped and deterministic-first.** A model repeating "revert `src/ui/render.ts`"
  would otherwise produce a numbered list with duplicates. The worker reads this list directly.
- **`sh -c` through injected `exec` (L13).** Test commands are naturally shell strings ("bun test &&
  bunx tsc --noEmit"), while git/gh stay argv-only. `exec` is injectable so every test runs offline.
- **Duration in the detail string.** The `AuditCheck` contract (LOCKED) has no duration field; the
  trailer keeps the information without a contract request.
- **No handshake mirror needed.** The auditor consumes only `@starling/core` (ports, contracts,
  exec, glob, clock) and never imports a Wave 1 sibling, so there is no `src/handshake.ts`.
- **Model provenance is copied from the response, not the config.** The LLM router decides which
  model actually answered (fallbacks, `--fully-open`); the verdict should show the truth. The
  `starling/deterministic` sentinel is used when no model answered.

## Interfaces for future epics

Exact exports from `packages/auditor/src/index.ts`:

```ts
export const PACKAGE: '@starling/auditor';

export interface CreateAuditorOptions {
  llm?: LLM;
  exec?: ExecFn;                       // (cmd: string[], opts: ExecOptions) => Promise<ExecResult>
  clock?: Clock;
  commandTimeoutMs?: number;           // default 600_000
  lintBlocking?: boolean;              // default false
  maxDiffChars?: number;               // default 60_000
}

export function createAuditor(options?: CreateAuditorOptions): Auditor;
// Auditor.audit(input: AuditInput): Promise<AuditVerdict>   — ARCHITECTURE §6 port, never throws

// helpers exported for reuse, tests and the dashboard
export function checkLane(changedFiles: readonly string[], owns: readonly string[]): LaneCheckResult;
export const STARLING_BOOKKEEPING_GLOBS: readonly ['.starling/**', '.starling-worktrees/**'];
export function isBookkeepingPath(path: string): boolean;

export function runShellCommand(
  execFn: ExecFn,
  command: string | undefined,
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult>;
export function tailText(text: string, limit?: number): string;   // default 4_096
export const COMMAND_OUTPUT_TAIL_CHARS = 4_096;
export function describeCommand(result: CommandResult): string;

export function splitDiff(patch: string): DiffBlock[];
export function prioritiseDiff(
  patch: string,
  opts: { owns: readonly string[]; maxChars: number },
): PrioritisedDiff;                   // { patch, truncated, omittedFiles }
export function isTestPath(path: string): boolean;
export function isBehaviourPath(path: string): boolean;
export function diffSignals(changedFiles: readonly string[]): DiffSignals;
export function signalsFor(diff: DiffSummary, changedFiles: readonly string[]): DiffSignals;

export const AUDITOR_SYSTEM_PROMPT: string;
export function buildAuditPrompt(args: AuditPromptArgs): string;

export const AuditorLlmVerdictSchema: z.ZodType<AuditorLlmVerdict>;
export const DodVerdictSchema: z.ZodType<DodVerdict>;
export const DETERMINISTIC_MODEL: { provider: 'starling'; model: 'deterministic' };
export const DEFAULT_COMMAND_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_DIFF_CHARS = 60_000;

export function buildFixInstructions(input: FixInstructionInput): string | undefined;
export function buildSummary(input: SummaryInput): string;
export function makeCheck(name: string, ok: boolean, detail: string, durationMs: number): AuditCheck;
```

Types exported alongside: `ExecFn`, `ResolvedAuditorOptions`, `CommandResult`, `DiffBlock`,
`DiffSignals`, `PrioritisedDiff`, `LaneCheckResult`, `AuditPromptArgs`, `AuditorLlmVerdict`,
`DodVerdict`, `FixInstructionInput`, `SummaryInput`.

Usage in the engine (E20) — real LLM router, real exec, worktree from the `TaskRun`:

```ts
import { createAuditor } from '@starling/auditor';

const auditor = createAuditor({
  llm: router.forRole('auditor'), // @starling/llm
  commandTimeoutMs: 600_000,
  lintBlocking: config.lintBlocking ?? false,
});

const verdict = await auditor.audit({
  ctx: promptCtx, // PromptContext: goal, plan, map, task, branch, testCommand
  run: taskRun, // must carry worktreePath
  diff, // Workspace.diff(worktreePath, integrationRef)
  changedFiles, // Workspace.changedFiles(...)
  attempt: taskRun.attempts,
});

if (verdict.pass) {
  await merger.merge(repo, integrationBranch, taskRun, { testCommand });
} else {
  await node.sendPrompt(handle, compiler.fixer(promptCtx, verdict));
}
```

Offline test shape (no network, no model):

```ts
const llm = new MockLLM({ responses: [{ text: JSON.stringify(passingVerdict()) }] });
const fake = fakeExec((command) => ({ code: 0, stdout: '12 pass\n0 fail' }));
const auditor = createAuditor({ llm, exec: fake.fn, clock: new FakeClock(1_700_000_000_000) });
const verdict = await auditor.audit(makeAuditInput());
expect(verdict.checks.map((c) => c.name)).toEqual(['lane', 'non-empty', 'tests', 'lint', 'llm-review']);
```

The store/server need no auditor-specific work: publish the returned verdict as the
`audit.verdict` event payload.

## Deviations from plan

- **`zod@4.6.7` added to `packages/auditor/package.json`** (already in the workspace via core, per
  L22's "prefer what's already installed"). The reviewer response schema is the package's own
  contract; importing core's zod instance through `@starling/core` would be a hidden dependency.
- **Extra exported helpers** (`prioritiseDiff`, `checkLane`, `runShellCommand`, …) beyond the single
  `createAuditor` deliverable. They are pure, tested and useful to E20/E21/E44; no frozen contract
  changed.
- **`lint` records `ok: false` for a failing advisory lint** while the final `pass` ignores it unless
  `lintBlocking`. The plan said "blocking only if `lintBlocking`"; recording the actual command
  result is the honest reading.
- **The reviewer is skipped for an empty diff**, in addition to the specified "LLM errors or
  times out" case. No model call is useful when there is nothing to read.
- **Contradiction guard:** the final `pass` additionally requires every `dod` entry to be `met` when
  the reviewer passed. This is stricter than `llm.pass` alone and is documented above.
- **Deterministic model sentinel `starling/deterministic`** for verdicts that did not consult a
  model (the contract requires a `ModelRef` and has no "none" literal).
- **The DoD/no-tests rule is reviewer-enforced**, not a deterministic check (see Key decisions).

## Known limitations / deferred

- **The no-tests catch depends on the reviewer.** A too-lenient model can pass the seeded miss; a
  too-strict one can fail a pure refactor. The prompt and signal are tuned to the measured
  qwen3.8:27b behaviour, but real-model tuning is Epic 44 and model choice is Epic 28.
- **Heuristics cover common conventions only.** Test paths are the globs in `TEST_PATH_GLOBS`
  (JS/TS, Go, Python, `tests/`, `__tests__/`); behaviour detection is an extension list. Exotic
  layouts (e.g. `spec/` without `.spec.`) are not recognised, so the no-tests signal can be a false
  positive.
- **The diff parser does not unquote paths with spaces** and does not model renames. A rename-only
  change can look like behaviour without tests; the reviewer sees the `diff --git` lines and can
  still judge it.
- **DoD coverage is not mechanically enforced.** If a model omits a `dod` entry but says
  `pass: true`, the auditor cannot notice. Enforcing item counts would need fuzzy matching of model
  item text; the prompt demands one entry per item and the contradiction guard catches explicit
  unmet entries.
- **Prompt budget is characters, not tokens**, and the local model's context window is not
  consulted. A small `maxDiffChars` can drop large in-lane files after their header.
- **No reviewer caching or concurrency limit.** Each attempt is one completion; the engine's
  `maxParallel` is the only throttle, and local Ollama serialises anyway.
- **Test/lint commands run with a 10-minute default timeout and no output streaming.** Very slow
  suites block one audit slot; a future epic can stream command output over `AgentEvent`s.
- **The worktree path falls back to `goal.repoPath`** when `TaskRun.worktreePath` is missing, which
  would grade the hub repo. E20 must set `worktreePath`; the fallback exists so the auditor is never
  unusable, not as a supported mode.
- **No `*.live.test.ts` file.** The real reviewer transport is `@starling/llm`'s job, and L23
  forbids local models in this wave; the prompt snapshot plus `MockLLM` cover the contract.
