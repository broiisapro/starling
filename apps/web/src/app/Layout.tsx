import { ChevronLeft, ChevronRight, PanelRight } from 'lucide-react';
import { useState } from 'react';
import { Badge, Panel, type TabItem, Tabs } from '../components';
import type { SkyState } from '../data/reducer';
import { activeRunOf, flockProps, sortedRuns } from '../data/selectors';
import { cn } from '../lib/cn';
import type { DemoSpeed } from '../lib/speed';
import type { Theme } from '../lib/theme';
import { RegionPlaceholder } from './RegionPlaceholder';
import { TopBar } from './TopBar';

type SkyTab = 'sky' | 'dag';

const SKY_TABS: readonly TabItem<SkyTab>[] = [
  { id: 'sky', label: 'Sky' },
  { id: 'dag', label: 'Flight plan' },
];

export interface LayoutProps {
  state: SkyState;
  speed: DemoSpeed;
  onSpeedChange(speed: DemoSpeed): void;
  theme: Theme;
  onToggleTheme(): void;
  onSelectRun?(runId: string): void;
  onCloseDrawer?(): void;
}

/**
 * The shell. Five regions, one receiving stream:
 *
 *     ┌────────────── top bar: logo · run picker · connection · demo speed · theme ──────────────┐
 *     │ flock │                     sky / flight plan                      │      drawer       │
 *     ├───────┴────────────────────────────────────────────────────────────┴───────────────────┤
 *     │                        merge queue                        │         metrics              │
 *     └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Each region is a `RegionPlaceholder` in Wave 1. C1 replaces the placeholder with the one-line
 * wiring noted beside it; nothing else in the shell has to move.
 */
export function Layout({
  state,
  speed,
  onSpeedChange,
  theme,
  onToggleTheme,
  onSelectRun,
  onCloseDrawer,
}: LayoutProps) {
  const [skyTab, setSkyTab] = useState<SkyTab>('sky');
  const [flockOpen, setFlockOpen] = useState(true);
  const run = activeRunOf(state);
  const runs = sortedRuns(state);
  const flock = flockProps(state);
  const online = flock.nodes.filter((node) => node.status !== 'offline').length;
  const taskList = run === undefined ? [] : Object.values(run.tasks);
  const landed = taskList.filter((task) => task.status === 'merged').length;

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
        landed={landed}
        totalTasks={taskList.length}
      />

      <main
        className="grid min-h-0 flex-1 gap-2 px-2 pt-2 pb-2"
        style={{
          gridTemplateColumns: flockOpen ? '15rem minmax(0, 1fr) 21rem' : '3.25rem minmax(0, 1fr) 21rem',
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
            <div id="flock-region-body" className="h-full">
              {flockOpen ? (
                // WIRED AT C1: <FlockPanel {...flockProps(state)} />
                <RegionPlaceholder name="flock" compact />
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
          aria-label="Sky region"
          tabIndex={-1}
          className="min-h-0 min-w-0"
        >
          <Panel
            className="h-full sky-field"
            title="The sky"
            subtitle={run?.plan?.summary ?? run?.goal.text ?? 'No run yet — waiting for a goal'}
            actions={
              <Tabs<SkyTab>
                ariaLabel="Sky or flight plan"
                tabs={SKY_TABS}
                value={skyTab}
                onChange={setSkyTab}
                size="sm"
              />
            }
            bodyClassName="relative"
          >
            <div hidden={skyTab !== 'sky'} className="h-full">
              {/* WIRED AT C1: <SkyView {...skyProps(state)} /> */}
              <RegionPlaceholder name="sky" />
            </div>
            <div hidden={skyTab !== 'dag'} className="h-full">
              {/* WIRED AT C1: <DagView {...dagProps(state)} /> */}
              <RegionPlaceholder name="dag" />
            </div>
          </Panel>
        </section>

        <aside data-region="drawer" aria-label="Agent drawer region" className="min-h-0 min-w-0">
          <Panel
            as="aside"
            className="h-full"
            title="Agent"
            subtitle={state.selectedTask === undefined ? 'No bird selected' : state.selectedTask}
            actions={
              <button
                type="button"
                onClick={() => onCloseDrawer?.()}
                aria-label="Close the agent drawer"
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-4 hover:bg-surface-3 hover:text-ink-1',
                  state.selectedTask === undefined && 'pointer-events-none opacity-30',
                )}
              >
                <PanelRight className="h-4 w-4" />
              </button>
            }
          >
            {/* WIRED AT C1: <AgentDrawer {...drawerProps(state)} /> */}
            <RegionPlaceholder name="drawer" />
          </Panel>
        </aside>
      </main>

      <footer
        data-region="strip"
        className="grid h-40 shrink-0 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-2 px-2 pb-2"
      >
        <section data-region="queue" aria-label="Merge queue region" className="min-h-0 min-w-0">
          <Panel className="h-full" title="Merge queue" subtitle="Branches waiting to land">
            {/* WIRED AT C1: <MergeQueue {...queueProps(state)} /> */}
            <RegionPlaceholder name="queue" compact />
          </Panel>
        </section>
        <section data-region="metrics" aria-label="Metrics region" className="min-h-0 min-w-0">
          <Panel className="h-full" title="Cost & speed">
            {/* WIRED AT C1: <MetricsPanel {...metricsProps(state)} /> */}
            <RegionPlaceholder name="metrics" compact />
          </Panel>
        </section>
      </footer>
    </div>
  );
}
