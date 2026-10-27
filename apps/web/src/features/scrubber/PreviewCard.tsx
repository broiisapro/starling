import { Eye } from 'lucide-react';
import { Badge } from '../../components';
import { formatTokens, formatUsd } from '../../lib/format';
import type { ScrubPreview } from './derive';

export interface PreviewCardProps {
  preview: ScrubPreview | undefined;
}

/**
 * What the dashboard would show at the head. Preview mode only: when the store can seek (Epic 204)
 * the scrubber is controlled and the live panes are the preview.
 */
export function PreviewCard({ preview }: PreviewCardProps) {
  if (preview === undefined) return null;

  return (
    <section
      data-testid="scrubber-preview"
      aria-label="Preview of the run at the scrubber head"
      className="rounded-lg border border-dashed border-hairline-strong bg-surface-1/60 px-3 py-2"
    >
      <p className="flex items-center gap-1.5 text-micro font-medium uppercase tracking-[0.08em] text-ink-4">
        <Eye aria-hidden="true" className="h-3 w-3" />
        preview: the live view keeps playing
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone="success">
          landed {preview.landed}/{preview.tasks}
        </Badge>
        <Badge tone="accent">flying {preview.flying}</Badge>
        <Badge tone={preview.failed > 0 ? 'danger' : 'neutral'}>failed {preview.failed}</Badge>
        <Badge tone="neutral">{formatUsd(preview.costUsd)}</Badge>
        <Badge tone="neutral">{formatTokens(preview.tokens)} tok</Badge>
        {preview.runStatus === undefined ? null : (
          <Badge tone="info" className="capitalize">
            {preview.runStatus}
          </Badge>
        )}
      </div>
      <p className="mt-1.5 truncate text-caption text-ink-3" data-testid="scrubber-preview-last">
        last: {preview.lastEvent?.summary ?? 'nothing yet'}
      </p>
    </section>
  );
}
