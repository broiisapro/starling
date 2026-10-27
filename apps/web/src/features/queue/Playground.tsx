import { useMemo, useState } from 'react';

// The recorded launch-day run, inlined by Vite (`?raw`). Same file the shell's demo mode replays.
import raw from '../../../../../fixtures/runs/sky-todo-launch-day.jsonl?raw';

import { parseEventLines } from '../../lib/events';
import { MergeQueue } from './MergeQueue';
import { replayQueue } from './replay';

// Local envelope guard, not core's zod schema: a runtime import from `@starling/core` would pull
// its config loader (and `node:fs`) into the browser bundle. See `src/lib/events.ts`.
const EVENTS = parseEventLines(raw).events;

/**
 * Fixture-driven playground for the queue board. Not wired into the dashboard shell (Epic 23 owns
 * routing); run `bun run dev:web` and mount `<Playground />` from `src/main.tsx` to poke at it.
 */
export function Playground() {
  const [index, setIndex] = useState(EVENTS.length - 1);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const board = useMemo(() => replayQueue(EVENTS, index), [index]);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-200">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold text-slate-100">Merge queue · playground</h1>
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            Event
            <input
              type="range"
              min={0}
              max={EVENTS.length - 1}
              value={index}
              onChange={(event) => setIndex(Number(event.target.value))}
              className="w-56 accent-sky-400"
            />
            <span className="w-16 tabular-nums">
              {index + 1}/{EVENTS.length}
            </span>
          </label>
        </header>
        <MergeQueue
          plan={board.plan}
          tasks={board.tasks}
          merges={board.merges}
          onSelectTask={(key) => setSelected(key)}
        />
        <p className="text-[11px] text-slate-500">
          Selected task: <span className="font-mono text-slate-300">{selected ?? 'none'}</span>
        </p>
      </div>
    </main>
  );
}

export default Playground;
