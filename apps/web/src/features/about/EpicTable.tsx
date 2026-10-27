import { formatCount, formatDuration, formatSigned, handbackLabel } from './format';
import type { EpicStats } from './types';

function statusClasses(status: string, inFlight: boolean): string {
  if (inFlight) return 'text-status-running';
  if (status === 'complete') return 'text-status-merged';
  if (status === 'partial') return 'text-status-auditing';
  return 'text-ink-4';
}

/**
 * The receipts: one row per epic, exactly the data the timeline draws.
 *
 * This is a real `<table>` on purpose. It is the accessible alternative to the SVG (screen readers
 * and colour-blind readers get the numbers from text), and it makes the page useful when printed or
 * screenshotted for a slide.
 */
export function EpicTable({ epics }: { epics: EpicStats[] }) {
  if (epics.length === 0) {
    return (
      <section
        aria-labelledby="about-table-heading"
        className="rounded-xl border border-hairline bg-panel p-4"
      >
        <h2 id="about-table-heading" className="text-heading font-semibold text-ink-1">
          Every epic
        </h2>
        <p className="mt-1 text-caption text-ink-3" data-testid="about-table-empty">
          Nothing collected yet.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="about-table-heading" className="rounded-xl border border-hairline bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 pt-3">
        <h2 id="about-table-heading" className="text-heading font-semibold text-ink-1">
          Every epic, as merged
        </h2>
        <p className="text-micro text-ink-4">
          Lines and commits are each epic&apos;s own; file touches can overlap.
        </p>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table
          className="w-full min-w-[46rem] border-collapse text-left text-caption"
          data-testid="about-epic-table"
        >
          <caption className="sr-only">
            Per-epic statistics: wave, pull request, commits, lines changed, test files added, duration and
            handback status.
          </caption>
          <thead>
            <tr className="border-y border-hairline text-micro uppercase tracking-[0.12em] text-ink-4">
              <th scope="col" className="px-3 py-2 font-medium">
                Epic
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Wave
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                PR
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Commits
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Lines
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Tests
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Duration
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Handback
              </th>
            </tr>
          </thead>
          <tbody>
            {epics.map((epic) => {
              const inFlight = epic.mergedAt === undefined;
              return (
                <tr
                  key={epic.number}
                  data-testid={`about-epic-${epic.number}`}
                  className="border-b border-hairline/60 last:border-b-0"
                >
                  <th scope="row" className="max-w-[22rem] px-3 py-1.5 font-normal">
                    <span className="font-mono text-micro text-ink-4">#{epic.number}</span>{' '}
                    <span className="text-ink-1">{epic.title}</span>
                    <span className="block truncate font-mono text-micro text-ink-4">
                      {epic.lane ?? epic.slug}
                    </span>
                  </th>
                  <td className="px-2 py-1.5 text-ink-3">{epic.wave === 'c1' ? 'C1' : epic.wave}</td>
                  <td className="px-2 py-1.5">
                    {epic.prUrl === undefined ? (
                      <span className="text-ink-4">—</span>
                    ) : (
                      <a
                        href={epic.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-status-ready underline-offset-2 hover:underline"
                      >
                        #{epic.pr}
                      </a>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">
                    {formatCount(epic.commits)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">
                    <span className="text-status-merged">{formatSigned(epic.added)}</span>{' '}
                    <span className="text-status-failed">{formatSigned(-epic.removed)}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">
                    {formatCount(epic.testsAdded)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-3">
                    {inFlight ? 'in flight' : formatDuration(epic.durationMs)}
                  </td>
                  <td className={`px-3 py-1.5 ${statusClasses(epic.handbackStatus, inFlight)}`}>
                    {handbackLabel(epic.handbackStatus, inFlight)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
