import type { RunMetrics, TokenUsage } from '@starling/core';
import { Info } from 'lucide-react';

import type { TokenSplit } from './cost';
import { costBreakdown } from './cost';
import { useCountUp } from './count-up';
import { formatTokens, formatTokensExact, formatUsd } from './format';
import { peakNote, savedDetail } from './pricing';

export interface CostMeterProps {
  metrics?: RunMetrics;
  /**
   * Animate the money figures towards their new value. Off by default so replay scrubbing and tests
   * read exact numbers on the first paint; `MetricsPanel` turns it on while the stream is live.
   */
  animate?: boolean;
}

const BAR_WIDTH = 200;
const BAR_HEIGHT = 6;

/**
 * The open-weight story in four numbers: API spend, local spend ($0.00, badge included), estimated
 * savings, and the API/local token split. Every figure comes from `RunMetrics`; nothing is re-priced
 * here, so the meter can never disagree with the engine's invoice.
 *
 * Projector details: the API number counts up while a run is live, the note under it shows the
 * off-peak equivalent (core bills peak on purpose), and "You saved" explains its estimate in a
 * tooltip instead of asking the audience to trust a number.
 */
export function CostMeter({ metrics, animate = false }: CostMeterProps) {
  const breakdown = costBreakdown(metrics);
  const api = breakdown.apiTokens;
  const local = breakdown.localTokens;
  const apiSpend = useCountUp(breakdown.apiSpendUsd, animate);
  const saved = useCountUp(breakdown.savedUsd, animate);
  const note = peakNote(breakdown.apiSpendUsd);
  const summary = `${formatUsd(breakdown.apiSpendUsd)} on DeepSeek, ${formatUsd(
    breakdown.localSpendUsd,
  )} on this laptop, ${formatUsd(breakdown.savedUsd)} saved`;
  const calls = breakdown.localCallCount;

  return (
    <section className="flex flex-col gap-1" aria-label={summary} data-testid="cost-meter">
      <dl className="flex flex-wrap items-start gap-x-4 gap-y-1.5">
        <div className="min-w-[5.5rem]">
          <dt className="text-[12px] uppercase tracking-[0.1em] text-slate-400">API · DeepSeek</dt>
          <dd className="text-lg leading-6 tabular-nums text-sky-200" data-testid="cost-api">
            {formatUsd(apiSpend)}
          </dd>
          {note !== undefined ? (
            <p
              className="max-w-[11rem] text-[12px] leading-4 text-slate-400"
              data-testid="cost-offpeak"
              title={note.detail}
            >
              {note.text}
            </p>
          ) : null}
        </div>

        <div className="min-w-[6.5rem]">
          <dt className="flex flex-wrap items-center gap-1 text-[12px] uppercase tracking-[0.1em] text-slate-400">
            Local · this laptop
            <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1 py-px text-[12px] uppercase tracking-[0.06em] text-emerald-200">
              local
            </span>
          </dt>
          <dd className="text-lg leading-6 tabular-nums text-emerald-200" data-testid="cost-local">
            {formatUsd(breakdown.localSpendUsd)}
          </dd>
          <p className="text-[12px] leading-4 text-slate-400" data-testid="cost-local-calls">
            <span className="tabular-nums text-emerald-200">{calls}</span> local{' '}
            {calls === 1 ? 'call' : 'calls'}
          </p>
        </div>

        <div className="min-w-[5.5rem]">
          <dt className="flex items-center gap-1 text-[12px] uppercase tracking-[0.1em] text-slate-400">
            You saved
            <span
              className="inline-flex cursor-help items-center text-slate-400"
              title={savedDetail(local)}
              aria-hidden="true"
            >
              <Info className="h-3.5 w-3.5" />
            </span>
          </dt>
          <dd
            className="text-lg leading-6 tabular-nums text-amber-200"
            data-testid="cost-saved"
            aria-describedby="cost-saved-note"
          >
            {formatUsd(saved)}
          </dd>
          <p id="cost-saved-note" className="sr-only">
            {savedDetail(local)}
          </p>
        </div>
      </dl>

      <TokenSplitBar split={breakdown.split} api={api} local={local} />

      <p className="text-[12px] leading-4 tabular-nums text-slate-400">
        {formatTokens(breakdown.totalTokenCount)} tokens ·{' '}
        <span className="text-emerald-300">{formatTokens(breakdown.localTokenCount)} local</span>
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
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-max max-w-[18rem] rounded-md border border-white/10 bg-slate-900/95 px-2 py-1 text-[12px] leading-4 text-slate-300 shadow-lg group-hover:block"
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
