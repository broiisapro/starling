import type { EpicRow } from './epics';
import { humanizeSlug, waveRank } from './epics';
import type { PullRequest } from './gh';
import { indexPullRequests } from './gh';
import type { EpicGitStats, GitSnapshot } from './git';
import type { AgentSession } from './logs';
import { agentHours, peakConcurrency } from './logs';
import type { EpicStats, HandbackStatus, StatsSources, SwarmStats, SwarmTotals, WaveStats } from './types';
import { SWARM_STATS_VERSION } from './types';

/** Test declarations in the tree after one epic merged. */
export interface TestsAtEpic {
  tests: number;
  ref: string;
}

export interface AssembleInput {
  repoRoot: string;
  git: GitSnapshot;
  /** `null` when `.orchestrator/epics.tsv` was missing — titles and waves are then derived. */
  rows: EpicRow[] | null;
  /** `null` when GitHub was unavailable. */
  prs: PullRequest[] | null;
  /** `null` when the handbacks directory was missing. */
  handbacks: Map<string, HandbackStatus> | null;
  /** `null` when the orchestrator log directory was missing. */
  sessions: AgentSession[] | null;
  /** Keyed by epic number: the test count at the tag created by that epic's merge. */
  testsAfter: Map<string, TestsAtEpic>;
  generatedAt: number;
  notes?: string[];
}

const NO_GIT: EpicGitStats = {
  commits: 0,
  added: 0,
  removed: 0,
  files: 0,
  testsAdded: 0,
  basis: 'none',
};

function iso(ms: number | undefined): string | undefined {
  return ms === undefined || !Number.isFinite(ms) ? undefined : new Date(ms).toISOString();
}

function msOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function minOf(values: (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? undefined : Math.min(...present);
}

function maxOf(values: (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? undefined : Math.max(...present);
}

/** Build plan rows out of what git knows, for repos without `.orchestrator/epics.tsv`. */
export function deriveRowsFromGit(git: GitSnapshot): EpicRow[] {
  const numbers = new Set<string>([...git.tags.keys(), ...git.branches.keys()]);
  return [...numbers].sort().map((number) => {
    const slug = git.branches.get(number) ?? `epic-${number}`;
    return {
      number,
      slug,
      title: humanizeSlug(slug),
      wave: 'unknown',
      machine: '',
      lane: '',
      depends: '',
    };
  });
}

/** The epic numbers worth showing: anything git, GitHub or the logs have actually seen work for. */
function observedNumbers(input: AssembleInput): Set<string> {
  const numbers = new Set<string>([...input.git.tags.keys(), ...input.git.branches.keys()]);
  for (const pr of input.prs ?? []) {
    const match = /epic\((\d+)\)/i.exec(pr.title);
    if (match?.[1] !== undefined) numbers.add(match[1].padStart(2, '0'));
  }
  for (const session of input.sessions ?? []) {
    if (session.number !== undefined) numbers.add(session.number);
  }
  for (const [number, stats] of input.git.epics) {
    if (stats.commits > 0) numbers.add(number);
  }
  return numbers;
}

function buildEpic(
  number: string,
  input: AssembleInput,
  rowsByNumber: Map<string, EpicRow>,
  prs: Map<string, PullRequest>,
): EpicStats {
  const row = rowsByNumber.get(number);
  const tag = input.git.tags.get(number);
  const pr = prs.get(number);
  const gitStats = input.git.epics.get(number) ?? NO_GIT;
  const session = (input.sessions ?? []).find((entry) => entry.number === number);
  const sessionSlug = session?.slug.replace(/^\d+-/, '');
  const slug = row?.slug ?? input.git.branches.get(number) ?? sessionSlug ?? `epic-${number}`;

  const mergedAt = iso(msOf(pr?.mergedAt ?? tag?.createdAt));
  // The agent usually starts before its first commit, so take the earlier of the two as the start.
  const commitStart = msOf(gitStats.firstCommitAt);
  const sessionStart = session?.start;
  const startMs =
    commitStart === undefined
      ? sessionStart
      : sessionStart === undefined
        ? commitStart
        : Math.min(commitStart, sessionStart);
  const startedAt = iso(startMs);
  const mergeMs = msOf(mergedAt);
  const durationMs =
    startMs !== undefined && mergeMs !== undefined ? Math.max(0, mergeMs - startMs) : undefined;

  return {
    number,
    slug,
    title: row?.title ?? humanizeSlug(slug),
    wave: row?.wave ?? 'unknown',
    lane: row?.lane ?? undefined,
    machine: row?.machine ?? undefined,
    mergedAt,
    startedAt,
    durationMs,
    commits: gitStats.commits,
    added: gitStats.added,
    removed: gitStats.removed,
    files: gitStats.files,
    testsAdded: gitStats.testsAdded,
    pr: pr?.number,
    prUrl: pr?.url,
    branch: gitStats.branch ?? (input.git.branches.has(number) ? `epic/${number}-${slug}` : undefined),
    handbackStatus: input.handbacks === null ? 'unavailable' : (input.handbacks.get(number) ?? 'missing'),
    agentSession:
      session === undefined
        ? undefined
        : { start: iso(session.start) ?? '', end: iso(session.end) ?? '', logFile: session.logFile },
  };
}

function epicOrder(a: EpicStats, b: EpicStats): number {
  const byWave = waveRank(a.wave) - waveRank(b.wave);
  if (byWave !== 0) return byWave;
  const byNumber = Number(a.number) - Number(b.number);
  return byNumber !== 0 ? byNumber : a.number.localeCompare(b.number);
}

function buildWave(wave: string, epics: EpicStats[], input: AssembleInput): WaveStats {
  const startedAt = minOf(epics.map((epic) => msOf(epic.startedAt)));
  const mergedAt = maxOf(epics.map((epic) => msOf(epic.mergedAt)));
  const lastMerged = epics
    .filter((epic) => input.testsAfter.has(epic.number) && epic.mergedAt !== undefined)
    .sort((a, b) => (msOf(b.mergedAt) ?? 0) - (msOf(a.mergedAt) ?? 0))[0];
  const after = lastMerged === undefined ? undefined : input.testsAfter.get(lastMerged.number);

  const sessions = (input.sessions ?? []).filter((session) =>
    epics.some((epic) => epic.number === session.number),
  );

  return {
    wave,
    epics: epics.length,
    agents: sessions.length > 0 ? sessions.length : epics.length,
    startedAt: iso(startedAt),
    mergedAt: iso(mergedAt),
    wallTimeMs:
      startedAt !== undefined && mergedAt !== undefined ? Math.max(0, mergedAt - startedAt) : undefined,
    testsAfter: after?.tests ?? 0,
    testsAfterRef: after?.ref,
    commits: epics.reduce((total, epic) => total + epic.commits, 0),
    added: epics.reduce((total, epic) => total + epic.added, 0),
    removed: epics.reduce((total, epic) => total + epic.removed, 0),
    merged: epics.filter((epic) => epic.mergedAt !== undefined).length,
  };
}

/**
 * Merge every source into the one JSON the page renders.
 *
 * Pure: no git, no filesystem, no clock. `collect.ts` does the I/O and hands the pieces in, which is
 * what makes the degraded cases (no `gh`, no logs, no `epics.tsv`) testable without a network.
 */
export function assembleStats(input: AssembleInput): SwarmStats {
  const rows = input.rows ?? deriveRowsFromGit(input.git);
  const rowsByNumber = new Map(rows.map((row) => [row.number, row]));
  const prs = indexPullRequests(input.prs ?? []);
  const numbers = observedNumbers(input);

  const epics = [...numbers].map((number) => buildEpic(number, input, rowsByNumber, prs)).sort(epicOrder);

  const byWave = new Map<string, EpicStats[]>();
  for (const epic of epics) {
    const bucket = byWave.get(epic.wave);
    if (bucket === undefined) byWave.set(epic.wave, [epic]);
    else bucket.push(epic);
  }
  const waves = [...byWave.keys()]
    .sort((a, b) => waveRank(a) - waveRank(b) || a.localeCompare(b))
    .map((wave) => buildWave(wave, byWave.get(wave) ?? [], input));

  const merged = epics.filter((epic) => epic.mergedAt !== undefined);
  const sessions = input.sessions ?? [];
  const startedAt = minOf(epics.map((epic) => msOf(epic.startedAt)));
  const lastMerge = maxOf(epics.map((epic) => msOf(epic.mergedAt)));

  const totals: SwarmTotals = {
    epics: merged.length,
    epicsObserved: epics.length,
    plannedEpics: rows.filter((row) => !numbers.has(row.number)).length,
    prs: epics.filter((epic) => epic.pr !== undefined).length,
    commits: epics.reduce((total, epic) => total + epic.commits, 0),
    added: epics.reduce((total, epic) => total + epic.added, 0),
    removed: epics.reduce((total, epic) => total + epic.removed, 0),
    files: epics.reduce((total, epic) => total + epic.files, 0),
    mergedPrsFromGh: input.prs?.length ?? 0,
    tests: input.git.testsAtHead.tests,
    testFiles: input.git.testsAtHead.testFiles,
    testsAdded: epics.reduce((total, epic) => total + epic.testsAdded, 0),
    waves: waves.length,
    agentSessions: sessions.length,
    peakConcurrentAgents:
      sessions.length > 0 ? peakConcurrency(sessions) : Math.max(0, ...waves.map((wave) => wave.agents)),
    wallTimeMs: startedAt !== undefined && lastMerge !== undefined ? Math.max(0, lastMerge - startedAt) : 0,
    agentHours: agentHours(sessions),
    inFlight: epics.length - merged.length,
  };

  const sources: StatsSources = {
    git: input.git.tags.size > 0 || input.git.epics.size > 0,
    gh: input.prs !== null,
    epics: input.rows !== null,
    handbacks: input.handbacks !== null,
    logs: input.sessions !== null,
  };

  const notes = [...(input.notes ?? []), ...input.git.notes];
  if (input.rows === null) notes.push('epics.tsv: missing; titles and waves were derived from git');
  if (input.handbacks === null) notes.push('handbacks: directory missing');
  if (input.sessions === null) notes.push('logs: agent log directory missing');

  return {
    version: SWARM_STATS_VERSION,
    generatedAt: iso(input.generatedAt) ?? new Date(0).toISOString(),
    repo: { root: input.repoRoot, head: input.git.head, headAt: input.git.headAt },
    sources,
    notes,
    totals,
    epics,
    waves,
  };
}

/** One-line human summary used by the CLI and the tests. */
export function summaryLines(stats: SwarmStats): string[] {
  const { totals } = stats;
  return [
    `epics ${totals.epics} merged (${totals.epicsObserved} observed, ${totals.inFlight} in flight)`,
    `PRs ${totals.prs} · commits ${totals.commits} · +${totals.added}/−${totals.removed} lines in ${totals.files} file touches`,
    `tests ${totals.tests} in ${totals.testFiles} files · ${totals.testsAdded} test files added across epics`,
    `agents ${totals.agentSessions} sessions · peak ${totals.peakConcurrentAgents} at once · ${totals.agentHours}h agent time`,
    `wall ${(totals.wallTimeMs / 3_600_000).toFixed(1)}h across ${totals.waves} waves`,
  ];
}
