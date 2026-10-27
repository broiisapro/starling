import { describe, expect, test } from 'bun:test';
import { emptyLiveState } from '../live-state';
import { liveState } from '../testing/fixtures';
import { renderLive } from './live';
import { fixedPalette, plainPalette } from './palette';

describe('renderLive', () => {
  const plain = plainPalette();

  test('renders one line per task, a footer and costs (non-TTY snapshot)', () => {
    const text = renderLive(liveState(), { palette: plain, width: 100 });
    expect(text).not.toContain('\x1b[');
    expect(text).toContain('Starling');
    expect(text).toContain('merged');
    expect(text).toContain('running');
    expect(text).toContain('pending');
    expect(text).toContain('1 merged');
    expect(text).toMatch(/api \$0\.012/);
    expect(text).toMatch(/local \$0/);
    expect(text).toMatch(/saved \$0\.00[45]/);
    expect(text).toContain('read src/store/todos.ts');
    expect(text).toMatchSnapshot();
  });

  test('colours status names on a TTY', () => {
    const text = renderLive(liveState(), { palette: fixedPalette(true), width: 100 });
    expect(text).toContain('\x1b[');
    expect(text).toContain('✔');
    expect(text).toMatchSnapshot();
  });

  test('shows the finished state and all-merged footer', () => {
    const state = liveState({ now: 1_700_000_000_000 + 372_000 });
    state.run = {
      ...(state.run as NonNullable<typeof state.run>),
      status: 'finished',
      finishedAt: 1_700_000_000_000 + 372_000,
    };
    for (const task of Object.values(state.run.tasks)) task.status = 'merged';
    state.run.metrics.tasksMerged = 3;
    const text = renderLive(state, { palette: plain, width: 100 });
    expect(text).toContain('finished');
    expect(text).toContain('3 merged');
    expect(text).toContain('100%');
  });

  test('waits politely before the first event', () => {
    expect(renderLive(emptyLiveState(), { palette: plain, width: 80 })).toContain('Waiting for the flock');
  });

  test('clips a long last action instead of wrapping the table', () => {
    const state = liveState({
      lastActions: { search: 'a very long action '.repeat(20) },
    });
    const text = renderLive(state, { palette: plain, width: 100 });
    const line = text.split('\n').find((candidate) => candidate.includes('search '));
    expect(line?.length ?? 0).toBeLessThanOrEqual(100);
  });
});
