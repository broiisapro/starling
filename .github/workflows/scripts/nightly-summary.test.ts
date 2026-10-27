import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readSummaryInputs, SUMMARY_PATHS, summaryTable } from './nightly-summary.ts';

const tempDirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'starling-nightly-'));
  tempDirs.push(dir);
  return dir;
}

function writeJson(root: string, relative: string, value: unknown): void {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const plannerReport = {
  summary: { caseCount: 12, meanScore: 1, threshold: 0.85, passed: true },
};
const auditorReport = {
  summary: { caseCount: 8, accuracy: 0.95, falsePassRate: 0.1, threshold: 0.9, passed: true },
};
const loadReport = {
  quick: true,
  engine: { wallMs: 2100 },
  sse: { wallMs: 1400 },
  reducer: { totalEvents: 6000 },
};
const statsReport = {
  totals: { epics: 28, prs: 30, tests: 2500, agentSessions: 31 },
};

describe('summaryTable', () => {
  test('renders one row per check with the headline number', () => {
    const table = summaryTable({
      planner: { cases: 12, meanScore: 1, passed: true },
      auditor: { cases: 8, accuracy: 0.95, falsePassRate: 0.1, passed: true },
      load: { quick: true, engineWallMs: 2100, sseWallMs: 1400, reducerEvents: 6000 },
      stats: { epics: 28, prs: 30, tests: 2500, agents: 31 },
    });
    expect(table).toContain('| Nightly check | Result |');
    expect(table).toContain('12 cases · mean 1.000 · pass');
    expect(table).toContain('accuracy 0.950');
    expect(table).toContain('Quick load (quick) | engine 2100 ms');
    expect(table).toContain('28 epics · 30 PRs · 2500 tests');
  });

  test('a missing check is reported, not thrown', () => {
    const table = summaryTable({});
    expect(table.match(/not produced/g)).toHaveLength(4);
  });

  test('a failing eval is spelled out', () => {
    const table = summaryTable({ planner: { cases: 12, meanScore: 0.7, passed: false } });
    expect(table).toContain('mean 0.700 · FAIL');
  });
});

describe('readSummaryInputs', () => {
  test('reads the four nightly artifacts', () => {
    const root = tempRoot();
    writeJson(root, SUMMARY_PATHS.planner, plannerReport);
    writeJson(root, SUMMARY_PATHS.auditor, auditorReport);
    writeJson(root, SUMMARY_PATHS.load, loadReport);
    writeJson(root, SUMMARY_PATHS.stats, statsReport);
    expect(readSummaryInputs(root)).toEqual({
      planner: { cases: 12, meanScore: 1, passed: true },
      auditor: { cases: 8, accuracy: 0.95, falsePassRate: 0.1, passed: true },
      load: { quick: true, engineWallMs: 2100, sseWallMs: 1400, reducerEvents: 6000 },
      stats: { epics: 28, prs: 30, tests: 2500, agents: 31 },
    });
  });

  test('an absent or malformed file is simply skipped', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'stats.json'), 'not json');
    expect(readSummaryInputs(root)).toEqual({});
  });

  test('a partial report is skipped rather than rendered with NaN', () => {
    const root = tempRoot();
    writeJson(root, SUMMARY_PATHS.planner, { summary: { caseCount: 3 } });
    expect(readSummaryInputs(root).planner).toBeUndefined();
  });
});
