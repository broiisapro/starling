import type { TaskRun } from '@starling/core/browser';
import { Badge, Kbd, Tabs } from '../../components';
import type { SkyState } from '../../data/reducer';
import { activeRunOf, sortedNodes } from '../../data/selectors';
import { cn } from '../../lib/cn';
import { formatUsd } from '../../lib/format';
import { NODE_STATUS_COLORS, STATUS_COLORS } from '../../lib/status';

export type MockView = 'sky' | 'dag';

export interface ShellMockProps {
  state: SkyState;
  /** Which task the mock drawer is showing; the shell keys this off `state.selectedTask`. */
  selectedTask?: string;
  view?: MockView;
  onViewChange?(view: MockView): void;
  /**
   * `false` removes two anchors — Epic 112's views menu and the cost meter — which is exactly the
   * "a region is missing" fallback this playground exists to demonstrate.
   */
  showAllAnchors?: boolean;
}

const VIEW_TABS = [
  { id: 'sky' as const, label: 'Sky' },
  { id: 'dag' as const, label: 'Flight plan' },
];

function TaskChip({ taskKey, task }: { taskKey: string; task: TaskRun }) {
  const palette = STATUS_COLORS[task.status];
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-caption',
        palette.border,
        palette.bg,
      )}
    >
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', palette.dot)} />
      <span className="truncate font-mono text-ink-2">{taskKey}</span>
      <span className={cn('ml-auto shrink-0', palette.text)}>{palette.label}</span>
    </div>
  );
}

/**
 * A miniature of the shell's six regions, used by the tour's Playground (and by the tests that assert
 * every tour anchor exists).
 *
 * It is intentionally a *mock*: the tour must not depend on the real Layout, the store or the router.
 * It copies the real hooks (`data-region`, the `aria-label="Centre view"` tablist and the optional
 * `data-shell="views-menu"`), so an anchor that works here is an anchor the shell already exposes.
 */
export function ShellMock({
  state,
  selectedTask,
  view = 'sky',
  onViewChange,
  showAllAnchors = true,
}: ShellMockProps) {
  const run = activeRunOf(state);
  const nodes = sortedNodes(state);
  const tasks = run?.tasks ?? {};
  const keys = Object.keys(tasks);
  const merged = keys.filter((key) => tasks[key]?.status === 'merged');
  const selected = selectedTask === undefined ? undefined : tasks[selectedTask];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 text-ink-1">
      <header className="flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-hairline bg-panel px-3 py-2 backdrop-blur-md">
        <span className="text-heading font-semibold tracking-tight">Starling</span>
        <Tabs<MockView>
          ariaLabel="Centre view"
          tabs={VIEW_TABS}
          value={view}
          onChange={(next) => onViewChange?.(next)}
        />
        {showAllAnchors ? (
          <button
            type="button"
            data-shell="views-menu"
            className="rounded-md border border-hairline px-2 py-1 text-caption text-ink-2 hover:bg-surface-3"
          >
            Views
          </button>
        ) : null}
        <span className="ml-auto truncate text-caption text-ink-3">
          {run?.goal.text ?? 'No run yet — waiting for a goal'}
        </span>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)_14rem] gap-2">
        <section
          data-region="flock"
          aria-label="Flock region"
          className="min-h-0 overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-panel p-2"
        >
          <h2 className="mb-2 text-caption font-semibold text-ink-2">Flock</h2>
          <ul className="flex flex-col gap-1.5">
            {nodes.map((node) => {
              const palette = NODE_STATUS_COLORS[node.status];
              return (
                <li key={node.id} className="rounded-md border border-hairline bg-surface-2/60 p-1.5">
                  <div className="flex items-center gap-1.5 text-caption">
                    <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', palette.dot)} />
                    <span className="truncate">{node.name}</span>
                  </div>
                  <p className="mt-0.5 text-micro text-ink-4">
                    {node.activeSessions}/{node.maxSessions} slots · {node.status}
                  </p>
                </li>
              );
            })}
            {nodes.length === 0 ? <li className="text-caption text-ink-4">No roosts yet</li> : null}
          </ul>
        </section>

        <section
          data-region="sky"
          aria-label={view === 'sky' ? 'Sky region' : 'Flight plan region'}
          className="sky-field min-h-0 overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-panel p-2"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-caption font-semibold text-ink-2">
              {view === 'sky' ? 'The sky' : 'Flight plan'}
            </h2>
            <Badge tone="accent">{keys.length} tasks</Badge>
          </div>
          <div className="grid grid-cols-2 content-start gap-1.5">
            {keys.map((key) => {
              const task = tasks[key];
              return task === undefined ? null : <TaskChip key={key} taskKey={key} task={task} />;
            })}
            {keys.length === 0 ? (
              <p className="text-caption text-ink-4">No tasks in this slice — scrub further.</p>
            ) : null}
          </div>
        </section>

        {selectedTask === undefined ? null : (
          <aside
            data-region="drawer"
            aria-label="Agent drawer region"
            className="min-h-0 overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-panel p-2"
          >
            <h2 className="text-caption font-semibold text-ink-2">Agent · {selectedTask}</h2>
            <p className="mt-1 font-mono text-caption text-ink-3">
              {selected === undefined
                ? 'no run for this task'
                : `${selected.status} · ${selected.attempts} attempt(s)`}
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-micro text-ink-4">
              <li>▸ tool.call read src/app/todo.ts</li>
              <li>▸ file.edited src/app/todo.ts +18 −2</li>
              <li>▸ audit.verdict pass</li>
            </ul>
          </aside>
        )}
      </main>

      <footer className="grid shrink-0 grid-cols-2 gap-2">
        <section
          data-region="queue"
          aria-label="Merge queue region"
          className="rounded-[var(--radius-panel)] border border-hairline bg-panel p-2"
        >
          <h2 className="text-caption font-semibold text-ink-2">Landing strip</h2>
          <p className="mt-1 text-caption text-ink-3">
            {merged.length}/{keys.length} landed · {merged.join(', ') || 'nothing on the wire yet'}
          </p>
        </section>
        {showAllAnchors ? (
          <section
            data-region="metrics"
            aria-label="Metrics region"
            className="rounded-[var(--radius-panel)] border border-hairline bg-panel p-2"
          >
            <h2 className="text-caption font-semibold text-ink-2">The meter</h2>
            <p className="mt-1 text-caption text-ink-3">
              <span className="text-sky-300">{formatUsd(run?.metrics.apiCostUsd ?? 0)} API</span>
              <span aria-hidden="true"> · </span>
              <span className="text-emerald-300">{run?.metrics.localCallCount ?? 0} local calls</span>
            </p>
          </section>
        ) : null}
      </footer>

      <p className="text-micro text-ink-4">
        Mock shell · <Kbd size="sm">→</Kbd> next step · <Kbd size="sm">Esc</Kbd> skip
      </p>
    </div>
  );
}
