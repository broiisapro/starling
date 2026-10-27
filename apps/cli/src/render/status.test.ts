import { describe, expect, test } from 'bun:test';
import { BASE_TS } from '@starling/core/testing';
import { FINISHED_RUN, RUN } from '../testing/fixtures';
import { fixedPalette, plainPalette } from './palette';
import { renderStatus } from './status';

describe('renderStatus', () => {
  const plain = plainPalette();

  test('renders the run header, task table and cost meter (non-TTY snapshot)', () => {
    const text = renderStatus(RUN, { palette: plain, width: 100, now: BASE_TS + 62_000 });
    expect(text).not.toContain('\x1b[');
    expect(text).toContain('Starling run');
    expect(text).toContain(RUN.id);
    expect(text).toContain('starling/000000/integration');
    expect(text).toContain('33%');
    expect(text).toContain('theme');
    expect(text).toContain('Definition of done met.');
    expect(text).toContain('No new runtime dependencies');
    expect(text).toMatch(/api \$0\.012/);
    expect(text).toMatchSnapshot();
  });

  test('shows a finished run with every task merged', () => {
    const text = renderStatus(FINISHED_RUN, { palette: plain, width: 100 });
    expect(text).toContain('100%');
    expect(text).toContain('✔ 3 merged');
    expect(text).toContain('finished');
  });

  test('colours the status cells on a TTY', () => {
    const text = renderStatus(RUN, { palette: fixedPalette(true), width: 100, now: BASE_TS + 62_000 });
    expect(text).toContain('\x1b[');
    expect(text).toMatchSnapshot();
  });

  test('shows a failed run without colour', () => {
    const failed = {
      ...FINISHED_RUN,
      status: 'failed' as const,
      tasks: {
        ...FINISHED_RUN.tasks,
        search: {
          ...(FINISHED_RUN.tasks.search as NonNullable<(typeof FINISHED_RUN.tasks)['search']>),
          status: 'failed' as const,
          lastVerdict: {
            taskKey: 'search',
            attempt: 3,
            pass: false,
            checks: [],
            laneViolations: [],
            summary: 'Tests failed after 3 attempts.',
            model: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
            ts: BASE_TS,
          },
        },
      },
      metrics: { ...FINISHED_RUN.metrics, tasksFailed: 1, tasksMerged: 2 },
    };
    const text = renderStatus(failed, { palette: plain, width: 100 });
    expect(text).toContain('failed');
    expect(text).toContain('Tests failed after 3 attempts.');
    expect(text).toContain('✘ 1 failed');
  });
});
