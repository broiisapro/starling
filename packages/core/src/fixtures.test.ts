import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plan, RepoMap, StarlingEvent } from './contracts';
import { PlanSchema, RepoMapSchema, StarlingEventSchema } from './contracts';
import { globsOverlap } from './glob';

const FIXTURES = join(import.meta.dir, '../../../fixtures');

function readFixture<T>(path: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, path), 'utf8')) as T;
}

function readRun(): StarlingEvent[] {
  const raw = readFileSync(join(FIXTURES, 'runs/sky-todo-launch-day.jsonl'), 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const parsed = StarlingEventSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`Fixture line ${index + 1} is not a StarlingEvent: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}

describe('fixtures/repomaps/sky-todo.json', () => {
  test('is a valid RepoMap for the demo app', () => {
    const map = RepoMapSchema.parse(readFixture<RepoMap>('repomaps/sky-todo.json'));
    expect(map.root).toBe('examples/sky-todo');
    expect(map.testCommand).toBe('bun test');
    expect(map.files.length).toBeGreaterThan(10);
    expect(map.files.map((f) => f.path)).toContain('src/lib/dates.ts');
    expect(map.tokenEstimate).toBeGreaterThan(0);
    expect(map.languages.typescript).toBeGreaterThan(0);
  });
});

describe('fixtures/plans/sky-todo-launch-day.json', () => {
  const plan = PlanSchema.parse(readFixture<Plan>('plans/sky-todo-launch-day.json'));

  test('is a valid seven-task plan with two dependency edges', () => {
    expect(plan.tasks).toHaveLength(7);
    const keys = plan.tasks.map((t) => t.key);
    expect(new Set(keys).size).toBe(7);
    const edges = plan.tasks.flatMap((t) => t.dependsOn.map((dep) => `${dep}->${t.key}`));
    expect(edges.sort()).toEqual(['dates-fix->due-badges', 'shortcuts->help-overlay']);
    for (const task of plan.tasks) {
      for (const dep of task.dependsOn) expect(keys).toContain(dep);
      expect(task.definitionOfDone.length).toBeGreaterThan(0);
      expect(task.lane.owns.length).toBeGreaterThan(0);
    }
  });

  test('lanes only overlap when there is a dependency path', () => {
    const byKey = new Map(plan.tasks.map((t) => [t.key, t]));
    const dependsOn = (from: string, target: string): boolean => {
      const seen = new Set<string>();
      const stack = [...(byKey.get(from)?.dependsOn ?? [])];
      while (stack.length > 0) {
        const key = stack.pop() as string;
        if (key === target) return true;
        if (seen.has(key)) continue;
        seen.add(key);
        stack.push(...(byKey.get(key)?.dependsOn ?? []));
      }
      return false;
    };

    for (const a of plan.tasks) {
      for (const b of plan.tasks) {
        if (a.key >= b.key) continue;
        const overlap = globsOverlap(a.lane.owns, b.lane.owns);
        if (overlap.length > 0) {
          expect(dependsOn(a.key, b.key) || dependsOn(b.key, a.key)).toBe(true);
        }
      }
    }
  });

  test('the demo goal names every feature', () => {
    const run = readRun();
    const created = run.find((e) => e.type === 'run.created');
    if (created?.type !== 'run.created') throw new Error('missing run.created');
    for (const word of ['dark mode', 'search', 'CSV', 'shortcuts', 'due-date', 'overdue']) {
      expect(created.payload.run.goal.text.toLowerCase()).toContain(word.toLowerCase());
    }
  });
});

describe('fixtures/runs/sky-todo-launch-day.jsonl', () => {
  const run = readRun();

  test('is a rich, parsed event stream', () => {
    expect(run.length).toBeGreaterThanOrEqual(150);
    expect(run.length).toBeLessThanOrEqual(400);
    const types = new Set(run.map((e) => e.type));
    expect(types).toEqual(
      new Set([
        'run.created',
        'repomap.ready',
        'plan.created',
        'task.status',
        'agent.event',
        'audit.verdict',
        'merge.result',
        'metrics',
        'log',
        'node.joined',
        'node.left',
        'node.stats',
        'task.migrated',
        'run.finished',
      ]),
    );
  });

  test('timestamps are monotonic and span about six minutes', () => {
    for (let i = 1; i < run.length; i += 1) {
      expect(run[i]?.ts).toBeGreaterThanOrEqual(run[i - 1]?.ts ?? 0);
    }
    const first = run[0]?.ts ?? 0;
    const last = run.at(-1)?.ts ?? 0;
    expect(last - first).toBeGreaterThan(300_000);
    expect(last - first).toBeLessThan(420_000);
  });

  test('starts with run.created, ends with run.finished, ticks metrics every 5s', () => {
    expect(run[0]?.type).toBe('run.created');
    expect(run.at(-1)?.type).toBe('run.finished');
    const metrics = run.filter((e) => e.type === 'metrics');
    expect(metrics.length).toBeGreaterThanOrEqual(60);
  });

  test('the agent streams include text, tools, edits and usage', () => {
    const kinds = new Set(
      run
        .filter((e) => e.type === 'agent.event')
        .map((e) => (e.type === 'agent.event' ? e.payload.kind : '')),
    );
    for (const kind of [
      'session.started',
      'text',
      'tool.call',
      'tool.result',
      'file.edited',
      'usage',
      'session.idle',
    ]) {
      expect(kinds.has(kind as never)).toBe(true);
    }
  });

  test('theme fails audit attempt 1 and passes on attempt 2', () => {
    const verdicts = run
      .filter((e) => e.type === 'audit.verdict')
      .map((e) => (e.type === 'audit.verdict' ? e.payload : undefined));
    const theme = verdicts.filter((v) => v?.taskKey === 'theme');
    expect(theme).toHaveLength(2);
    expect(theme[0]?.pass).toBe(false);
    expect(theme[0]?.fixInstructions).toBeTruthy();
    expect(theme[1]?.pass).toBe(true);
    expect(theme[1]?.attempt).toBe(2);
  });

  test('merges respect the DAG', () => {
    const merged = run
      .filter((e) => e.type === 'merge.result' && e.payload.status === 'merged')
      .map((e) => (e.type === 'merge.result' ? e.payload : undefined));
    const at = (key: string): number => merged.find((m) => m?.taskKey === key)?.ts ?? Number.NaN;
    expect(at('dates-fix')).toBeLessThan(at('due-badges'));
    expect(at('shortcuts')).toBeLessThan(at('help-overlay'));

    const finished = run.at(-1);
    if (finished?.type !== 'run.finished') throw new Error('missing run.finished');
    expect(Object.values(finished.payload.run.tasks).every((t) => t.status === 'merged')).toBe(true);
    expect(finished.payload.summary.toLowerCase()).toContain('merged');
  });

  test('the flock story: a perch joins, takes work, drops, and a task migrates', () => {
    const joined = run.filter((e) => e.type === 'node.joined');
    const air = joined.find((e) => e.type === 'node.joined' && e.payload.node.id === 'air');
    expect(air).toBeDefined();
    if (air?.type !== 'node.joined') throw new Error('missing air');
    expect(air.payload.node.kind).toBe('remote');

    const ranOnAir = run.filter(
      (e) => e.type === 'task.status' && e.payload.to === 'running' && e.payload.run.nodeId === 'air',
    );
    expect(ranOnAir.length).toBeGreaterThanOrEqual(3);

    expect(run.some((e) => e.type === 'node.left' && e.payload.nodeId === 'air')).toBe(true);
    expect(run.some((e) => e.type === 'task.migrated' && e.payload.fromNode === 'air')).toBe(true);
    expect(run.filter((e) => e.type === 'node.stats').length).toBeGreaterThanOrEqual(8);
  });

  test('metrics track merges, active agents and the API/local split', () => {
    const metrics = run
      .filter((e) => e.type === 'metrics')
      .map((e) => (e.type === 'metrics' ? e.payload : undefined));
    expect(metrics.some((m) => (m?.agentsActive ?? 0) > 1)).toBe(true);
    expect(metrics.at(-1)?.tasksMerged).toBe(7);
    expect(metrics.at(-1)?.apiUsage.input).toBeGreaterThan(0);
    expect(metrics.at(-1)?.localUsage.input).toBeGreaterThan(0);
    expect(metrics.at(-1)?.apiCostUsd).toBeGreaterThan(0);
    expect(metrics.at(-1)?.estSavedUsd).toBeGreaterThan(0);
  });
});
