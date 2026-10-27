import type { StarlingEvent } from '@starling/core';
import { create } from 'zustand';
import type { JoinInfo } from './handshake';
import { applyEvent, applyEvents, type ConnectionState, createInitialState, type SkyState } from './reducer';

/**
 * The single zustand store. Components read it through hooks; the feature panels never do —
 * they receive plain props from `selectors.ts` (ARCHITECTURE §8).
 */
export interface SkyActions {
  /** Apply one event (from SSE or the demo player). */
  ingest(event: StarlingEvent): void;
  /** Apply a backlog in order, one render. */
  ingestMany(events: readonly StarlingEvent[]): void;
  /** Open the agent drawer; call with no argument to close it. */
  selectTask(taskKey?: string): void;
  /** Switch the whole shell to another run (events are re-filtered). */
  setActiveRun(runId?: string): void;
  setConnection(connection: ConnectionState): void;
  setJoin(join: JoinInfo | undefined): void;
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
  selectTask: (taskKey?: string) => useSky.getState().selectTask(taskKey),
  setActiveRun: (runId?: string) => useSky.getState().setActiveRun(runId),
  setConnection: (connection: ConnectionState) => useSky.getState().setConnection(connection),
  setJoin: (join: JoinInfo | undefined) => useSky.getState().setJoin(join),
  reset: () => useSky.getState().reset(),
} as const;
