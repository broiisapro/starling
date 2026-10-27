## Epic 16 Handback — Auditor: tests + lanes + local LLM verdict

**Status:** Complete. Branch `epic/16-auditor` @ `67f64e6` (this handback commit on top).

**Delivered:**
- `packages/auditor/src/auditor.ts` — `createAuditor({ llm?, exec?, clock?, commandTimeoutMs?, lintBlocking?, maxDiffChars? })`
  returning the core `Auditor` port. `audit(input)` runs five checks in order and never throws for
  check failures.
- `packages/auditor/src/lane.ts` — `checkLane` over core `matchesAny`, with an explicit allowlist for
  Starling bookkeeping (`.starling/**`, `.starling-worktrees/**`); lockfiles are deliberately not
  exempt.
- `packages/auditor/src/commands.ts` — `runShellCommand` (`sh -c`, injected `exec`, cwd = worktree,
  timeout, 4 KB tail), `tailText`, `describeCommand`.
- `packages/auditor/src/diff.ts` — `splitDiff`, `prioritiseDiff` (lane-owned blocks first, headers
  kept, omitted files named), `isTestPath`, `isBehaviourPath`, `diffSignals` / `signalsFor`.
- `packages/auditor/src/prompt.ts` — `AUDITOR_SYSTEM_PROMPT` + `buildAuditPrompt`: task brief,
  numbered DoD, lane, deterministic signals (including `NEW BEHAVIOUR WITHOUT NEW TESTS`), changed
  file stats, test-output tail, fenced diff, truncation notice. Deterministic; snapshot-tested.
- `packages/auditor/src/verdict.ts` — `buildFixInstructions` (lane → empty diff → tests → blocking
  lint → unmet DoD → reviewer instructions, deduped and numbered), `buildSummary`, `makeCheck`.
- `packages/auditor/src/types.ts` — options, resolved options, zod reviewer schema
  (`{pass, summary, dod[{item, met, evidence}], fixInstructions?}`), `starling/deterministic` model.
- `packages/auditor/src/index.ts` — public exports (factory, prompt, helpers, types); the placeholder
  export is replaced.
- 79 offline tests across 7 files + 1 committed prompt snapshot. No network, no process spawn, no
  model, no `ollama` invocation.
- `docs/epic-16-auditor.md` — pipeline, decisions, exact exported signatures, usage snippet, the
  full system prompt, a worked csv-export first-attempt verdict JSON, deviations and limitations.

**Key design decisions:**
- **Deterministic checks are law; the reviewer adds judgment.** The pass formula is
  `lane.ok && !empty && tests.ok && (lintBlocking ? lint.ok : true) && reviewerPass`, so the gate
  still works with no local model. Rule 4 of the system prompt says the same thing.
- **No-tests catch is reviewer-enforced via an explicit signal.** `NEW BEHAVIOUR WITHOUT NEW TESTS:
  YES` + a hard system-prompt rule. A deterministic sixth check was rejected for v1: refactors,
  renames and config edits would false-fail and burn retries; Epic 44 can tune one with real-model
  data. A scripted-reviewer test proves the seeded `will-fail-audit` miss fails with an "add tests"
  instruction.
- **Contradiction guard.** A reviewer that returns `pass: true` while any DoD item is `met: false`
  is rejected (detail says so). Trusting the boolean would defeat the evidence rule.
- **Empty diff skips the reviewer.** Nothing to review, deterministic failure is decisive, and it
  saves the most expensive call.
- **Advisory lint is recorded honestly.** Failing non-blocking lint shows `ok: false` +
  `; non-blocking` in the detail; `pass` ignores it unless `lintBlocking`. Hiding it would make the
  dashboard lie.
- **Lane-first truncation keeps evidence.** Owned blocks first, every kept block keeps its
  `diff --git`/`---`/`+++` header, omitted files are listed, and a diff that fits is returned
  byte-for-byte (no reordering).
- **Durations live in the `detail` trailer.** `AuditCheck` is frozen without a duration field; see
  the contract request. This avoided changing LOCKED contracts.
- **No `src/handshake.ts`.** The package imports only `@starling/core` (and `@starling/core/testing`
  in tests), so there is no Wave 1 sibling to mirror.
- **Extra helpers are exported** (`prioritiseDiff`, `checkLane`, `runShellCommand`, …) because they
  are pure, tested, and useful to E20/E21/E44. No contract or root config changed.

**Verification (exact commands + results):**
- `bun install` (worktree) → `Checked 133 installs across 192 packages (no changes) [13.00ms]`.
- `bun test packages/auditor` → `79 pass / 0 fail`, `1 snapshots, 242 expect() calls`, `Ran 79 tests
  across 7 files. [54.00ms]`.
- `bun run test` (root) → `264 pass / 0 fail`, `1 snapshots, 1026 expect() calls`, `Ran 264 tests
  across 43 files. [378.00ms]`.
- `bun run typecheck` → clean (`tsc --noEmit -p` for every workspace, exit 0).
- `bunx biome check packages/auditor docs/epic-16-auditor.md` → `Checked 19 files. No fixes applied.`
- `bun run check` → **fails on 9 pre-existing Biome errors outside this lane**, all present on
  `origin/main` and untouched by this branch: `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`,
  `tools/local-models/host.ts`, `tools/local-models/ollama.test.ts`, `tools/local-models/ollama.ts`,
  `tools/local-models/smoke.ts` (format + organizeImports), and the two
  `tools/local-models/results/*.json` files. The typecheck half of `bun run check` passes.
- Worked example was produced by actually running `createAuditor` with a scripted reviewer, a fake
  exec and `FakeClock` (no network/model); the JSON in the doc is that output, including the merged
  DoD-unmet + reviewer fix instructions.

**Dependencies added:** `zod@4.6.7` in `packages/auditor` (already installed in the workspace via
`@starling/core`; used for the reviewer response schema). `bun.lock` updated by `bun install`.

**CONTRACT REQUESTS:** Add an optional `durationMs?: number` to `AuditCheck` in
`packages/core/src/contracts.ts` (schema: `durationMs: z.number().int().nonnegative().optional()`).
Why: the epic requires each check to report its duration, but the frozen `AuditCheck` has only
`name`/`ok`/`detail`, so this implementation appends ` (N ms)` to `detail` and the UI would have to
parse prose. Additive and backward compatible; no blocker (current behaviour is documented).

**Deliberately deferred / out of scope:**
- Real local-model tuning and prompt iteration — Epic 44 (explicitly out of scope here); model choice
  is Epic 28. No `ollama` command was run (L23).
- A deterministic no-tests guard — deferred until real-model data exists; the signal and path
  heuristics are exported for it.
- `*.live.test.ts` for a real reviewer — the LLM transport belongs to `@starling/llm`; L23 forbids
  local models in this wave.
- Streaming test/lint output over `AgentEvent`s; reviewer caching; a per-audit concurrency limit.
- Parsing quoted diff paths with spaces and modelling rename-only diffs (known limitations section).

**Open questions / flagged tradeoffs:**
- Advisory lint failures are recorded as `ok: false` while `verdict.pass` stays true. That is honest
  for the dashboard but means `pass` is not `checks.every(ok)`; the UI should render an advisory
  failure as a warning, not a failed audit.
- A reviewer that omits DoD entries entirely cannot be caught mechanically (only explicit
  `met: false` contradictions are). Enforcing item coverage would require fuzzy item matching; the
  prompt demands one entry per item.
- The `worktreePath` fallback to `goal.repoPath` exists so the auditor is never unusable, but E20
  must always set `worktreePath` — otherwise an audit would grade the hub repo.
