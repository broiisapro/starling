import type { Run } from '@starling/core';
import { Bird, Keyboard, Moon, Sun } from 'lucide-react';
import { Badge, type BadgeTone, Kbd, type TabItem, Tabs, Tooltip } from '../components';
import type { ConnectionState } from '../data/reducer';
import { cn } from '../lib/cn';
import { DEMO_SPEEDS, type DemoSpeed } from '../lib/speed';
import type { Theme } from '../lib/theme';

/** The centre region's two views. Keys 1 and 2 switch them (see `KeyboardHelp`). */
export type CentreView = 'sky' | 'dag';

export interface TopBarProps {
  runs: Run[];
  activeRunId?: string;
  connection: ConnectionState;
  speed: DemoSpeed;
  onSpeedChange(speed: DemoSpeed): void;
  theme: Theme;
  onToggleTheme(): void;
  onSelectRun(runId: string): void;
  /** Which view fills the centre region. */
  view: CentreView;
  onViewChange(view: CentreView): void;
  /** Opens the `?` keyboard-help overlay. */
  onOpenHelp?(): void;
  /** Shell-level progress: tasks landed / total in the active run. */
  landed?: number;
  totalTasks?: number;
}

const SPEED_TABS: readonly TabItem<DemoSpeed>[] = DEMO_SPEEDS.map((speed) => ({
  id: speed,
  label: `${speed}×`,
}));

const VIEW_TABS: readonly TabItem<CentreView>[] = [
  {
    id: 'sky',
    label: 'Sky',
    badge: (
      <span aria-hidden="true">
        <Kbd size="sm">1</Kbd>
      </span>
    ),
  },
  {
    id: 'dag',
    label: 'DAG',
    badge: (
      <span aria-hidden="true">
        <Kbd size="sm">2</Kbd>
      </span>
    ),
  },
];

const CONNECTION: Record<ConnectionState, { label: string; tone: BadgeTone; title: string; dot: string }> = {
  live: {
    label: 'live',
    tone: 'success',
    title: 'Connected to the Starling server over SSE.',
    dot: 'bg-emerald-400',
  },
  demo: {
    label: 'demo',
    tone: 'violet',
    title: 'No server found — replaying the recorded launch-day run.',
    dot: 'bg-violet-400',
  },
  offline: {
    label: 'offline',
    tone: 'danger',
    title: 'The event stream dropped. Reconnecting with backoff…',
    dot: 'bg-red-400',
  },
};

function runLabel(run: Run): string {
  const text = run.goal.text.length > 64 ? `${run.goal.text.slice(0, 61)}…` : run.goal.text;
  return `${text} · ${run.status}`;
}

/**
 * The top rail: identity, run picker, data-source badge, the Sky/DAG view toggle, demo speed, help
 * and the theme toggle. Everything here is a button or a native control, so keyboard users get the
 * whole shell; keys 1/2 mirror the view toggle and `?` opens the shortcut card.
 */
export function TopBar({
  runs,
  activeRunId,
  connection,
  speed,
  onSpeedChange,
  theme,
  onToggleTheme,
  onSelectRun,
  view,
  onViewChange,
  onOpenHelp,
  landed,
  totalTasks,
}: TopBarProps) {
  const status = CONNECTION[connection];
  const activeRun = runs.find((run) => run.id === activeRunId) ?? runs[0];

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-surface-1/70 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 pr-1">
        <Bird className="h-6 w-6 text-irid-teal" aria-hidden="true" />
        <span className="iridescent-text text-title font-bold tracking-tight">Starling</span>
        <span className="hidden text-micro font-medium tracking-[0.14em] text-ink-4 uppercase xl:inline">
          murmuration
        </span>
      </div>

      <div className="mx-1 h-6 w-px bg-hairline-strong" aria-hidden="true" />

      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="hidden shrink-0 text-micro font-medium tracking-[0.1em] text-ink-4 uppercase lg:inline">
          Run
        </span>
        <select
          aria-label="Active run"
          value={activeRun?.id ?? ''}
          onChange={(event) => onSelectRun(event.target.value)}
          disabled={runs.length === 0}
          className="min-w-0 max-w-xl flex-1 truncate rounded-lg border border-hairline-strong bg-surface-2/80 px-2.5 py-1.5 text-caption text-ink-2 transition-colors hover:border-focus/50 disabled:opacity-50"
        >
          {runs.length === 0 ? <option value="">No runs yet</option> : null}
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {runLabel(run)}
            </option>
          ))}
        </select>
      </label>

      <Tooltip content={status.title}>
        <Badge
          tone={status.tone}
          className="gap-1.5"
          icon={<span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} aria-hidden="true" />}
        >
          {status.label}
        </Badge>
      </Tooltip>

      {totalTasks !== undefined && totalTasks > 0 ? (
        <Badge
          tone={landed === totalTasks ? 'success' : 'neutral'}
          title="Tasks merged into the integration branch"
        >
          {landed ?? 0}/{totalTasks} landed
        </Badge>
      ) : null}

      <Tabs<CentreView> ariaLabel="Centre view" tabs={VIEW_TABS} value={view} onChange={onViewChange} />

      <div className="flex items-center gap-2">
        <span className="hidden text-micro font-medium tracking-[0.1em] text-ink-4 uppercase xl:inline">
          Demo
        </span>
        <Tabs<DemoSpeed>
          ariaLabel="Demo playback speed"
          tabs={SPEED_TABS}
          value={speed}
          onChange={onSpeedChange}
        />
      </div>

      <Tooltip content="Keyboard shortcuts (?)">
        <button
          type="button"
          onClick={() => onOpenHelp?.()}
          aria-label="Keyboard shortcuts"
          aria-keyshortcuts="?"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline-strong bg-surface-1/70 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
        >
          <Keyboard className="h-4 w-4" aria-hidden="true" />
        </button>
      </Tooltip>

      <Tooltip content={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline-strong bg-surface-1/70 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </Tooltip>
    </header>
  );
}
