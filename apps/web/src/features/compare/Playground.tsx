import { useMemo, useState } from 'react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';
import { sortedRuns } from '../../data/selectors';
import { ComparePage } from './ComparePage';
import { secondRun } from './test-fixtures';

/**
 * Dev playground for the compare page. Vite only: `/src/features/compare/playground.html`.
 *
 * The slider replays the recorded launch-day fixture event by event, so the page can be inspected
 * mid-run and at the end. A second run (derived deterministically in `test-fixtures.ts`) makes the
 * plan diff and the "two laptops" story visible, and the toggle pins B to the serial baseline.
 */
export function Playground() {
  const events = useMemo(() => demoEvents(), []);
  const [index, setIndex] = useState(events.length);
  const [baseline, setBaseline] = useState(false);

  const state: SkyState = useMemo(() => {
    const base = applyEvents(createInitialState(), events.slice(0, index));
    const active = sortedRuns(base)[0];
    if (active === undefined) return base;
    const other = secondRun(active);
    return { ...base, runs: { ...base.runs, [other.id]: other } };
  }, [events, index]);

  const search = baseline ? '?b=baseline' : '';

  return (
    <div className="min-h-screen bg-surface-0 p-4 text-ink-1">
      <header className="mx-auto mb-4 flex w-full max-w-6xl flex-col gap-2">
        <p className="text-micro uppercase tracking-[0.2em] text-teal-300">Starling · compare playground</p>
        <h1 className="text-title font-semibold">Two runs, one screen</h1>
        <p className="max-w-3xl text-caption text-ink-3">
          Event {index} of {events.length}. Drag the scrubber to watch the numbers move mid-run; toggle the
          baseline to compare the same run against “one agent, one task at a time”.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex grow items-center gap-2 text-caption text-ink-2">
            <span className="shrink-0">Events</span>
            <input
              type="range"
              min={0}
              max={events.length}
              value={index}
              onChange={(event) => setIndex(Number(event.target.value))}
              className="grow accent-teal-400"
              aria-label="Event index"
            />
          </label>
          <label className="flex items-center gap-2 text-caption text-ink-2">
            <input
              type="checkbox"
              checked={baseline}
              onChange={(event) => setBaseline(event.target.checked)}
              className="accent-amber-400"
            />
            Serial baseline mode
          </label>
        </div>
      </header>
      <ComparePage
        key={baseline ? 'baseline' : 'pair'}
        state={state}
        search={search}
        onSelectRun={() => undefined}
      />
    </div>
  );
}

export default Playground;
