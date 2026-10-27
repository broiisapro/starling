import type { AuditVerdict } from '@starling/core';
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { checkDuration, sortVerdicts, splitFixInstructions } from './audit';
import { formatClock, formatDuration } from './format';

function VerdictCard({ verdict }: { verdict: AuditVerdict }) {
  const steps = splitFixInstructions(verdict.fixInstructions);
  const model = `${verdict.model.provider}/${verdict.model.model}`;

  return (
    <article
      className="rounded-lg border border-slate-800 bg-slate-900/50"
      data-testid={`verdict-attempt-${verdict.attempt}`}
      data-pass={verdict.pass ? 'true' : 'false'}
    >
      <header
        className={`flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b px-3 py-2 ${
          verdict.pass
            ? 'border-emerald-900/70 bg-emerald-950/40 text-emerald-200'
            : 'border-rose-900/70 bg-rose-950/40 text-rose-200'
        }`}
      >
        <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
          {verdict.pass ? (
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
          ) : (
            <XCircle aria-hidden="true" className="h-4 w-4" />
          )}
          {verdict.pass ? 'Passed' : 'Failed'} · attempt {verdict.attempt}
        </p>
        <p className="text-[10px] text-slate-400">
          {model} · {formatClock(verdict.ts)}
        </p>
      </header>

      <div className="space-y-3 px-3 py-2.5">
        <p className="text-[12px] leading-relaxed text-slate-300">{verdict.summary}</p>

        {verdict.checks.length > 0 ? (
          <table
            className="w-full table-fixed text-left text-[11px]"
            data-testid={`checks-table-${verdict.attempt}`}
          >
            <thead className="text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-[24%] pb-1 font-medium">check</th>
                <th className="w-[8%] pb-1 font-medium">ok</th>
                <th className="pb-1 font-medium">detail</th>
                <th className="w-[12%] pb-1 text-right font-medium">duration</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {verdict.checks.map((check) => (
                <tr key={check.name} className="border-t border-slate-800/80">
                  <td className="py-1 pr-2 font-mono text-slate-300">{check.name}</td>
                  <td className="py-1">
                    {check.ok ? (
                      <CheckCircle2 aria-label="ok" className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <XCircle aria-label="not ok" className="h-3.5 w-3.5 text-rose-400" />
                    )}
                  </td>
                  <td className="break-words py-1 pr-2 text-slate-400">{check.detail}</td>
                  <td className="py-1 text-right font-mono text-slate-500">
                    {formatDuration(checkDuration(check))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {verdict.laneViolations.length > 0 ? (
          <div
            className="rounded-md border border-yellow-800/70 bg-yellow-950/30 px-2 py-1.5"
            data-testid="lane-violations"
          >
            <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-300">
              <AlertTriangle aria-hidden="true" className="h-3 w-3" />
              Lane violations
            </p>
            <ul className="mt-1 list-inside list-disc font-mono text-[11px] text-yellow-200">
              {verdict.laneViolations.map((file) => (
                <li key={file} className="break-all">
                  {file}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {steps.length > 0 ? (
          <div data-testid="fix-instructions">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">How to fix</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-slate-300">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** One card per audit attempt, newest first. Read-only: the fixer prompt is the engine's job. */
export function AuditTab({ verdicts }: { verdicts: AuditVerdict[] }) {
  const ordered = sortVerdicts(verdicts);

  if (ordered.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-slate-500">
        No audit yet — the flock is still reviewing. 🪶
      </p>
    );
  }

  return (
    <div className="space-y-3 p-3" data-testid="audit-tab">
      {ordered.map((verdict) => (
        <VerdictCard key={`${verdict.attempt}-${verdict.ts}`} verdict={verdict} />
      ))}
      <p className="flex items-center justify-end gap-1 text-[10px] text-slate-600">
        <ShieldCheck aria-hidden="true" className="h-3 w-3" />
        {ordered.length} audit {ordered.length === 1 ? 'attempt' : 'attempts'}
      </p>
    </div>
  );
}
