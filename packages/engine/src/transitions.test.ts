import { describe, expect, test } from 'bun:test';
import type { TaskStatus } from '@starling/core';
import { StarlingError } from '@starling/core';
import {
  ACTIVE_TASK_STATUSES,
  allowedTransitions,
  assertTaskTransition,
  isActiveStatus,
  isTaskTransitionAllowed,
  isTerminalStatus,
  TASK_TRANSITIONS,
  TERMINAL_TASK_STATUSES,
} from './transitions';

describe('task transition table', () => {
  test('covers every status', () => {
    const statuses: TaskStatus[] = [
      'pending',
      'ready',
      'running',
      'auditing',
      'fixing',
      'merging',
      'merged',
      'failed',
      'conflict',
      'cancelled',
    ];
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...statuses].sort());
  });

  test('terminal statuses have no outgoing edges', () => {
    for (const status of TERMINAL_TASK_STATUSES) expect(TASK_TRANSITIONS[status]).toEqual([]);
  });

  test('active and terminal statuses are disjoint', () => {
    for (const status of ACTIVE_TASK_STATUSES) expect(TERMINAL_TASK_STATUSES).not.toContain(status);
  });

  test('the happy path is legal edge by edge', () => {
    expect(isTaskTransitionAllowed('pending', 'ready')).toBe(true);
    expect(isTaskTransitionAllowed('ready', 'running')).toBe(true);
    expect(isTaskTransitionAllowed('running', 'auditing')).toBe(true);
    expect(isTaskTransitionAllowed('auditing', 'merging')).toBe(true);
    expect(isTaskTransitionAllowed('merging', 'merged')).toBe(true);
  });

  test('the fix loop is legal', () => {
    expect(isTaskTransitionAllowed('auditing', 'fixing')).toBe(true);
    expect(isTaskTransitionAllowed('fixing', 'auditing')).toBe(true);
    expect(isTaskTransitionAllowed('merging', 'fixing')).toBe(true);
  });

  test('flock rescheduling is legal from every in-flight status', () => {
    expect(isTaskTransitionAllowed('running', 'ready')).toBe(true);
    expect(isTaskTransitionAllowed('fixing', 'ready')).toBe(true);
    expect(isTaskTransitionAllowed('auditing', 'ready')).toBe(true);
  });

  test('skipping the audit is illegal', () => {
    expect(isTaskTransitionAllowed('running', 'merged')).toBe(false);
    expect(isTaskTransitionAllowed('ready', 'auditing')).toBe(false);
    expect(isTaskTransitionAllowed('pending', 'merged')).toBe(false);
  });

  test('a no-op transition is allowed', () => {
    expect(isTaskTransitionAllowed('merged', 'merged')).toBe(true);
    expect(assertTaskTransition('failed', 'failed', { strict: true })).toBe(true);
  });

  test('strict mode throws a StarlingError with the task key', () => {
    try {
      assertTaskTransition('merged', 'running', { strict: true, taskKey: 'theme' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StarlingError);
      expect((err as StarlingError).code).toBe('INVALID_ARGUMENT');
      expect((err as StarlingError).details?.taskKey).toBe('theme');
      expect((err as StarlingError).message).toContain('merged → running');
    }
  });

  test('non-strict mode returns false instead of throwing', () => {
    expect(assertTaskTransition('cancelled', 'ready')).toBe(false);
  });

  test('classifiers agree with the table', () => {
    expect(isTerminalStatus('merged')).toBe(true);
    expect(isTerminalStatus('conflict')).toBe(true);
    expect(isTerminalStatus('auditing')).toBe(false);
    expect(isActiveStatus('merging')).toBe(true);
    expect(isActiveStatus('ready')).toBe(false);
    expect(allowedTransitions('pending')).toEqual(['ready', 'cancelled']);
  });
});
