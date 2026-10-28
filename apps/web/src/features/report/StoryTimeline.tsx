import { EmptyState } from '../../components';
import { beatClock } from './format';
import type { StoryBeat, StoryKind } from './types';

const KIND_DOT: Record<StoryKind, string> = {
  repomap: 'bg-slate-400',
  plan: 'bg-sky-400',
  'node.joined': 'bg-emerald-400',
  'node.left': 'bg-amber-400',
  running: 'bg-teal-400',
  audit: 'bg-orange-400',
  migrated: 'bg-violet-400',
  merge: 'bg-emerald-400',
  conflict: 'bg-rose-400',
  log: 'bg-amber-400',
  finished: 'bg-irid-teal',
};

export interface StoryTimelineProps {
  story: StoryBeat[];
  summary?: string;
  onSelectTask?(key: string): void;
}

/**
 * The run as a vertical timeline, starting at `T+0:00`. Tap a beat that names a task to open it in
 * the agent drawer. The writer's own summary sits at the bottom, quoted rather than paraphrased.
 */
export function StoryTimeline({ story, summary, onSelectTask }: StoryTimelineProps) {
  return (
    <section
      data-testid="report-story"
      aria-labelledby="report-story-title"
      className="rounded-[var(--radius-panel)] border border-hairline bg-panel px-4 py-4 print:break-inside-avoid print:border-slate-300 print:bg-white print:text-slate-900"
    >
      <h2 id="report-story-title" className="text-heading font-semibold text-ink-1 print:text-slate-900">
        The flight, in order
      </h2>
      <p className="mt-0.5 text-caption text-ink-3 print:text-slate-600">
        Twelve beats at most, newest last, times relative to launch.
      </p>

      {story.length === 0 ? (
        <EmptyState
          compact
          title="No story yet"
          description="The report fills in as soon as the run maps, plans or lands a task."
        />
      ) : (
        <ol className="mt-3 flex flex-col">
          {story.map((beat, index) => (
            <li
              key={`${beat.at}-${beat.kind}-${beat.text}`}
              data-testid={`report-beat-${index}`}
              className="relative flex gap-3 pb-2.5 last:pb-0"
            >
              <div className="flex w-14 shrink-0 items-start justify-end pt-0.5">
                <time className="font-mono text-micro tabular-nums text-ink-4 print:text-slate-500">
                  {beatClock(beat.at)}
                </time>
              </div>
              <span
                aria-hidden
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[beat.kind]} print:opacity-100`}
              />
              <div className="min-w-0">
                <p className="text-caption text-ink-2 print:text-slate-700">{beat.text}</p>
                {beat.taskKey !== undefined && onSelectTask !== undefined ? (
                  <button
                    type="button"
                    onClick={() => onSelectTask(beat.taskKey as string)}
                    className="text-micro text-sky-300 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus print:text-sky-800"
                  >
                    Inspect {beat.taskKey}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {summary !== undefined ? (
        <blockquote
          data-testid="report-summary"
          className="mt-3 border-l-2 border-teal-400/50 pl-3 text-caption italic text-ink-2 print:border-teal-700 print:text-slate-700"
        >
          {summary}
        </blockquote>
      ) : null}
    </section>
  );
}
