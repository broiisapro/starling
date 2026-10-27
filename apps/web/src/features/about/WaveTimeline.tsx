import { useMemo } from 'react';

import { formatDuration, formatTimestamp } from './format';
import { shortTitle, TIMELINE_BOTTOM, TIMELINE_TOP, timelineLayout, waveLabel } from './timeline';
import type { SwarmStats } from './types';

const LABEL_INSIDE_MIN_WIDTH = 128;

/**
 * The timeline: one horizontal lane per wave, one bar per epic from start to merge.
 *
 * The SVG is decorative-by-necessity (a chart), so it carries a `title`/`desc` summary and the
 * exact same data is rendered as a real table by `EpicTable` immediately below — colour and
 * position are never the only way to read a number.
 */
export function WaveTimeline({ stats }: { stats: SwarmStats }) {
  const layout = useMemo(() => timelineLayout(stats), [stats]);

  if (stats.epics.length === 0) {
    return (
      <section
        aria-labelledby="about-timeline-heading"
        className="rounded-xl border border-hairline bg-panel p-4"
      >
        <h2 id="about-timeline-heading" className="text-heading font-semibold text-ink-1">
          Waves, as swim lanes
        </h2>
        <p className="mt-1 text-caption text-ink-3" data-testid="about-timeline-empty">
          No epics to chart yet. Run <code className="font-mono text-ink-2">bun tools/stats/collect.ts</code>{' '}
          and reload.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="about-timeline-heading"
      className="rounded-xl border border-hairline bg-panel p-3"
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
        <div>
          <h2 id="about-timeline-heading" className="text-heading font-semibold text-ink-1">
            Waves, as swim lanes
          </h2>
          <p className="text-micro text-ink-3">
            Each bar is one epic, from its first commit (or agent start) to its merge.
          </p>
        </div>
        <p className="flex items-center gap-3 text-micro text-ink-4">
          <span className="inline-flex items-center gap-1.5">
            <svg width="14" height="8" aria-hidden="true" focusable="false">
              <rect width="14" height="8" rx="2" fill="var(--color-irid-teal)" />
            </svg>
            merged
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="14" height="8" aria-hidden="true" focusable="false">
              <rect
                x="0.6"
                y="0.6"
                width="12.8"
                height="6.8"
                rx="2"
                fill="none"
                stroke="var(--color-irid-teal)"
              />
            </svg>
            in flight
          </span>
        </p>
      </header>

      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-labelledby="about-timeline-title about-timeline-desc"
        data-testid="about-timeline"
        className="h-auto w-full"
      >
        <title id="about-timeline-title">
          Timeline of {stats.epics.length} epics across {stats.waves.length} waves
        </title>
        <desc id="about-timeline-desc">
          One lane per wave; each bar runs from an epic&apos;s first commit to its merge, or to the moment
          these stats were generated while it is still in flight. The same data is listed in the epic table
          below.
        </desc>

        {layout.rows.map((row, rowIndex) => (
          <g key={row.wave} data-wave={row.wave} data-testid={`about-timeline-wave-${row.wave}`}>
            <rect
              x="0"
              y={row.y - 4}
              width={layout.width}
              height={row.height + 8}
              rx="6"
              fill="var(--surface-2)"
              opacity={rowIndex % 2 === 0 ? 0.5 : 0.22}
            />
            <text x="12" y={row.y + 12} fontSize="11" fontWeight="600" fill="var(--ink-1)">
              {row.label}
            </text>
            <text x="12" y={row.y + 26} fontSize="9.5" fill="var(--ink-4)">
              {row.merged} merged
              {row.wallTimeMs === undefined ? '' : ` · ${formatDuration(row.wallTimeMs)}`}
            </text>
          </g>
        ))}

        {layout.ticks.map((tick) => (
          <g key={tick.ms}>
            <line
              x1={tick.x}
              y1={TIMELINE_TOP - 6}
              x2={tick.x}
              y2={layout.height - TIMELINE_BOTTOM}
              stroke="var(--hairline)"
              strokeDasharray="2 4"
            />
            <text
              x={tick.x}
              y={layout.height - 8}
              fontSize="9.5"
              fill="var(--ink-4)"
              textAnchor={
                tick.x <= layout.plotLeft + 1 ? 'start' : tick.x >= layout.plotRight - 1 ? 'end' : 'middle'
              }
            >
              {tick.label}
            </text>
          </g>
        ))}

        {layout.bars.map((bar) => {
          const label = `${bar.epic.number} ${shortTitle(bar.epic.title, 34)}`;
          const inside = bar.width >= LABEL_INSIDE_MIN_WIDTH;
          const detail = [
            `#${bar.epic.number} ${bar.epic.title}`,
            waveLabel(bar.wave),
            `${formatTimestamp(bar.epic.startedAt)} → ${bar.inFlight ? 'in flight' : formatTimestamp(bar.epic.mergedAt)}`,
            formatDuration(bar.epic.durationMs),
            bar.epic.pr === undefined ? undefined : `PR #${bar.epic.pr}`,
          ]
            .filter((part) => part !== undefined && part !== '—')
            .join(' · ');

          return (
            <g key={`${bar.wave}-${bar.epic.number}`} data-epic={bar.epic.number}>
              <title>{detail}</title>
              <rect
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx="3"
                fill={bar.inFlight ? 'none' : bar.color}
                stroke={bar.color}
                strokeWidth={bar.inFlight ? 1.2 : 0}
                opacity={bar.inFlight ? 0.85 : 0.82}
              />
              <text
                x={inside ? bar.x + 6 : bar.x + bar.width + 5}
                y={bar.y + bar.height - 3.5}
                fontSize="9.5"
                fill={inside ? 'var(--surface-0)' : 'var(--ink-2)'}
                style={{ pointerEvents: 'none' }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
