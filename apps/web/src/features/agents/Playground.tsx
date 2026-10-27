import type { AgentEvent, DiffSummary } from '@starling/core';
import { useMemo, useState } from 'react';
import runJsonl from '../../../../../fixtures/runs/sky-todo-launch-day.jsonl?raw';
import { parseRunJsonl } from '../dag/run-jsonl';
import { AgentDrawer } from './AgentDrawer';

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The recorded run carries `file.edited` events but no `DiffSummary` (that lands with the store), so
 * the playground builds a summary from the edits and a clearly illustrative patch body for each file.
 */
function diffFromEvents(events: AgentEvent[]): DiffSummary {
  const files = new Map<string, { added: number; removed: number }>();
  for (const event of events) {
    if (event.kind !== 'file.edited') continue;
    const path = asString(event.data.path) ?? 'unknown';
    const current = files.get(path) ?? { added: 0, removed: 0 };
    files.set(path, {
      added: current.added + asNumber(event.data.added),
      removed: current.removed + asNumber(event.data.removed),
    });
  }

  const entries = [...files].map(([path, counts]) => ({ path, ...counts }));
  const patch = entries
    .map((file) =>
      [
        `diff --git a/${file.path} b/${file.path}`,
        `--- a/${file.path}`,
        `+++ b/${file.path}`,
        `@@ -1,2 +1,2 @@`,
        `-// before (illustrative: the fixture records counts, not hunks)`,
        `+// after (illustrative)`,
      ].join('\n'),
    )
    .join('\n');

  return { files: entries, patch, truncated: false };
}

/** Dev playground for the drawer. Vite only: `/src/features/agents/playground.html`. */
export default function Playground() {
  const slice = useMemo(() => parseRunJsonl(runJsonl), []);
  const [selected, setSelected] = useState('theme');
  const [open, setOpen] = useState(true);

  const task = slice.plan?.tasks.find((entry) => entry.key === selected);
  const events = useMemo(
    () => slice.events.filter((event) => event.taskKey === selected),
    [slice.events, selected],
  );
  const verdicts = useMemo(
    () => slice.verdicts.filter((verdict) => verdict.taskKey === selected),
    [slice.verdicts, selected],
  );
  const diff = useMemo(() => diffFromEvents(events), [events]);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-200">
      <div className={open ? 'max-w-[calc(100vw-600px)]' : 'max-w-4xl'}>
        <header className="mb-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-sky-400">
            Starling · agent drawer playground
          </p>
          <h1 className="mt-1 text-xl font-semibold">Everything about one task</h1>
          <p className="mt-1 text-sm text-slate-300">
            Recorded launch-day run. Pick a task, then switch between Activity, Audit, Diff and Spec. File
            chips in Activity jump to the matching diff; repeated tool calls collapse into one row. Press Esc
            or the ✕ to close. (The recording predates per-item DoD evidence, so the Audit checklist appears
            when an auditor supplies <code className="font-mono text-[12px]">verdict.dod</code>.)
          </p>
          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-3 rounded-md border border-sky-600 bg-sky-950 px-3 py-1 text-sm text-sky-200 hover:bg-sky-900"
            >
              Open drawer
            </button>
          ) : null}
        </header>

        <div className="grid gap-2 sm:grid-cols-2">
          {slice.plan?.tasks.map((entry) => {
            const run = slice.tasks[entry.key];
            const active = entry.key === selected;
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => {
                  setSelected(entry.key);
                  setOpen(true);
                }}
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  active
                    ? 'border-sky-500 bg-sky-950/60'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
                }`}
              >
                <p className="font-mono text-[12px] text-sky-300">{entry.key}</p>
                <p className="truncate text-slate-200">{entry.title}</p>
                <p className="mt-0.5 text-[12px] text-slate-400">
                  {run?.status ?? 'pending'} · {run?.attempts ?? 0} attempt(s) · {run?.nodeId ?? 'unassigned'}
                </p>
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-[12px] text-slate-400">
          {events.length} activity events · {verdicts.length} audit verdict(s) · {diff.files.length} edited
          file(s)
        </p>
      </div>

      {open ? (
        <AgentDrawer
          task={task}
          run={slice.tasks[selected]}
          events={events}
          verdicts={verdicts}
          diff={diff}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </main>
  );
}
