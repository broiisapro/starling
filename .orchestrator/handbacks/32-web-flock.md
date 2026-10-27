## Epic 32 Handback — Web: flock panel

**Status:** Complete. Branch `epic/32-web-flock` @ `66582b2` (feature tip; docs/verification commits follow). Closes #26.

**Delivered:**

- `apps/web/src/features/flock/` — the whole lane, 27 files:
  - `FlockPanel` (props-only, ARCHITECTURE §8) with hub-first roost cards: status dot + busy pulse,
    hub/perch badge, hardware line, latency, segmented session meter, lent-model chips, clickable
    task chips, dimmed offline state with "last seen 12s ago".
  - Enter/exit card transitions (`useEntered`, `usePresence` with a 320 ms exit hold), all suppressed
    under `reducedMotion`.
  - `JoinCard`: large monospace join code + copy, full perch command + copy, hub URL, and a QR
    encoding the command, plus the exact explainer sentence. Graceful "flock off" state.
  - `EmptyFlock` ("Your flock is just you." / "Add a laptop →") when the hub is alone.
  - `CompactFlock` one-row mode (`compact` prop) with an add tile that copies the join command.
  - `STATUS_PALETTE` + `taskTone` local status palette for C1.
  - `deriveNodes`/`deriveTasks`: fold `node.*` / task events into `NodeInfo[]` / `TaskRun` records.
  - `Playground`: fixture-driven replay with play/pause/scrub/"Next roost event", showing the Air
    joining mid-run, dropping, and returning; also accepts `events`/`fixture` for tests.
  - `handshake.ts` with the verbatim §8 mirror header, plus documented `FlockPanelExtras`.
- 34 tests across 3 files (23 UI, 7 pure helper, 4 playground), including clipboard mocks, QR SVG,
  offline styling, hub-first order, session pips, compact mode, reduced motion, presence, and the
  real 252-event fixture story.
- `docs/epic-32-web-flock.md`.
- `apps/web/package.json`: `qrcode@1.5.4` (dep), `@types/qrcode@1.5.6` (devDep).

**Key design decisions:**

- All additions to §8 are optional (`compact`, `reducedMotion`, `now`, `onSelectTask`), so
  `FlockPanel` still satisfies `FlockPanelProps`; C1 can promote them to core without call-site
  churn.
- `now` pins the replay clock (the fixture is from the recorded day); when absent, `useNow` ticks
  once a second so offline ages keep climbing.
- QR via `qrcode`'s `create()` matrix + a hand-written single-path SVG renderer: synchronous,
  canvas-free, black-on-white with a quiet zone for scanners, and easy to test.
- Presence is a local hook (per-node timers, cleaned up) rather than a motion dependency.
- `node.left` keeps hardware, zeroes sessions, marks offline; unknown leaves are ignored; optional
  heartbeat fields are preserved. Rejoin sets online.
- Clipboard falls back to `execCommand` and surfaces failure as "Press ⌘C" + an aria-live message.
- Fixture reaches `Playground` through `fixture-log.ts` (static `?raw`), lazily imported. A dynamic
  `import('…?raw')` across the workspace root is left unresolved by a production Vite build; the
  static module is inlined into a 116 kB lazy chunk (verified).
- Tests mount with `react-dom/client` + `act` (`test-dom.ts`) instead of RTL, following E00's
  documented Bun/RTL incompatibility.

**Verification (exact commands + results):**

- `bun install`: `Checked 162 installs across 221 packages (no changes) [14.00ms]`
- `bun test apps/web/src/features/flock`:
  `34 pass, 0 fail, 131 expect() calls, Ran 34 tests across 3 files. [1.71s]`
- `bun run test` (root):
  `221 pass, 0 fail, 919 expect() calls, Ran 221 tests across 40 files. [1.85s]`
- `bun run typecheck`: exit 0 (all 18 workspaces).
- `biome check apps/web/src/features/flock`: `Checked 27 files ... No fixes applied.`
- `bun run check`: **fails only on pre-existing, out-of-lane formatting** on `main`:
  `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`,
  `tools/local-models/{host,ollama,smoke}.ts`, `tools/local-models/ollama.test.ts`,
  `tools/local-models/smoke.ts` (organizeImports) and
  `tools/local-models/results/smoke-*.json`. None of those files are touched by this branch; Biome +
  typecheck are clean for the lane.
- `cd apps/web && bun run build`: `✓ 1938 modules transformed ... built in 271ms` (no bundle errors
  from the new dependency).
- Browser-bundle smoke: `bun build apps/web/src/features/flock/FlockPanel.tsx --target=browser
  --jsx=automatic --external react --external react-dom --external lucide-react` → `Bundled 45
  modules`, 101.83 kB, no `pngjs`/`yargs` (browser field honoured).
- Throwaway Vite build with `Playground.tsx` as an app entry → emitted `fixture-log-*.js`
  (116,529 bytes) containing the recorded log and `playground-next-roost`; the temp entry files and
  build output were deleted. This is the check that caught the dynamic-`?raw` problem.

**Dependencies added:** `qrcode@1.5.4` (runtime) and `@types/qrcode@1.5.6` (dev) in `apps/web`.
`bun.lock` updated by `bun add`; not hand-edited.

**CONTRACT REQUESTS:**

1. Add a selection callback to §8's flock props (needed for clickable task chips; every other view
   already has one):

   ```ts
   export interface FlockPanelProps {
     nodes: NodeInfo[];
     join?: JoinInfo;
     tasks: Record<string, TaskRun>;
     onSelectTask?(key: string): void;
   }
   ```

2. When C1 moves the §8 types into `@starling/core`, include `JoinInfo` (it is defined in §8's
   FlockHub block but not in `packages/core/src/contracts.ts`), so the server, `FlockHub` and the
   panel share one type instead of three mirrors.
3. Consider promoting `now?: number` alongside the other view props: replay/playground needs a
   pinned clock in any timestamped panel, and the shell will otherwise repeat this logic.

**Deliberately deferred / out of scope:**

- Global store wiring, SSE, and task-chip → agent-drawer opening (Epic 23/C1).
- Registering/launching perches (backend E30/E31); the join card only shows what to run.
- Sky roost visuals (Epic 24).
- Virtualisation for hundreds of nodes.
- Live/browser E2E; Wave 1 forbids network and long-running servers.

**Open questions / flagged tradeoffs:**

- The QR encodes the **command**, not the hub URL, because the next step after scanning is pasting a
  terminal command. A phone cannot run it, though; if C1 grows a `starling://join` deep link, that
  should become the payload.
- Task chips are clickable in card mode only; compact mode is intentionally read-only (a single row
  of mini roosts) apart from the add tile.
- `last seen` uses whole seconds; a 15 s offline threshold (per ARCHITECTURE §1) is the engine's
  call, not the panel's — the panel only renders whatever `status` says.
