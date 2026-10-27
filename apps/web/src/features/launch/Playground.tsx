import type { Run } from '@starling/core';
import { emptyMetrics } from '@starling/core/browser';
import { Bird, Clapperboard } from 'lucide-react';
import { useState } from 'react';
import { fixturePlan, PLAYGROUND_RECENT_REPOS, PLAYGROUND_RUNS } from './fixtures';
import { DEMO_GOALS } from './goals';
import { LaunchPanel } from './LaunchPanel';
import type { LaunchInput, LaunchPanelProps } from './types';

export interface PlaygroundProps {
  /** Seed history (tests or a demo variant). Defaults to the sky-todo fixture runs. */
  runs?: readonly Run[];
  /** Milliseconds of fake latency per call, so the loading states are visible. */
  latencyMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeRun(input: LaunchInput, index: number): Run {
  return {
    id: `run_playground_${index}`,
    goal: {
      id: `goal_playground_${index}`,
      text: input.goal,
      repoPath: input.repoPath,
      baseBranch: input.baseBranch ?? 'main',
      createdAt: Date.now(),
      constraints: [],
    },
    tasks: {},
    status: 'mapping',
    startedAt: Date.now(),
    metrics: emptyMetrics(),
  };
}

/**
 * `Playground` — the launch screen wired to fixtures.
 *
 * `onPreview` returns a plan from `fixtures.ts` (including the deliberate `conflict-bait` overlap)
 * and `onLaunch` prepends a fresh `mapping` run to the history, so the whole flow can be shown
 * without a server. The two failure switches exist because the error states are part of the demo.
 */
export function Playground({ runs = PLAYGROUND_RUNS, latencyMs = 450 }: PlaygroundProps) {
  const [history, setHistory] = useState<Run[]>(() => [...runs]);
  const [failPreview, setFailPreview] = useState(false);
  const [failLaunch, setFailLaunch] = useState(false);
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const [launches, setLaunches] = useState(0);

  const onPreview: NonNullable<LaunchPanelProps['onPreview']> = async (input) => {
    await delay(latencyMs);
    if (failPreview) throw new Error('Planner timed out after 60 s (simulated).');
    return { plan: fixturePlan(input.goal), issues: [] };
  };

  const onLaunch: LaunchPanelProps['onLaunch'] = async (input) => {
    await delay(latencyMs);
    if (failLaunch) throw new Error('POST /api/runs failed with 503 (simulated).');
    const run = makeRun(input, launches + 1);
    setLaunches((count) => count + 1);
    setHistory((current) => [run, ...current]);
    return { runId: run.id };
  };

  return (
    <main className="min-h-screen space-y-3 bg-slate-950 p-4 text-slate-200 sm:p-6">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.22em] text-sky-300/80 uppercase">
            <Clapperboard aria-hidden="true" className="h-3 w-3" />
            playground
          </p>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-50">
            <Bird aria-hidden="true" className="h-4 w-4 text-sky-300" />
            Launch a run · fixture wiring
          </h1>
          <p className="mt-0.5 text-[11px] text-slate-400">
            The sky-todo demo goals, the real expected lanes, and a fake engine. Try{' '}
            <code className="font-mono text-slate-300">conflict-bait</code> to see the overlap badge.
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <input
              type="checkbox"
              data-testid="playground-fail-preview"
              checked={failPreview}
              onChange={(event) => setFailPreview(event.target.checked)}
              className="accent-rose-400"
            />
            fail preview
          </span>
          <span className="flex items-center gap-1.5">
            <input
              type="checkbox"
              data-testid="playground-fail-launch"
              checked={failLaunch}
              onChange={(event) => setFailLaunch(event.target.checked)}
              className="accent-rose-400"
            />
            fail launch
          </span>
        </label>
      </header>

      <div className="mx-auto w-full max-w-6xl">
        <LaunchPanel
          onLaunch={onLaunch}
          onPreview={onPreview}
          recentRepos={PLAYGROUND_RECENT_REPOS}
          goals={[...DEMO_GOALS]}
          runs={history}
          onOpenRun={(id) => setOpened(id)}
        />
      </div>

      <p className="mx-auto w-full max-w-6xl text-[11px] text-slate-500">
        onOpenRun → <span className="font-mono text-slate-300">{opened ?? 'nothing opened yet'}</span>
      </p>
    </main>
  );
}

export default Playground;
