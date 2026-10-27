## Epic 47 Handback — Sky polish: roosts, migrations, sound

**Status:** Complete. Branch `epic/47-sky-polish` @ `9bfab4a` (this handback and the epic doc land in
the commit after it).

**Delivered:**
- **Roosts that read from the back of the room.** `layoutRoosts` now carries `activeSessions`,
  `maxSessions`, `isHub`, `busy`, `ripple` and `left`; the label size is
  `clamp(15, height × 0.026, 24)` px (21 px on the shell's 816 px sky at 1080p, 18 px at 720p), with a
  dark glass plate, a hub crown, a `3/5` sessions gauge with pips, and a busy glow that scales with
  session pressure. Roosts moved 58 px off the bottom edge so the old clipped label now fits.
- **Join moment.** `node.joined` grows the roost from the horizon (`grow` 0 → 1 over 1.2 s) with a
  two-ring ripple (1.7 s) and a top-centre toast `🪺 MacBook Air joined the flock`. `node.left` dims
  the roost to 0.25, scatters its flocks and fades `MacBook Air has flown away` under the roost.
  Notices are deduplicated by `(type, nodeId, ts)` and back-dated by the frame's age, so replay and
  live SSE behave identically.
- **Work in the bottom half.** Working flocks orbit a band anchored to *their own roost* (60–75 % of
  the sky) instead of a global mid-sky circle — the C1 "bottom is empty" complaint. `file.edited`
  spawns four pooled sparks at the leader; `tool.call` sets a decaying beat ring. Audit stays amber,
  the fix loop keeps its wide coral zig-zag.
- **Migration.** The 3.4 s arc + comet trail now ends inside the destination roost's working band, so
  the flock reforms where it will work instead of at 40 % height.
- **The wire.** Slots are spaced by landed/landing flocks (readable keys instead of a left-side pile),
  each landed flock draws its task key under the wire, a 1.5 s shimmer ring flashes on a *real*
  landing (not on a reconnect), and `run.status === 'finished'` fires one staggered all-landed lift
  with a travelling crest and an `All N birds landed` caption.
- **Optional sound.** `sound.ts`: throw-proof `readSoundEnabled`/`writeSoundEnabled` over an injected
  `StorageLike`, and `createSkyAudio()` — two-oscillator hum scaled by `workingFraction()`, chirps on
  landing, whooshes on migration, no audio files. Off by default; toggle in the Sky (`aria-pressed`,
  "sound on/off"); lazy context + resume on the click gesture.
- **`paused`, fps, stress.** Local optional `SkyViewProps.paused` stops the rAF loop (one final draw,
  resume without a time jump), `onFps` feeds a live fps readout, and the Playground's "stress 30
  flocks" toggle (`?stress=1`, `withStressTasks`) reproduces 360 birds.
- **Calm mode** settles `grow`/`dim`/`busy` and skips ripples, sparks, beats, shimmers and the sweep:
  strictly static, as the C1 note asked.
- **Tests (+19):** `polish.test.ts` (10: label metrics, gauge/busy, join growth/ripple/notice,
  back-dated replay join, leave caption/dim, sparks + beat decay + dedupe, roost-anchored work band,
  landing order/shimmer, one-shot sweep, stress helper) and `sound.test.ts` (6: persistence, corrupt
  value, throwing storage, throwing `localStorage` getter, synth cue counts, inert without WebAudio),
  plus 3 new `SkyView` cases (pause/resume loop, persisted toggle, blocked storage) and the calm-test
  coordinate update.
- Two new screenshots, `__screens__/sky-47-mid.png` (197 KiB) and `sky-47-join.png` (156 KiB), both
  1920×1080.

**Key design decisions:**
- Roost-anchored work bands — the middle-of-canvas orbit told you nothing about *which machine* was
  working and left the bottom empty. Cost: working birds are lower and clustered per roost (wanted).
- Event-driven join/leave with back-dating — node-list diffing cannot reconstruct replay timing; the
  timestamp is the only honest source. Dedupe key includes `ts` so a scrubbed frame never re-fires.
- Dynamic wire slots — a deliberate change to Epic 24's stable slots. With 9+ merges the old spacing
  overprinted labels; sliding left as merges arrive reads as the wire filling up (documented as a
  supersession in the epic doc).
- Cues live in the sim (seeded, testable, allocation-free), not in the renderer; the renderer only
  draws pool contents.
- Sound storage helpers are pure and injected; the engine takes an optional `createContext` so tests
  assert the oscillator graph without a device. No noise buffer: a pitch sweep is enough for a 0.5 s
  whoosh.
- `paused`/`onFps`/`createAudio` are additive optional local props (core is Epic 40's lane, L30). The
  intersection type survives core adding `paused`.
- Calm mode snaps roost chrome because `step()` never runs there; without the snap a new roost sat at
  `grow = 0` forever (caught in the calm screenshot).

**Verification (exact commands + results):**
- `bun install`: `Checked 162 installs across 221 packages (no changes) [121.00ms]` — clean worktree,
  no new dependencies.
- Feature tests `cd apps/web && bun test src/features/sky`: **60 pass, 0 fail**, 1734 expect() calls.
- `bun run test` (root):
  - packages: `1359 pass, 4 skip, 0 fail — Ran 1363 tests across 162 files. [31.48s]`
  - web: `445 pass, 0 fail — Ran 445 tests across 41 files. [6.31s]`
- `bun run check`: `Checked 708 files in 807ms. No fixes applied.` + the per-workspace
  `tsc --noEmit` loop finished with no output (clean).
- **Playground fps measurement**, 1920×1080, headless Chromium, `preview.html?t=200&stress=1` (30
  flocks = 360 birds + the fixture's own), read from the Sky's `data-fps`: **119, 120, 121 fps** on
  three runs (display capped at 120 Hz). Sim-only cost, 1440×900, 600 steps: **22.8 ms total,
  0.038 ms/step** (≈0.2 % of a 16.7 ms frame).
- Screenshots via Playwright (Chromium) against the Vite dev page:
  `preview.html?t=172` and `preview.html?t=90` at 1920×1080 →
  `apps/web/src/features/sky/__screens__/sky-47-mid.png` (197 KiB) and `sky-47-join.png` (156 KiB).
- Manual browser pass at 1920×1080: roost plates/gages legible, join ripple + toast, leave caption,
  wire keys + shimmer, calm mode static and complete, sound toggle flips and persists across a
  reload, no console errors.

**Dependencies added:** none.

**FIX REQUESTS:**
1. **`packages/core/src/handshake.ts` — `SkyViewProps.paused?: boolean`** (owner: Epic 40). The C1
   handback already requested it; Epic 47 now consumes it via a local intersection type, so the
   change is purely additive:
   ```ts
   export interface SkyViewProps { /* … */ reducedMotion?: boolean; paused?: boolean }
   ```
   Why: the shell keeps both centre views mounted (React Flow measurement + instant switching), so the
   Sky's rAF must stop while the DAG is shown (`.orchestrator/handbacks/34-c1-web-wiring.md`, request
   3). Until it lands, the shell can pass `paused` and TypeScript will reject it.
2. **`apps/web/src/app/Layout.tsx` — pass `paused={view !== 'sky'}` to `<SkyView>`** (owner: Epic 41 /
   shell). The Sky already stops cleanly; only the wiring is missing. No layout or data-layer changes
   are needed, and the fps/sound controls need no shell support.
3. *(Optional)* `apps/web/src/app/Layout.tsx` — forward toasts/notices into the flock panel's node
   list? Not needed: the Sky renders its own captions and the node.* events already reach it through
   `recent`.

**Deliberately deferred / out of scope:**
- Pixel-diff/screenshot tests and a Playwright CI harness (screenshots remain documentation; the
  deterministic sim tests are the assertion layer).
- Resolver sessions still look like their parent status (no `resolver` TaskStatus exists).
- Per-flock migration re-planning mid-arc; variable migration duration by distance.
- Sound mix/volume UI, spatial panning per roost, and a live-device audio test.
- Caption localisation, a caption priority queue beyond "newest four", and reduced-motion captions.
- Wire labels beyond ~30 merges (ellipsised; the DAG owns full titles).
- Anything in the data layer, layout or the other five panels (Epic 41's lane).

**Open questions / flagged tradeoffs:**
- **Dynamic wire slots supersede Epic 24's stable-slot decision.** Landed flocks shuffle left as new
  merges arrive. It buys readable keys at 9+ merges; if the orchestrator prefers absolute stability,
  revert `wireSlots()` to `flocks.length` and accept overlapping/absent labels.
- **Sound volume is fixed** (master 0.26, hum ≤ 0.05). A demo room may want a slider; a projector
  audience will barely hear it, which is the intent for a stage demo.
- **The join toast is ~20 px tall at 1080p** (`height × 0.023`), deliberately smaller than the roost
  names. If the projector review wants it bigger, one constant in `drawNotices` changes it.
- **`createAudio` is a production prop** (not test-only) because it doubles as the embedding seam for
  a future shared audio context; it is inert unless passed.
