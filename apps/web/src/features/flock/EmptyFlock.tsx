import { ArrowRight, Bird } from 'lucide-react';

export interface EmptyFlockProps {
  /** The join card's element id, so the call to action scrolls to the right panel instance. */
  anchorId: string;
}

/** Shown while the hub is the only roost: the flock grows by lending a laptop, and the join card is right there. */
export function EmptyFlock({ anchorId }: EmptyFlockProps) {
  return (
    <div
      data-testid="empty-flock"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-sky-400/25 bg-sky-400/[0.04] px-3.5 py-3"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-full border border-sky-400/25 bg-sky-400/10">
          <Bird aria-hidden="true" className="h-4 w-4 text-sky-300" />
        </span>
        <div>
          <p className="text-sm font-medium text-slate-100">Your flock is just you.</p>
          <p className="text-[11px] text-slate-400">
            Every laptop in the room is another roost, another opencode, another pair of hands.
          </p>
        </div>
      </div>
      <a
        data-testid="empty-flock-cta"
        href={`#${anchorId}`}
        className="inline-flex items-center gap-1 rounded-lg border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-[11px] font-medium text-sky-100 transition-colors hover:border-sky-300/50 hover:bg-sky-400/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        Add a laptop
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
