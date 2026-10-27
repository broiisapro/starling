import { useEffect, useMemo, useState } from 'react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState } from '../../data/reducer';
import { Leaderboard } from './Leaderboard';

/**
 * Dev playground for the leaderboard (`/src/features/leaderboard/playground.html`).
 *
 * Scrub the slider to replay the recorded launch-day run: ranks swap live, so the ▲/▼ badges and the
 * FLIP slide can be seen mid-run instead of only at the final frame. The theme toggle checks the
 * card chrome in light mode without touching the shell.
 */
export default function Playground() {
  const events = useMemo(() => demoEvents(), []);
  const [index, setIndex] = useState(events.length);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [selected, setSelected] = useState<string | undefined>('theme');

  const state = useMemo(() => applyEvents(createInitialState(), events.slice(0, index)), [events, index]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  const selectedState = useMemo(
    () => (selected === undefined ? state : { ...state, selectedTask: selected }),
    [state, selected],
  );

  return (
    <main className="min-h-screen bg-surface-0 p-6 text-ink-1">
      <header className="mb-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-irid-teal">
          Starling · leaderboard playground
        </p>
        <h1 className="mt-1 text-title font-semibold">The flock sorts itself out</h1>
        <p className="mt-1 max-w-2xl text-body text-ink-2">
          {events.length} recorded events. Scrub to watch the boards reorder: crown, avatar, value and the
          one-line story update from the same run snapshots the dashboard uses. Click a bird to select its
          task, or switch the theme to check both palettes.
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-hairline bg-panel px-3 py-2">
        <label className="flex min-w-64 flex-1 items-center gap-2 text-caption text-ink-2">
          <span className="shrink-0 tabular-nums">event {index}</span>
          <input
            type="range"
            min={0}
            max={events.length}
            value={index}
            onChange={(event) => setIndex(Number(event.target.value))}
            className="w-full accent-irid-teal"
            aria-label="Event index"
          />
          <span className="shrink-0 tabular-nums">{events.length}</span>
        </label>
        <button
          type="button"
          className="rounded-md border border-hairline-strong bg-surface-3/70 px-2 py-1 text-caption text-ink-1 hover:bg-surface-3"
          onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </section>

      <div className="h-[360px] min-h-[280px] overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-panel/70">
        <Leaderboard state={selectedState} onSelectTask={setSelected} />
      </div>

      <p className="mt-3 text-caption text-ink-3">
        Selected task: <span className="font-mono text-ink-2">{selected ?? 'none'}</span>. Boards with no
        qualifying task are hidden, so the strip grows as the run progresses.
      </p>
    </main>
  );
}
