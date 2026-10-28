import { Check, X } from 'lucide-react';
import { Badge, EmptyState } from '../../components';
import type { NotableVerdict } from './types';
import { verdictHeadline, verdictModel } from './verdicts';

export interface VerdictCardsProps {
  verdicts: NotableVerdict[];
  onSelectTask?(key: string): void;
}

/**
 * Where the auditor pushed back. Each card is one failing (or lane-flagged) attempt, with the later
 * passing attempt named in the headline, the per-check verdicts and the reviewer's model — the receipt
 * a judge can audit.
 */
export function VerdictCards({ verdicts, onSelectTask }: VerdictCardsProps) {
  return (
    <section
      data-testid="report-verdicts"
      aria-labelledby="report-verdicts-title"
      className="rounded-[var(--radius-panel)] border border-hairline bg-panel px-4 py-4 print:break-inside-avoid print:border-slate-300 print:bg-white print:text-slate-900"
    >
      <h2 id="report-verdicts-title" className="text-heading font-semibold text-ink-1 print:text-slate-900">
        Where the auditor pushed back
      </h2>
      <p className="mt-0.5 text-caption text-ink-3 print:text-slate-600">
        Failed attempts, lane violations and fix instructions. Clean first-time passes are omitted.
      </p>

      {verdicts.length === 0 ? (
        <EmptyState
          compact
          title="No pushback recorded"
          description="Either every audit passed first time, or the run has not been audited yet."
        />
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {verdicts.map((verdict) => {
            const tone = verdict.pass ? 'warn' : verdict.resolvedBy === undefined ? 'danger' : 'neutral';
            return (
              <li
                key={`${verdict.taskKey}-${verdict.attempt}`}
                data-testid={`report-verdict-${verdict.taskKey}-${verdict.attempt}`}
                className="rounded-lg border border-hairline bg-surface-2/40 px-3 py-2 print:border-slate-300 print:bg-white"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-body font-medium text-ink-1 print:text-slate-900">
                    {verdictHeadline(verdict)}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={tone}>
                      {verdict.resolvedBy === undefined
                        ? verdict.pass
                          ? 'flagged'
                          : 'unresolved'
                        : `fixed on attempt ${verdict.resolvedBy}`}
                    </Badge>
                    <span className="text-micro text-ink-4 print:text-slate-500">
                      {verdictModel(verdict)}
                    </span>
                  </div>
                </div>

                <p className="mt-1 text-caption text-ink-2 print:text-slate-700">{verdict.summary}</p>

                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {verdict.checks.map((check) => (
                    <li
                      key={check.name}
                      className="flex items-start gap-1.5 text-micro text-ink-3 print:text-slate-600"
                    >
                      {check.ok ? (
                        <Check
                          aria-hidden
                          className="mt-0.5 h-3 w-3 shrink-0 text-emerald-300 print:text-emerald-700"
                        />
                      ) : (
                        <X
                          aria-hidden
                          className="mt-0.5 h-3 w-3 shrink-0 text-rose-300 print:text-rose-700"
                        />
                      )}
                      <span>
                        <span className="font-mono text-ink-2 print:text-slate-800">{check.name}</span>:{' '}
                        {check.detail}
                      </span>
                    </li>
                  ))}
                </ul>

                {verdict.laneViolations.length > 0 ? (
                  <p className="mt-1 text-micro text-rose-200 print:text-rose-700">
                    Lane violations: {verdict.laneViolations.join(', ')}
                  </p>
                ) : null}

                {verdict.fixInstructions !== undefined && verdict.fixInstructions !== '' ? (
                  <p className="mt-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-micro text-amber-100 print:border-amber-600 print:bg-white print:text-amber-800">
                    Fix asked for: {verdict.fixInstructions}
                  </p>
                ) : null}

                {onSelectTask !== undefined ? (
                  <button
                    type="button"
                    onClick={() => onSelectTask(verdict.taskKey)}
                    className="mt-1.5 text-micro font-medium text-sky-300 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus print:text-sky-800"
                  >
                    Inspect {verdict.taskKey}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
