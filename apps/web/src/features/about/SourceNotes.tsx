import { formatTimestamp } from './format';
import type { SwarmStats } from './types';

const SOURCE_LABELS: Record<keyof SwarmStats['sources'], string> = {
  git: 'git history',
  gh: 'GitHub pull requests',
  epics: '.orchestrator/epics.tsv',
  handbacks: 'handbacks',
  logs: 'agent logs',
};

/**
 * Provenance footer: what was read, what was missing, what the collector had to work around.
 *
 * A stats page that silently drops a source is a stats page that lies; every degraded source is
 * named here, and the raw notes from the collector are listed verbatim.
 */
export function SourceNotes({ stats }: { stats: SwarmStats }) {
  const missing = (Object.keys(SOURCE_LABELS) as (keyof SwarmStats['sources'])[]).filter(
    (key) => !stats.sources[key],
  );

  return (
    <footer
      data-testid="about-sources"
      className="rounded-xl border border-hairline bg-panel px-3 py-2.5 text-micro text-ink-4"
    >
      <p>
        Generated {formatTimestamp(stats.generatedAt)} at commit{' '}
        <span className="font-mono text-ink-3">{stats.repo.head ?? '—'}</span> from git history, merged pull
        requests, <span className="font-mono">.orchestrator/epics.tsv</span>, the handbacks and the
        orchestrator agent logs.
      </p>
      {missing.length > 0 ? (
        <p className="mt-1 text-status-auditing">
          Unavailable this run: {missing.map((key) => SOURCE_LABELS[key]).join(', ')} — those numbers degrade
          gracefully rather than disappear.
        </p>
      ) : null}
      {stats.notes.length > 0 ? (
        <ul className="mt-1 list-inside list-disc">
          {stats.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1">
        Machine-readable copy: <span className="font-mono text-ink-3">tools/stats/out/stats.json</span>.
      </p>
    </footer>
  );
}
