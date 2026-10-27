# Epic 29 — Evals harness (planner + auditor)

## Goal

Give Starling a way to answer "is the planner good?" and "is the auditor making the right
calls?" against written answer keys instead of vibes. Wave 1 ships the measurement rig: cases,
scorers, reference answers, and a CLI that runs either a mock implementation (self-test of the
harness) or the real packages (Wave 2 / Epics 44 and 48). Nothing here tunes a model or calls one.

## How it works

### Planner evals (`evals/planner/`)

- `cases/*.json` — eight answer keys. Five convert every
  `examples/sky-todo/demo-goals/*.expected.md` (`launch-day`, `launch-day-xl`, `quick-wins`,
  `conflict-bait`, `will-fail-audit`). Three are new and run on two hand-written synthetic
  RepoMaps: a tiny Express notes API (`express-notes-auth-search`,
  `express-notes-pagination-rate-limit`) and a Python todo CLI (`python-cli-json-config`).
- Each case declares the goal text, a `taskCount` range, expected features as keyword groups, the
  real DAG edges, files some lane must cover, files no lane may touch, and the accepted sets of
  validator error codes.
- `score.ts` — `scorePlan(plan, case, repoMap)` returns a weighted 0..1 score plus six checks:

  | Check                | Weight | What it measures                                                         |
  | -------------------- | ------ | ------------------------------------------------------------------------ |
  | `validator`          | 0.20   | Zero error-level issues (or exactly the accepted set, for conflict-bait) |
  | `task-count`         | 0.10   | Task count inside the answer-key range                                   |
  | `feature-coverage`   | 0.25   | Every feature matched by at least one task                               |
  | `dependencies`       | 0.15   | Required edges present, no spurious edges between disjoint features      |
  | `lane-precision`     | 0.20   | Required files covered by some lane, forbidden files owned by none       |
  | `definition-of-done` | 0.10   | Every task has at least one test/verification step                       |

- `validate.ts` reimplements the planner validator on the eval side (cycle, missing dep, empty
  lane, empty DoD, duplicate key, concurrent lane overlap) using `globsOverlap` from
  `@starling/core`. Overlap is only an error for tasks with no dependency path between them,
  because the DAG serialises the rest.
- `reference.ts` holds a hand-written reference plan per case. They are separate from the case
  JSON on purpose: if a case and its reference drift, the mock run drops below 0.95 and the
  harness catches itself.

Feature matching is deliberately simple: a task matches a feature when its key, title, goal and
deliverables contain one keyword from every group (groups are AND, alternatives inside a group
are OR). Task-to-feature matching then drives coverage, required edges and spurious edges.

### Auditor evals (`evals/auditor/`)

- `cases/*.json` — twelve seeded diffs with expected verdicts. Four expect a pass; eight expect a
  fail. The set is about decision quality, not volume:
  - clean feature with meaningful colocated tests (pass)
  - missing tests the DoD requires (fail)
  - tests that only assert `true` (fail)
  - lockfile/manifest change outside a lane (fail)
  - docs-only task with no tests (pass — false-fail trap)
  - failing test in the new code (fail)
  - unrelated refactor outside the lane (fail)
  - empty diff (fail)
  - behaviour-preserving rename that updates existing tests (pass)
  - mounting through the shared renderer instead of a slot (fail)
  - CSV export without RFC 4180 quoting, tested only on the happy path (fail)
  - test-only regression task (pass)
- `score.ts` — `scoreAuditor(verdicts)` reports:
  - **accuracy**: pass/fail agreement with the answer key;
  - **false-pass rate**: expected fail, verdict said pass (the dangerous direction);
  - **false-fail rate**: expected pass, verdict said fail (wasted retries);
  - **fix quality**: share of required keyword groups present in `fixInstructions`, averaged over
    fail cases; a wrong pass scores 0;
  - **lane detection**: every expected lane violation reported, and none invented on pass cases.
- `input.ts` builds the real `AuditInput` port shape (goal, plan, repo map, task, diff) so the same
  cases drive the mock and, later, the real auditor. `reference.ts` turns the answer key into a
  `MockAuditor` verdict via `decorate`.

### CLI (`evals/run.ts`)

```bash
bun evals/run.ts planner --impl mock
bun evals/run.ts auditor --impl mock
bun evals/run.ts planner --impl real --case sky-todo-launch-day
```

- `--impl mock` scripts `MockPlanner`/`MockAuditor` with the reference answers. It validates the
  harness; a score below 1.0 means a case, reference or scorer is wrong.
- `--impl real` dynamically imports `@starling/planner` / `@starling/auditor`, looking for
  `createPlanner`/`planner`/`default` and `createAuditor`/`auditor`/`default` exporting the core
  ports. Today both packages are Wave 1 placeholders, so it exits 2 with a Wave 2 message.
- Output is a fixed-width table plus `evals/results/<suite>-<date>.json` (or `--out`). The report
  carries every check, every per-case verdict, and the summary.
- Exit codes: `0` pass, `1` below threshold (planner case < 0.85; auditor accuracy < 0.9 or
  false-pass > 0.15), `2` real implementation not available, `64` bad arguments.

## Key decisions & reasoning

- **Answer keys are JSON, reference plans are TypeScript.** Cases need to be data for future
  tooling and diffability; references are built with core factories so a typo fails scoring rather
  than a JSON schema. Keeping them in separate files makes the mock run a real self-check.
- **The validator is reimplemented locally, not imported from `@starling/planner`.** The planner is
  the system under test and is a parallel Wave 1 sibling. Reimplementing it also pins the `warn`
  vs `error` contract for evals: only error-level issues fail the check.
- **Concurrent-overlap semantics.** A shared lane is legal when a dependency path orders the two
  tasks; only unordered pairs count as `lane-overlap`. This matches the scheduler: the DAG already
  serialises dependent work.
- **`conflict-bait` accepts two answers.** The expected file itself says the honest repair is one
  merged task, while the demo wants two overlapping tasks. The case allows a 1–2 task count and
  either no validator errors or exactly `lane-overlap`; anything else fails.
- **Feature matching on key/title/goal/deliverables rather than file paths.** Real planners name
  tasks differently. Keyword groups keep the check about meaning ("what changed") while lane
  coverage handles "where". The cost is occasional cross-matching, which is fine for coverage and
  handled explicitly for edges.
- **Auditor scoring weights the dangerous direction.** Accuracy alone hides a model that passes
  everything; false-pass rate is reported separately and is part of the CLI gate. Lane detection
  is separate from pass/fail so a right verdict with a hallucinated violation is visible.
- **Pass cases include docs-only, rename and test-only tasks.** These are the ones a naive
  "tests added?" auditor false-fails. Encoding them now makes the trap part of the regression
  suite before the real auditor exists.
- **`evals/` stays outside the Bun workspace.** Root `workspaces` is locked and orchestrator-owned.
  Two tiny re-export files point at `packages/core`'s public entry points, and `lib/zod.ts` points
  at the locked zod copy in Bun's install store, so a clean clone needs no extra install step and
  no second zod version. No dependency was added.
- **Mock runs are not evidence about the planner.** They prove the scorer agrees with the answer
  key. The doc and the CLI message both say Wave 2 is where real quality is measured.

## Interfaces for future epics

Everything below is exported from the files named. The harness has no package boundary yet, so
import by relative path from `evals/**`.

```ts
// evals/planner/case.ts
export const FeatureSpecSchema: ZodType<FeatureSpec>;
export const PlannerCaseSchema: ZodType<PlannerCase>;
export type PlannerCase = {
  name: string; goal: string; repomap: string;
  taskCount: { min: number; max: number };
  features: FeatureSpec[];
  requiredDeps: [string, string][];
  requiredLaneFiles: string[]; forbiddenFiles: string[];
  validator: { anyOf: string[][] };
  notes?: string;
};

// evals/planner/cases.ts
export function loadPlannerCases(dir?: string): PlannerCase[];
export function loadRepoMap(relativePath: string): RepoMap;
export function findPlannerCase(cases: PlannerCase[], name: string): PlannerCase;
export function assertCaseConsistent(c: PlannerCase, source?: string): void;

// evals/planner/validate.ts
export function validatePlan(plan: Plan): PlanIssue[];
// codes: cycle | missing-dep | empty-lane | empty-dod | lane-overlap | other

// evals/planner/score.ts
export const PLANNER_CHECK_WEIGHTS: {
  validator: 0.2; 'task-count': 0.1; 'feature-coverage': 0.25;
  dependencies: 0.15; 'lane-precision': 0.2; 'definition-of-done': 0.1;
};
export function scorePlan(plan: Plan, testCase: PlannerCase, repoMap: RepoMap): PlanScore;
export function matchFeatures(plan: Plan, testCase: PlannerCase): FeatureCoverage[];
// PlanScore = { caseName; score: 0..1; checks: PlanCheck[]; coverage: FeatureCoverage[] }
// PlanCheck = { name; ok; score: 0..1; weight; detail }

// evals/planner/reference.ts
export function referencePlan(caseName: string, goal: Goal): Plan;
export function referenceCaseNames(): string[];

// evals/auditor/case.ts
export const AuditorCaseSchema: ZodType<AuditorCase>;

// evals/auditor/cases.ts
export function loadAuditorCases(dir?: string): AuditorCase[];
export function findAuditorCase(cases: AuditorCase[], name: string): AuditorCase;
export function assertAuditorCaseConsistent(c: AuditorCase, source?: string): void;

// evals/auditor/score.ts
export function scoreAuditor(
  verdicts: Array<{ testCase: AuditorCase; verdict: AuditVerdict }>,
): AuditorScore;
// AuditorScore = { caseCount; accuracy; falsePassRate; falseFailRate;
//                  fixQuality; laneDetection; results: AuditCaseResult[] }

// evals/auditor/input.ts
export function makeAuditInputFor(testCase: AuditorCase): AuditInput;

// evals/auditor/reference.ts
export function referenceVerdict(testCase: AuditorCase): AuditVerdict;

// evals/run.ts
export type Suite = 'planner' | 'auditor';
export type Impl = 'mock' | 'real';
export function parseArgs(argv: string[]): CliOptions;
export function run(options: CliOptions): Promise<{ lines: string; report: EvalReport; passed: boolean }>;
export function writeReport(report: EvalReport, out?: string): string;
export function main(argv: string[]): Promise<number>;

// evals/real.ts — Wave 2 adapter contract
export function loadRealPlanner(): Promise<Planner>;
export function loadRealAuditor(): Promise<Auditor>;
export function isPlanner(value: unknown): value is Planner;
export function isAuditor(value: unknown): value is Auditor;
```

A Wave 2 quality pass (Epic 48 for the planner, Epic 44 for the auditor) is:

```ts
import { makeGoal } from '@starling/core/testing';
import { findPlannerCase, loadPlannerCases, loadRepoMap } from '../evals/planner/cases';
import { scorePlan } from '../evals/planner/score';

const cases = loadPlannerCases();
const testCase = findPlannerCase(cases, 'sky-todo-launch-day');
const repoMap = loadRepoMap(testCase.repomap);
const goal = makeGoal({ text: testCase.goal, repoPath: repoMap.root });
const { plan } = await planner.plan(goal, repoMap);
const score = scorePlan(plan, testCase, repoMap);
if (score.score < 0.95) console.log(score.checks.filter((c) => !c.ok));
```

For the real auditor, build the input with `makeAuditInputFor` and score the verdict with
`scoreAuditor([{ testCase, verdict }])`. The only coupling to the real packages is `evals/real.ts`.

## Deviations from plan

- **Two module-resolution shims.** `evals/lib/core.ts`, `evals/lib/core-testing.ts` and
  `evals/lib/zod.ts` re-export core's public entry points and the locked zod copy by path, because
  `evals/` is not a workspace and bare `@starling/core` / `zod` specifiers do not resolve from it.
  No dependency was added.
- **`repoMap` is used lightly in scoring.** It marks which required lane files already exist (new
  vs existing) in the lane-check detail; it is not used to reject plans that create files. The
  parameter stays in the signature because the real planner receives the map and future checks
  (e.g. "lane claims a file that does not exist and is not new") will need it.
- **`--impl` defaults to `mock`.** The assignment shows it as mandatory; defaulting keeps a stray
  `bun evals/run.ts planner` from reaching for a model.
- **Three synthetic cases, not three fixtures.** Two live on the Express map, one on the Python
  map, as allowed by "3 more cases on two ... fixtures".
- **Auditor patches are illustrative, not applied.** They are seeded unified diffs with consistent
  file lists; scoring never runs `git apply`. The audit signal under test is the verdict, not the
  patch application.
- **Root typecheck does not cover `evals/`.** Root `typecheck` loops `packages/*` and `apps/*`, and
  root config is locked. `evals/tsconfig.json` exists so `bunx tsc --noEmit -p evals` checks it;
  that command is part of the handback verification.

## Known limitations / deferred

- **Keyword matching is lexical.** A planner that says "theme switcher" instead of "toggle" may
  miss a feature. That is a deliberate trade for a scorer with no model in the loop; Epic 48 can
  add embedding-based matching behind the same `FeatureCoverage` shape.
- **Task-to-feature mapping can be many-to-many.** Edges are credited if any pair of matched
  features is required. A merged task that carries two features is accepted, but an edge between
  two multi-feature tasks is harder to attribute.
- **Only direct dependency edges count.** Transitive-only edges fail a required edge. The answer
  keys are written against the expected plan, which uses direct edges.
- **Lane precision checks a sample of files, not the whole repo.** Cases name the files that must
  and must not be owned; a plan that also owns some unrelated path is not penalised unless that
  path is in `forbiddenFiles`.
- **Fix quality is substring matching.** It rewards naming the right concepts, not phrasing; a
  detailed instruction that uses synonyms outside the group scores zero for that group.
- **Auditor cases are hand-written scenarios.** They test decision _policy_, not the real
  test-command executor. Real audit accuracy (including actual `bun test` runs and local-model
  judgement) is Wave 2 / Epic 44.
- **`--impl real` is untested against a real package.** It is an adapter with a clear failure
  message; the factory names are a proposal until Epic 48 lands.
- **No per-case console output detail.** Failed checks are visible in the table and the JSON;
  a future `--verbose` could print each detail line.
