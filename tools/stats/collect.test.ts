import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { collectStats, writeStats } from './collect';
import { type RunCommand, runCommand } from './exec';
import { SWARM_STATS_VERSION } from './types';

/**
 * End-to-end collector tests against a throwaway git repository.
 *
 * The repo is built for real (`git init`, branches, squash merges, `epic-NN-complete` tags) so the
 * git commands are exercised exactly as they are on the Starling checkout. GitHub is the only fake:
 * a `RunCommand` that answers `gh` from `fixtures/gh-prs.json` and delegates everything else to git.
 */

const FIXTURE_GH = new URL('./fixtures/gh-prs.json', import.meta.url);
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const result = await runCommand(['git', ...args], { cwd, env });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

async function commit(cwd: string, message: string, date: string): Promise<void> {
  await git(cwd, ['add', '-A']);
  await git(
    cwd,
    ['-c', 'user.name=Stats Fixture', '-c', 'user.email=stats@example.test', 'commit', '-m', message],
    { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  );
}

async function write(cwd: string, path: string, content: string): Promise<void> {
  const full = join(cwd, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
}

async function writeLog(path: string, header: string, slug: string, endMs: number): Promise<void> {
  await writeFile(path, `=== ${header} :: ${slug} :: model test-model :: ui run ===\nworked\n`);
  const end = new Date(endMs);
  await utimes(path, end, end);
}

interface Fixture {
  root: string;
  repo: string;
  logs: string;
  run: RunCommand;
  ghCalls: string[][];
}

const EPICS_TSV = [
  'nn\tslug\ttitle\twave\tmachine\tlane\tdepends',
  '00\tfoundation\tFoundation & frozen contracts\t0\tmbp\troot, packages/core\t-',
  '10\tllm\tLLM router\t1\tmbp\tpackages/llm\t00',
  '',
].join('\n');

async function buildFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'starling-stats-'));
  created.push(root);
  const repo = join(root, 'repo');
  const logs = join(root, '_logs');
  await mkdir(repo, { recursive: true });
  await mkdir(logs, { recursive: true });

  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  await write(repo, '.orchestrator/epics.tsv', EPICS_TSV);
  await write(
    repo,
    '.orchestrator/handbacks/00-foundation.md',
    '## Epic 00 Handback\n**Status:** Complete. Branch `epic/00-foundation`.\n',
  );
  await write(repo, 'README.md', '# fixture\n');
  await commit(repo, 'chore: init', '2026-10-27T13:50:00Z');

  // Epic 00: two commits on a branch, squash-merged, tagged.
  await git(repo, ['checkout', '-b', 'epic/00-foundation']);
  await write(repo, 'packages/core/src/a.ts', 'export const a = 1;\n');
  await write(
    repo,
    'packages/core/src/a.test.ts',
    "import { expect, test } from 'bun:test';\n\ntest('a', () => {\n  expect(1).toBe(1);\n});\n\ntest('b', () => {\n  expect(2).toBe(2);\n});\n",
  );
  await commit(repo, 'feat(core): a', '2026-10-27T14:10:00Z');
  await write(repo, 'packages/core/src/a.ts', 'export const a = 2;\nexport const b = 3;\n');
  await commit(repo, 'fix(core): b', '2026-10-27T14:20:00Z');
  await git(repo, ['checkout', 'main']);
  await git(repo, ['merge', '--squash', 'epic/00-foundation']);
  await commit(repo, 'epic(00): foundation (#1)', '2026-10-27T14:45:00Z');
  await git(repo, ['tag', 'epic-00-complete']);

  // Epic 10: three commits, squash-merged, tagged.
  await git(repo, ['checkout', '-b', 'epic/10-llm']);
  await write(repo, 'packages/llm/src/router.ts', 'export const route = () => 1;\n');
  await write(
    repo,
    'packages/llm/src/router.test.ts',
    "import { expect, test } from 'bun:test';\n\ntest('routes', () => {\n  expect(1).toBe(1);\n});\n",
  );
  await commit(repo, 'feat(llm): router', '2026-10-27T15:00:00Z');
  await write(repo, 'packages/llm/src/router.ts', 'export const route = () => 2;\n');
  await commit(repo, 'feat(llm): retry', '2026-10-27T15:05:00Z');
  await write(repo, 'packages/llm/src/extra.ts', 'export const extra = true;\n');
  await commit(repo, 'feat(llm): extra', '2026-10-27T15:10:00Z');
  await git(repo, ['checkout', 'main']);
  await git(repo, ['merge', '--squash', 'epic/10-llm']);
  await commit(repo, 'epic(10): LLM router (#2)', '2026-10-27T15:20:00Z');
  await git(repo, ['tag', 'epic-10-complete']);

  // Two overlapping agent sessions: 14:00-14:30 and 14:20-15:00.
  await writeLog(
    join(logs, '00-foundation.log'),
    'Tue 27 Oct 2026 14:00:00 UTC',
    '00-foundation',
    Date.parse('2026-10-27T14:30:00Z'),
  );
  await writeLog(
    join(logs, '10-llm.log'),
    'Tue 27 Oct 2026 14:20:00 UTC',
    '10-llm',
    Date.parse('2026-10-27T15:00:00Z'),
  );

  const ghJson = await readFile(FIXTURE_GH, 'utf8');
  const ghCalls: string[][] = [];
  const run: RunCommand = async (cmd, opts) => {
    if (cmd[0] === 'gh') {
      ghCalls.push(cmd);
      return { code: 0, stdout: ghJson, stderr: '' };
    }
    return runCommand(cmd, opts);
  };

  return { root, repo, logs, run, ghCalls };
}

test('collects epics, PRs, tests, durations and waves from a fixture repo', async () => {
  const fixture = await buildFixture();
  const stats = await collectStats({
    repo: fixture.repo,
    logsDir: fixture.logs,
    run: fixture.run,
    now: Date.parse('2026-10-27T16:00:00Z'),
  });

  expect(stats.version).toBe(SWARM_STATS_VERSION);
  expect(stats.generatedAt).toBe('2026-10-27T16:00:00.000Z');
  expect(stats.sources).toEqual({ git: true, gh: true, epics: true, handbacks: true, logs: true });
  expect(stats.notes).toEqual([]);
  expect(stats.repo.head).toBeTruthy();
  expect(stats.repo.root.endsWith('repo')).toBe(true);

  expect(stats.epics.map((epic) => epic.number)).toEqual(['00', '10']);
  const [epic0, epic10] = stats.epics;
  expect(epic0?.title).toBe('Foundation & frozen contracts');
  expect(epic0?.commits).toBe(2);
  expect(epic0?.added).toBe(11);
  expect(epic0?.testsAdded).toBe(1);
  expect(epic0?.pr).toBe(1);
  expect(epic0?.prUrl).toBe('https://github.com/example/starling/pull/1');
  expect(epic0?.mergedAt).toBe('2026-10-27T14:45:00.000Z');
  expect(epic0?.startedAt).toBe('2026-10-27T14:00:00.000Z');
  expect(epic0?.durationMs).toBe(45 * 60_000);
  expect(epic0?.handbackStatus).toBe('complete');

  expect(epic10?.commits).toBe(3);
  expect(epic10?.pr).toBe(2);
  expect(epic10?.handbackStatus).toBe('missing');
  expect(epic10?.durationMs).toBe(60 * 60_000);

  expect(stats.totals).toMatchObject({
    epics: 2,
    epicsObserved: 2,
    plannedEpics: 0,
    prs: 2,
    commits: 5,
    tests: 3,
    testFiles: 2,
    testsAdded: 2,
    waves: 2,
    agentSessions: 2,
    peakConcurrentAgents: 2,
    inFlight: 0,
    mergedPrsFromGh: 2,
  });

  expect(stats.waves.map((wave) => wave.wave)).toEqual(['0', '1']);
  expect(stats.waves[0]?.testsAfter).toBe(2);
  expect(stats.waves[0]?.testsAfterRef).toBe('epic-00-complete');
  expect(stats.waves[1]?.testsAfter).toBe(3);
  expect(stats.waves[1]?.merged).toBe(1);

  expect(fixture.ghCalls[0]).toContain('--state');
  expect(fixture.ghCalls[0]).toContain('merged');
});

test('degrades to tags when GitHub is skipped', async () => {
  const fixture = await buildFixture();
  const stats = await collectStats({
    repo: fixture.repo,
    logsDir: fixture.logs,
    run: fixture.run,
    useGh: false,
  });

  expect(stats.sources.gh).toBe(false);
  expect(stats.notes.some((note) => note.startsWith('gh:'))).toBe(true);
  expect(stats.totals.prs).toBe(0);
  expect(stats.totals.mergedPrsFromGh).toBe(0);
  expect(stats.epics[0]?.pr).toBeUndefined();
  // The tag still tells us the epic merged, so it stays in the merged count.
  expect(stats.epics[0]?.mergedAt).toBe('2026-10-27T14:45:00.000Z');
  expect(stats.totals.epics).toBe(2);
});

test('degrades when the agent logs are missing', async () => {
  const fixture = await buildFixture();
  const stats = await collectStats({ repo: fixture.repo, logsDir: null, run: fixture.run });

  expect(stats.sources.logs).toBe(false);
  expect(stats.notes).toContain('logs: agent log directory missing');
  expect(stats.totals.agentSessions).toBe(0);
  expect(stats.totals.agentHours).toBe(0);
  // No sessions, so the peak falls back to the busiest wave (one epic each here).
  expect(stats.totals.peakConcurrentAgents).toBe(1);
  expect(stats.epics[0]?.startedAt).toBe('2026-10-27T14:10:00.000Z');
});

test('derives titles and waves when epics.tsv and handbacks are absent', async () => {
  const fixture = await buildFixture();
  await rm(join(fixture.repo, '.orchestrator'), { recursive: true, force: true });

  const stats = await collectStats({ repo: fixture.repo, logsDir: fixture.logs, run: fixture.run });

  expect(stats.sources.epics).toBe(false);
  expect(stats.sources.handbacks).toBe(false);
  expect(stats.epics.map((epic) => epic.slug)).toEqual(['foundation', 'llm']);
  expect(stats.epics[0]?.title).toBe('Foundation');
  expect(stats.epics.every((epic) => epic.wave === 'unknown')).toBe(true);
  expect(stats.epics.every((epic) => epic.handbackStatus === 'unavailable')).toBe(true);
  expect(stats.waves).toHaveLength(1);
  expect(stats.notes.some((note) => note.startsWith('epics.tsv:'))).toBe(true);
});

test('writeStats creates the output directory and writes parseable JSON', async () => {
  const fixture = await buildFixture();
  const stats = await collectStats({ repo: fixture.repo, logsDir: null, run: fixture.run });
  const out = join(fixture.root, 'out/deep/stats.json');

  const written = await writeStats(stats, out);
  expect(written).toBe(out);
  const parsed = JSON.parse(await readFile(written, 'utf8'));
  expect(parsed.version).toBe(SWARM_STATS_VERSION);
  expect(parsed.totals.epics).toBe(2);
});
