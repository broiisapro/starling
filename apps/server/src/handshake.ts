// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
import type { NodeInfo, NodeRegistry, Run } from '@starling/core';

// ── Engine API: implemented by packages/engine (E20); consumed by apps/server (E21) + apps/cli (E22)
// biome-ignore format: mirrored verbatim from ARCHITECTURE §8 — do not reflow
export interface StartRunInput { goal: string; repoPath: string; dryRun?: boolean; maxParallel?: number; baseBranch?: string }
// biome-ignore format: mirrored verbatim from ARCHITECTURE §8 — do not reflow
export interface EngineApi {
  start(input: StartRunInput): Promise<{ runId: string }>;      // resolves once the run is created; work continues async
  cancel(runId: string): Promise<void>;
  abortTask(runId: string, taskKey: string): Promise<void>;
  getRun(runId: string): Run | undefined;
  listRuns(): Run[];                                            // most recent first
  waitForFinish(runId: string): Promise<Run>;                   // CLI uses this for `starling run`
}

// ── Flock hub: implemented by packages/flock (E30); consumed by apps/server (E21), engine (E20), cli (E22)
// biome-ignore format: mirrored verbatim from ARCHITECTURE §8 — do not reflow
export interface JoinInfo { code: string; hubUrl: string; command: string } // command: `starling perch --hub <url> --code <code>`
// biome-ignore format: mirrored verbatim from ARCHITECTURE §8 — do not reflow
export interface FlockHub {
  registry: NodeRegistry;                                       // includes the hub's own LocalNode with id 'hub'
  joinInfo(): JoinInfo;
  verifyToken(token: string | undefined): boolean;
  register(input: { url: string; info: NodeInfo }): Promise<{ nodeId: string }>;
  heartbeat(input: { nodeId: string; info: NodeInfo }): void;
  bundle(ref: string): Promise<{ path: string }>;               // a git bundle file of `ref` from the active repo
  setActiveRepo(repoPath: string): void;
  close(): Promise<void>;
}

// ── Bundle URL: how the engine (E20) tells a RemoteNode where to fetch the repo. Server path is §6 /api/flock/bundle
export type BundleUrlFor = (ref: string) => { url: string; token: string };
