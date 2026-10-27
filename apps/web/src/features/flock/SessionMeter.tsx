import type { NodeStatus } from '@starling/core';
import { cx } from './cx';
import { STATUS_PALETTE } from './palette';

export interface SessionMeterProps {
  active: number;
  max: number;
  status: NodeStatus;
  compact?: boolean;
}

/**
 * `activeSessions / maxSessions` as segmented pips, one pip per session slot. A glance says whether
 * a roost can take more birds. Pips stop at 24 so a misconfigured 200-session node still renders.
 */
export function SessionMeter({ active, max, status, compact = false }: SessionMeterProps) {
  const tone = STATUS_PALETTE[status];
  const filled = Math.min(Math.max(active, 0), max);
  const slots = Math.min(Math.max(max, 0), 24);
  const overflow = Math.max(0, max - slots);

  return (
    <div className="flex items-center gap-2">
      <div
        data-testid="session-meter"
        data-active={active}
        data-max={max}
        data-filled={filled}
        role="img"
        aria-label={`${filled} of ${max} sessions in use`}
        className={cx('flex flex-wrap items-center', compact ? 'gap-0.5' : 'gap-1')}
      >
        {Array.from({ length: slots }, (_, index) => {
          const key = `pip-${index}`;
          const isFilled = index < filled;
          return (
            <span
              key={key}
              data-testid="session-pip"
              data-filled={isFilled}
              className={cx(
                'rounded-full transition-colors duration-300',
                compact ? 'h-1 w-1.5' : 'h-1.5 w-3',
                isFilled ? tone.meter : 'bg-white/10',
              )}
            />
          );
        })}
        {overflow > 0 ? <span className="text-[12px] text-slate-400">+{overflow}</span> : null}
      </div>
      <span
        data-testid="session-count"
        className={cx(
          'font-mono tabular-nums',
          compact ? 'text-[12px] text-slate-300' : 'text-[12px] text-slate-200',
        )}
      >
        {active}/{max}
      </span>
      {!compact ? (
        <span className="text-[12px] text-slate-400">{filled >= max ? 'full' : 'free'}</span>
      ) : null}
    </div>
  );
}
