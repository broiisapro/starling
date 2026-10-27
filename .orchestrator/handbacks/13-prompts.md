## Epic 13 Handback — Prompt compiler

**Status:** Complete. Branch `epic/13-prompts` @ `d8480a5` (this handback commit on top).

**Delivered:**
- `packages/prompts/src/index.ts`: public surface — `createPromptCompiler`, `buildWorkerPrompt`, `buildFixerPrompt`, `buildResolverPrompt`, `conflictingTasks`, `parseHandback`, `handbackInstructions`, `estimateTokens`, `renderRepoMap`, `rankRepoFiles`, `resolveOptions`, `WorkerHandbackSchema`, `HANDBACK_START`/`HANDBACK_END`, plus types.
- **Worker prompt** with the nine sections in the required order (role → project context → task → lane → siblings → repo orientation → verify → git → finish line). Includes goal `constraints`, an explicit dependencies line, test/lint commands, and the §8 handback block.
- **Fixer prompt**: failed checks with auditor detail, passed checks named separately, lane violations with “revert these”, `fixInstructions` verbatim, “fix only these / don’t redo completed work”, the same lane rules, the task for reference, same handback.
- **Resolver prompt**: conflicted files + merger detail, its own intent (goal/deliverables/out-of-scope/DoD), every sibling whose lane owns a conflicted file with its intent, both-sides-survive rules (no dropping tests, resolve markers in place, run tests, commit on the branch), same handback. Falls back honestly when no lane claims the file.
- **Budget guard** in `buildWorkerPrompt`: halves the repo map (floor 400 chars) first, then the sibling list (floor 3 + “and N more”), never the task spec or lane globs; `maxChars` default 24 000, 12-step cap.
- **Handback parsing**: last `<<<STARLING_HANDBACK … STARLING_HANDBACK>>>` block, fence-tolerant, prose-tolerant, zod-validated, extra fields ignored, malformed input → `undefined` (never throws).
- **Lane-focused repo map renderer**: rank owned/read/other via the core glob matcher, deterministic path sort, summaries/symbols in `full`, budgeted tail, owned/read never dropped.
- `style: 'compact'`: same facts, less prose, 40% map budget.
- 101 tests in 8 files, 4 committed snapshots (worker full, worker compact, fixer, resolver).
- `docs/epic-13-prompts.md` with exported signatures, an engine usage snippet, and the full `csv-export` worker prompt as an appendix.

**Key design decisions:**
- Facts above prose and the task above the repo map — the only shrinkable sections are the map and the sibling list, so an overloaded prompt can never lose a DoD item or a lane glob.
- Owned and read files are excluded from budget trimming: hiding an editable file is a correctness risk, hiding orientation noise is not.
- The handback template uses `<complete|partial>` placeholders, so an agent echoing the template does not parse as a successful handback. A concrete `"complete"` example would.
- `parseHandback` returns `undefined` rather than throwing: malformed handbacks are expected model behaviour, not a crash. Wrong-task verdict/merge inputs *do* throw `StarlingError('INVALID_ARGUMENT')` — those are engine bugs.
- Resolver attribution uses lane globs against conflicted files because `MergeResult` has no “other task” field, avoiding a contract change.
- `localeCompare` is avoided in sorting and byte formatting so snapshots are identical on every machine.
- Handback schema is mirrored in `src/handshake.ts` per ARCHITECTURE §8 rather than imported from core (core does not own `WorkerHandback` yet; C1 moves it).

**Verification (exact commands + results):**
- `bun install` (worktree): `Checked 133 installs across 192 packages (no changes)`.
- `bun test packages/prompts`: **101 pass / 0 fail**, `4 snapshots, 299 expect() calls`, `Ran 101 tests across 8 files.`
- `bun run test` (root): **286 pass / 0 fail**, `4 snapshots, 1083 expect() calls`, `Ran 286 tests across 44 files.`
- `bun run check`: **pre-existing failure, not this lane.** Biome reports 9 formatting errors, all outside `packages/prompts`: `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/host.ts`, `tools/local-models/ollama.ts`, `tools/local-models/ollama.test.ts`, `tools/local-models/smoke.ts` (2 errors, one an import-order fix), and two files under `tools/local-models/results/`. `bunx biome check packages/prompts` is clean (23 files, no fixes). `bun run typecheck` exits 0 for every workspace.
- `git status`: only `packages/prompts/**`, `docs/epic-13-prompts.md` and this handback changed.

**Dependencies added:** `zod@4.6.7` in `packages/prompts/package.json` (already resolved in the workspace through core). `bun install` updated `bun.lock`'s workspace entry; the lockfile was not hand-edited.

**CONTRACT REQUESTS:** none.

**Deliberately deferred / out of scope:**
- Real repo-map rendering (tree, symbols, caching) — repomap's renderer is adopted at C1; this one is a minimal, lane-focused stand-in by design.
- Any LLM call, prompt quality benchmarking against a live model, and `*.live.test.ts` files (L23: no local models or real calls in this wave).
- Cross-checking `handback.filesChanged`/`testsAdded` against the real diff — that belongs to the auditor.
- A tokenizer; `estimateTokens` is the documented 4-chars-per-token heuristic for budgeting/logging only.
- Retrying with the previous diff: the fixer prompt replaces the worker prompt on retries.

**Open questions / flagged tradeoffs:**
- **Placeholder template.** `<complete|partial>` guarantees template echoes fail validation, but a literal-minded model may copy the placeholders and end with no parsable handback. The engine should treat that as “no handback” and let the audit decide. If live runs show this happening, switch to a concrete example and accept that an unedited echo parses.
- **Resolver attribution** can only see lanes. A conflict in a shared file no lane owns (e.g. `src/main.ts`) has no attributable sibling; the prompt says so and lists the plan instead of guessing.
- **Sibling trimming** drops the last siblings in plan order, so which ones disappear is deterministic but arbitrary. With six siblings the map shrink alone usually suffices.
- If the fixed sections alone exceed `maxChars`, the prompt is returned over budget rather than truncating the task spec — a deliberate tradeoff.
