import { useMemo, useState } from 'react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState } from '../../data/reducer';
import { buildFlightReport } from './derive';
import { ReportPage } from './ReportPage';

/**
 * Dev playground for the flight report (Vite only: `/src/features/report/playground.html`).
 *
 * The slider replays the recorded launch-day run event by event: stop mid-run to see "Still flying"
 * and live counters, or drag to the end for the landed report the projector sees.
 */
export default function Playground() {
  const events = useMemo(() => demoEvents(), []);
  const [index, setIndex] = useState(events.length);
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const state = useMemo(() => applyEvents(createInitialState(), events.slice(0, index)), [events, index]);
  const view = useMemo(
    () => (selected === undefined ? state : { ...state, selectedTask: selected }),
    [state, selected],
  );
  const clock = index === 0 ? undefined : events[index - 1]?.ts;
  const report = buildFlightReport(state, state.activeRunId, clock);

  return (
    <main className="min-h-screen bg-dusk-950 p-6 text-ink-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.2em] text-teal-300">
              Starling · report playground
            </p>
            <h1 className="mt-1 text-title font-semibold">The flight report, mid-run and landed</h1>
            <p className="mt-1 max-w-2xl text-caption text-ink-3">
              {report === undefined
                ? 'No run yet — advance the slider.'
                : `Run ${report.runId.slice(0, 8)} · ${report.outcome} · ${report.tasks.merged}/${report.tasks.total} landed`}
            </p>
          </div>
          <label className="flex items-center gap-2 text-caption text-ink-3">
            Event
            <input
              type="range"
              min={0}
              max={events.length}
              step={1}
              value={index}
              aria-label="Event position"
              onChange={(event) => setIndex(Number(event.target.value))}
              className="w-56 accent-teal-400"
            />
            <span className="w-20 font-mono tabular-nums">
              {index}/{events.length}
            </span>
          </label>
        </header>

        <ReportPage
          state={view}
          {...(clock === undefined ? {} : { now: clock })}
          onSelectTask={(key) => setSelected(key)}
        />
      </div>
    </main>
  );
}
