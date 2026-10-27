import type { DiffSummary, Run, StarlingEvent } from '@starling/core/browser';
import { create } from 'zustand';
import type { PublicConfig } from './api';
import type { JoinInfo } from './handshake';
import {
  applyEvent,
  applyEvents,
  type ConnectionState,
  createInitialState,
  diffKey,
  type SkyState,
} from './reducer';

/**
 * The single zustand store. Components read it through hooks; the feature panels never do —
 * they receive plain props from `selectors.ts` (ARCHITECTURE §8).
 */
export interface SkyActions {
  /** Apply one event (from SSE or the demo player). */
  ingest(event: StarlingEvent): void;
  /** Apply a backlog in order, one render. */
  ingestMany(events: readonly StarlingEvent[]): void;
  /** Seed runs from `GET /api/runs` before the SSE backlog arrives (live mode). */
  ingestRuns(runs: readonly Run[]): void;
  /** Open the agent drawer; call with no argument to close it. */
  selectTask(taskKey?: string): void;
  /** Switch the whole shell to another run (events are re-filtered). */
  setActiveRun(runId?: string): void;
  setConnection(connection: ConnectionState): void;
  setJoin(join: JoinInfo | undefined): void;
  /** `/api/config/public`, for the header's model line. */
  setPublicConfig(config: PublicConfig | undefined): void;
  /** A lazily fetched drawer diff. */
  setDiff(runId: string, taskKey: string, diff: DiffSummary): void;
  /** Clear the run state but keep the mode (a demo loop should stay in demo). */
  reset(): void;
}

export type SkyStore = SkyState & SkyActions;

function eventsForRun(state: SkyState, runId: string | undefined): StarlingEvent[] {
  if (runId === undefined) return state.events.filter((event) => event.runId === '*');
  return state.events.filter((event) => event.runId === '*' || event.runId === runId);
}

export const useSky = create<SkyStore>()((set, get) => ({
  ...createInitialState(),

  ingest: (event) => {
    set((state) => applyEvent(state, event));
  },

  ingestMany: (events) => {
    set((state) => applyEvents(state, events));
  },

  ingestRuns: (runs) => {
    set((state) => {
      if (runs.length === 0) return {};
      const merged = { ...state.runs };
      for (const run of runs) merged[run.id] = run;
      if (state.activeRunId !== undefined) return { runs: merged };
      const newest = [...runs].sort((a, b) => b.startedAt - a.startedAt)[0];
      return newest === undefined ? { runs: merged } : { runs: merged, activeRunId: newest.id };
    });
  },

  selectTask: (taskKey) => {
    set({ selectedTask: taskKey });
  },

  setActiveRun: (runId) => {
    set((state) => ({ activeRunId: runId, events: eventsForRun(state, runId) }));
  },

  setConnection: (connection) => {
    set({ connection });
  },

  setJoin: (join) => {
    set({ join });
  },

  setPublicConfig: (publicConfig) => {
    set({ publicConfig });
  },

  setDiff: (runId, taskKey, diff) => {
    set((state) => ({ diffs: { ...state.diffs, [diffKey(runId, taskKey)]: diff } }));
  },

  reset: () => {
    set({
      ...createInitialState(),
      connection: get().connection,
      join: undefined,
      selectedTask: undefined,
      activeRunId: undefined,
    });
  },
}));

/**
 * Stable actions for non-React callers (the demo player, selectors' defaults, C1 wiring outside
 * React). `useSky.getState()` is zustand's escape hatch and is safe to call anywhere.
 */
export const skyActions = {
  ingest: (event: StarlingEvent) => useSky.getState().ingest(event),
  ingestMany: (events: readonly StarlingEvent[]) => useSky.getState().ingestMany(events),
  ingestRuns: (runs: readonly Run[]) => useSky.getState().ingestRuns(runs),
  selectTask: (taskKey?: string) => useSky.getState().selectTask(taskKey),
  setActiveRun: (runId?: string) => useSky.getState().setActiveRun(runId),
  setConnection: (connection: ConnectionState) => useSky.getState().setConnection(connection),
  setJoin: (join: JoinInfo | undefined) => useSky.getState().setJoin(join),
  setPublicConfig: (config: PublicConfig | undefined) => useSky.getState().setPublicConfig(config),
  setDiff: (runId: string, taskKey: string, diff: DiffSummary) =>
    useSky.getState().setDiff(runId, taskKey, diff),
  reset: () => useSky.getState().reset(),
} as const;
