import { formatCount, formatHours, formatSigned } from './format';
import type { SwarmTotals } from './types';

interface Tile {
  testId: string;
  label: string;
  value: string;
  detail: string;
}

/**
 * The five big numbers: epics, agents, PRs, tests, hours.
 *
 * Values are `dd`/`dt` pairs so screen readers announce "Epics merged, 28" rather than reading five
 * unrelated numbers. Tiles are static — nothing counts up on scroll, so reduced motion has nothing
 * to disable.
 */
export function BigNumbers({ totals }: { totals: SwarmTotals }) {
  const tiles: Tile[] = [
    {
      testId: 'about-stat-epics',
      label: 'Epics merged',
      value: formatCount(totals.epics),
      detail: `${formatCount(totals.inFlight)} still in flight`,
    },
    {
      testId: 'about-stat-agents',
      label: 'Agents at peak',
      value: formatCount(totals.peakConcurrentAgents),
      detail: `${formatCount(totals.agentSessions)} sessions · ${formatHours(totals.agentHours * 3_600_000)} agent time`,
    },
    {
      testId: 'about-stat-prs',
      label: 'Pull requests',
      value: formatCount(totals.prs),
      detail: `${formatSigned(totals.added)} / ${formatSigned(-totals.removed)} lines`,
    },
    {
      testId: 'about-stat-tests',
      label: 'Tests green',
      value: formatCount(totals.tests),
      detail: `${formatCount(totals.testFiles)} files · ${formatCount(totals.testsAdded)} added by epics`,
    },
    {
      testId: 'about-stat-hours',
      label: 'Wall clock',
      value: formatHours(totals.wallTimeMs),
      detail: `${formatCount(totals.waves)} waves · ${formatCount(totals.commits)} commits`,
    },
  ];

  return (
    <section aria-labelledby="about-numbers-title">
      <h2 id="about-numbers-title" className="sr-only">
        By the numbers
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div
            key={tile.testId}
            data-testid={tile.testId}
            className="rounded-xl border border-hairline bg-panel px-3 py-3 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]"
          >
            <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">{tile.label}</dt>
            <dd className="mt-1">
              <span className="block text-title font-semibold tabular-nums text-ink-1">{tile.value}</span>
              <span className="block text-micro leading-snug text-ink-4">{tile.detail}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
