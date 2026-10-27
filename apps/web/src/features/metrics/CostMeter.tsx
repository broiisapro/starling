import type { RunMetrics, TokenUsage } from '@starling/core';

import type { TokenSplit } from './cost';
import { costBreakdown } from './cost';
import { formatTokens, formatTokensExact, formatUsd } from './format';

export interface CostMeterProps {
  metrics?: RunMetrics;
}

const BAR_WIDTH = 200;
const BAR_HEIGHT = 6;

/**
 * The open-weight story in four numbers: API spend, local spend ($0.00, badge included), estimated
 * savings, and the API/local token split. Every figure comes from `RunMetrics`; nothing is re-priced
 * here, so the meter can never disagree with the engine's invoice.
 */
export function CostMeter({ metrics }: CostMeterProps) {
  const breakdown = costBreakdown(metrics);
  const api = breakdown.apiTokens;
  const local = breakdown.localTokens;
  const summary = `${formatUsd(breakdown.apiSpendUsd)} on DeepSeek, ${formatUsd(
    breakdown.localSpendUsd,
  )} on this laptop, ${formatUsd(breakdown.savedUsd)} saved`;

  return (
    <section className="flex flex-col gap-1" aria-label={summary} data-testid="cost-meter">
      <dl className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div>
          <dt className="text-[9px] uppercase tracking-[0.12em] text-slate-500">API · DeepSeek</dt>
          <dd className="text-lg leading-6 tabular-nums text-sky-200" data-testid="cost-api">
            {formatUsd(breakdown.apiSpendUsd)}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-slate-500">
            Local · this laptop
            <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1 py-px text-[8px] uppercase tracking-[0.08em] text-emerald-200">
              local
            </span>
          </dt>
          <dd className="text-lg leading-6 tabular-nums text-emerald-200" data-testid="cost-local">
            {formatUsd(breakdown.localSpendUsd)}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-[0.12em] text-slate-500">You saved</dt>
          <dd className="text-lg leading-6 tabular-nums text-amber-200" data-testid="cost-saved">
            {formatUsd(breakdown.savedUsd)}
          </dd>
        </div>
      </dl>

      <TokenSplitBar split={breakdown.split} api={api} local={local} />

      <p className="text-[10px] leading-3 text-slate-500">
        {formatTokens(breakdown.totalTokenCount)} tokens ·{' '}
        <span className="text-emerald-300/80">{formatTokens(breakdown.localTokenCount)} local</span> ·{' '}
        {breakdown.localCallCount} local {breakdown.localCallCount === 1 ? 'call' : 'calls'}
      </p>
    </section>
  );
}

interface TokenSplitBarProps {
  split: TokenSplit;
  api: TokenUsage;
  local: TokenUsage;
}

/**
 * A two-segment SVG bar. The exact counts live in the native tooltip, in a hover bubble and in the
 * SVG's `<desc>`, so the numbers are reachable by mouse, keyboard and screen reader alike.
 */
function TokenSplitBar({ split, api, local }: TokenSplitBarProps) {
  const apiWidth = Math.round(split.apiShare * BAR_WIDTH * 100) / 100;
  const localWidth = Math.max(0, Math.round((BAR_WIDTH - apiWidth) * 100) / 100);
  const exact = `API ${formatTokensExact(api.input)} in (${formatTokensExact(api.cached)} cached), ${formatTokensExact(
    api.output,
  )} out · local ${formatTokensExact(local.input)} in (${formatTokensExact(local.cached)} cached), ${formatTokensExact(
    local.output,
  )} out`;
  const hasTokens = split.total > 0;

  return (
    <div className="group relative mt-0.5 w-full max-w-[13rem]" data-testid="token-split">
      <svg
        role="img"
        aria-label={hasTokens ? `Token split: ${exact}` : 'Token split: no tokens spent yet'}
        viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`}
        width="100%"
        height={BAR_HEIGHT}
        preserveAspectRatio="none"
        className="block"
      >
        <title>API vs local token split</title>
        <desc>{hasTokens ? exact : 'No tokens spent yet'}</desc>
        <rect x={0} y={0} width={BAR_WIDTH} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill="#1e293b" />
        {apiWidth > 0 ? (
          <rect x={0} y={0} width={apiWidth} height={BAR_HEIGHT} rx={2.5} fill="#38bdf8" />
        ) : null}
        {localWidth > 0 ? (
          <rect x={apiWidth} y={0} width={localWidth} height={BAR_HEIGHT} rx={2.5} fill="#34d399" />
        ) : null}
      </svg>

      <div
        role="tooltip"
        data-testid="token-split-tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-max max-w-[18rem] rounded-md border border-white/10 bg-slate-900/95 px-2 py-1 text-[10px] leading-4 text-slate-300 shadow-lg group-hover:block group-focus-within:block"
      >
        <p className="tabular-nums">
          <span className="text-sky-300">API</span> {formatTokensExact(api.input)} in (
          {formatTokensExact(api.cached)} cached) · {formatTokensExact(api.output)} out
        </p>
        <p className="tabular-nums">
          <span className="text-emerald-300">Local</span> {formatTokensExact(local.input)} in (
          {formatTokensExact(local.cached)} cached) · {formatTokensExact(local.output)} out
        </p>
      </div>

      <p className="sr-only">{exact}</p>
    </div>
  );
}
