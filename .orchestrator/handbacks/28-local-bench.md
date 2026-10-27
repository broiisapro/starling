## Epic 28 Handback — Local model benchmark harness (MBP + Air)

**Status:** Complete. The harness, the twelve-case corpus, the scoring/rails/recommendation logic and
the fake Ollama are built, tested and documented. **The real model run is deliberately not done here**
(ARCHITECTURE L23 — loading a 27 GB model while ~22 agents share this 32 GB box is the exact mistake
Epic 02 measured); the exact steps are the RUNBOOK in `docs/epic-28-local-bench.md`.
Branch `epic/28-local-bench` @ `5e8dbbb` (code), with `docs/epic-28-local-bench.md` and this handback
in the commit that follows.

**Delivered:**
- `tools/local-models/cases/*.json` — **12 audit cases**, six `expect.pass` / six `expect.pass: false`,
  each with title, goal, DoD, optional lane, unified diff, test-output tail, `expect.mustMention` and
  a `why`. Coverage: good CSV export with tests · CSV export without tests · trivially good docs fix ·
  lane violation · partial DoD · failing tests · off-by-one month (tests green) · large four-file
  refactor · a11y keyboard nav · memoised filter · theme persistence · deleted-export regression.
- `tools/local-models/audit-request.ts` — the single audit request shape (`VERDICT_SCHEMA`,
  `AUDIT_SYSTEM`, `buildAuditUser`, `auditRequest`). `smoke.ts` now imports it instead of keeping a
  private copy, so the benchmark scores exactly the request the smoke test proves.
- `tools/local-models/cases.ts` — `loadCases`, `parseCase` (full validation, `CASE_INVALID` with the
  file name), `caseRequest`, `findCaseForPrompt`.
- `tools/local-models/bench.ts` — `--models a,b --profile mbp|air [--cases dir] [--repeat 2]
  [--max-ram-gb N] [--dry-run] [--force] [--host url] [--out file] [--no-write] [--think on|off]
  [--max-tokens N] [--budget-mbp N] [--budget-air N] [--fake-free-ram N] [--fake-opencode N] [--help]`.
  Prints a markdown table + a per-model miss list; writes `results/bench-<host>-<date>.json`
  (kind, schemaVersion, host, ollama version, full request incl. `think`/`repeat`, safety rail record,
  case list, per-model results with every attempt and raw response).
- `tools/local-models/bench-run.ts` — the measurement loop: `/api/ps` before load, every case ×
  `--repeat`, resident sample once warm, free RAM before/after, `keep_alive: 0` unload before the
  next model, abort the model on its first OOM-ish answer or an unreachable daemon.
- `tools/local-models/bench-core.ts` — `judgeAnswer` (expected verdict + valid JSON + `mustMention`),
  `caseOutcomes` (strict across repeats), `summariseModel` (accuracy over the whole corpus, mean
  TTFT/latency/tok-s), `isMemoryFailure`, `isUnreachable`, `checkRails`, `MAX_OPENCODE_PROCESSES = 4`.
- `tools/local-models/probes.ts` + `ollama-admin.ts` — free RAM (`memory_pressure`), opencode process
  count (`ps`), resident models + unload over HTTP (`/api/ps`, `/api/generate`) instead of the
  `ollama` CLI, so nothing needs a daemon to be tested.
- `tools/local-models/fake-ollama.ts` — `Bun.serve({ port: 0 })` fake with `smart` / `lazy` /
  `garbage` / `oom` models; identifies each case from the diff in the prompt (no answer leakage);
  implements `/api/version`, `/api/ps`, `/api/generate`, `/api/chat`, `/v1/chat/completions`.
- `tools/local-models/recommend.ts` — `recommendModels`, `pickForProfile`, `PROFILE_BUDGET_GB`
  (`{ mbp: 24, air: 9 }`), `readBenchResults` (newest per model across `bench-*.json`),
  `writeRecommendation`; CLI writes `results/recommendation.json` as
  `{ mbp: { auditor, summarizer }, air: { auditor, summarizer } }`.
- `tools/local-models/{bench-core,bench,cases,fake-ollama,probes,recommend}.test.ts` — **69 new
  offline tests** (83 with Epic 02's 14), all against the in-process fake.
- `docs/epic-28-local-bench.md` — design, case table, the **RUNBOOK** (MBP and Air, with timings),
  interfaces, deviations, limitations.

**Key design decisions:**
- *Twelve hand-written cases, not generated* — each isolates one audit failure mode, and the `why`
  field keeps the ground truth auditable. Small-sample caveat documented.
- *The fake finds the case by its diff* — the dry run therefore sends the same bytes as a real run;
  a `caseKey` in the prompt would have proved a request that never ships.
- *`mustMention` is part of correctness* — pass/fail alone lets "looks good" score well; requiring
  the reason (one lowercase token, ≤2 per case) separates a lucky verdict from an audit.
- *Strict repeats, corpus-wide denominator* — a case is right only if every repeat was right, and an
  aborted model is scored 0/12 rather than 0/1. Both stop a flaky or OOM-ing model from looking good.
- *HTTP instead of the `ollama` CLI* — testable against the fake, no subprocess parsing, and no
  `ollama` command on a busy machine (L23).
- *Rails before any load* — >4 opencode processes or free RAM < `--max-ram-gb` refuses unless
  `--force`; the result file records `safety.forced`. `--max-ram-gb` is **headroom required to
  start**; the model-size cap is the profile budget at recommendation time.
- *Dry run writes nothing* — fake `100 %` scores can never leak into `results/` and then a config;
  `--out` writes both outputs when a human asks. One-line placeholder warning under the table.
- *Recommendation throws `NO_ELIGIBLE_MODEL` instead of inventing a pick*, and only a **measured**
  `residentGb` counts as fitting the budget.
- *`tools/` stays dependency-free* (Epic 02 rule) with a tools-local `ToolError` carrying a machine
  `code`, so no `@starling/core` import and no new npm dependency.
- *Budgets are product constants* (`24 GB` mbp / `9 GB` air) derived from Epic 02's measured
  21.2 GB wired / 27 % free at 18 GB, so a result file is portable to the other laptop.

**Verification (exact commands + results):**
- `bun install` (clean worktree): `Checked 133 installs across 192 packages (no changes)`.
- `bun test tools/local-models`: **83 pass / 0 fail**, 359 `expect()` calls, 7 files (14 from Epic 02,
  69 new). Summary: `Ran 83 tests across 7 files. [151.00ms]`.
- `bun run test` (root): **256 pass / 0 fail**, 1085 `expect()` calls — summary line:
  `Ran 256 tests across 43 files. [376.00ms]`.
- `bun run check`: **fails on 2 pre-existing files that are not mine** —
  `docs/epic-01-demo-target.md format` and `docs/epic-02-repo-ops.md format` (both were already in the
  9-error baseline before this epic; Biome 2.6 formats Markdown). Everything in
  `tools/local-models/**` and my own doc is clean: `bunx biome check tools/local-models` →
  `Checked 38 files … No fixes applied.` The `typecheck` half of the script passes on its own:
  `bun run typecheck` → exit 0 (all `packages/*` + `apps/*`).
- `bunx tsc --noEmit -p tools/local-models` → exit 0 (the new `tools/local-models/tsconfig.json`,
  since root typecheck only loops over `packages/* apps/*`).
- DoD 3, dry run (pasted, exit 0):
  ```
  🐦 local-model bench — 12 cases × 2 · profile mbp · DRY RUN against a fake Ollama (no model is loaded)
     ollama 0.0.0-fake at http://127.0.0.1:58916
     rails: 0 opencode process(es), 12 GB free (needs 6 GB)
     fake-smart: cold · free RAM 12 GB · 12 cases × 2
     fake-lazy: cold · free RAM 12 GB · 12 cases × 2

  | model | status | correct | json | TTFT | latency | tok/s | resident | free RAM |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | fake-smart | ok | 12/12 (100%) | 100% | 1 ms | 1 ms | 20274.74 | 7.5 GB | 12 → 12 GB |
  | fake-lazy | ok | 6/12 (50%) | 100% | 1 ms | 1 ms | 13637.65 | 3 GB | 12 → 12 GB |

     (dry run: latency, tok/s and RAM come from the fake — placeholders, not measurements)

  misses:
     fake-smart: no misses
     fake-lazy: missed 6/12
       · csv-export-no-tests: verdict pass=true, expected false; did not mention test
       · lane-violation: verdict pass=true, expected false; did not mention lane
       · partial-dod: verdict pass=true, expected false; did not mention empty
       · tests-failing: verdict pass=true, expected false; did not mention fail
       · … and 2 more

  | profile | role | model | accuracy | latency | resident |
  | --- | --- | --- | --- | --- | --- |
  | mbp | auditor | fake-smart | 100% | 1.08 ms | 7.5 GB |
  | mbp | summarizer | fake-smart | 100% | 1.08 ms | 7.5 GB |
  | air | auditor | fake-smart | 100% | 1.08 ms | 7.5 GB |
  | air | summarizer | fake-smart | 100% | 1.08 ms | 7.5 GB |

  {"mbp":{"auditor":"fake-smart","summarizer":"fake-smart"},"air":{"auditor":"fake-smart","summarizer":"fake-smart"}}

     dry run: nothing written. Re-run without --dry-run on a quiet machine.
  ```
- Rails (real probes, this machine): `bun tools/local-models/bench.ts --dry-run --models fake-smart
  --fake-free-ram 2 --fake-opencode 7` → exit 1 with
  `✘ RAIL_REFUSED: refusing to start — the machine is not quiet:` and both reasons; adding `--force`
  continues with `! --force: continuing anyway`.
- The **non-dry-run write path** was exercised once against a fake daemon started in a second process
  (`--host <fake> --force --out $TMP/bench-test-host-2026-10-27.json`). It printed the table, then
  `wrote …/bench-test-host-2026-10-27.json` and `wrote …/recommendation.json`, and the record held
  `request.think: true`, `repeat: 1`, `safety.blocking: ["23 opencode processes are running (limit 4)…"]`,
  `safety.forced: true`, and per model `accuracy 1 / 0.5`, `residentGb 7.5 / 3`, `unloaded: true`.
  This is also how the rails were confirmed against a live machine: 23 agents are running right now.
- `bun tools/local-models/recommend.ts --results <tmp with 3 hand-made result files>` produced
  `mbp: { auditor: qwen3.8:27b-mlx, summarizer: qwen3.5:9b }`, `air: { auditor: qwen3.5:9b,
  summarizer: qwen3.5:9b }` — the expected shape on realistic numbers.

**Dependencies added:** none (no package.json change; `tools/` is not a workspace).

**CONTRACT REQUESTS:** none. `results/recommendation.json` and `VERDICT_SCHEMA` are documented local
conventions, not core contracts; they are repeated in the doc so Epic 16 can adopt the schema by
copying it (packages must not import `tools/`).

**Deliberately deferred / out of scope:**
- The real benchmark run on either laptop (L23). The RUNBOOK is the deliverable that makes it a
  15-minute job when the machine is quiet; expected outputs, checks and wiring are spelled out.
- Auditor package code (Epic 16) — this epic only proposes the request shape and the verdict rule.
- Changing Ollama settings globally (`OLLAMA_NUM_PARALLEL`, `keep_alive` defaults): untouched.
- A "model next to 8 opencode sessions" mode (the real demo condition) and a peak-RAM sampler —
  noted as follow-ups in the doc.
- Growing the corpus beyond 12 cases; the format and validator make that cheap, and 12 is enough to
  separate good from lazy but not for a confidence interval (±8.3 % per case).
- CI wiring (Epic 52).

**Open questions / flagged tradeoffs:**
- **Profile budgets (24 GB / 9 GB) are a product call**, derived from Epic 02's single measurement
  and candidates.json's rules. If demo day runs fewer sessions, the MBP budget could go to 26-27 GB
  and admit `qwen3.6:35b-a3b`; if it runs 8 workers, 20 GB is safer. One constant to change.
- **`think: off` vs `on` for the production auditor.** Epic 02 measured 21.8 s → 5.8 s per verdict
  with the same verdict, which dominates the accuracy/latency trade the recommender makes. The
  runbook benches with `--think off`; somebody should confirm the verdicts stay identical on the
  winner before that becomes the config default.
- **`mustMention` favours literal models.** A model that says "the change is untested" passes; one
  that says "coverage is absent" also passes on `test`, but a purely synonymic answer might not. The
  corpus rule (one short token) is the mitigation; reading the winner's misses once is the check.
- **One `recommendation.json` for both profiles**, overwritten by the newest run. Fine for two
  laptops and one decision; a host dimension would be needed if several machines ever bench the same
  profile.

Closes #22
