import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, ErrorBoundary, Panel } from '../components';
import type { SkyState } from '../data/reducer';
import {
  activeRunOf,
  dagProps,
  displayTasks,
  drawerProps,
  flockProps,
  metricsProps,
  queueProps,
  type SelectorActions,
  skyProps,
  sortedRuns,
  storeActions,
} from '../data/selectors';
import { AgentDrawer } from '../features/agents';
import { DagView } from '../features/dag';
import { FlockPanel } from '../features/flock';
import { MetricsPanel, usePrefersReducedMotion } from '../features/metrics';
import { MergeQueue } from '../features/queue';
import { SkyView } from '../features/sky';
import { cn } from '../lib/cn';
import { formatUsd } from '../lib/format';
import type { DemoSpeed } from '../lib/speed';
import type { Theme } from '../lib/theme';
import { KeyboardHelp } from './KeyboardHelp';
import { RegionPlaceholder } from './RegionPlaceholder';
import { type CentreView, TopBar } from './TopBar';

export type { CentreView };

const FLOCK_OPEN = '15rem';
const FLOCK_CLOSED = '3.25rem';
const DRAWER_OPEN = '22rem';

export interface LayoutProps {
  state: SkyState;
  speed: DemoSpeed;
  onSpeedChange(speed: DemoSpeed): void;
  theme: Theme;
  onToggleTheme(): void;
  onSelectRun?(runId: string): void;
  onCloseDrawer?(): void;
  /** Select a task from any panel. Defaults to the store (this is what makes C1 wiring one-liners work). */
  onSelectTask?(key: string): void;
  /** The centre view to start on. Keys 1/2 and the top-bar toggle change it after mount. */
  initialView?: CentreView;
}

/**
 * The shell. Five regions, one receiving stream, every panel fed by a selector:
 *
 *     ┌────────────── top bar: logo · run · live badge · Sky/DAG toggle · speed · ? · theme ──────┐
 *     │ flock │                     sky / flight plan                      │      agent        │
 *     ├───────┴────────────────────────────────────────────────────────────┴───────────────────┤
 *     │                        merge queue                        │        cost & speed         │
 *     └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * At 1280×720 the sky keeps the centre and the right column only exists while a task is selected;
 * at 1920×1080 everything breathes. Each region sits behind its own `ErrorBoundary`, so a panel
 * that throws shows the `RegionPlaceholder` fallback instead of blanking the dashboard.
 *
 * Keyboard: `1` Sky · `2` DAG · `b` bottom strip · `f` flock rail · `?` help · `Esc` close.
 */
export function Layout({
  state,
  speed,
  onSpeedChange,
  theme,
  onToggleTheme,
  onSelectRun,
  onCloseDrawer,
  onSelectTask,
  initialView = 'sky',
}: LayoutProps) {
  const [view, setView] = useState<CentreView>(initialView);
  const [flockOpen, setFlockOpen] = useState(true);
  const [stripOpen, setStripOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const actions = useMemo<SelectorActions>(
    () => ({
      selectTask: onSelectTask ?? storeActions.selectTask,
      closeDrawer: onCloseDrawer ?? storeActions.closeDrawer,
    }),
    [onSelectTask, onCloseDrawer],
  );

  // Only the three label-rendering panels get display node names; the Sky and the flock panel
  // need real node ids (roost lookup and per-roost task grouping).
  const tasks = useMemo(() => displayTasks(state, activeRunOf(state)?.tasks ?? {}), [state]);
  const sky = skyProps(state, actions);
  const dag = dagProps(state, actions);
  const drawer = drawerProps(state, actions);
  const queue = queueProps(state, actions);
  const metrics = metricsProps(state, { live: activeRunOf(state)?.status === 'running' });
  const flock = flockProps(state, actions, {
    compact: true,
    reducedMotion,
    onSelectTask: actions.selectTask,
  });

  const runs = sortedRuns(state);
  const run = activeRunOf(state);
  const tasksOfRun = Object.values(tasks);
  const landed = tasksOfRun.filter((task) => task.status === 'merged').length;
  const flying = tasksOfRun.filter((task) => task.status === 'running' || task.status === 'fixing').length;
  const online = flock.nodes.filter((node) => node.status !== 'offline').length;
  const drawerOpen = state.selectedTask !== undefined;
  const onTheWire = metrics.metrics?.tasksMerged ?? 0;

  const closeDrawer = useCallback(() => actions.closeDrawer(), [actions]);

  // One document-level handler for the whole shell; text fields keep their keystrokes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      switch (event.key) {
        case '1':
          setView('sky');
          break;
        case '2':
          setView('dag');
          break;
        case 'b':
          setStripOpen((open) => !open);
          break;
        case 'f':
          setFlockOpen((open) => !open);
          break;
        case '?':
          setHelpOpen((open) => !open);
          break;
        case 'Escape':
          if (helpOpen) setHelpOpen(false);
          else closeDrawer();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, closeDrawer]);

  return (
    <div className="flex h-screen min-h-0 w-full flex-col overflow-hidden text-ink-1">
      <a
        href="#region-sky"
        className="sr-only z-50 rounded-md bg-surface-3 px-3 py-2 text-body text-ink-1 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to the sky
      </a>

      <TopBar
        runs={runs}
        activeRunId={state.activeRunId}
        connection={state.connection}
        speed={speed}
        onSpeedChange={onSpeedChange}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onSelectRun={(runId) => onSelectRun?.(runId)}
        view={view}
        onViewChange={setView}
        onOpenHelp={() => setHelpOpen(true)}
        landed={landed}
        totalTasks={tasksOfRun.length}
      />

      <main
        className="grid min-h-0 flex-1 gap-2 px-2 pt-2 pb-2 transition-[grid-template-columns] duration-300 ease-out"
        style={{
          gridTemplateColumns: `${flockOpen ? FLOCK_OPEN : FLOCK_CLOSED} minmax(0, 1fr) ${
            drawerOpen ? DRAWER_OPEN : '0rem'
          }`,
        }}
      >
        <aside data-region="flock" aria-label="Flock region" className="flex min-h-0 min-w-0 flex-col">
          <Panel
            className="h-full"
            title={flockOpen ? 'Flock' : undefined}
            actions={
              <>
                {flockOpen ? (
                  <Badge tone={online > 1 ? 'accent' : 'neutral'} title="Online nodes">
                    {online}/{flock.nodes.length || 0}
                  </Badge>
                ) : null}
                <button
                  type="button"
                  aria-expanded={flockOpen}
                  aria-controls="flock-region-body"
                  aria-label={flockOpen ? 'Collapse the flock region' : 'Expand the flock region'}
                  onClick={() => setFlockOpen((open) => !open)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-4 hover:bg-surface-3 hover:text-ink-1"
                >
                  {flockOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              </>
            }
          >
            <div id="flock-region-body" className="h-full overflow-y-auto overscroll-contain p-1.5">
              {flockOpen ? (
                <ErrorBoundary name="flock" resetKey={state.activeRunId}>
                  {/*
                    The rail is ~15rem wide: the compact panel's one-row strip scrolls sideways there,
                    so the shell stacks its roosts vertically instead. Nothing inside the feature moves.
                  */}
                  <div className="[&_[data-testid='compact-flock']]:flex-col [&_[data-testid='compact-flock']>li]:w-full">
                    <FlockPanel {...flock} />
                  </div>
                </ErrorBoundary>
              ) : (
                <div className="flex h-full flex-col items-center gap-3 pt-3">
                  <span className="[writing-mode:vertical-rl] text-micro tracking-[0.18em] text-ink-4 uppercase">
                    Flock · {online}/{flock.nodes.length || 0}
                  </span>
                </div>
              )}
            </div>
          </Panel>
        </aside>

        <section
          id="region-sky"
          data-region="sky"
          aria-label={view === 'sky' ? 'Sky region' : 'Flight plan region'}
          tabIndex={-1}
          className="min-h-0 min-w-0"
        >
          <Panel
            className="h-full sky-field"
            title={view === 'sky' ? 'The sky' : 'Flight plan'}
            subtitle={run?.plan?.summary ?? run?.goal.text ?? 'No run yet — waiting for a goal'}
            actions={
              <Badge tone={flying > 0 ? 'accent' : 'neutral'} title="Birds in the air right now">
                {flying} flying
              </Badge>
            }
            bodyClassName="relative"
          >
            {/*
              Both views stay mounted (switching is instant, the Sky keeps its flocks, and React Flow
              keeps its measured size). The inactive one is only hidden visually: `display: none`
              would hand React Flow a zero-sized container and break its fit-to-view, and the Sky
              would stop painting birds mid-frame. `inert` keeps it out of the tab order and the
              accessibility tree.
            */}
            <div
              data-view="sky"
              data-active={view === 'sky' ? 'true' : 'false'}
              aria-hidden={view !== 'sky'}
              inert={view !== 'sky'}
              className={
                view === 'sky' ? 'relative h-full' : 'pointer-events-none absolute inset-0 h-full opacity-0'
              }
            >
              <ErrorBoundary
                name="sky"
                resetKey={state.activeRunId}
                fallback={(error) => <RegionPlaceholder name="sky" detail={error.message} />}
              >
                <SkyView {...sky} reducedMotion={reducedMotion} />
              </ErrorBoundary>
            </div>
            <div
              data-view="dag"
              data-active={view === 'dag' ? 'true' : 'false'}
              aria-hidden={view !== 'dag'}
              inert={view !== 'dag'}
              className={
                view === 'dag' ? 'relative h-full' : 'pointer-events-none absolute inset-0 h-full opacity-0'
              }
            >
              <ErrorBoundary
                name="dag"
                resetKey={state.activeRunId}
                fallback={(error) => <RegionPlaceholder name="dag" detail={error.message} />}
              >
                <DagView {...dag} />
              </ErrorBoundary>
            </div>
          </Panel>
        </section>

        <aside
          data-region="drawer"
          aria-label="Agent drawer region"
          className={cn('relative min-h-0 min-w-0', !drawerOpen && 'hidden')}
        >
          {drawerOpen ? (
            <ErrorBoundary
              name="drawer"
              resetKey={state.selectedTask}
              fallback={(error) => <RegionPlaceholder name="drawer" detail={error.message} />}
            >
              {/*
                The drawer is a fixed, right-edge overlay by design (Epic 25) so it can be read over
                the graph. Inside the shell it belongs to a region, so the wrapper pins it to that
                region instead of the viewport: same component, no feature edits, no occlusion of
                the sky.
              */}
              <div className="h-full w-full [&>aside]:absolute [&>aside]:inset-0 [&>aside]:w-full [&>aside]:max-w-none [&>aside]:border-l">
                <AgentDrawer {...drawer} />
              </div>
            </ErrorBoundary>
          ) : null}
        </aside>
      </main>

      <footer
        data-region="strip"
        className={cn(
          'shrink-0 gap-2 px-2 pb-2',
          stripOpen ? 'grid h-48 grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]' : 'flex h-10 flex-col',
        )}
      >
        {stripOpen ? (
          <>
            <section data-region="queue" aria-label="Merge queue region" className="min-h-0 min-w-0">
              <Panel
                className="h-full"
                title="Landing strip"
                subtitle="Branches waiting to land"
                actions={
                  <button
                    type="button"
                    onClick={() => setStripOpen(false)}
                    aria-expanded="true"
                    aria-controls="region-strip-body"
                    aria-label="Collapse the bottom strip"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-4 hover:bg-surface-3 hover:text-ink-1"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                }
              >
                <div id="region-strip-body" className="h-full overflow-y-auto overscroll-contain">
                  <ErrorBoundary
                    name="queue"
                    resetKey={state.activeRunId}
                    fallback={(error) => <RegionPlaceholder name="queue" detail={error.message} compact />}
                  >
                    <MergeQueue {...queue} />
                  </ErrorBoundary>
                </div>
              </Panel>
            </section>
            <section data-region="metrics" aria-label="Metrics region" className="min-h-0 min-w-0">
              <Panel
                className="h-full"
                title="The meter"
                subtitle="API spend vs this laptop"
                bodyClassName="overflow-y-auto overscroll-contain"
              >
                <ErrorBoundary
                  name="metrics"
                  resetKey={state.activeRunId}
                  fallback={(error) => <RegionPlaceholder name="metrics" detail={error.message} compact />}
                >
                  <MetricsPanel {...metrics} />
                </ErrorBoundary>
              </Panel>
            </section>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setStripOpen(true)}
            aria-expanded="false"
            aria-controls="region-strip-body"
            className="flex h-full w-full items-center gap-3 rounded-[var(--radius-panel)] border border-hairline bg-panel px-3 text-left text-caption text-ink-2 hover:bg-surface-2"
          >
            <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-4" />
            <span className="font-semibold text-ink-1">Landing strip</span>
            <span className="tabular-nums">
              {landed}/{tasksOfRun.length} landed
            </span>
            <span aria-hidden="true" className="text-ink-4">
              ·
            </span>
            <span className="tabular-nums">{onTheWire} on the wire</span>
            <span aria-hidden="true" className="text-ink-4">
              ·
            </span>
            <span className="tabular-nums text-sky-300">
              {formatUsd(metrics.metrics?.apiCostUsd ?? 0)} API
            </span>
            <span className="tabular-nums text-emerald-300">
              {metrics.metrics?.localCallCount ?? 0} local calls
            </span>
            <span className="ml-auto text-micro tracking-[0.12em] text-ink-4 uppercase">Show (b)</span>
          </button>
        )}
      </footer>

      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
