import { describe, expect, test } from 'bun:test';
import { buildHarness, loadFixturePlan } from './testing/harness';

/**
 * Golden trace of the engine's happy path over the sky-todo launch-day fixture.
 *
 * This is deliberately a literal: any refactor that reorders dispatch, promotion or the merge queue
 * must update this list on purpose. Each entry is `<taskKey>:<from>-><to>` in event order.
 */
const GOLDEN_SEQUENCE = [
  'theme:pending->ready',
  'search:pending->ready',
  'csv-export:pending->ready',
  'shortcuts:pending->ready',
  'dates-fix:pending->ready',
  'theme:ready->running',
  'search:ready->running',
  'csv-export:ready->running',
  'shortcuts:ready->running',
  'dates-fix:ready->running',
  'theme:running->auditing',
  'search:running->auditing',
  'csv-export:running->auditing',
  'shortcuts:running->auditing',
  'dates-fix:running->auditing',
  'theme:auditing->merging',
  'search:auditing->merging',
  'csv-export:auditing->merging',
  'shortcuts:auditing->merging',
  'dates-fix:auditing->merging',
  'theme:merging->merged',
  'search:merging->merged',
  'csv-export:merging->merged',
  'shortcuts:merging->merged',
  'help-overlay:pending->ready',
  'help-overlay:ready->running',
  'dates-fix:merging->merged',
  'due-badges:pending->ready',
  'due-badges:ready->running',
  'help-overlay:running->auditing',
  'due-badges:running->auditing',
  'help-overlay:auditing->merging',
  'due-badges:auditing->merging',
  'help-overlay:merging->merged',
  'due-badges:merging->merged',
];

describe('golden trace', () => {
  test('the happy path emits exactly the frozen task.status sequence', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    await h.finish();
    const actual = h.statusEvents().map((event) => `${event.taskKey}:${event.from}->${event.to}`);
    expect(actual).toEqual(GOLDEN_SEQUENCE);
  });

  test('the sequence is stable across repeated runs', async () => {
    const sequences: string[][] = [];
    for (let i = 0; i < 3; i += 1) {
      const h = buildHarness({ plan: loadFixturePlan() });
      await h.finish();
      sequences.push(h.statusEvents().map((event) => `${event.taskKey}:${event.from}->${event.to}`));
    }
    expect(sequences[1]).toEqual(sequences[0]);
    expect(sequences[2]).toEqual(sequences[0]);
  });

  test('the whole event envelope also has a stable shape', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    await h.finish();
    const counts: Record<string, number> = {};
    for (const event of h.events) counts[event.type] = (counts[event.type] ?? 0) + 1;
    const { metrics, log: logs, ...rest } = counts;
    expect(rest).toEqual({
      'run.created': 1,
      'repomap.ready': 1,
      'plan.created': 1,
      'task.status': 35,
      'agent.event': 49,
      'audit.verdict': 7,
      'merge.result': 7,
      'run.status': 4,
      'run.finished': 1,
    });
    expect(metrics).toBeGreaterThanOrEqual(1);
    expect(logs ?? 0).toBeGreaterThanOrEqual(0);
  });
});
