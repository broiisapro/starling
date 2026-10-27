import { describe, expect, test } from 'bun:test';

import { formatDuration, formatRate, formatTokens, formatTokensExact, formatUsd, shortSha } from './format';

describe('formatUsd', () => {
  test('renders a free meter as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  test('never rounds a real cost down to nothing', () => {
    expect(formatUsd(0.0004)).toBe('$<0.01');
    expect(formatUsd(0.004)).toBe('$<0.01');
  });

  test('crosses into a cent as soon as it would round there', () => {
    expect(formatUsd(0.005)).toBe('$0.01');
  });

  test('keeps two decimals for normal run costs', () => {
    expect(formatUsd(0.0309648)).toBe('$0.03');
    expect(formatUsd(1.8)).toBe('$1.80');
  });

  test('groups thousands', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });

  test('clamps negatives and non-finite values to zero', () => {
    expect(formatUsd(-3)).toBe('$0.00');
    expect(formatUsd(Number.NaN)).toBe('$0.00');
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe('$0.00');
  });
});

describe('formatTokens', () => {
  test('shows small counts exactly', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(742)).toBe('742');
    expect(formatTokens(999)).toBe('999');
  });

  test('shows thousands with one decimal under 10k', () => {
    expect(formatTokens(1_000)).toBe('1k');
    expect(formatTokens(1_234)).toBe('1.2k');
    expect(formatTokens(9_950)).toBe('9.9k');
  });

  test('shows whole thousands above 10k', () => {
    expect(formatTokens(103_500)).toBe('104k');
    expect(formatTokens(999_499)).toBe('999k');
  });

  test('shows millions with two decimals', () => {
    expect(formatTokens(1_234_567)).toBe('1.23M');
    expect(formatTokens(10_000_000)).toBe('10M');
  });

  test('clamps negatives and non-finite values to zero', () => {
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(Number.NaN)).toBe('0');
  });
});

describe('formatTokensExact', () => {
  test('groups every thousand for tooltips', () => {
    expect(formatTokensExact(0)).toBe('0');
    expect(formatTokensExact(999)).toBe('999');
    expect(formatTokensExact(103_500)).toBe('103,500');
    expect(formatTokensExact(1_234_567)).toBe('1,234,567');
  });

  test('rounds fractional tokens rather than printing decimals', () => {
    expect(formatTokensExact(12.6)).toBe('13');
  });
});

describe('formatDuration', () => {
  test('renders zero as 0s', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  test('uses milliseconds below one second', () => {
    expect(formatDuration(950)).toBe('950ms');
  });

  test('rounds to seconds below a minute', () => {
    expect(formatDuration(44_000)).toBe('44s');
    expect(formatDuration(59_000)).toBe('59s');
  });

  test('pads seconds in the minutes range', () => {
    expect(formatDuration(356_000)).toBe('5m 56s');
    expect(formatDuration(305_000)).toBe('5m 05s');
  });

  test('rolls over into hours', () => {
    expect(formatDuration(3_725_000)).toBe('1h 02m');
  });

  test('clamps negatives and non-finite values to zero', () => {
    expect(formatDuration(-1)).toBe('0s');
    expect(formatDuration(Number.NaN)).toBe('0s');
  });
});

describe('formatRate', () => {
  test('always keeps one decimal', () => {
    expect(formatRate(11.83)).toBe('11.8');
    expect(formatRate(0)).toBe('0.0');
  });

  test('guards non-finite and negative rates', () => {
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe('0.0');
    expect(formatRate(-2)).toBe('0.0');
  });
});

describe('shortSha', () => {
  test('cuts to seven characters', () => {
    expect(shortSha('c0ffee00112233')).toBe('c0ffee0');
  });

  test('keeps short ids as they are', () => {
    expect(shortSha('abc1234')).toBe('abc1234');
  });

  test('returns undefined for missing or blank ids', () => {
    expect(shortSha(undefined)).toBeUndefined();
    expect(shortSha('   ')).toBeUndefined();
  });
});
