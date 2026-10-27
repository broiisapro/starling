import { expect, test } from 'bun:test';
import { DEFAULT_SAVED_MODEL, PRICING } from '@starling/core';
import { OFF_PEAK_RATIO, offPeakUsd, PEAK_MODEL, peakNote, SAVED_MODEL, savedDetail } from './pricing';

/**
 * These assertions pin the panel's local assumption to core's table. `apps/web` does not import
 * `PRICING` at runtime (bundle size), so this test is the contract between the two.
 */
test('core bills DeepSeek at peak rates and the panel halves them for off-peak', () => {
  const price = PRICING[PEAK_MODEL];
  expect(price).toBeDefined();
  expect(price?.inputPerM).toBe(0.3);
  expect(price?.cachedInputPerM).toBe(0.006);
  expect(price?.outputPerM).toBe(1.2);
  expect(OFF_PEAK_RATIO).toBe(0.5);

  // Half of the peak table is exactly DeepSeek's published off-peak tariff.
  expect((price?.inputPerM ?? 0) * OFF_PEAK_RATIO).toBeCloseTo(0.15, 6);
  expect((price?.cachedInputPerM ?? 0) * OFF_PEAK_RATIO).toBeCloseTo(0.003, 6);
  expect((price?.outputPerM ?? 0) * OFF_PEAK_RATIO).toBeCloseTo(0.6, 6);
});

test('the saved estimate is priced against the same model', () => {
  expect(SAVED_MODEL).toBe(DEFAULT_SAVED_MODEL);
});

test('offPeakUsd is defensive about junk and clamps negatives', () => {
  expect(offPeakUsd(0.04)).toBeCloseTo(0.02, 6);
  expect(offPeakUsd(0)).toBe(0);
  expect(offPeakUsd(-5)).toBe(0);
  expect(offPeakUsd(Number.NaN)).toBe(0);
  expect(offPeakUsd(0.04, 0)).toBe(0);
});

test('the peak note carries a short line and a full explanation', () => {
  const note = peakNote(0.04);
  expect(note?.text).toBe('peak rates · off-peak ≈ $0.02');
  expect(note?.detail).toContain('budget guardrail');
  expect(note?.detail).toContain('exactly half');

  expect(peakNote(0)?.text).toBe('peak rates · off-peak ≈ $0.00');
  expect(peakNote(Number.NaN)).toBeUndefined();
});

test('the savings explanation names the token count and the rates', () => {
  const detail = savedDetail({ input: 53_200, output: 6_560, cached: 2_000 });
  expect(detail).toContain('59,760 local tokens');
  expect(detail).toContain('$0.30/M');
  expect(detail).toContain('$1.20/M out');
  expect(detail).toContain('Nothing was actually billed');
});
