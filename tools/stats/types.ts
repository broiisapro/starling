/**
 * The JSON contract behind `tools/stats/out/stats.json` — the "built by the flock" stats the About
 * page (`apps/web/src/features/about`) and the future landing site (`site/data/stats.json`, Epic 59)
 * render.
 *
 * These types are the single source of truth: the web feature re-exports them from
 * `features/about/types.ts`, and the collector is the only producer. Everything here is
 * JSON-serialisable — no dates as `Date`, no `Map`s, no `undefined` inside arrays.
 */

/** Bumped when a field changes meaning. Consumers may refuse to render unknown versions. */
export const SWARM_STATS_VERSION = 1;

/** Wave labels come from `.orchestrator/epics.tsv`: `0`, `1`, `c1`, `2`, `3`, or `unknown`. */
export type WaveKey = string;

/** Which sources the collector could actually read on this machine. */
export interface StatsSources {
  /** False when `git` produced nothing at all (not a repo, no tags). */
  git: boolean;
  /** False when `gh` was skipped (`--no-gh`), missing, or unauthenticated. */
  gh: boolean;
  /** False when `.orchestrator/epics.tsv` was missing; titles/waves are then derived. */
  epics: boolean;
  /** False when `.orchestrator/handbacks/` was missing. */
  handbacks: boolean;
  /** False when the orchestrator agent log directory (`../starling-wt/_logs`) was missing. */
  logs: boolean;
}

/** Handback report state, read from the `**Status:**` line of `.orchestrator/handbacks/NN-slug.md`. */
export type HandbackStatus = 'complete' | 'partial' | 'unknown' | 'missing' | 'unavailable';

/** One epic, assembled from git + GitHub + the orchestrator logs. */
export interface EpicStats {
  /** Zero-padded epic number, e.g. `'00'`, `'68'`. */
  number: string;
  slug: string;
  title: string;
  wave: WaveKey;
  /** Lane summary from `epics.tsv` (`packages/llm`, `apps/web/src/features/sky`, …). */
  lane?: string;
  /** Which laptop ran it, from `epics.tsv`. */
  machine?: string;
  mergedAt?: string;
  /** First commit on the epic branch (ISO), or its agent session start when git has no branch. */
  startedAt?: string;
  /** `mergedAt − startedAt` in ms; omitted when either end is unknown. */
  durationMs?: number;
  commits: number;
  added: number;
  removed: number;
  /** Files touched by the epic's own commits. */
  files: number;
  /** Test files this epic added (`*.test.ts` / `*.test.tsx`). */
  testsAdded: number;
  pr?: number;
  prUrl?: string;
  branch?: string;
  handbackStatus: HandbackStatus;
  /** The agent session that built it, from the orchestrator logs. */
  agentSession?: { start: string; end: string; logFile: string };
}

/** One wave of the plan, aggregated from its epics. */
export interface WaveStats {
  wave: WaveKey;
  /** Epics observed in this wave (merged or still in flight). */
  epics: number;
  /** Agents that worked in this wave (agent log sessions); falls back to the epic count. */
  agents: number;
  startedAt?: string;
  mergedAt?: string;
  /** `mergedAt − startedAt` across the wave. */
  wallTimeMs?: number;
  /** Test declarations in the tree at the wave's last merge (`testsAfterRef`). */
  testsAfter: number;
  /** Git ref the `testsAfter` count was taken at (usually `epic-NN-complete`). */
  testsAfterRef?: string;
  commits: number;
  added: number;
  removed: number;
  merged: number;
}

/** The headline numbers on the page. */
export interface SwarmTotals {
  /** Epics that merged. */
  epics: number;
  /** Every epic with observed work, including still-running ones. */
  epicsObserved: number;
  /** Epics in `epics.tsv` that have not started yet. */
  plannedEpics: number;
  prs: number;
  commits: number;
  added: number;
  removed: number;
  files: number;
  /** Merged PRs count from `gh` (may be lower than `prs` when a PR closed without merging). */
  mergedPrsFromGh: number;
  /** Test declarations in the working tree right now. */
  tests: number;
  testFiles: number;
  /** Test files added across all epics. */
  testsAdded: number;
  waves: number;
  /** Agent log sessions found (one per epic run). */
  agentSessions: number;
  peakConcurrentAgents: number;
  /** Wall clock from the first epic start to the last merge. */
  wallTimeMs: number;
  /** Sum of every agent session's duration, in hours (the "person-hours" of the flock). */
  agentHours: number;
  inFlight: number;
}

/** Everything the page needs, in one file. */
export interface SwarmStats {
  version: number;
  generatedAt: string;
  repo: {
    root: string;
    head?: string;
    headAt?: string;
  };
  sources: StatsSources;
  /** Human-readable notes about degraded sources, e.g. `gh: not authenticated`. */
  notes: string[];
  totals: SwarmTotals;
  epics: EpicStats[];
  waves: WaveStats[];
}
