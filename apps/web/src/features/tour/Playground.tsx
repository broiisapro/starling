import { useMemo, useState } from 'react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState } from '../../data/reducer';
import { type MockView, ShellMock } from './ShellMock';
import { TOUR_STEPS } from './steps';
import { Tour } from './Tour';

/**
 * Dev playground for the tour: Vite only, at `/src/features/tour/playground.html`.
 *
 * It draws a mock of the shell's six regions (so every step has a real anchor), lets you scrub the
 * recorded launch-day run to any point, and removes two anchors on demand to show the centred-card
 * fallback. "Start tour" remounts the overlay, which is exactly what the shell's palette entry does.
 */
export default function Playground() {
  const events = useMemo(() => demoEvents(), []);
  const [cursor, setCursor] = useState(160);
  const [showAllAnchors, setShowAllAnchors] = useState(true);
  const [view, setView] = useState<MockView>('sky');
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [tourKey, setTourKey] = useState(0);

  const state = useMemo(() => applyEvents(createInitialState(), events.slice(0, cursor)), [events, cursor]);
  const run = state.activeRunId === undefined ? undefined : state.runs[state.activeRunId];

  const start = (): void => {
    setTourKey((key) => key + 1);
    setOpen(true);
  };

  return (
    <main className="flex h-screen min-h-0 flex-col gap-2 bg-surface-0 p-3 text-ink-1">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <p className="text-micro tracking-[0.2em] text-sky-300 uppercase">Starling · guided tour</p>
          <h1 className="mt-0.5 text-title font-semibold tracking-tight">
            Seven steps, real UI, never stuck
          </h1>
          <p className="mt-1 max-w-2xl text-caption text-ink-3">
            {TOUR_STEPS.length} steps over the mock shell. Scrub the recorded run, drop the optional anchors,
            then run the tour: a missing region becomes a centred card, never a dead end.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={start}
            className="rounded-md border border-teal-400/40 bg-teal-400/15 px-3 py-1.5 text-caption font-medium text-teal-200 hover:bg-teal-400/25"
          >
            {open ? 'Restart tour' : 'Start tour'}
          </button>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 rounded-[var(--radius-panel)] border border-hairline bg-panel px-3 py-2">
        <label className="flex min-w-72 flex-1 items-center gap-3 text-caption text-ink-2">
          <span className="shrink-0">Event {cursor}</span>
          <input
            type="range"
            min={0}
            max={events.length}
            value={cursor}
            onChange={(event) => setCursor(Number(event.target.value))}
            className="w-full accent-teal-300"
          />
          <span className="w-28 shrink-0 text-right text-micro text-ink-4">
            {run?.status ?? 'no run'} · {selected ?? 'nothing selected'}
          </span>
        </label>
        <label className="flex items-center gap-2 text-caption text-ink-2">
          <input
            type="checkbox"
            checked={showAllAnchors}
            onChange={(event) => setShowAllAnchors(event.target.checked)}
            className="accent-teal-300"
          />
          remove two anchors (views menu + meter)
        </label>
      </section>

      <section className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius-panel)] border border-hairline">
        <ShellMock
          state={state}
          selectedTask={selected}
          view={view}
          onViewChange={setView}
          showAllAnchors={showAllAnchors}
        />
      </section>

      <Tour
        key={tourKey}
        state={state}
        open={open}
        onSelectTask={setSelected}
        onClose={() => setOpen(false)}
      />
    </main>
  );
}
