// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
import type { Run } from '@starling/core';

// ── Engine API: implemented by packages/engine (E20); consumed by apps/server (E21) + apps/cli (E22)
export interface StartRunInput {
  goal: string;
  repoPath: string;
  dryRun?: boolean;
  maxParallel?: number;
  baseBranch?: string;
}
export interface EngineApi {
  start(input: StartRunInput): Promise<{ runId: string }>; // resolves once the run is created; work continues async
  cancel(runId: string): Promise<void>;
  abortTask(runId: string, taskKey: string): Promise<void>;
  getRun(runId: string): Run | undefined;
  listRuns(): Run[]; // most recent first
  waitForFinish(runId: string): Promise<Run>; // CLI uses this for `starling run`
}

// ── Bundle URL: how the engine (E20) tells a RemoteNode where to fetch the repo. Server path is §6 /api/flock/bundle
export type BundleUrlFor = (ref: string) => { url: string; token: string };
