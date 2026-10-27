# Epic 33 (Checkpoint C1-a) — Core consolidation, contract requests, root health

## Goal

Wave 1 shipped 23 epics in parallel against mocks. Each one had to work around the frozen core at
least once: error codes smuggled through `details.reason`, an audit duration glued onto human text, a
`BundleOps` type duplicated in two packages, and the ARCHITECTURE §8 handshake copied verbatim into
thirteen `handshake.ts` files. The integration dry run also surfaced two root-level problems: an
unreadable test summary and a cross-file `fetch` pollution that only happened when the web tests and
the `Bun.serve`-based tests shared a process.

This checkpoint closes all of that:

- the root test script runs `apps/web` in its own process and prints one label per half;
- Biome no longer formats Markdown at all, and the CSS parser accepts Tailwind directives;
- fourteen contract requests become additive changes in `@starling/core`, and the workarounds that
  existed only to survive their absence are gone;
- §8 lives **only** in `packages/core/src/handshake.ts`, with every mirror a one-line re-export;
- `@starling/core/browser` gives the web a browser-safe entry, guarded by a bundle test;
- the cost meter prices DeepSeek V4.1 Flash at its published rates instead of a placeholder.

The bar for every change was **additive and backward compatible**: an existing caller must keep
compiling and passing with no edits, unless the assignment said to update it.

## How it works

### Root health

`package.json` now runs two test halves:

```
bun run test:packages   # bun test packages apps/server apps/cli skills integrations tools evals
bun run test:web        # cd apps/web && bun test
```

Each half prints a one-line banner, so the two summaries stay readable. The isolation is not
cosmetic: `apps/web`'s happy-dom `GlobalRegistrator` replaces the global `fetch`, and happy-dom's
`fetch` rejects Bun's own responses with "Duplicate Content-Length". Every `Bun.serve` fake that then
ran in the same process (10 in `apps/server`, 7 in `packages/llm`) failed. Two defences now exist:

1. the process split, so the pollution cannot happen; and
2. `packages/llm`'s opencode client tests pass `Bun.fetch` explicitly (`NATIVE_FETCH` in
   `providers/opencode.test.ts`), so they survive a polluted global anywhere they run.

Biome changes: `markdown.formatter.enabled = false` at the root (docs are prose written by many
agents and must never fail CI on whitespace) and `css.parser.tailwindDirectives = true` (so `@theme`
and `@utility` parse). The nested `skills/biome.json` and `integrations/biome.json` existed **only**
to disable Markdown formatting — checked before deleting; nothing else was in them.

### Contract rulings implemented in core

| # | Change | Where |
|---|--------|-------|
| 1 | `StarlingErrorCode` += `LLM_BAD_JSON`, `GIT_TOO_OLD`, `GH_AUTH`, `GH_REPO`, `GH_COMMAND`, `GH_MISSING`, `NOT_WIRED`, `NODE_AUTH` | `errors.ts` |
| 2 | `AuditCheck.durationMs?: number` (int ≥ 0) | `contracts.ts` |
| 3 | `AuditVerdict.dod?: { item, met, evidence? }[]` | `contracts.ts` |
| 4 | `NodeRegistryEvent { type, node, reason? }`, used by `NodeRegistry.onChange` | `ports.ts` |
| 5 | `LLMCallOptions { signal?, timeoutMs? }` as an optional second argument to `LLM.complete` / `completeJson` | `ports.ts` |
| 6 | `MergePreflight { clean, conflictedFiles, alreadyMerged, detail }` + `Merger.preflight?()` | `ports.ts` |
| 7 | `BundleOps`, `MdnsAdvertiseOptions`, `MdnsAdvertiser`, `DiscoveredPerch`, `MdnsBrowser` | `ports.ts` |

The workarounds removed alongside them:

- **`packages/llm`** — `badJsonError` throws `LLM_BAD_JSON`. `isBadJsonError` remains as a thin helper
  and still recognises the pre-C1 `LLM_ERROR` + `details.reason` shape, so a recorded run stays
  interpretable. `CallOptions` is now an alias of core's `LLMCallOptions`, so `LLMClient extends LLM`
  with no duplicated shape.
- **`packages/workspace`** — `GIT_TOO_OLD_CODE` is
  `'GIT_TOO_OLD' as const satisfies StarlingErrorCode`; the double cast is gone. `BundleOps` is
  `export type BundleOps = CoreBundleOps`.
- **`packages/github`** — `GitHubError` passes its `GH_*` code straight to `StarlingError`, so
  `err.code`, `isStarlingError(err, 'GH_AUTH')` and `err.githubCode` all agree; `githubCode` stays as
  the promised alias (and still rides in `details` for old logs).
- **`apps/cli`** — `compose()` throws `NOT_WIRED` directly. The error-hint table is now keyed by
  `StarlingErrorCode` and explains `GIT_TOO_OLD`, `GH_AUTH`, `GH_MISSING` and `NODE_AUTH` too.
- **`packages/flock`** — a 401/403 from a perch is `NODE_AUTH` (and the SSE reconnect loop stops on
  it), `FlockRegistryEvent` is an alias of core's `NodeRegistryEvent`, and `cloneFromBundle` returns
  `{ path, branch }` like the workspace implementation.

### The §8 handshake

`packages/core/src/handshake.ts` now holds every §8 interface: `StartRunInput`, `EngineApi`,
`JoinInfo`, `FlockHub`, `BundleUrlFor`, the six web `*Props`, `WorkerHandback` — plus the two
amendments, `FlockPanelProps.onSelectTask?` (Epic 32) and `MetricsPanelProps.live?` (Epic 26). It is
**types only**: importing the module yields zero runtime exports (a test asserts that), which is what
makes it safe inside the browser entry.

Every mirror (`packages/{engine,flock,perch,prompts,github}`, `apps/{server,cli}`, `apps/web/src/data`
and `apps/web/src/features/*`) is now a re-export, not a copy:

```ts
export type { EngineApi, JoinInfo, StartRunInput } from '@starling/core';
```

`packages/prompts` keeps the runtime half (the zod schema and the `<<<STARLING_HANDBACK` markers) and
declares the schema against the core type, so the two cannot drift. `packages/github` keeps its
parser next to the re-exported type. Nothing was deleted, so no consumer changed.

`packages/flock/src/hub.ts` still declares `interface FlockHub extends HandshakeFlockHub` — that is
the hub-side **extension** (adds `code` and `discover()`), not a second definition of the contract.

### `@starling/core/browser`

`packages/core/src/browser.ts` re-exports contracts (schemas + types), the handshake, errors, glob,
metrics/pricing and ids. Its `exports` map gains `"./browser": "./src/browser.ts"`, and a test proves
the subpath resolves from outside the package. The test also bundles the entry with
`Bun.build({ target: 'browser', metafile: true })` and fails if:

- any import in the graph is left **external** (that is where `node:fs` hides — Bun stubs Node
  built-ins under `target: 'browser'` instead of failing, so scanning the emitted text alone is not
  enough);
- any non-`node_modules` input is something other than the seven allowed pure modules;
- the emitted text contains `node:`, `Bun.` or `process.env`.

Nothing imports it yet — Epic 34 and Wave 2 switch the web over.

### Pricing

`PRICING` now uses DeepSeek's published peak rates for `deepseek-flash` (= DeepSeek-V4.1-Flash-1017),
read from <https://api-docs.deepseek.com/quick_start/pricing> on 2026-10-27:

| per 1M tokens | off-peak | peak |
|---|---|---|
| input, cache miss | $0.15 | **$0.30** |
| input, cache hit | $0.003 | **$0.006** |
| output | $0.60 | **$1.20** |

Peak is billed because this table feeds the `budget.maxUsd` guardrail, and a guardrail must not
under-count. The recording `fixtures/runs/sky-todo-launch-day.jsonl` was re-priced from its token
counts so it stays internally consistent (API $0.042, saved $0.019); only money fields changed.

## Key decisions & reasoning

- **Two defences against the fetch pollution, not one.** The process split is the real fix; the
  explicit `Bun.fetch` in the LLM tests is cheap insurance for anyone who runs `bun test` by hand in
  one process. Considered `happy-dom`-aware skipping instead — rejected, because a test that only
  passes in one process order is a trap.
- **Markdown formatting off globally rather than per directory.** The nested configs were a
  workaround for a root default; keeping them would mean every future `docs/` folder needs one too.
- **`NODE_AUTH` is a new code, not a reuse of `INVALID_ARGUMENT`.** The engine's retry policy branches
  on codes: a bad join code must stop, a dead perch must reschedule. A shared code forces callers to
  string-match messages.
- **`AuditCheck.durationMs` instead of parsing detail.** `detail` is human text and a model may rewrite
  it; a number in its own field is the only version the UI can chart. `packages/auditor` stopped
  appending ` (12 ms)`, and the web drawer already read `durationMs` opportunistically, so it now
  shows real numbers with no web change.
- **`dod` drops empty evidence rather than storing `""`.** The auditor's zod schema is deliberately
  permissive (a small local model returning `evidence: ""` should not fail the audit); the contract
  makes the field optional so the UI can distinguish "no evidence" from "empty evidence".
- **The pre-C1 bad-JSON shape is still recognised.** Replays and stored verdicts from Wave 1 carry
  `LLM_ERROR` + `details.reason`; `isBadJsonError` accepts both so old recordings keep working.
- **`BundleOps.cloneFromBundle` returns `{ path, branch }` (Epic 14's signature).** Flock's version
  returned `void`; nothing consumed it, so returning the real checkout result is a free improvement
  and makes the two implementations interchangeable at the port.
- **mDNS: the perch's shape wins.** `MdnsAdvertiseOptions.type?` (Epic 31) subsumes flock's
  `{ name, port, txt }`; both advertisers implement the same interface, and `DiscoveredPerch` moved
  into core because `MdnsBrowser.browse` needs it in its signature.
- **The `handshake.ts` files are re-exports, not deletions.** Half the repo imports
  `from './handshake'`; re-exporting keeps this checkpoint a pure refactor for every other lane.
  Deleting them is a Wave 2 cleanup once imports point at core.
- **The launch-day fixture was re-priced.** It is a golden fixture whose money fields are derived by
  the engine's table; a price change makes it stale by definition. Regenerating it (and the three web
  assertions that pin the display strings) is the standard golden-file move; rewriting the JSON by
  hand would have left `apiCostUsd` and the sum of task `costUsd` disagreeing.
- **One flaky web test fixed deterministically.** `MetricsPanel`'s "elapsed clock ticks" test used a
  sample stamped with `Date.now()` at render time, so it passed only when the mount happened to cross
  a millisecond. Running web in its own (faster) process exposed it. The sample is now 50 ms old,
  which is what the test always meant.

## Interfaces for future epics

```ts
import type {
  // error codes
  StarlingErrorCode,            // + LLM_BAD_JSON, GIT_TOO_OLD, GH_*, NOT_WIRED, NODE_AUTH
  // audit detail
  AuditCheck,                   // .durationMs?: number
  AuditVerdict,                 // .dod?: AuditDodItem[]
  AuditDodItem,
  // ports
  LLMCallOptions,               // LLM.complete(req, { signal, timeoutMs })
  MergePreflight,               // Merger.preflight?(repo, integration, branch)
  NodeRegistryEvent,            // onChange: { type, node, reason? }
  BundleOps,                    // createBundle / cloneFromBundle / fetchBundle
  MdnsAdvertiseOptions, MdnsAdvertiser, MdnsBrowser, DiscoveredPerch,
  // §8
  StartRunInput, EngineApi, JoinInfo, FlockHub, BundleUrlFor,
  SkyViewProps, DagViewProps, AgentDrawerProps, MergeQueueProps, MetricsPanelProps, FlockPanelProps,
  WorkerHandback,
} from '@starling/core';

import { PRICING, usageCostUsd, estimateSavedUsd } from '@starling/core/browser';
```

- **Epic 34 / Wave 2 web work**: import from `@starling/core/browser`; the handshake `*Props` are now
  the ones in core, so `FlockPanel` should accept `onSelectTask` and `MetricsPanel` should accept
  `live` rather than redeclaring the props.
- **Wave 2 engine**: `Merger.preflight` is the supported way to skip a merge (`alreadyMerged`) or
  spawn a resolver (`conflictedFiles`); probe it with `if (merger.preflight)`.
- **Wave 2 flock/perch**: implement `MdnsAdvertiser`/`MdnsBrowser`/`BundleOps` from core; do not add
  package-local copies.
- **Orchestrator**: the rules below are ready to be appended to ARCHITECTURE §7 as L26+.

## Deviations from plan

- **`packages/github/src/handshake.ts` was updated too**, although the prompt's list of mirrors omitted
  it. It declared its own `WorkerHandback`, which would have left §8 with two definitions. The parser
  and its behaviour are untouched; only the type now comes from core.
- **`fixtures/runs/sky-todo-launch-day.jsonl` and three `apps/web` assertions were edited.** Both follow
  necessarily from the pricing ruling (see *Key decisions*). Two files are in Epic 26's feature folder;
  Epic 34 does not touch `features/metrics/*.test.tsx`, so the conflict risk is negligible.
- **`packages/core/src/testing/mock-registry.ts` was updated** to emit `NodeRegistryEvent` (with
  `reason`) — a `@starling/core/testing` mock, so it belongs to this lane.
- **`apps/cli`'s error-hint table gained four hints** (`GIT_TOO_OLD`, `GH_AUTH`, `GH_MISSING`,
  `NODE_AUTH`). Strictly beyond the ruling; it costs four lines and makes `starling doctor` useful now
  that the codes exist.
- **No `tools/local-models` formatting fix was needed** — it is already Biome-clean on this branch; the
  command was still run to confirm.

## Known limitations / deferred

- **The handshake files still exist as re-exports.** Thirteen files that only say "moved to core" are
  noise; deleting them (and rewriting imports) is a Wave 2 job once no lane is holding a branch.
- **The two opencode V2 clients are still separate** (`packages/llm` and `packages/runner`); Epic 40
  unifies them. Nothing here touches that.
- **`@starling/core/browser` is unused by the web app so far.** Switching `apps/web` imports is Epic
  34's call; the entry and its guard test are ready.
- **`PRICING` bills peak.** Off-peak runs will look ~2× more expensive than the invoice. That is
  deliberate for the guardrail; a future "report at off-peak" toggle belongs with the cost meter work.
- **`skills/` and `integrations/` are still outside the workspace** (no `package.json`), so they are
  linted and tested but not typechecked as their own projects. Unchanged by this checkpoint.
- **`evals/` remains a non-workspace directory.** Making it a workspace is explicitly out of scope.

## Rules implemented (for ARCHITECTURE §7, L26+)

- **L26** `StarlingErrorCode` includes `LLM_BAD_JSON`, `GIT_TOO_OLD`, `GH_AUTH`, `GH_REPO`,
  `GH_COMMAND`, `GH_MISSING`, `NOT_WIRED` and `NODE_AUTH`. Packages must throw these directly; a
  domain code hidden in `details` is not acceptable.
- **L27** `AuditCheck.durationMs` carries a check's duration; `detail` is human text and never a data
  channel. `AuditVerdict.dod` carries per-item DoD judgments when a reviewer was consulted.
- **L28** `LLM.complete`/`completeJson` accept `opts?: LLMCallOptions` (`signal`, `timeoutMs`). Every
  `LLM` implementation must accept and may ignore them.
- **L29** `Merger.preflight?(repo, integrationBranch, branch): Promise<MergePreflight>` is the only
  conflict-prediction contract; engine code probes for its presence.
- **L30** `NodeRegistry.onChange` events are `NodeRegistryEvent` and carry an optional `reason`
  (`'heartbeat-timeout'`, `'left the flock'`, …).
- **L31** `BundleOps` and `MdnsAdvertiser`/`MdnsBrowser`/`MdnsAdvertiseOptions`/`DiscoveredPerch` are
  core ports; packages alias them, never redefine them.
- **L32** ARCHITECTURE §8 lives only in `packages/core/src/handshake.ts`. Package-local
  `handshake.ts` files are re-exports. `FlockPanelProps.onSelectTask?` and `MetricsPanelProps.live?`
  are part of §8.
- **L33** Browser code imports `@starling/core/browser`, which is guaranteed free of `node:*`, `Bun`,
  `exec`, config and the event bus; a bundle test enforces it.
- **L34** The root `test` script runs `apps/web` in its own `bun test` process because happy-dom owns
  the global `fetch`. Biome does not format Markdown, and the CSS parser accepts Tailwind directives.
