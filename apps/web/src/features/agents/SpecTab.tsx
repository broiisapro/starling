import type { AuditVerdict, TaskSpec } from '@starling/core';
import { Ban } from 'lucide-react';
import type { ReactNode } from 'react';
import { dodChecklist, dodEvidence } from './spec';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

/** The task spec, exactly as the planner wrote it. Read-only by design. */
export function SpecTab({ task, verdict }: { task?: TaskSpec; verdict?: AuditVerdict }) {
  if (!task) {
    return <p className="p-6 text-center text-sm text-slate-500">No task spec to show.</p>;
  }

  const checklist = dodChecklist(task.definitionOfDone, verdict);
  const evidence = dodEvidence(verdict);

  return (
    <div className="space-y-5 p-3" data-testid="spec-tab">
      <Section title="Goal">
        <p className="text-[12px] leading-relaxed text-slate-200">{task.goal}</p>
      </Section>

      <Section title="Deliverables">
        <ul className="space-y-1">
          {task.deliverables.map((item) => (
            <li key={item} className="flex gap-2 text-[12px] leading-relaxed text-slate-300">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sky-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      {task.outOfScope.length > 0 ? (
        <Section title="Out of scope">
          <ul className="space-y-1">
            {task.outOfScope.map((item) => (
              <li key={item} className="flex gap-2 text-[12px] leading-relaxed text-slate-400">
                <Ban aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Definition of done">
        {evidence ? (
          <p className="text-[10px] leading-relaxed text-slate-500" data-testid="dod-evidence">
            Evidence from attempt {verdict?.attempt}: {evidence}
          </p>
        ) : null}
        <ul className="space-y-1" data-testid="dod-list">
          {checklist.map((entry) => (
            <li key={entry.item} className="flex items-start gap-2 text-[12px] leading-relaxed">
              <input
                type="checkbox"
                checked={entry.done}
                readOnly
                aria-label={entry.item}
                data-checked={entry.done ? 'true' : 'false'}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-500"
              />
              <span className={entry.done ? 'text-slate-200' : 'text-slate-400'}>{entry.item}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Lane">
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            <span className="text-[10px] uppercase tracking-wide text-emerald-400/80">owns</span>
            {task.lane.owns.map((glob) => (
              <code
                key={glob}
                className="rounded bg-slate-800/80 px-1 py-0.5 font-mono text-[10px] text-emerald-200"
              >
                {glob}
              </code>
            ))}
          </div>
          {task.lane.reads.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">reads</span>
              {task.lane.reads.map((glob) => (
                <code
                  key={glob}
                  className="rounded bg-slate-900 px-1 py-0.5 font-mono text-[10px] text-slate-400"
                >
                  {glob}
                </code>
              ))}
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
