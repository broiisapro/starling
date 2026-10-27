import { BigNumbers } from './BigNumbers';
import { EpicTable } from './EpicTable';
import { formatCount, formatHours } from './format';
import { SourceNotes } from './SourceNotes';
import { swarmStory } from './story';
import type { AboutPageProps } from './types';
import { WaveTimeline } from './WaveTimeline';

/**
 * "Built by the flock" — the stats page.
 *
 * Props-only (no store, no fetching): the shell decides where `stats` comes from. Today the data is
 * `tools/stats/out/stats.json`, produced by `bun tools/stats/collect.ts`; the landing site (Epic 59)
 * reads the same JSON from `site/data/stats.json`.
 *
 * Layout: the three-sentence story, five big numbers, the swim-lane timeline, the per-epic table
 * that backs it, and an honest provenance footer.
 */
export function AboutPage({ stats }: AboutPageProps) {
  const story = swarmStory(stats);
  const peak = stats.totals.peakConcurrentAgents;

  return (
    <main
      aria-labelledby="about-title"
      data-testid="about-page"
      className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 text-body text-ink-1"
    >
      <header className="rounded-xl border border-hairline bg-panel px-4 py-4 shadow-[0_18px_48px_-28px_rgba(0,0,0,0.9)]">
        <p className="text-micro uppercase tracking-[0.2em] text-ink-3">Built by the flock</p>
        <h1 id="about-title" className="mt-1 text-hero font-semibold tracking-tight text-ink-1">
          {peak >= 2 ? `One person, ${formatCount(peak)} agents` : 'One person, one flock'}
        </h1>
        <p className="mt-2 max-w-3xl text-caption leading-relaxed text-ink-2" data-testid="about-story">
          {story.join(' ')}
        </p>
        <p className="mt-2 text-micro text-ink-4">
          {formatCount(stats.totals.epicsObserved)} epics across {formatCount(stats.totals.waves)} waves ·{' '}
          {formatHours(stats.totals.agentHours * 3_600_000)} of agent time · every number read from the repo
          itself.
        </p>
      </header>

      <BigNumbers totals={stats.totals} />
      <WaveTimeline stats={stats} />
      <EpicTable epics={stats.epics} />
      <SourceNotes stats={stats} />
    </main>
  );
}
