import { Plus } from 'lucide-react';
import { useId, useMemo } from 'react';
import { CompactFlock } from './CompactFlock';
import { EmptyFlock } from './EmptyFlock';
import { isHub, sessionTotals, sortRoosts } from './format';
import { JoinCard } from './JoinCard';
import { RoostCard } from './RoostCard';
import type { FlockPanelAllProps } from './types';
import { useNow } from './use-now';
import { usePresence } from './use-presence';

/**
 * The flock panel: every machine in the swarm, the on-ramp for the next one.
 *
 * Props-only by contract (ARCHITECTURE §8) — it never reads the store, never fetches. The shell
 * passes `nodes`, `join` and `tasks`; this component derives presentation only.
 */
export function FlockPanel({
  nodes,
  join,
  tasks,
  compact = false,
  reducedMotion = false,
  now,
  onSelectTask,
}: FlockPanelAllProps) {
  const roosts = useMemo(() => sortRoosts(nodes), [nodes]);
  const { entries } = usePresence(roosts, reducedMotion);
  const clock = useNow(now);
  const totals = sessionTotals(roosts);
  const reactId = useId();
  // Two panels may be on screen (full + compact); keep the join anchors unique and selector-safe.
  const anchorId = `flock-join-${reactId.replace(/[^a-zA-Z0-9_-]/g, '') || 'panel'}`;
  const firstRoost = roosts[0];
  const onlyHub = roosts.length === 1 && firstRoost !== undefined && isHub(firstRoost);

  if (compact) {
    return (
      <CompactFlock
        entries={entries}
        tasks={tasks}
        join={join}
        now={clock}
        reducedMotion={reducedMotion}
        onSelectTask={onSelectTask}
      />
    );
  }

  return (
    <section
      data-testid="flock-panel"
      data-compact="false"
      data-node-count={roosts.length}
      aria-label="The flock"
      className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-slate-100 shadow-[0_24px_80px_-48px_rgba(14,165,233,0.35)] backdrop-blur-sm"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-sky-300/80">flock</p>
          <h2 className="mt-0.5 text-base font-semibold tracking-tight text-slate-50">Roosts in the sky</h2>
          <p data-testid="flock-summary" className="mt-0.5 text-[12px] tabular-nums text-slate-300">
            {roosts.length} {roosts.length === 1 ? 'roost' : 'roosts'} · {totals.active}/{totals.max} sessions
            busy · {totals.free} free
          </p>
        </div>
        {join ? (
          <a
            href={`#${anchorId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[12px] font-medium text-slate-100 transition-colors hover:border-sky-300/40 hover:bg-sky-400/10 hover:text-sky-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            Add a laptop
          </a>
        ) : null}
      </header>

      {onlyHub && join ? (
        <div className="mt-3">
          <EmptyFlock anchorId={anchorId} />
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map(({ node, leaving }) => (
          <RoostCard
            key={node.id}
            node={node}
            tasks={tasks}
            now={clock}
            reducedMotion={reducedMotion}
            leaving={leaving}
            onSelectTask={onSelectTask}
          />
        ))}
        <JoinCard join={join} anchorId={anchorId} nodeCount={roosts.length} />
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2.5 text-[12px] text-slate-400">
        <span>Every roost runs its own opencode; audits and merges always land on the hub.</span>
        <span className="font-mono tabular-nums">
          {totals.free > 0 ? `${totals.free} free slots` : 'flock at capacity'}
        </span>
      </footer>
    </section>
  );
}
