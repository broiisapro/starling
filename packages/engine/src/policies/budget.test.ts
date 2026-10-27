import { describe, expect, test } from 'bun:test';
import { BudgetGuard } from './budget';

describe('BudgetGuard', () => {
  test('warns once at 80% and stops once at 100%', () => {
    const guard = new BudgetGuard({ maxUsd: 5 });
    expect(guard.warnUsd).toBe(4);
    expect(guard.observe(1)).toEqual({ warn: false, stop: false });
    expect(guard.observe(4)).toEqual({ warn: true, stop: false });
    expect(guard.observe(4.5)).toEqual({ warn: false, stop: false });
    expect(guard.observe(5)).toEqual({ warn: false, stop: true });
    expect(guard.stopped).toBe(true);
    expect(guard.observe(9)).toEqual({ warn: false, stop: false });
  });

  test('a custom warn ratio is honoured', () => {
    const guard = new BudgetGuard({ maxUsd: 10, warnRatio: 0.5 });
    expect(guard.observe(4.9).warn).toBe(false);
    expect(guard.observe(5).warn).toBe(true);
  });

  test('a zero cap stops before anything is spent, without a warning', () => {
    const guard = new BudgetGuard({ maxUsd: 0 });
    expect(guard.observe(0)).toEqual({ warn: false, stop: true });
  });

  test('spend is monotonic even if a caller reports a lower number', () => {
    const guard = new BudgetGuard({ maxUsd: 10 });
    guard.observe(6);
    expect(guard.observe(2).warn).toBe(false);
    expect(guard.spentUsd).toBe(6);
  });
});
