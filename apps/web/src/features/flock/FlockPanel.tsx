import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { CompactFlock } from './CompactFlock';
import { EmptyFlock } from './EmptyFlock';
import { isHub, sessionTotals, sortRoosts } from './format';
import { JoinCard } from './JoinCard';
import { RoostCard } from './RoostCard';
import type { FlockPanelAllProps } from './types';
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
  now = Date.now(),
  onSelectTask,
}: FlockPanelAllProps) {
  const roosts = useMemo(() => sortRoosts(nodes), [nodes]);
  const { entries } = usePresence(roosts, reducedMotion);
  const totals = sessionTotals(roosts);
  const firstRoost = roosts[0];
  const onlyHub = roosts.length === 1 && firstRoost !== undefined && isHub(firstRoost);

  if (compact) {
    return (
      <CompactFlock entries={entries} tasks={tasks} join={join} now={now} reducedMotion={reducedMotion} />
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-300/80">flock</p>
          <h2 className="mt-0.5 text-base font-semibold tracking-tight text-slate-50">Roosts in the sky</h2>
          <p data-testid="flock-summary" className="mt-0.5 text-[11px] text-slate-400">
            {roosts.length} {roosts.length === 1 ? 'roost' : 'roosts'} · {totals.active}/{totals.max} sessions
            busy · {totals.free} free
          </p>
        </div>
        {join ? (
          <a
            href="#flock-join"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:border-sky-300/40 hover:bg-sky-400/10 hover:text-sky-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            Add a laptop
          </a>
        ) : null}
      </header>

      {onlyHub ? (
        <div className="mt-3">
          <EmptyFlock />
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map(({ node, leaving }) => (
          <RoostCard
            key={node.id}
            node={node}
            tasks={tasks}
            now={now}
            reducedMotion={reducedMotion}
            leaving={leaving}
            onSelectTask={onSelectTask}
          />
        ))}
        <JoinCard join={join} />
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2.5 text-[10px] text-slate-500">
        <span>Every roost runs its own opencode; audits and merges always land on the hub.</span>
        <span className="font-mono">
          {totals.free > 0 ? `${totals.free} free slots` : 'flock at capacity'}
        </span>
      </footer>
    </section>
  );
}
