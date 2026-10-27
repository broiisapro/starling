# Epic 28 — Local model benchmark harness (MBP + Air)

**Status:** built and fully tested against a fake Ollama. **No real model has been loaded yet** —
that is the deliberate next step in the runbook below (ARCHITECTURE L23: the 27B model is not pulled
while ~20 agents share this 32 GB machine).

## Goal

Decide, with numbers instead of vibes, **which local open-weight model Starling audits and
summarises with on each laptop**: the MacBook Pro M5 Pro (32 GB) and the MacBook Air M2 (~16 GB).

The question is not "which model is smartest". It is:

1. does it reach the right **verdict** on a real audit (pass vs fail, and can it say why);
2. does it emit **valid JSON** without a repair loop;
3. can it answer fast enough to sit behind every merge (TTFT and total latency);
4. and does it **fit** next to macOS and one or two opencode sessions (resident memory + free RAM).

Epic 02 answered "which model can we pull at all" and measured one model. This epic answers
"which model should each laptop actually use", reproducibly, on twelve cases that mirror the
judgments Starling asks for in production.

## How it works

```
cases/*.json ──► bench.ts ──► runBench ──► (Ollama) ──► attempts ──► scores ──► table + bench-<host>-<date>.json
                   │                           │                                        │
                   ├─ safety rails             └─ fake Ollama on :0 for --dry-run       └─► recommend.ts
                   └─ unload between models                                                 └─► recommendation.json
```

### 1. The corpus — twelve audit cases

Each file in `tools/local-models/cases/` is a complete audit input plus the expected answer:

```json
{
  "key": "csv-export-no-tests",
  "title": "CSV export, shipped without a test",
  "goal": "Add an Export CSV action …",
  "lane": { "owns": ["src/ui/**"], "reads": ["src/lib/**", "docs/**"] },  // optional
  "definitionOfDone": ["…", "…", "…"],
  "diff": "diff --git a/src/ui/csv.ts …",
  "testOutput": "$ bun test … 18 pass, 0 fail",
  "expect": { "pass": false, "mustMention": ["test"] },
  "why": "The classic audit miss: real code, green suite, but the DoD asks for a test."
}
```

They are deliberately sky-todo-shaped and **balanced six pass / six fail**:

| case                        | expected | what it tests                                               |
| --------------------------- | -------- | ----------------------------------------------------------- |
| `csv-export-with-tests`     | pass     | the reference good change                                   |
| `csv-export-no-tests`       | fail     | DoD asks for a test; none was added                         |
| `docs-flag-typo`            | pass     | a trivially good docs change (punishes over-strictness)     |
| `lane-violation`            | fail     | good code that edits `src/lib/**` from a `src/ui/**` lane   |
| `partial-dod`               | fail     | two of three DoD items implemented                          |
| `tests-failing`             | fail     | red test in the tail of the output                          |
| `date-month-off-by-one`     | fail     | subtle bug: `getMonth()` never incremented; tests are green |
| `storage-module-refactor`   | pass     | a large, four-file change it cannot skim                    |
| `a11y-keyboard-nav`         | pass     | well-scoped feature with tests                              |
| `perf-memoized-filter`      | pass     | caching assertion the diff really satisfies                 |
| `theme-toggle-persist`      | pass     | three files, real persistence                               |
| `removed-export-regression` | fail     | silently deleted `formatTime`, breaking a consumer          |

`mustMention` is one literal token the verdict must name (`test`, `lane`, `empty`, `fail`,
`month`, `formattime`). It is checked case-insensitively in `summary + fixInstructions`. The corpus
test enforces: lowercase, no spaces, ≥ 4 characters, at most two per case — so a disqualifying
token can never be an unfair phrase.

### 2. The request

Every case is sent through **exactly** what `smoke.ts` sends (Epic 02): the OpenAI-compatible
`/v1/chat/completions` with a strict `json_schema` response format, streaming, `temperature: 0`,
falling back to `/api/chat` with `format: <schema>` in one attempt if the compatible endpoint fails.

That request now lives in one place — `audit-request.ts` — and both entrypoints import it, so a
future change to the auditor prompt cannot make the benchmark score a different question than the
one the smoke test proves.

### 3. The loop (`bench-run.ts`)

For each model, in order and one model at a time:

1. read `/api/ps` **before** loading (was it already resident?) and free RAM;
2. ask every case `--repeat` times (default 2) — a cold first pass, then a warm one;
3. after the first answer, sample `/api/ps` again for the resident size (`size` = weights + KV);
4. **abort this model on the first OOM-ish failure** (`out of memory`, `failed to allocate`,
   `ggml_backend…not enough memory`, or a 5xx whose body says memory) — retrying a model that does
   not fit is how Epic 02 took the laptop to 4 % free RAM;
5. sample free RAM after, then `POST /api/generate { keep_alive: 0 }` to unload before the next model.

An answer never reaching the daemon (status 0) aborts the whole model immediately with
`OLLAMA_UNREACHABLE`-ish text in `abortReason`.

### 4. Scoring (`bench-core.ts`)

- **`correct`** per case = expected `pass` matched **and** valid JSON **and** every `mustMention`
  token present. A case counts only when **every repeat** of it was correct (strict; a flaky model is
  a flaky auditor).
- **`accuracy`** = correct cases / **the whole corpus** (12), so an aborted model cannot look good by
  only being scored on what it reached.
- **`jsonValidRate`** = shaped, parseable verdicts / attempts (fences are tolerated).
- **TTFT / latency / tok/s** are means over attempts. TTFT is `null` if a stream never produced
  content; tok/s comes from `usage.completion_tokens` (a lower bound — the native call reports the
  exact eval counters, and Epic 10's router will prefer that).
- **memory**: `residentGb` (max seen while warm) and free RAM before → after.

### 5. The fake Ollama (`fake-ollama.ts`)

`Bun.serve({ port: 0 })` implementing `/api/version`, `/api/ps`, `/api/generate` (unload),
`/api/chat` and `/v1/chat/completions`, with scripted models:

| behaviour | answers                                                    |
| --------- | ---------------------------------------------------------- |
| `smart`   | the expected verdict, naming the `mustMention` token       |
| `lazy`    | `pass: true` for everything (fails all six negative cases) |
| `garbage` | prose, not JSON                                            |
| `oom`     | HTTP 500 `out of memory` on the first call                 |

The fake identifies the case **from the diff embedded in the prompt** (`findCaseForPrompt`), never
from a side channel, so the benchmark cannot leak the expected verdict into what it sends.

`--dry-run` runs the whole pipeline — HTTP transport, streaming parse, scoring, memory, unload — on
that fake and writes nothing. `--fake-free-ram` / `--fake-opencode` let a human (or a test) exercise
the rails without touching the machine.

### 6. Recommendation (`recommend.ts`)

RAM is a **hard gate**, then two rules:

1. **auditor** — most accurate eligible model; ties broken by lowest mean latency;
2. **summarizer** — fastest eligible model that still clears `SUMMARISER_MIN_ACCURACY` (80 %),
   because writing a PR body is easier than judging a diff; falls back to the auditor if nothing
   clears the bar.

Eligible = `status: ok`, a **measured** `residentGb`, and `residentGb ≤ budget` for the profile.
Budgets live in `PROFILE_BUDGET_GB`: **24 GB (mbp), 9 GB (air)**. The MBP figure is Epic 02's
measurement that an 18 GB model wires 21.2 GB and leaves 27 % free, and candidates.json's own
"23 GB is the upper bound" rule; the Air figure is candidates.json's "~7 GB next to 1-2 sessions".

Output is exactly `{ "mbp": { "auditor", "summarizer" }, "air": { … } }` in
`results/recommendation.json`, which is the two lines of `starling.config.yaml` the PRD asks for.

## RUNBOOK

Two deliberate sessions. Neither runs while Starling agents are working: the rails will refuse
(and that refusal is a test on this machine — a dry run today saw **23 opencode processes**, so the
limit of 4 is not hypothetical).

### (a) MacBook Pro M5 Pro, 32 GB — the real matrix

Prereqs: `bash tools/local-models/setup.sh --profile mbp --pull` has pulled at least the primary
(`qwen3.8:27b-mlx`, 18 GB), and `starling` agents are stopped.

```bash
cd starling
ollama ps                       # must print nothing: a stale model makes the first TTFT a lie

# 1. One sanity check first (30-60 s): proves the daemon and the JSON schema work.
bun tools/local-models/smoke.ts

# 2. The matrix. ~4 min per dense model, ~2 min per MoE, plus a cold load.
bun tools/local-models/bench.ts \
  --models qwen3.8:27b-mlx,gpt-oss:20b,gemma4:26b-a4b \
  --profile mbp --repeat 2 --max-ram-gb 8 --think off

# 3. If the ONNX/MLX variant is a suspect, repeat just that model with reasoning on:
bun tools/local-models/bench.ts --models qwen3.8:27b-mlx --profile mbp --repeat 1 --think on

# 4. Turn the newest results into the config lines.
bun tools/local-models/recommend.ts
```

**How long:** ~12-15 min for the three models at `--think off` (Epic 02 measured 5.8 s per verdict
versus 21.8 s with reasoning on; 24 requests per model). Add the pulls: `gpt-oss:20b` is 14 GB and
`gemma4:26b-a4b` 16-19 GB, and this network pulled at 2-4 MB/s during Epic 02, so **pull overnight**
or bench only what is resident (right now: `qwen3.8:27b-mlx`, ~4 min). A `--think on` pass on one
model adds ~9 min.

What to check before trusting the file:

- `curl -s localhost:11434/api/ps` is empty **between** the model headers in the table (the unload
  worked), and `residentGb` for the 27B is ~18-21 GB, not a small number (a small number means the
  sample raced the load);
- `jsonValidRate` is 100 %; below that, do not wire the model in — Starling would need a repair
  loop on every merge;
- the six negative cases are the ones it misses, not the positives. Missing a positive means it is
  too strict to be useful;
- `freeRamAfterGb` still leaves room for the opencode sessions the config will run.

Then:

```bash
cat tools/local-models/results/recommendation.json
# → models:
#     auditor:    { provider: ollama, model: <mbp.auditor> }
#     summarizer: { provider: ollama, model: <mbp.summarizer> }
```

### (b) MacBook Air M2, ~16 GB

Prereqs: `bash tools/local-models/setup.sh --profile air --pull` (one-time; it pulls
`qwen3.5:9b`, 6.6 GB, and drops to `qwen3.5:4b` on an 8 GB machine).

```bash
cd starling
ollama ps

bun tools/local-models/smoke.ts        # ~20-60 s

# All four candidates fit the 9 GB budget; small models are fast, so run them all.
bun tools/local-models/bench.ts \
  --models qwen3.5:9b,gemma4:12b-it-qat,gemma4:e4b,qwen3.5:4b \
  --profile air --repeat 2 --max-ram-gb 4 --think off

bun tools/local-models/recommend.ts
```

**How long:** the bench is ~6-8 min for four small models (expect 30-60 tok/s). The pulls are the
long part: ~24 GB total, so pull over home wifi, or start with `qwen3.5:9b` alone (~7 min of bench)
and add the others later — `recommend.ts` merges the newest result per model across files, so
later runs refine the pick instead of replacing it.

The Air's own model is an optimisation for its worker sessions; audits always run on the hub
(L20), so a weak Air verdict is not a blocker — wire `air` only if `jsonValidRate` is 100 %.

### Re-running and gotchas

- **One matrix per file.** A file records the `think` / `repeat` / `maxTokens` it used; mixing
  settings in one profile makes accuracy and latency incomparable. Use `--out` to name a run.
- `results/bench-<host>-<date>.json` is machine-specific and gets overwritten the same day; pass
  `--out` (e.g. `--out results/bench-mbp-nothink-2026-10-28.json`) to keep a comparison.
- `--no-write` measures and prints without writing anything.
- If a run is killed mid-model, the model may stay resident: `ollama stop <model>`, or the next
  run's `keep_alive: 0` unload will do it.
- `--dry-run --models fake-smart,fake-lazy --profile mbp` is the smoke test for the harness itself;
  it is safe on a busy machine and must always end with `fake-smart` recommended.

## Key decisions & reasoning

1. **Twelve hand-written cases, not generated ones.** The harness is only as good as its ground
   truth. Hand-written diffs let each case isolate one failure mode (missing test, lane violation,
   red test, off-by-one) and let the `why` field explain it. Twelve is enough to separate a good
   model from a lazy one and small enough that the whole run fits in a coffee break. It is _not_
   enough for a confidence interval — see limitations.

2. **The fake identifies the case by its diff.** The alternative — a `caseKey` field in the prompt
   or a header — would have been simpler, but then the dry run would prove a request the real run
   never sends. Using the diff keeps the dry run honest: same bytes in, same parsing, same scoring.

3. **`mustMention` counts toward correctness.** Pass/fail alone is a coin flip for a model that
   always says "looks good" on passes and "no test" on everything else. Requiring the _reason_
   separates a lucky verdict from an audit. Tokens are literal, short and lowercased, so the rule
   cannot punish a differently-worded but correct answer.

4. **Strict repeats.** A case is correct only if every repeat was correct. An auditor that is right
   50 % of the time on the same diff is not an auditor. (Latency is averaged, correctness is not.)

5. **Aborted models are scored against the full corpus.** Otherwise a model that OOMs on case 1
   would show 0/1 = 0 % and confuse "never ran" with "got everything wrong"; 0/12 is the honest
   reading, and the `abortReason` in the file carries the rest.

6. **HTTP `/api/ps` and `keep_alive: 0`, not the `ollama` CLI.** Testable against the fake server,
   no subprocess parsing, and no `ollama` command on a machine with 20 agents (L23, the hardest
   lesson of Epic 02).

7. **Rails: > 4 opencode processes, or free RAM < `--max-ram-gb`, refuses.** These are the two
   ways this tool can hurt the machine it runs on. `--force` exists because the demo machine is
   sometimes busy on purpose; the refusal text says how to override and both facts are recorded in
   the result file (`safety.forced`).

8. **`--max-ram-gb` is headroom required before loading**, not a cap on the model (that cap is
   `PROFILE_BUDGET_GB` at recommendation time). The brief's wording — "free memory is <
   `--max-ram-gb` headroom" — is what the flag does; the two numbers answer different questions and
   both are needed: _can I start?_ and _does it fit the profile?_

9. **Dry run writes nothing**, so a fake-smart `100 %` can never end up in `results/` and then in a
   config. The brief asked for `results/bench-…json` from a real run; `--dry-run` prints the table
   and the recommendation instead, and `--out` redirects _both_ outputs when a human wants them.

10. **`recommendModels` throws rather than inventing a pick.** A `recommendation.json` with an empty
    model name would silently fall back to whatever `starling.config.yaml` had, which is worse than
    a loud `NO_ELIGIBLE_MODEL` naming the budget that nothing fitted.

11. **Budgets are constants, not measurements of this machine.** They encode the product decision
    ("leave room for opencode sessions") so the same result file can be re-read on the other laptop
    without re-running. `--budget-mbp/--budget-air` override them for an experiment.

12. **`tools/` stays outside the workspace, with a local `ToolError`.** These scripts must run on a
    bare checkout with only Bun (Epic 02's rule); importing `@starling/core` would tie them to a
    workspace install and to a package that other agents were rewriting. The error still carries a
    machine `code`, which is the property that matters.

13. **One request module, shared with `smoke.ts`.** `audit-request.ts` is now the single source of
    the schema, the system prompt and the user-message layout. `smoke.ts` lost its private copy.

## Interfaces for future epics

Nothing in `packages/` may import from `tools/` (Epic 02's rule): these are the shapes to **copy**
into `@starling/auditor` (Epic 16) and the data a config step consumes.

```ts
// ── tools/local-models/audit-request.ts — the request @starling/auditor should adopt ──────────
export const VERDICT_SCHEMA: {
  type: 'object';
  properties: { pass: { type: 'boolean' }; summary: { type: 'string' }; fixInstructions: { type: 'string' } };
  required: ['pass', 'summary'];
  additionalProperties: false;
};
export const AUDIT_SYSTEM: string;

export interface AuditRequestInput {
  goal: string;
  definitionOfDone: string[];
  diff: string;
  testOutput?: string;                        // tail of the test run, verbatim
  lane?: { owns: string[]; reads: string[] };// when present, an edit outside `owns` fails
}
export function buildAuditUser(input: AuditRequestInput): string;
export function auditRequest(input: AuditRequestInput): {
  system: string;
  user: string;
  schema: typeof VERDICT_SCHEMA;
};
export type Verdict = { pass: boolean; summary: string; fixInstructions?: string };

// ── tools/local-models/cases.ts — the corpus, reusable by @starling/evals (no product dep) ───
export interface AuditCase extends AuditRequestInput {
  key: string; title: string; testOutput: string;
  expect: { pass: boolean; mustMention: string[] };
  why: string;
}
export function loadCases(dir: string): AuditCase[];
export function caseRequest(c: AuditCase): { system: string; user: string; schema: object };

// ── tools/local-models/bench-core.ts — the verdict scorer the auditor's eval will want ───────
export function judgeAnswer(text: string, expect: { pass: boolean; mustMention: string[] }): {
  correct: boolean; passMatches: boolean; jsonValid: boolean;
  missingMentions: string[]; verdict: Verdict | null; parseError?: string;
};
export const MAX_OPENCODE_PROCESSES: number;   // 4

// ── tools/local-models/recommend.ts — what a config step / `starling doctor` reads ───────────
export type Profile = 'mbp' | 'air';
export const PROFILE_BUDGET_GB: Record<Profile, number>;               // { mbp: 24, air: 9 }
export const SUMMARISER_MIN_ACCURACY: number;                          // 0.8
export type Recommendation = Record<Profile, { auditor: string; summarizer: string }>;
export function recommendModels(
  results: ModelBenchResult[],
  budgets?: Record<Profile, number>,
): Recommendation;
export function readBenchResults(dir: string): ModelBenchResult[];
export function writeRecommendation(path: string, rec: Recommendation): void;
```

`results/recommendation.json` is the only artifact a later epic needs to read:

```json
{
  "mbp": { "auditor": "qwen3.8:27b-mlx", "summarizer": "qwen3.5:9b" },
  "air": { "auditor": "qwen3.5:9b", "summarizer": "qwen3.5:9b" }
}
```

Usage snippet — wire the pick into a config, and reuse the scorer in an eval:

```ts
// A future config/init step (not this epic): tools are data producers, packages are consumers.
const rec = (await Bun.file('tools/local-models/results/recommendation.json').json()) as Recommendation;
const profile: Profile = ramGb >= 24 ? 'mbp' : 'air';
const models = {
  auditor: { provider: 'ollama', model: rec[profile].auditor },
  summarizer: { provider: 'ollama', model: rec[profile].summarizer },
};

// Epic 16's auditor test can copy judgeAnswer's rule instead of re-deriving it:
// correct = verdict.pass === expected.pass && every mustMention token appears in summary+fix.
```

## Deviations from plan

1. **No model was loaded, so no real `results/bench-*.json` or `results/recommendation.json` is
   committed.** DoD 3 is satisfied with `--dry-run`; the real run is the runbook. This is the one
   thing a human must do next, and doing it here would have wrecked the machine the other 22 agents
   are using.
2. **`--dry-run` writes nothing** (the plan implied the table _plus_ the result file). Rationale:
   keep fake data out of `results/`; `--out` writes both files when asked.
3. **`--max-ram-gb` is free-RAM headroom**, defaulting to 6 GB (mbp) / 4 GB (air). The brief named
   the flag but not its semantics; both readings are documented above.
4. **Extra flags** beyond the brief: `--force`, `--host`, `--out`, `--no-write`, `--think`,
   `--max-tokens`, `--budget-mbp`, `--budget-air`, `--fake-free-ram`, `--fake-opencode`, `--help`.
5. **`tools/local-models/tsconfig.json` was added.** Root `bun run typecheck` only loops over
   `packages/* apps/*`; this gives the tools a strict typecheck of their own
   (`bunx tsc --noEmit -p tools/local-models`), which is now part of the verification list.
6. **Epic 02's files in this lane were reformatted to the root Biome config** (double → single
   quotes). They were failing `bun run check` before this epic; the changes are formatting-only and
   leave `smoke.ts`'s behaviour intact apart from importing the shared request.
7. **`mustMention` is part of scoring**, not a separate "style" column. Explained in decisions #3.
8. **The corpus is JSON, not TS fixtures**, so a non-programmer can add a case. A validator and a
   corpus test replace the type system for these files.
9. **`recommend.ts` also has a CLI** (not just a library) so the runbook can re-derive a
   recommendation from existing files without re-benchmarking.

## Known limitations / deferred

- **The real benchmark has not run.** Every number in this document is about the harness, not about
  any model. `candidates.json`'s primary picks are still Epic 02's single measurements.
- **Twelve cases is a small sample.** One case is 8.3 % of the score, so a 92 % vs 100 % difference
  can be a single case. The corpus should grow (30-50 cases) before the final demo pick; the format
  and the tests make that cheap.
- **`mustMention` is substring matching**, not an LLM judge of the summary. It is deterministic and
  cheap, but a model that lists the words without understanding them passes. A human should read the
  misses of the winner once.
- **No scoring of `fixInstructions` quality.** The auditor's fixer prompt (Epic 14) would benefit
  from a second judge; deferred.
- **Memory is `size` + free RAM, not peak during generation.** `/api/ps` reports weights + KV after
  the call; a peak sampler (or `vm_stat` polling during the call) would be more precise and is
  deliberately deferred as over-engineering for a model-choice decision.
- **No "next to opencode sessions" mode.** The PRD's real demo condition is a model plus 8 worker
  sessions; this bench measures the model alone and uses the rails to keep the machine quiet. A
  future mode could spawn N idle sessions first (Epic 28 stretch, or a follow-up).
- **The bench is single-turn and sequential.** No concurrency, no queue depth, no batch of diffs in
  one context — the production auditor is one diff at a time, so this matches production, but it
  says nothing about throughput under load.
- **`recommendation.json` is a single file for both profiles**, overwritten by each run. Fine for
  two laptops and one decision; wrong if the repo ever benchmarks more than one machine per profile
  (it would need a host dimension).
- **Free RAM is macOS-only** (`memory_pressure`). On Linux/Windows it returns `null`, which turns the
  memory rail into a warning rather than a refusal. Acceptable: both target laptops are macOS.
- **No CI wiring.** Root CI is Epic 52; the local gate is `bun test tools/local-models`.
