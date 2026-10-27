# Epic 120 — Web: command palette (⌘K)

## Goal

With fifteen Wave 3 views, the dashboard needed one predictable way in: press ⌘K (Ctrl-K), type a
few letters, press Enter. The palette had to search the active run's tasks, every run, the feature
manifests the shell hands it and shell-provided commands, remember the last eight picks, and be fully
keyboard- and screen-reader-usable — without binding the global hotkey itself (the shell owns that).

## How it works

**Pure layer (`fuzzy.ts`, `items.ts`, `recent.ts`, `derive.ts`, `hotkey.ts`, `icons.tsx`)**

1. `fuzzyScore(query, text)` is a case-insensitive subsequence matcher implemented as a small
   dynamic program, not a greedy scan. `layers[j][i]` is the best score for the query prefix ending
   with `query[j]` matched at `text[i]`; each step takes the better of an adjacent match (a
   consecutive bonus) or the best earlier match (a real jump). Backpointers reconstruct the winning
   positions, which are merged into half-open `[start, end)` ranges for highlighting.
   Bonuses: word start (+5), prefix of the text (+8 on the first query char at index 0), consecutive
   match (+4), and a tiny earlier-is-better penalty. An empty/whitespace query matches everything with
   score 0 and no ranges.
2. `rankItems(query, items, limit)` scores the label plus optional hint (×0.85) and keywords (×0.75),
   keeps only matches, then sorts by score, lower-cased label, id and original order — no locale, no
   object-order dependence. `ranges` always refer to the label (empty when only a keyword matched),
   because that is the only text the row highlights.
3. Builders turn the read-only store snapshot into `PaletteItem`s:
   - `taskItems` reads `activeRunOf(state)?.plan?.tasks`, so undispatched tasks are searchable too;
     the hint is `key · statusLabel(TaskRun.status)`.
   - `runItems` reads `sortedRuns(state)` (newest first), labels with the goal text and hints with the
     run status.
   - `featureItems` / `commandItems` adapt the optional shell manifests.
4. `groupResults(items, query, recents, limit)` returns `[{id, label, items}]`. An empty query shows
   Recent (max 8) first, then Commands → Views → Tasks → Runs, capped at 50 rows in total. A real
   query ranks across every item, caps at 50, then buckets by group so headings never reorder.
5. Recents are item ids in `localStorage['starling.palette.recent.v1']`: read/write are wrapped in
   try/catch (Safari private mode throws), duplicates collapse, the list caps at 8, and ids that no
   longer exist are skipped when building the list (`recentItems`).

**Component (`CommandPalette.tsx`)**

- A fixed, centred dialog over a backdrop (or an inline block for the playground), a single
  focusable control (the input) and the WAI-ARIA combobox + listbox pattern:
  `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-autocomplete`,
  a `role="listbox"` with labelled `role="group"` sections and `role="option"` rows whose
  `aria-selected` follows the active index.
- Keys: ↓/↑ wrap, Home/End jump, Enter runs the active item then calls `onClose`, Escape closes, Tab
  is prevented (the palette has one tab stop; leaving it would strand the query behind the overlay).
  A `role="status"` live region announces the result count.
- Opening focuses the input and captures the previously focused element; unmounting restores it.
- Matched ranges render as `<mark>`; hotkeys render through the shared `Kbd`; rows show a group icon
  (feature icons come from the manifest's icon name via a fixed lucide map, everything unknown falls
  back to `Command`).
- `prefers-reduced-motion` is read through `usePrefersReducedMotion()` from `features/metrics` and
  the row/backdrop transitions are dropped when it is set (the global stylesheet already has a
  backstop).

**Manifest and playground**

- `index.ts` exports `FEATURE = 'palette'`, the L39 `feature` manifest (`overlay`, icon `Command`,
  hotkey `mod+k`) and every pure building block.
- `Playground.tsx` + `playground.html` replay `fixtures/runs/sky-todo-launch-day.jsonl` through
  `applyEvents(createInitialState(), demoEvents().slice(0, i))` with an event-index slider, pass a
  fake list of the 15 Wave 3 manifests (ids/titles/hotkeys from L39) and log every pick.

## Key decisions & reasoning

- **Best alignment, not greedy.** A greedy matcher is simpler but ranks `abc` in `zaxbxcxabc` as the
  scattered `a/x/b/x/c` instead of the consecutive tail. The DP is O(text × query) per item; 500
  tasks × ~40-char titles × a 3-letter query is comfortably under a frame, and only 50 rows mount.
- **Half-open ranges** `[start, end)` are the least ambiguous contract for `String.slice` and for
  rendering; documented in the type and asserted by tests.
- **Label ranges even when a keyword wins the score.** The row only highlights the label; returning
  ranges from a hint/keyword would highlight text that is not on screen.
- **Deterministic tie-break by label then id**, not `localeCompare`: identical labels must not swap
  places between machines or test runs.
- **Ids, not labels, in recents.** Task titles and goals change between runs; a stale id is dropped
  silently instead of resurrecting a row that no longer exists. Cleanup happens on the next pick,
  not on render, so building the list stays pure.
- **50-row cap at rank time.** The brief's cap is also the performance answer: ranking is cheap, but
  mounting 500 rows in an overlay is not. No virtualisation: 50 rows is under any threshold where it
  would pay for itself.
- **No document-level keydown listener.** The shell's registry (Epic 112, wired at C3) binds
  `mod+k` from the manifest. The component only handles keys while the input has focus, which avoids
  a double-toggle and keeps the hotkey discoverable in one place.
- **`onSelectTask` / `onSelectRun` are optional.** Without them the palette still lists tasks and
  runs and closes on Enter; that keeps `ComponentType<FeatureProps>` honest and lets the playground
  and tests mount it bare.
- **Structural feature type, not the L39 manifest type.** `PaletteFeature` is a subset
  (`id/title/description/kind/icon/hotkey?`) so C3 can pass registry manifests directly without the
  palette importing the shell.
- **One local lucide map.** `import * as icons` would pull the whole set into the dashboard bundle for
  a 14 px glyph; the palette maps the Wave 3 icon names plus a few aliases and falls back to
  `Command`.

## Interfaces for future epics

```ts
export const FEATURE: 'palette';
export const feature: {
  id: 'palette'; title: string; description: string; kind: 'overlay';
  icon: 'Command'; hotkey: 'mod+k'; Component: ComponentType<FeatureProps>;
};

export function fuzzyScore(query: string, text: string):
  { score: number; ranges: [number, number][] } | undefined;
export function rankItems<T extends Rankable>(query: string, items: readonly T[], limit?: number):
  { item: T; score: number; ranges: [number, number][] }[];

export interface PaletteItem {
  id: string; group: 'recent' | 'commands' | 'features' | 'tasks' | 'runs';
  label: string; hint?: string; keywords?: string[]; hotkey?: string; run(): void;
}
export interface PaletteFeature { id; title; description; kind; icon; hotkey? }
export interface PaletteCommand { id; label; hint?; hotkey?; run() }

export function taskItems(state: SkyState, onSelectTask?: (key: string) => void): PaletteItem[];
export function runItems(state: SkyState, onSelectRun?: (runId: string) => void): PaletteItem[];
export function featureItems(features: readonly PaletteFeature[], onOpen?: (id: string) => void): PaletteItem[];
export function commandItems(commands: readonly PaletteCommand[]): PaletteItem[];
export function recentItems(items, recents, limit?): PaletteItem[];
export function groupResults(items, query, recents?, limit?): PaletteGroupResult[];

export const RECENT_KEY = 'starling.palette.recent.v1';
export const RECENT_LIMIT = 8;
export function recordRecent(ids: readonly string[], id: string): string[];
export function pruneRecent(ids: readonly string[], valid: ReadonlySet<string>): string[];
```

`CommandPaletteProps extends FeatureProps` and adds only optional props (C3 passes none of them):
`features?`, `commands?`, `onOpenFeature?`, `initialRecent?`, `persistRecent?`, `inline?`.

## Deviations from plan

- The brief described the fuzzy matcher loosely ("subsequence, bonuses…"). The implementation is a
  DP alignment rather than a greedy scan; the extra cost is one small allocation per item per
  keystroke and the ranking quality is materially better, so the trade was taken deliberately.
- Search also covers a task's lane globs/goal, a run's id/repo/integration branch and a feature's
  id/kind. The brief asked only for keys/status text; extra keywords cost nothing and help someone
  who remembers `src/lib/dates.ts` but not the task title.
- `icons.tsx` includes a handful of aliases (`Dashboard`, `Sky`, `Metrics`, …) so older manifests and
  the playground's fake list all render real glyphs; unknown names still fall back to `Command`.
- The playground opens as the real overlay (on first load and via a button) rather than an inline
  copy, so its focus/keyboard behaviour is the shipped behaviour. `inline` remains available to
  future docs or screenshots.

## Known limitations / deferred

- No typo tolerance (subsequence only). A query with a transposed letter does not match; a
  Damerau-Levenshtein fallback would be a `fuzzy.ts` change plus a ranking fixture.
- Recents are global to the browser, not per run or per repo. A multi-run dashboard may offer a task
  from yesterday until its id is pruned by the next pick.
- Feature icons are limited to the names in `icons.tsx` (plus aliases). A new manifest icon needs one
  line there; the fallback keeps it rendering meanwhile.
- No virtualised list. At 50 rows it is unnecessary; a future "show all results" mode would need one.
- C3 still has to route `?playground=palette`, register the manifest and bind `mod+k`; the exact code
  is in `.orchestrator/handbacks/120-web-palette.md`.
