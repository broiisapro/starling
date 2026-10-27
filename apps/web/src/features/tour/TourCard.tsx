import { ChevronLeft, ChevronRight, Compass, SkipForward } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { Badge, Kbd } from '../../components';
import { cn } from '../../lib/cn';
import { CARD_WIDTH } from './constants';
import type { PlacedCard } from './geometry';
import type { TourStep } from './types';

export interface TourCardProps {
  step: TourStep;
  index: number;
  total: number;
  placed: PlacedCard;
  /** `false` when the step's anchor is missing or collapsed — the footer says so. */
  hasTarget: boolean;
  cardRef: RefObject<HTMLDivElement | null>;
  primaryRef: RefObject<HTMLButtonElement | null>;
  titleId: string;
  bodyId: string;
  onNext(): void;
  onBack(): void;
  onSkip(): void;
  onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
}

/**
 * The tour's card: progress, copy, and the three controls. Presentational on purpose — placement,
 * measurement and persistence all live above it, so this can be dropped into a screenshot test or a
 * future video overlay without the state machine.
 */
export function TourCard({
  step,
  index,
  total,
  placed,
  hasTarget,
  cardRef,
  primaryRef,
  titleId,
  bodyId,
  onNext,
  onBack,
  onSkip,
  onKeyDown,
}: TourCardProps) {
  const last = index === total - 1;

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="tour-card"
      data-step={step.id}
      data-placement={placed.placement}
      data-has-target={hasTarget ? 'true' : 'false'}
      className={cn(
        'absolute rounded-[var(--radius-panel)] border border-hairline-strong bg-panel-strong p-4 text-body shadow-[var(--shadow-panel)]',
        'motion-safe:transition-[left,top] motion-safe:duration-200 motion-safe:ease-[var(--ease-flock)]',
      )}
      style={{
        left: placed.x,
        top: placed.y,
        width: Math.min(CARD_WIDTH, placed.width),
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge tone="accent" icon={<Compass aria-hidden="true" className="h-3.5 w-3.5" />}>
          Starling tour
        </Badge>
        <p data-testid="tour-progress" className="text-micro tracking-[0.12em] text-ink-3 uppercase">
          Step {index + 1} of {total}
        </p>
      </div>

      <h2 id={titleId} className="mt-2 text-heading font-semibold tracking-tight text-ink-1">
        {step.title}
      </h2>
      <p id={bodyId} className="mt-1.5 text-body text-ink-2">
        {step.body}
      </p>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-hairline pt-3">
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption text-ink-3 hover:bg-surface-3 hover:text-ink-1"
        >
          <SkipForward aria-hidden="true" className="h-3.5 w-3.5" />
          Skip
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onBack}
            disabled={index === 0}
            className="inline-flex items-center gap-1 rounded-md border border-hairline px-2.5 py-1 text-caption text-ink-2 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Back
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-1 rounded-md border border-teal-400/40 bg-teal-400/15 px-2.5 py-1 text-caption font-medium text-teal-200 hover:bg-teal-400/25"
          >
            {last ? 'Finish' : 'Next'}
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="mt-2 flex items-center gap-1 text-micro text-ink-4">
        <Kbd size="sm">←</Kbd>
        <Kbd size="sm">→</Kbd>
        move
        <span aria-hidden="true">·</span>
        <Kbd size="sm">Esc</Kbd>
        skip
        {hasTarget ? null : (
          <span className="ml-auto">no region to point at — showing this card instead</span>
        )}
      </p>
    </div>
  );
}
