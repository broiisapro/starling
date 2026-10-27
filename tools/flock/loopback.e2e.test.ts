import { describe, expect, test } from 'bun:test';
import { runLoopback } from './loopback';

/**
 * The Flock loopback E2E. Real HTTP, real git bundles, two real perches, no LLM.
 *
 * It runs four tasks: two in parallel (one per perch), one killed mid-flight with a graceful perch
 * stop, and one killed by a heartbeat timeout (a crashed laptop). Each is re-dispatched to the
 * surviving perch, collected as a bundle and imported into the hub repo.
 */
describe('flock loopback', () => {
  test('two perches run tasks, a killed perch leaves immediately and the work is rescheduled', async () => {
    const summary = await runLoopback();

    // Registration and scheduling.
    expect(new Set(summary.perches.map((perch) => perch.id))).toEqual(
      new Set(['loop-perch-1', 'loop-perch-2']),
    );
    expect(summary.perches.every((perch) => perch.url.startsWith('http://127.0.0.1:'))).toBe(true);
    expect(summary.tasks).toHaveLength(4);
    expect(summary.tasks.every((task) => task.nodeId !== 'hub')).toBe(true);

    // Both perches did real work: perch one won the two parallel picks' tie-break, then hosted the
    // task that got killed; the survivor absorbed the two rescues.
    const byNode = new Map<string, number>();
    for (const task of summary.tasks) byNode.set(task.nodeId, (byNode.get(task.nodeId) ?? 0) + 1);
    expect(byNode.get('loop-perch-1')).toBeGreaterThanOrEqual(1);
    expect(byNode.get('loop-perch-2')).toBeGreaterThanOrEqual(1);

    for (const task of summary.tasks) {
      expect(task.events).toContain('session.started');
      expect(task.events).toContain('file.edited');
      expect(task.events).toContain('session.idle');
      expect(task.changedFiles).toContain(`src/${task.key}.ts`);
      // The bundle really landed in the hub repo: fetch resolved the imported branch to a commit.
      expect(task.hubCommit).toMatch(/^[0-9a-f]{40,64}$/);
      expect(task.commit).toMatch(/^[0-9a-f]{40,64}$/);
    }

    // Graceful stop: the hub hears `perch-stopped` immediately (no 15 s wait) and re-dispatches.
    const rescued = summary.tasks.find((task) => task.key === 't03-murmur');
    expect(rescued?.rescheduledFrom).toBe('loop-perch-1');
    expect(rescued?.nodeId).toBe('loop-perch-2');

    // Crash: heartbeats stop, the registry sweeps the node offline, and the task moves.
    const crashed = summary.tasks.find((task) => task.key === 't04-dusk');
    expect(crashed?.rescheduledFrom).toBe('loop-perch-1');
    expect(crashed?.nodeId).toBe('loop-perch-2');

    expect(summary.leaves).toEqual([
      { nodeId: 'loop-perch-1', reason: 'perch-stopped' },
      { nodeId: 'loop-perch-1', reason: 'heartbeat-timeout' },
    ]);

    // The brief says < 60 s; it normally takes ~2 s.
    expect(summary.elapsedMs).toBeLessThan(60_000);
  }, 60_000);
});
