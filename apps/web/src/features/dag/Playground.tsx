import { useMemo, useState } from 'react';
import runJsonl from '../../../../../fixtures/runs/sky-todo-launch-day.jsonl?raw';
import { DagView } from './DagView';
import { parseRunJsonl } from './run-jsonl';

/**
 * Dev playground for the DAG. Vite only: `/src/features/dag/playground.html`. Uses the recorded
 * launch-day run so the graph has seven tasks, real lanes and a finished status spread.
 */
export default function Playground() {
  const slice = useMemo(() => parseRunJsonl(runJsonl), []);
  const [selected, setSelected] = useState<string | undefined>('theme');
  const task = slice.plan?.tasks.find((entry) => entry.key === selected);
  const run = selected ? slice.tasks[selected] : undefined;

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-200">
      <header className="mb-4">
        <p className="text-[10px] uppercase tracking-[0.2em] text-sky-400">Starling · DAG playground</p>
        <h1 className="mt-1 text-xl font-semibold">Task graph from the recorded launch-day run</h1>
        <p className="mt-1 max-w-2xl text-[12px] text-slate-400">
          Plan {slice.plan?.id ?? '—'} · run {slice.runId ?? '—'} · {slice.plan?.tasks.length ?? 0} tasks.
          Click a card, hover for its lane, or use the arrow keys after focusing the canvas.
        </p>
      </header>

      <div className="h-[70vh] min-h-[420px]">
        <DagView plan={slice.plan} tasks={slice.tasks} selectedTask={selected} onSelectTask={setSelected} />
      </div>

      <section className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-[12px]">
        {task ? (
          <>
            <p className="font-mono text-sky-200">
              {task.key} · {run?.status ?? 'pending'} · {run?.nodeId ?? 'unassigned'}
            </p>
            <p className="mt-1 text-slate-300">{task.title}</p>
            <p className="mt-1 text-slate-500">
              owns {task.lane.owns.join(', ')} · {run?.attempts ?? 0} attempt(s)
            </p>
          </>
        ) : (
          <p className="text-slate-500">Select a task to inspect it.</p>
        )}
      </section>
    </main>
  );
}
