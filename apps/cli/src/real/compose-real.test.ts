import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { defaultConfig, exec, type LLMRequest, type StarlingEvent } from '@starling/core';
import { MockLLM } from '@starling/core/testing';
import { createOpencodeRunner } from '@starling/runner';
// The runner's own fake server is the only thing that speaks enough of the opencode v2 API to run a
// real session; importing it from its test helpers keeps this test offline (AGENTS.md §4, L23).
import {
  createFakeOpencodeServer,
  type FakeOpencodeServer,
} from '../../../../packages/runner/test/fake-opencode';
import { tmpDir } from '../testing/tmp';
import { composeReal, type RealComposition } from './compose-real';

/**
 * The real composition, end to end, with fakes only at the two edges that would otherwise leave the
 * machine: `MockLLM` for planner/auditor/writer and the runner's in-process fake `opencode serve` for
 * the agents. Everything between them is the genuine stack — real git worktrees, the real engine,
 * the real auditor, the real merge queue and a real SQLite store.
 */

const PACKAGE_JSON = `${JSON.stringify(
  { name: 'fixture', private: true, type: 'module', scripts: { test: 'bun test' } },
  null,
  2,
)}\n`;

// The test imports a *dependency*, exactly like sky-todo's tests import happy-dom: a task worktree
// without `node_modules` fails, and so does the merge queue's integration worktree.
const BASE_TEST = `import { expect, test } from 'bun:test';
import { twice } from 'fixture-dep';
import { base } from './base';

test('base is one', () => {
  expect(base).toBe(1);
  expect(twice(2)).toBe(4);
});
`;

const DRAFT = {
  summary: 'two independent files in disjoint lanes',
  lockedDecisions: ['bun + bun:test', 'no network in tests', 'plain TypeScript, no framework'],
  tasks: [
    {
      key: 'one',
      title: 'Add src/one.ts',
      goal: 'Create src/one.ts exporting a constant.',
      deliverables: ['src/one.ts'],
      outOfScope: ['src/base.ts', 'src/two.ts'],
      definitionOfDone: ['bun run test passes', 'src/one.ts exports one'],
      dependsOn: [],
      lane: { owns: ['src/one.ts'], reads: ['src/base.ts'] },
      estimateMin: 5,
    },
    {
      key: 'two',
      title: 'Add src/two.ts',
      goal: 'Create src/two.ts exporting a constant.',
      deliverables: ['src/two.ts'],
      outOfScope: ['src/base.ts', 'src/one.ts'],
      definitionOfDone: ['bun run test passes', 'src/two.ts exports two'],
      dependsOn: [],
      lane: { owns: ['src/two.ts'], reads: ['src/base.ts'] },
      estimateMin: 5,
    },
  ],
};

function scriptedLlm(): MockLLM {
  return new MockLLM({
    responder: (req: LLMRequest) => {
      switch (req.role) {
        case 'planner':
          return { text: JSON.stringify(DRAFT), parsed: DRAFT };
        case 'auditor':
          return {
            text: '{}',
            parsed: {
              pass: true,
              summary: 'the file exists and the suite is green',
              dod: [{ item: 'file exists', met: true, evidence: 'changedFiles' }],
            },
          };
        case 'writer':
          return { text: 'Both new modules landed on the integration branch.' };
        default:
          return { text: '{}', parsed: {} };
      }
    },
  });
}

/** A throwaway git repo with one passing test, so the merge queue has something real to verify. */
async function makeRepo(): Promise<string> {
  const dir = tmpDir();
  writeFileSync(join(dir, 'package.json'), PACKAGE_JSON);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'base.ts'), 'export const base = 1;\n');
  writeFileSync(join(dir, 'src', 'base.test.ts'), BASE_TEST);
  // A installed-looking dependency: gitignored, present only in the checkout.
  mkdirSync(join(dir, 'node_modules', 'fixture-dep'), { recursive: true });
  writeFileSync(
    join(dir, 'node_modules', 'fixture-dep', 'package.json'),
    JSON.stringify({ name: 'fixture-dep', version: '1.0.0', main: 'index.js' }),
  );
  writeFileSync(join(dir, 'node_modules', 'fixture-dep', 'index.js'), 'exports.twice = (n) => n * 2;\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  const git = (args: string[]) => exec(['git', ...args], { cwd: dir, timeoutMs: 20_000 });
  await git(['init', '-q', '-b', 'main']);
  await git(['add', '-A']);
  await git([
    '-c',
    'user.email=fixture@starling.local',
    '-c',
    'user.name=Fixture',
    'commit',
    '-q',
    '-m',
    'init',
  ]);
  return dir;
}

describe('composeReal', () => {
  let composition: RealComposition | undefined;
  let server: FakeOpencodeServer | undefined;

  afterEach(async () => {
    await composition?.close();
    composition = undefined;
    server?.close();
    server = undefined;
  });

  test('runs a two-task plan to completion on real worktrees and a real store', async () => {
    const repo = await makeRepo();
    const fake = createFakeOpencodeServer({
      onPrompt: ({ sessionId, emit, setActive, server: fakeServer }) => {
        const dir = fakeServer.sessions.get(sessionId)?.directory;
        if (dir === undefined) throw new Error('the fake session has no directory');
        // The worktree directory ends in the task key: `<worktreeRoot>/starling-<run>-one`.
        // (The prompt is no good for this: it lists every sibling task's lane too.)
        const target = basename(dir).endsWith('one') ? 'src/one.ts' : 'src/two.ts';
        const file = join(dir, target);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `export const value = '${target}';\n`);
        emit({ type: 'file.edited', data: { file: target } });
        setActive(false);
        emit({ type: 'session.idle', data: { sessionID: sessionId } });
      },
    });
    server = fake;
    const runner = createOpencodeRunner({
      mode: 'attach',
      url: fake.url,
      ...(fake.password === undefined ? {} : { password: fake.password }),
      textDebounceMs: 0,
    });

    const events: StarlingEvent[] = [];
    const llm = scriptedLlm();
    composition = composeReal(defaultConfig, {
      repoPath: repo,
      llm,
      runner,
      profile: 'opencode',
      env: {},
      worktreeRoot: join(repo, '..', `${repo.split('/').at(-1) ?? 'fixture'}-worktrees`),
    });
    composition.bus.subscribe((event) => events.push(event));

    const { runId } = await composition.engine.start({ goal: 'add two modules', repoPath: repo });
    const run = await composition.engine.waitForFinish(runId);

    expect(run.status).toBe('finished');
    expect(Object.values(run.tasks).map((task) => task.status)).toEqual(['merged', 'merged']);
    expect(run.integrationBranch).toBeDefined();

    // Every task's file is on the integration branch — a real git merge, not a mock.
    const branch = run.integrationBranch ?? '';
    for (const file of ['src/one.ts', 'src/two.ts']) {
      const show = await exec(['git', 'show', `${branch}:${file}`], { cwd: repo, timeoutMs: 10_000 });
      expect(show.code).toBe(0);
    }
    const log = await exec(['git', 'log', '--oneline', `main..${branch}`], {
      cwd: repo,
      timeoutMs: 10_000,
    });
    expect(log.stdout).toContain('merge(two)');
    expect(log.stdout).toContain('merge(one)');

    // The recorder is the only writer: one store row per published event, no duplicates.
    expect(composition.store.events(runId)).toHaveLength(events.length);
    expect(events.some((event) => event.type === 'agent.event')).toBe(true);
    expect(events.some((event) => event.type === 'merge.result')).toBe(true);
    expect(llm.calls.filter((call) => call.role === 'planner')).toHaveLength(1);
  }, 60_000);
});
