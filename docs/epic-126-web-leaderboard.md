# Epic 126 — Web: flock leaderboard

## Goal

A playful, honest scoreboard for the audience: who is the fastest bird, the hungriest, the cleanest,
the most stubborn, and which laptop is the busiest perch. Six small cards with generated bird avatars,
a crown for the leader, and ranks that visibly slide when they change during a live run.

The panel is a self-contained Wave 3 feature module: props-only, no store access, no fetching, no new
dependencies. C3 registers the manifest; the shell owns the `⇧L` binding.

## How it works

Everything derives from `SkyState` in one pure function, `buildBoards(state)` (`derive.ts`):

| Board id | Title | Source | Unit | Direction |
|---|---|---|---|---|
| `fastest` | Fastest bird | min `finishedAt − startedAt` over **merged** `TaskRun`s with both timings | seconds | ascending |
| `hungriest` | Hungriest bird | max `usage.input + usage.output` (`cached` is a subset of `input`, so it is never added) | tokens | descending |
| `cleanest` | Cleanest audit | a verdict on attempt 1 that passed with **every** `checks[].ok` | seconds | ascending |
| `stubborn` | Most stubborn | `TaskRun.attempts`, then failed verdict count | fixes | descending |
| `perch` | Busiest perch | tasks per `TaskRun.nodeId`, names from `state.nodes` | tasks | descending |
| `thriftiest` | Thriftiest perch | total `costUsd` of a node's merged tasks ÷ merged task count | usd | ascending |

Each board keeps its top five; ties break on the hidden secondary key (`stubborn` only) and then on the
entry key, so the same state always produces the same order — which is what makes the FLIP animation
deterministic. Boards with no qualifying entry are dropped instead of rendered empty. Only the active
run contributes.

Fixture truths pinned by tests (the recorded launch-day run):

- **Fastest bird** `dates-fix` at `33.4s`.
- **Busiest perch** `MacBook Pro` (`hub`) with five tasks; the Air has two.
- **Most stubborn** `theme`, one fix (it also has the only failed verdict; `search` ties on fixes but
  has none).
- **Hungriest** `theme`, `29.4k` tokens.
- **Cleanest audit** `dates-fix`, `30.4s` (verdict ts − task start, because the fixture's checks carry
  no `durationMs`).
- **Thriftiest perch** `MacBook Air` at ≈ `$0.0053` per landing.

Audit duration uses `Σ checks[].durationMs` **only when every check reported one**; a partial sum would
flatter the bird that reported least, so it falls back to `verdict.ts − task.startedAt`. No timing at
all means no entry, never a zero.

Migrations: a migrated task's arrival is already reflected in `TaskRun.nodeId`, so counting
`task.migrated` again would double-book it. The events are consulted only for a task the run snapshot
does not list (hydration lag or a capped event window), which is the one case the snapshot cannot answer.

`BirdAvatar` is a 24×24 SVG generated from a string hash (FNV-1a + mulberry32): hue band from the
starling-iridescent palette, pattern (speckle/streak/spangle/dapple), eye shape, head tilt and 4–7
clipped feathers. The same task (or node) key draws the same bird in every board; no images, no network,
no randomness in render. It is `aria-hidden` because the row's label is the accessible text.

Ranking motion is two pieces: `rankChanges(prev, next)` (pure, `Map<rankKey, delta>`) and a FLIP measure
in `Leaderboard.tsx` — save each row's `top`, measure again after the reorder, then animate from
`translateY(old − new)` to zero with `--ease-flock` (read from CSS, with the token's value as fallback).
A ▲/▼ badge stays for 2 s. Reduced motion disables the slide; the badge remains, because it carries
information rather than decoration.

## Key decisions & reasoning

- **Snapshots primary, events for gaps.** `state.events` is capped at 5,000 and is dropped on run
  switches, so boards read `Run`/`TaskRun` and use `task.migrated` only where the snapshot cannot know.
- **Only the active run.** Mixing runs would let a retired 30 s landing beat today's live one.
- **Hidden empty boards.** Six cards with four "no data yet" placeholders looks broken on a projector;
  the strip grows as the run does, and the empty state covers the zero-board case.
- **Honest numbers over flattering ones.** Non-empty `checks` required for "clean", all-or-nothing
  duration sums, missing timings skipped, cached tokens never double-counted.
- **Thriftiest is per node.** "Lowest `costUsd` per merged task" reads as a ratio; averaging a node's
  merged landings keeps it comparable and pairs with the busiest-perch board. A per-task reading is one
  comparator away if product prefers it (see *Open questions*).
- **Badge survives reduced motion.** The brief says the badge is "off" with reduced motion; the panel
  keeps the glyph and drops the animation. Hiding a rank change from someone who asked for less motion
  removes information, not motion.
- **No panel chrome.** Like the flock panel, the feature renders a slim summary line and cards; the
  shell's `Panel` provides the title. The board strip scrolls horizontally inside itself so the page
  never scrolls at 1280.
- **No keydown listener.** The shell binds `L` (Shift+L; `l` is the lanes map), so the component only
  handles focus inside its own rows (native buttons).
- **Avatars seeded by key, not row position.** Identity stays stable across boards and reorders, which
  also keeps React keys and FLIP rows honest.

## Interfaces for future epics

`apps/web/src/features/leaderboard/index.ts`:

```ts
export const FEATURE = 'leaderboard' as const;
export const feature = {
  id: 'leaderboard', title: 'Flock leaderboard', kind: 'panel',
  icon: 'Trophy', hotkey: 'L', Component, description,
} as const;

export function buildBoards(state: SkyState): Board[];            // derive.ts
export function birdAvatar(seed: string): AvatarSpec;             // avatar.ts
export function rankChanges(prev: Board[], next: Board[]): Map<string, number>; // rank-diff.ts
export function rankChangeList(prev, next): RankChange[];
export function flockEasing(element?): string;
export function auditDurationMs(verdict, task): number | undefined;
export function formatBoardSeconds(ms): string;
```

`Board = { id, title, blurb, unit, entries }`, `BoardEntry = { key, label, value, display, nodeId? }`.
`key` is a task key for bird entries and a node id for perch entries; `nodeId` marks the latter, which
is also how the component decides whether a row is clickable.

Props: `LeaderboardAllProps = FeatureProps & { reducedMotion?: boolean; badgeMs?: number }`. The extras
are optional so `ComponentType<FeatureProps>` stays honest. Any future shell can render
`<Leaderboard state={state} onSelectTask={selectTask} reducedMotion={prefersReduced} />`.

## Deviations from plan

- **`avatar.ts` + `BirdAvatar.tsx`** instead of one `avatar.ts`: JSX needs a `.tsx` file. `avatar.ts`
  keeps the pure spec as specified; the component is a separate, small file.
- **Board-level blurb.** The `Board` shape in the brief has one `blurb` field, so the one-liner is
  computed from the leader ("… landed in 33.4s — a personal best for the flock") rather than repeated
  per row. No per-entry field was invented.
- **56 tests** instead of the required ≥ 24: 39 pure derive/avatar/rank tests and 17 component tests
  (11 panel, 6 avatar).
- **Thriftiest averages per node** (rationale above).

## Known limitations / deferred

- No persistence, no all-time high scores, no cross-run comparison — explicitly out of scope.
- Boards only rank what the active run's snapshots contain. A task that vanished from a capped event
  window still fails to appear in `cleanest`/`stubborn` (verdict history is capped at 100 per task).
- The FLIP slide is measured per board list; a card that appears or disappears moves the strip without
  animating its siblings. The strip's horizontal scroll position is not preserved across run switches.
- `stubborn` reads `TaskRun.attempts` as fix attempts, which is the contract's meaning; a task that
  passed first time shows no entry rather than "0 fixes".
- Avatars are decorative: they are not configurable, not clickable and carry no tooltip of their own.
- No Playwright coverage; the deterministic derivation + happy-dom component tests are the assertion
  layer, and the playground is the visual check.
