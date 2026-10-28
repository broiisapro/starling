import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { usePrefersReducedMotion } from '../metrics';
import { CARD_ESTIMATE, SPOTLIGHT_PADDING } from './constants';
import { trapTab } from './focus';
import { type CardSize, placeCard } from './geometry';
import { drawerTaskKeyOf, TOUR_STEPS } from './steps';
import { recordTourSeen } from './storage';
import { TourCard } from './TourCard';
import type { TourProps, TourStep } from './types';
import { useAnchor, useViewport } from './use-anchor';

/** Steps beyond the array (only possible if the array shrinks while mounted) degrade to the first. */
const FALLBACK_STEP: TourStep = { id: 'empty', title: 'Tour', body: '', placement: 'center' };

function stepAt(index: number): TourStep {
  return TOUR_STEPS[index] ?? TOUR_STEPS[0] ?? FALLBACK_STEP;
}

/**
 * The guided tour overlay (kind `overlay`, Epic 119).
 *
 * One dimmed layer with an SVG mask cut-out around the current anchor, and one card. It is a real
 * dialog: focus starts on the primary action, Tab is trapped inside the card, and every escape hatch
 * (missing anchor, collapsed region, tiny window) ends in the same centred card instead of a dead end.
 *
 * The component is props-only, per the Wave 3 manifest contract. `open` is additive and optional so
 * the shell can mount it permanently and toggle it, or mount it only while open.
 */
export function Tour({ state, onSelectTask, onClose, open = true }: TourProps) {
  const total = TOUR_STEPS.length;
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const viewport = useViewport();
  const reducedMotion = usePrefersReducedMotion();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const [cardSize, setCardSize] = useState<CardSize>(CARD_ESTIMATE);
  const suffix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const titleId = `tour-title-${suffix}`;
  const bodyId = `tour-body-${suffix}`;
  const maskId = `tour-mask-${suffix}`;

  const visible = open && !closed;
  const step = stepAt(index);

  // A fresh open is a fresh tour. When the shell closes and reopens the overlay ("Restart tour"),
  // the previous step should not survive the round trip.
  useEffect(() => {
    if (!open) return;
    setClosed(false);
    setIndex(0);
  }, [open]);

  // Focus lands on the primary action for every step, not just the first: a judge pressing Enter
  // should always take the obvious next step. The ref makes the "already focused" case a no-op so
  // re-renders caused by the demo stream do not steal focus from the Skip button.
  const focusedStep = useRef(-1);
  useEffect(() => {
    if (!visible || focusedStep.current === index) return;
    focusedStep.current = index;
    primaryRef.current?.focus();
  }, [visible, index]);

  const { spotlight } = useAnchor(step.anchor, viewport, SPOTLIGHT_PADDING);
  const placed = placeCard(spotlight, cardSize, viewport, step.placement);

  // Measure the card after it renders so the placement maths uses its real height (the copy length
  // differs per step). happy-dom reports 0, hence the estimate fallback. No dependency list: the
  // comparison inside `setCardSize` makes an unchanged box a no-op, so this cannot loop.
  useLayoutEffect(() => {
    const node = cardRef.current;
    if (node === null) return;
    const width = node.offsetWidth > 0 ? node.offsetWidth : CARD_ESTIMATE.width;
    const height = node.offsetHeight > 0 ? node.offsetHeight : CARD_ESTIMATE.height;
    setCardSize((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    );
  });

  // The drawer step opens the task whose agent is at work, so the spotlight lands on a real
  // transcript rather than an empty column. `state` is read through a ref so a stream of demo events
  // does not re-trigger `onSelectTask` on every tick; one action per step entry, tracked by signature.
  const stateRef = useRef(state);
  stateRef.current = state;
  const runId = state.activeRunId;
  const lastAction = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!visible || step.action !== 'select-first-running-task') return;
    const signature = `${index}:${runId ?? 'none'}`;
    if (lastAction.current === signature) return;
    lastAction.current = signature;
    const key = drawerTaskKeyOf(stateRef.current);
    if (key !== undefined) onSelectTask?.(key);
  }, [visible, index, runId, step.action, onSelectTask]);

  /** Finishing and skipping both mean "seen": the tour should not ambush the same judge twice. */
  const finish = useCallback(() => {
    recordTourSeen();
    setClosed(true);
    onClose?.();
  }, [onClose]);

  const next = useCallback(() => {
    if (index >= total - 1) {
      finish();
      return;
    }
    setIndex((current) => Math.min(current + 1, total - 1));
  }, [finish, index]);

  const back = useCallback(() => {
    setIndex((current) => Math.max(current - 1, 0));
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      next();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      back();
      return;
    }
    if (event.key === 'Tab') {
      trapTab(event, cardRef.current);
      return;
    }
    if (event.key === 'Enter') {
      const target = event.target;
      // A focused <button> handles Enter itself; intercepting it would advance twice.
      if (target instanceof HTMLElement && target.tagName === 'BUTTON') return;
      event.preventDefault();
      event.stopPropagation();
      next();
    }
  };

  if (!visible) return null;

  return (
    <div
      data-testid="tour-overlay"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className="fixed inset-0 z-50"
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        width={viewport.width}
        height={viewport.height}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      >
        <defs>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={viewport.width}
            height={viewport.height}
          >
            <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="white" />
            {spotlight === undefined ? null : (
              <rect
                x={spotlight.x}
                y={spotlight.y}
                width={spotlight.width}
                height={spotlight.height}
                rx={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width={viewport.width}
          height={viewport.height}
          fill="rgba(4, 6, 15, 0.72)"
          mask={`url(#${maskId})`}
        />
        {spotlight === undefined ? null : (
          <rect
            data-testid="tour-spotlight"
            x={spotlight.x}
            y={spotlight.y}
            width={spotlight.width}
            height={spotlight.height}
            rx={12}
            fill="none"
            stroke="var(--color-irid-teal)"
            strokeWidth={2}
          />
        )}
      </svg>

      <TourCard
        step={step}
        index={index}
        total={total}
        placed={placed}
        hasTarget={spotlight !== undefined}
        cardRef={cardRef}
        primaryRef={primaryRef}
        titleId={titleId}
        bodyId={bodyId}
        onNext={next}
        onBack={back}
        onSkip={finish}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

/** Exported for the Playground's legend and for C3's command-palette entry copy. */
export const TOUR_TOTAL = TOUR_STEPS.length;
