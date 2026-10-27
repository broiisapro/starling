import { useEffect, useMemo, useState } from 'react';

// The recorded launch-day run, inlined by Vite (`?raw`). Same file the shell's demo mode replays.
import raw from '../../../../../fixtures/runs/sky-todo-launch-day.jsonl?raw';

import { parseEventLines } from '../../lib/events';
import { MetricsPanel } from './MetricsPanel';
import { replayMetrics } from './replay';

// Local envelope guard, not core's zod schema: a runtime import from `@starling/core` would pull
// its config loader (and `node:fs`) into the browser bundle. See `src/lib/events.ts`.
const EVENTS = parseEventLines(raw).events;

/**
 * Fixture-driven playground for the metrics panel. The shell mounts it full-screen from
 * `?playground=metrics` (dev and demo backup), so it never has to touch the store.
 *
 * Press Play to step through the recorded metrics events with the meter live: cost counts up, the
 * elapsed clock ticks, and the off-peak note follows the API figure. Scrubbing the slider is a dry
 * run — exact numbers, no animation — which is what a replay should do.
 */
export function Playground() {
  const [index, setIndex] = useState(EVENTS.length - 1);
  const [playing, setPlaying] = useState(false);
  const history = useMemo(() => replayMetrics(EVENTS, index), [index]);
  const metrics = history[history.length - 1]?.metrics;

  useEffect(() => {
    if (!playing) return;
    if (index >= EVENTS.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((current) => Math.min(current + 1, EVENTS.length - 1)), 120);
    return () => clearTimeout(timer);
  }, [playing, index]);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-200">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold text-slate-100">Metrics · playground</h1>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (index >= EVENTS.length - 1) setIndex(0);
                setPlaying((value) => !value);
              }}
              className="rounded-md border border-sky-500/60 bg-sky-500/10 px-2.5 py-1 text-sm font-medium text-sky-100 hover:bg-sky-500/20"
            >
              {playing ? 'Pause' : 'Play with count-up'}
            </button>
            <label className="flex items-center gap-2 text-[12px] text-slate-300">
              Event
              <input
                type="range"
                min={0}
                max={EVENTS.length - 1}
                value={index}
                onChange={(event) => {
                  setPlaying(false);
                  setIndex(Number(event.target.value));
                }}
                className="w-56 accent-sky-400"
              />
              <span className="w-16 tabular-nums">
                {index + 1}/{EVENTS.length}
              </span>
            </label>
          </div>
        </header>
        <MetricsPanel metrics={metrics} history={history} live={playing} animate={playing} />
        <p className="text-sm text-slate-400">
          Scrubbing replays the recorded metrics events and freezes the clock once the stream goes stale. Play
          runs the same stream live so the cost meter counts up; the note under the API figure is DeepSeek's
          off-peak equivalent (the engine bills peak, so the budget guardrail never under-counts).
        </p>
      </div>
    </main>
  );
}

export default Playground;
