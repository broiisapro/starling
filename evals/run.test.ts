import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const tempDirs: string[] = [];

interface Report {
  suite: string;
  impl: string;
  caseName: string | null;
  cases: Array<{ caseName?: string; name?: string; score?: number }>;
  summary: Record<string, unknown>;
}

interface RunResult {
  code: number;
  text: string;
  report: Report | undefined;
}

async function runEvals(args: string[]): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), 'starling-evals-'));
  tempDirs.push(dir);
  const out = join(dir, 'report.json');
  const proc = Bun.spawn([process.execPath, 'evals/run.ts', ...args, '--out', out], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const text = `${stdout}${stderr}`;
  const report = code === 0 ? (JSON.parse(readFileSync(out, 'utf8')) as Report) : undefined;
  return { code, text, report };
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('run.ts --impl mock', () => {
  test('planner mock run scores every case perfectly and writes the report', async () => {
    const { code, text, report } = await runEvals(['planner', '--impl', 'mock']);
    expect(code).toBe(0);
    expect(text).toContain('PASS');
    expect(report?.suite).toBe('planner');
    expect(report?.impl).toBe('mock');
    expect(report?.cases.length).toBe(8);
    expect(report?.summary.meanScore).toBe(1);
    expect(report?.summary.passed).toBe(true);
  }, 30_000);

  test('auditor mock run is perfectly accurate on the twelve seeded diffs', async () => {
    const { code, text, report } = await runEvals(['auditor', '--impl', 'mock']);
    expect(code).toBe(0);
    expect(text).toContain('accuracy 1.000');
    expect(report?.suite).toBe('auditor');
    expect(report?.cases.length).toBe(12);
    expect(report?.summary.accuracy).toBe(1);
    expect(report?.summary.falsePassRate).toBe(0);
  }, 30_000);

  test('--case narrows the suite to one case', async () => {
    const { code, report } = await runEvals(['planner', '--impl', 'mock', '--case', 'sky-todo-quick-wins']);
    expect(code).toBe(0);
    expect(report?.caseName).toBe('sky-todo-quick-wins');
    expect(report?.cases.length).toBe(1);
    expect(report?.cases[0]?.caseName).toBe('sky-todo-quick-wins');
  }, 30_000);

  test('an unknown case fails with a readable message', async () => {
    const { code, text } = await runEvals(['auditor', '--impl', 'mock', '--case', 'not-a-case']);
    expect(code).not.toBe(0);
    expect(text).toContain('Unknown auditor case');
  }, 30_000);
});
