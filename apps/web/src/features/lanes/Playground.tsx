import { useMemo, useState } from 'react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState } from '../../data/reducer';
import { LanesView } from './LanesView';
import { overlapScenarioEvents } from './test-fixtures';

/**
 * Dev playground for the lanes map. Vite only: `/src/features/lanes/playground.html`.
 *
 * The slider replays the recorded launch-day run from the beginning: watch the plan paint all seven
 * lanes, then the touched files gain weight as the flock edits. The scenario buttons swap in a small
 * hand-made run where two lanes collide on `src/ui/**`, one file is edited twice, and a merge
 * conflicts — the warnings a judge should notice in two seconds.
 */
export default function Playground() {
  const [scenario, setScenario] = useState<'recorded' | 'overlap'>('recorded');
  const events = useMemo(
    () => (scenario === 'recorded' ? demoEvents() : overlapScenarioEvents()),
    [scenario],
  );
  const [index, setIndex] = useState(() => demoEvents().length);
  const [selected, setSelected] = useState<string | undefined>();

  const state = useMemo(() => applyEvents(createInitialState(), events.slice(0, index)), [events, index]);

  const choose = (next: 'recorded' | 'overlap'): void => {
    setScenario(next);
    setSelected(undefined);
    setIndex(next === 'recorded' ? demoEvents().length : overlapScenarioEvents().length);
  };

  return (
    <main className="min-h-screen bg-surface-0 p-6 text-ink-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.2em] text-ink-4">
              Starling · lanes playground
            </p>
            <h1 className="mt-1 text-title font-semibold">Every bird gets its own patch of sky</h1>
            <p className="mt-1 max-w-2xl text-caption text-ink-3">
              A treemap coloured by owning task. Frames nest directories; faded tiles are read-only; hatching
              means two lanes claim the same path; red means a conflict or a lane violation. Focus a tile and
              use the arrow keys to fly between patches.
            </p>
          </div>
          <fieldset aria-label="Fixture" className="m-0 flex items-center gap-1.5 border-0 p-0">
            <button
              type="button"
              data-testid="lanes-fixture-recorded"
              aria-pressed={scenario === 'recorded'}
              onClick={() => choose('recorded')}
              className="rounded-full border border-hairline bg-surface-2 px-3 py-1 text-caption"
            >
              Recorded run
            </button>
            <button
              type="button"
              data-testid="lanes-fixture-overlap"
              aria-pressed={scenario === 'overlap'}
              onClick={() => choose('overlap')}
              className="rounded-full border border-hairline bg-surface-2 px-3 py-1 text-caption"
            >
              Overlap + conflict
            </button>
          </fieldset>
        </header>

        <label className="flex flex-wrap items-center gap-2 text-caption text-ink-3">
          <span>Event</span>
          <input
            type="range"
            min={0}
            max={events.length}
            value={index}
            aria-label="Replay the fixture up to this event"
            onChange={(event) => {
              setSelected(undefined);
              setIndex(Number(event.target.value));
            }}
            className="w-72 accent-[var(--color-irid-teal)]"
          />
          <span className="w-24 tabular-nums" data-testid="lanes-playground-clock">
            {index}/{events.length} events
          </span>
          <span className="text-ink-4">
            · {scenario === 'recorded' ? 'sky-todo launch day' : 'two lanes on src/ui/**'}
          </span>
        </label>

        <div className="h-[68vh] min-h-[460px] overflow-hidden rounded-[var(--radius-panel)] border border-hairline shadow-[var(--shadow-panel)]">
          <LanesView
            state={selected === undefined ? state : { ...state, selectedTask: selected }}
            onSelectTask={setSelected}
          />
        </div>
      </div>
    </main>
  );
}
