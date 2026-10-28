import type { StarlingEvent } from '@starling/core/browser';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState } from '../../data/reducer';
import { ToastHost } from './ToastHost';

const SPEEDS = [1, 4, 16] as const;
type Speed = (typeof SPEEDS)[number];

/**
 * Two synthetic events after the recorded run so every toast kind is visible in the playground.
 * They are labelled as synthetic in the UI and are never part of the fixture the tests read.
 */
function syntheticTail(events: readonly StarlingEvent[]): StarlingEvent[] {
  const first = events[0];
  const last = events.at(-1);
  if (first === undefined || last === undefined) return [];
  const runId = first.runId;
  const conflictTs = last.ts + 1_000;
  return [
    {
      type: 'merge.result',
      runId,
      ts: conflictTs,
      payload: {
        taskKey: 'stage-guard',
        status: 'conflict',
        conflictedFiles: ['src/app/App.tsx'],
        detail: 'Synthetic demo event: lane overlap with the theme task',
        ts: conflictTs,
      },
    },
    {
      type: 'log',
      runId,
      ts: conflictTs + 1_000,
      payload: {
        level: 'error',
        msg: 'Synthetic demo event: a perch vanished mid-task',
        taskKey: 'stage-guard',
      },
    },
  ];
}

/** Dev-only playground for the toast stack; same fixture story as the demo (`?playground=toasts`). */
export default function Playground() {
  const recording = useMemo(() => demoEvents(), []);
  const timeline = useMemo(() => [...recording, ...syntheticTail(recording)], [recording]);
  const [speed, setSpeed] = useState<Speed>(16);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [generation, setGeneration] = useState(0);

  const state = useMemo(() => applyEvents(createInitialState(), timeline.slice(0, index)), [timeline, index]);

  useEffect(() => {
    if (!playing) return;
    const next = timeline[index];
    if (next === undefined) {
      setPlaying(false);
      return;
    }
    const previous = timeline[index - 1];
    const delay = previous === undefined ? 0 : Math.max(0, Math.round((next.ts - previous.ts) / speed));
    const timer = setTimeout(() => setIndex((current) => current + 1), delay);
    return () => clearTimeout(timer);
  }, [playing, index, speed, timeline]);

  const restart = (nextSpeed: Speed = speed): void => {
    setSpeed(nextSpeed);
    setIndex(0);
    setPlaying(true);
    setGeneration((value) => value + 1);
  };

  const done = index >= timeline.length;
  const durationS = Math.round(((timeline.at(-1)?.ts ?? 0) - (timeline[0]?.ts ?? 0)) / speed / 1000);

  return (
    <main className="min-h-screen bg-slate-950 p-6 pb-24 text-slate-200">
      <header className="mb-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-sky-400">
          Starling · toasts playground
        </p>
        <h1 className="mt-1 text-xl font-semibold">Shoulder taps from the recorded launch-day run</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-300">
          Replays {timeline.length} events in about {durationS}s at {speed}×. Watch the Air join and drop,
          theme fail its first audit, the landings collapse, the budget climb past 80 % and 100 %, and the run
          finish. The last two events are synthetic so the conflict and error toasts appear too.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => restart(value)}
            className={`rounded-md border px-2.5 py-1 ${
              value === speed
                ? 'border-sky-400/60 bg-sky-400/15 text-sky-200'
                : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {value}×
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-slate-300 hover:border-slate-500"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() => restart()}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-slate-300 hover:border-slate-500"
        >
          <RotateCcw className="size-3.5" />
          Restart
        </button>
        <span className="text-slate-400">
          {Math.min(index, timeline.length)}/{timeline.length} events
          {done ? ' · finished' : playing ? ' · playing' : ' · paused'}
        </span>
      </div>

      <section className="max-w-2xl rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm">
        <p className="font-mono text-sky-200">
          {Object.keys(state.runs).length} run(s) · {state.events.length} events in the store
        </p>
        <p className="mt-1 text-slate-400">
          Stack cap 4 · auto-dismiss 6 s · errors and budget stay · hover or focus the stack to pause.
        </p>
      </section>

      {/* Keyed so a restart resets the cursor and the stack, exactly like a fresh tab. */}
      <ToastHost key={`${generation}-${speed}`} state={state} budgetUsd={0.04} />
    </main>
  );
}
