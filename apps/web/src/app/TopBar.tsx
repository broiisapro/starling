import type { Run } from '@starling/core/browser';
import { Bird, Keyboard, Moon, Sun } from 'lucide-react';
import { Badge, type BadgeTone, Kbd, type TabItem, Tabs, Tooltip } from '../components';
import { modelLabel, modelLabels, type PublicConfig } from '../data/api';
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
  /** `/api/config/public`: the header shows the auditor's model and every role in a tooltip. */
  config?: PublicConfig;
  /** One-click fallback: demo when live, live when demo. */
  onToggleDemo?(): void;
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
    dot: 'bg-emerald-400 text-emerald-400',
  },
  demo: {
    label: 'demo',
    tone: 'warn',
    title: 'No server found — replaying the recorded launch-day run.',
    dot: 'bg-amber-300 text-amber-300',
  },
  offline: {
    label: 'offline',
    tone: 'danger',
    title: 'The event stream dropped. Reconnecting with backoff…',
    dot: 'bg-red-400 text-red-400',
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
  config,
  onToggleDemo,
}: TopBarProps) {
  const status = CONNECTION[connection];
  const activeRun = runs.find((run) => run.id === activeRunId) ?? runs[0];

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-surface-1/60 px-4 backdrop-blur-xl after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-gradient-to-r after:from-transparent after:via-[color-mix(in_oklab,var(--accent)_45%,transparent)] after:to-transparent">
      <div className="flex items-center gap-2 pr-1">
        <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl border border-hairline-strong bg-gradient-to-b from-white/10 to-white/0 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]">
          <Bird className="accent-glow h-[18px] w-[18px] text-[var(--accent)]" aria-hidden="true" />
        </span>
        <span className="text-title font-semibold tracking-[-0.035em] text-ink-1">Starling</span>
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
          icon={<span className={cn('pulse-dot h-1.5 w-1.5 rounded-full', status.dot)} aria-hidden="true" />}
        >
          <span className="font-semibold tracking-[0.12em] uppercase">{status.label}</span>
        </Badge>
      </Tooltip>

      {onToggleDemo !== undefined ? (
        <Tooltip
          content={
            connection === 'demo'
              ? 'Reconnect to the Starling server at /api/health.'
              : 'Replay the recorded launch-day run (no server needed).'
          }
        >
          <button
            type="button"
            onClick={onToggleDemo}
            aria-label={connection === 'demo' ? 'Switch to live data' : 'Switch to demo replay'}
            className="inline-flex h-7 items-center rounded-lg border border-hairline-strong bg-surface-1/70 px-2 text-caption font-medium text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
          >
            {connection === 'demo' ? 'Live' : 'Demo'}
          </button>
        </Tooltip>
      ) : null}

      {config !== undefined ? (
        <Tooltip
          content={
            <span className="block whitespace-pre font-mono text-micro" data-testid="model-roles">
              {modelLabels(config).join('\n')}
            </span>
          }
        >
          <Badge tone="neutral" className="hidden font-mono xl:inline-flex">
            {modelLabel(config, 'auditor')}
          </Badge>
        </Tooltip>
      ) : null}

      {totalTasks !== undefined && totalTasks > 0 ? (
        <div
          title="Tasks merged into the integration branch"
          className="hidden min-w-[92px] flex-col gap-1 sm:flex"
        >
          <span
            className={cn(
              'stat-num text-caption font-semibold whitespace-nowrap',
              landed === totalTasks ? 'text-emerald-300' : 'text-ink-1',
            )}
          >
            {landed ?? 0}/{totalTasks} landed
          </span>
          <span className="h-1 w-full overflow-hidden rounded-full bg-white/8" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-soft)] shadow-[0_0_8px_var(--accent)] transition-[width] duration-700 ease-[var(--ease-flock)]"
              style={{ width: `${Math.round(((landed ?? 0) / totalTasks) * 100)}%` }}
            />
          </span>
        </div>
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
