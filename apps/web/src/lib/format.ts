import type { TokenUsage } from '@starling/core';

/** Compact duration for strips and metrics: 5m 56s, 42s, 1h 03m. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** Dollars with enough precision to see the local-vs-API story: $0.031. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  if (value === 0) return '$0.00';
  const trim = (fixed: string): string => {
    const [whole = '0', fraction = ''] = fixed.split('.');
    const kept = fraction.replace(/0+$/, '').padEnd(2, '0');
    return `${whole}.${kept}`;
  };
  const abs = Math.abs(value);
  if (abs < 0.01) return `$${trim(value.toFixed(4))}`;
  if (abs < 1) return `$${trim(value.toFixed(3))}`;
  return `$${value.toFixed(2)}`;
}

/** 12.4k / 1.2M — token counts are read at a glance, not audited. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function totalTokens(usage: TokenUsage): number {
  return usage.input + usage.output + usage.cached;
}

/** "3s ago", "in 2m", "now" — relative to an explicit clock so tests are deterministic. */
export function formatRelative(ts: number, now: number): string {
  const delta = now - ts;
  const abs = Math.abs(delta);
  const suffix = delta >= 0 ? 'ago' : 'from now';
  if (abs < 1000) return 'now';
  if (abs < 60_000) return `${Math.round(abs / 1000)}s ${suffix}`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  return `${Math.round(abs / 3_600_000)}h ${suffix}`;
}

/** Wall-clock time for event rows: 12:14:03. */
export function formatClock(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Percent for progress bars, clamped to 0…100. */
export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}
