import type { AuditVerdict, TaskSpec } from '@starling/core';
import { Ban } from 'lucide-react';
import type { ReactNode } from 'react';
import { dodChecklist, dodEvidence } from './spec';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-300">{title}</h3>
      {children}
    </section>
  );
}

/** The task spec, exactly as the planner wrote it. Read-only by design. */
export function SpecTab({ task, verdict }: { task?: TaskSpec; verdict?: AuditVerdict }) {
  if (!task) {
    return <p className="p-6 text-center text-sm text-slate-400">No task spec to show.</p>;
  }

  const checklist = dodChecklist(task.definitionOfDone, verdict);
  const evidence = dodEvidence(verdict);

  return (
    <div className="space-y-5 p-3" data-testid="spec-tab">
      <Section title="Goal">
        <p className="text-sm leading-relaxed text-slate-200">{task.goal}</p>
      </Section>

      <Section title="Deliverables">
        <ul className="space-y-1">
          {task.deliverables.map((item) => (
            <li key={item} className="flex gap-2 text-sm leading-relaxed text-slate-200">
              <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-sky-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      {task.outOfScope.length > 0 ? (
        <Section title="Out of scope">
          <ul className="space-y-1">
            {task.outOfScope.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-relaxed text-slate-300">
                <Ban aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Definition of done">
        {evidence ? (
          <p className="text-[12px] leading-relaxed text-slate-300" data-testid="dod-evidence">
            Evidence from attempt {verdict?.attempt}: {evidence}
          </p>
        ) : null}
        <ul className="space-y-1" data-testid="dod-list">
          {checklist.map((entry) => (
            <li key={entry.item} className="flex items-start gap-2 text-sm leading-relaxed">
              <input
                type="checkbox"
                checked={entry.done}
                readOnly
                aria-label={entry.item}
                data-checked={entry.done ? 'true' : 'false'}
                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
              />
              <span className={entry.done ? 'text-slate-100' : 'text-slate-300'}>
                {entry.item}
                {entry.evidence ? (
                  <span
                    className="mt-0.5 block text-[12px] leading-relaxed text-slate-300"
                    data-testid="dod-item-evidence"
                  >
                    {entry.evidence}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Lane">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[12px] uppercase tracking-wide text-emerald-300">owns</span>
            {task.lane.owns.map((glob) => (
              <code
                key={glob}
                className="rounded bg-slate-800/80 px-1 py-0.5 font-mono text-[12px] text-emerald-200"
              >
                {glob}
              </code>
            ))}
          </div>
          {task.lane.reads.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[12px] uppercase tracking-wide text-slate-400">reads</span>
              {task.lane.reads.map((glob) => (
                <code
                  key={glob}
                  className="rounded bg-slate-900 px-1 py-0.5 font-mono text-[12px] text-slate-300"
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
