import { expect, test } from 'bun:test';

import { assembleStats, summaryLines } from './assemble';
import { parseArgs, USAGE } from './collect';
import { humanizeSlug, normalizeEpicNumber, parseEpicsTsv, waveRank } from './epics';
import { epicNumberOfPr, indexPullRequests, parsePullRequestList } from './gh';
import type { GitSnapshot } from './git';
import { parseHandbackStatus } from './handbacks';
import { agentHours, parseLogHeader, peakConcurrency } from './logs';
import type { HandbackStatus } from './types';

function emptyGit(): GitSnapshot {
  return {
    baseRef: 'main',
    tags: new Map(),
    epics: new Map(),
    branches: new Map(),
    testsAtHead: { tests: 0, testFiles: 0 },
    notes: [],
  };
}

test('parses epics.tsv and skips the header and malformed rows', () => {
  const rows = parseEpicsTsv(
    [
      'nn\tslug\ttitle\twave\tmachine\tlane\tdepends',
      '00\tfoundation\tFoundation & frozen contracts\t0\tmbp\troot\t-',
      '7\tseven\tSeven\t1\tmbp\tpackages/seven\t00',
      'garbage',
      '',
    ].join('\n'),
  );

  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({
    number: '00',
    slug: 'foundation',
    title: 'Foundation & frozen contracts',
    wave: '0',
    machine: 'mbp',
    lane: 'root',
    depends: '-',
  });
  expect(rows[1]?.number).toBe('07');
  expect(normalizeEpicNumber('c1')).toBeUndefined();
  expect(waveRank('c1')).toBeLessThan(waveRank('2'));
  expect(waveRank('nope')).toBeGreaterThan(waveRank('3'));
  expect(humanizeSlug('swarm-stats')).toBe('Swarm stats');
});

test('reads handback status words', () => {
  const cases: [string, HandbackStatus][] = [
    ['**Status:** Complete. Branch x.', 'complete'],
    ['**Status:** Partial (collector tests missing).', 'partial'],
    ['Status: partial', 'partial'],
    ['**Status:** Blocked on review', 'unknown'],
    ['no status line here', 'unknown'],
  ];
  for (const [markdown, expected] of cases) expect(parseHandbackStatus(markdown)).toBe(expected);
});

test('parses agent log headers and counts overlapping sessions', () => {
  const header = parseLogHeader(
    '=== Tue 27 Oct 2026 14:00:00 UTC :: 20-engine :: model opencode-go/deepseek-v4.1-flash :: ui run ===',
  );
  expect(header?.slug).toBe('20-engine');
  expect(new Date(header?.start ?? 0).toISOString()).toBe('2026-10-27T14:00:00.000Z');
  expect(parseLogHeader('not a header')).toBeUndefined();

  // A hand-off (one ends exactly when the next starts) is not an overlap.
  expect(
    peakConcurrency([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ]),
  ).toBe(1);
  expect(
    peakConcurrency([
      { start: 0, end: 30 },
      { start: 10, end: 40 },
      { start: 20, end: 50 },
      { start: 60, end: 70 },
    ]),
  ).toBe(3);
  expect(
    agentHours([
      { start: 0, end: 3_600_000 },
      { start: 0, end: 1_800_000 },
    ]),
  ).toBe(1.5);
});

test('parses gh JSON and matches PRs to epics by title or branch', () => {
  const prs = parsePullRequestList(
    JSON.stringify([
      { number: 7, title: 'epic(20): engine (#7)', url: 'u7', headRefName: 'epic/20-engine' },
      { number: 8, title: 'C1 web wiring', url: 'u8', headRefName: 'epic/34-c1-web-wiring' },
      { number: 'nope', title: 'bad', url: 'u' },
    ]),
  );
  expect(prs).toHaveLength(2);
  const [first, second] = prs;
  expect(first === undefined ? undefined : epicNumberOfPr(first)).toBe('20');
  expect(second === undefined ? undefined : epicNumberOfPr(second)).toBe('34');
  expect(indexPullRequests(prs).get('20')?.number).toBe(7);
  expect(parsePullRequestList('not json')).toEqual([]);
});

test('parses CLI flags and rejects unknown ones', () => {
  expect(parseArgs(['--repo=/tmp/x', '--no-gh', '--logs', 'none', '--json'])).toEqual({
    repo: '/tmp/x',
    useGh: false,
    json: true,
    help: false,
    logsDir: null,
  });
  expect(parseArgs(['--out', 'custom.json']).out).toBe('custom.json');
  expect(parseArgs(['--help']).help).toBe(true);
  expect(() => parseArgs(['--bogus'])).toThrow('unknown option');
  expect(() => parseArgs(['--repo'])).toThrow('needs a value');
  expect(USAGE).toContain('--no-gh');
});

test('assembleStats handles an empty repository', () => {
  const stats = assembleStats({
    repoRoot: '/tmp/empty',
    git: emptyGit(),
    rows: null,
    prs: null,
    handbacks: null,
    sessions: null,
    testsAfter: new Map(),
    generatedAt: Date.parse('2026-10-27T12:00:00Z'),
  });

  expect(stats.epics).toEqual([]);
  expect(stats.waves).toEqual([]);
  expect(stats.totals).toMatchObject({
    epics: 0,
    epicsObserved: 0,
    commits: 0,
    tests: 0,
    peakConcurrentAgents: 0,
    agentSessions: 0,
    wallTimeMs: 0,
    inFlight: 0,
  });
  expect(stats.sources).toEqual({ git: false, gh: false, epics: false, handbacks: false, logs: false });
  expect(stats.notes).toHaveLength(3);
  expect(summaryLines(stats)[0]).toContain('epics 0 merged');
});

test('assembleStats keeps a session-only epic as in flight', () => {
  const start = Date.parse('2026-10-27T15:00:00Z');
  const stats = assembleStats({
    repoRoot: '/tmp/repo',
    git: emptyGit(),
    rows: [
      {
        number: '68',
        slug: 'swarm-stats',
        title: 'Built-by-the-flock stats page',
        wave: '2',
        machine: 'mbp',
        lane: 'apps/web/src/features/about, tools/stats',
        depends: 'C2',
      },
    ],
    prs: [],
    handbacks: new Map([['68', 'missing']]),
    sessions: [
      {
        number: '68',
        slug: '68-swarm-stats',
        start,
        end: start + 90 * 60_000,
        logFile: '68-swarm-stats.log',
      },
    ],
    testsAfter: new Map(),
    generatedAt: start + 60 * 60_000,
  });

  expect(stats.epics).toHaveLength(1);
  expect(stats.epics[0]?.mergedAt).toBeUndefined();
  expect(stats.epics[0]?.startedAt).toBe('2026-10-27T15:00:00.000Z');
  expect(stats.epics[0]?.agentSession?.logFile).toBe('68-swarm-stats.log');
  expect(stats.totals).toMatchObject({ epics: 0, epicsObserved: 1, inFlight: 1, agentSessions: 1 });
  expect(stats.waves[0]).toMatchObject({ wave: '2', epics: 1, agents: 1, merged: 0, testsAfter: 0 });
});
