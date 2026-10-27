import type { TaskStatus } from '@starling/core';
import { Activity, Clock, FileDiff, ListChecks, ScrollText, X } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useState } from 'react';
import { statusChip } from '../../lib/status';
import { useNow } from '../metrics/hooks';
import { ActivityTab } from './ActivityTab';
import { AuditTab } from './AuditTab';
import { sortVerdicts } from './audit';
import { DiffTab } from './DiffTab';
import { formatCost, formatDuration, formatTokens } from './format';
import type { AgentDrawerProps } from './handshake';
import { SpecTab } from './SpecTab';

type TabId = 'activity' | 'audit' | 'diff' | 'spec';

const TAB_ICONS = {
  activity: Activity,
  audit: ListChecks,
  diff: FileDiff,
  spec: ScrollText,
} as const;

/** Statuses where an elapsed clock is worth ticking once a second. */
const LIVE_STATUSES: readonly TaskStatus[] = ['running', 'auditing', 'fixing', 'merging'];

/**
 * The "everything about one task" drawer. Right side, four tabs, read-only. Esc closes. Props-only
 * (ARCHITECTURE §8): the shell owns selection and data.
 *
 * The header is the live surface: elapsed time ticks (and freezes when the run does), cost is the
 * engine's invoice, and the Activity tab's file chips jump straight to the matching Diff block.
 */
export function AgentDrawer({ task, run, events, verdicts, diff, onClose }: AgentDrawerProps) {
  const [tab, setTab] = useState<TabId>('activity');
  const [focusFile, setFocusFile] = useState<string | undefined>(undefined);

  const latestVerdict = useMemo(() => sortVerdicts(verdicts)[0], [verdicts]);

  const status: TaskStatus = run?.status ?? 'pending';
  const ticking = run?.finishedAt === undefined && LIVE_STATUSES.includes(status);
  const now = useNow(ticking);
  const elapsedMs =
    run?.startedAt === undefined ? undefined : Math.max(0, (run.finishedAt ?? now) - run.startedAt);
  const tokens = run === undefined ? 0 : run.usage.input + run.usage.output;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'activity', label: 'Activity', count: events.length },
    { id: 'audit', label: 'Audit', count: verdicts.length },
    { id: 'diff', label: 'Diff', count: diff?.files.length ?? 0 },
    { id: 'spec', label: 'Spec' },
  ];

  const handleTabKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = tabs.findIndex((entry) => entry.id === tab);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) setTab(next.id);
  };

  const openFile = (path: string) => {
    setFocusFile(path);
    setTab('diff');
  };

  const taskKey = task?.key ?? run?.taskKey;
  // `TaskRun.nodeName` is feature-detected (FIX REQUEST to Epic 40); the shell's display mapping
  // already puts a name in `nodeId`, so the fallback is a name for every current producer.
  const nodeName =
    (run as (typeof run & { nodeName?: string }) | undefined)?.nodeName?.trim() ||
    run?.nodeId ||
    'unassigned';

  return (
    <aside
      role="dialog"
      aria-label={taskKey ? `Task ${taskKey} details` : 'Task details'}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[560px] flex-col border-l border-slate-800 bg-slate-950/97 shadow-2xl shadow-slate-950"
      data-testid="agent-drawer"
    >
      <header className="border-b border-slate-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[12px] text-sky-200">
                {taskKey ?? 'no-task'}
              </code>
              <span
                className={`rounded-full border px-2 py-0.5 text-[12px] font-medium uppercase tracking-wide ${statusChip(status)}`}
                data-testid="drawer-status"
              >
                {status}
              </span>
              {ticking ? (
                <span
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-teal-300"
                  data-testid="drawer-live"
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" aria-hidden="true" />
                  live
                </span>
              ) : null}
            </div>
            <h2 className="mt-1.5 truncate text-sm font-semibold text-slate-100" title={task?.title}>
              {task?.title ?? 'No task selected'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close agent drawer"
            className="rounded-md border border-slate-700 p-1 text-slate-300 hover:border-slate-500 hover:text-slate-100"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
          <div className="min-w-0">
            <dt className="uppercase tracking-wide text-slate-400">Node</dt>
            <dd className="truncate font-mono text-slate-100" data-testid="drawer-node" title={nodeName}>
              {nodeName}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-slate-400">Elapsed</dt>
            <dd
              className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-100"
              data-testid="drawer-elapsed"
              data-live={ticking ? 'true' : 'false'}
            >
              <Clock aria-hidden="true" className="h-3 w-3 text-slate-400" />
              {formatDuration(elapsedMs)}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-slate-400">Cost</dt>
            <dd className="font-mono tabular-nums text-slate-100" data-testid="drawer-cost">
              {formatCost(run?.costUsd)}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-slate-400">Attempts</dt>
            <dd className="font-mono tabular-nums text-slate-100" data-testid="drawer-attempts">
              {run?.attempts ?? 0}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-slate-400">Tokens</dt>
            <dd className="font-mono tabular-nums text-slate-100" data-testid="drawer-tokens">
              {formatTokens(tokens)}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-slate-400">Events</dt>
            <dd className="font-mono tabular-nums text-slate-100" data-testid="drawer-events">
              {events.length}
            </dd>
          </div>
        </dl>
      </header>

      {task || run ? (
        <div
          role="tablist"
          aria-label="Task details"
          onKeyDown={handleTabKeys}
          className="flex shrink-0 gap-1 border-b border-slate-800 px-2 pt-2"
        >
          {tabs.map((entry) => {
            const Icon = TAB_ICONS[entry.id];
            const selected = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`agent-tab-${entry.id}`}
                aria-selected={selected}
                aria-controls={`agent-panel-${entry.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(entry.id)}
                className={`inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1.5 text-[12px] font-medium ${
                  selected
                    ? 'border-sky-400 bg-slate-900 text-sky-200'
                    : 'border-transparent text-slate-300 hover:text-slate-100'
                }`}
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                {entry.label}
                {entry.count !== undefined ? (
                  <span className="rounded-full bg-slate-800 px-1.5 text-[12px] tabular-nums text-slate-200">
                    {entry.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        role="tabpanel"
        id={`agent-panel-${tab}`}
        aria-labelledby={`agent-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {task || run ? (
          <>
            {tab === 'activity' ? <ActivityTab events={events} onOpenFile={openFile} /> : null}
            {tab === 'audit' ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <AuditTab verdicts={verdicts} />
              </div>
            ) : null}
            {tab === 'diff' ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <DiffTab diff={diff} focusPath={focusFile} />
              </div>
            ) : null}
            {tab === 'spec' ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <SpecTab task={task} verdict={latestVerdict} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="p-6 text-center text-sm text-slate-400">
            Pick a task from the DAG to zoom in on its agent. 🐦
          </p>
        )}
      </div>
    </aside>
  );
}
