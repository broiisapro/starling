import type { AgentEvent } from '@starling/core';
import { ArrowDown, CheckCircle2, ChevronRight, FileCode2, Minus, Plus, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTimeline, groupToolCalls, type TimelineEntry } from './activity';
import { formatClock, formatTokens } from './format';
import { MarkdownLite } from './MarkdownLite';
import { computeWindow, DEFAULT_ROW_HEIGHT, isAtBottom } from './windowing';

function ToolRow({ entry }: { entry: TimelineEntry }) {
  const tool = entry.tool;
  if (!tool) return null;
  const repeats = entry.repeats ?? 1;
  const status =
    tool.ok === true ? (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-300">
        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> ok
      </span>
    ) : tool.ok === false ? (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-rose-300">
        <XCircle aria-hidden="true" className="h-3.5 w-3.5" /> err
      </span>
    ) : (
      <span className="text-[12px] text-slate-400">…</span>
    );

  return (
    <details
      className="group rounded-md border border-slate-800 bg-slate-900/60"
      data-testid="tool-row"
      data-repeats={repeats}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-open:rotate-90"
        />
        <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[12px] text-slate-200">
          {tool.name}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-200" title={tool.summary}>
          {tool.summary}
        </span>
        {repeats > 1 ? (
          <span
            className="shrink-0 rounded-full border border-sky-400/40 bg-sky-400/10 px-1.5 py-px text-[12px] font-medium tabular-nums text-sky-200"
            title={`${repeats} identical calls in a row`}
          >
            <span aria-hidden="true">×{repeats}</span>
            <span className="sr-only">ran {repeats} times</span>
          </span>
        ) : null}
        {status}
      </summary>
      <div className="border-t border-slate-800 px-2 py-1.5">
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-slate-300">
          {tool.detail ?? 'No result recorded yet.'}
        </pre>
      </div>
    </details>
  );
}

function EntryBody({ entry, onOpenFile }: { entry: TimelineEntry; onOpenFile?(path: string): void }) {
  switch (entry.kind) {
    case 'session.started':
      return (
        <p className="text-[12px] font-medium uppercase tracking-wide text-slate-400">
          session started{entry.meta ? ` · ${entry.meta}` : ''}
        </p>
      );
    case 'text':
      return entry.text ? <MarkdownLite text={entry.text} /> : null;
    case 'tool.call':
    case 'tool.result':
      return <ToolRow entry={entry} />;
    case 'file.edited': {
      const file = entry.file;
      if (!file) return null;
      const content = (
        <>
          <FileCode2 aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-300" />
          <span className="truncate font-mono text-[12px] text-slate-100">{file.path}</span>
          <span className="inline-flex shrink-0 items-center text-[12px] font-medium tabular-nums text-emerald-300">
            <Plus aria-hidden="true" className="h-3 w-3" />
            {file.added}
          </span>
          <span className="inline-flex shrink-0 items-center text-[12px] font-medium tabular-nums text-rose-300">
            <Minus aria-hidden="true" className="h-3 w-3" />
            {file.removed}
          </span>
        </>
      );

      if (onOpenFile === undefined) {
        return (
          <span
            className="inline-flex max-w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-2 py-1"
            data-testid="file-chip"
          >
            {content}
          </span>
        );
      }
      return (
        <button
          type="button"
          onClick={() => onOpenFile(file.path)}
          data-testid="file-chip"
          data-file-path={file.path}
          aria-label={`Open ${file.path} in the Diff tab`}
          title={`Open ${file.path} in the Diff tab`}
          className="inline-flex max-w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-left transition-colors hover:border-sky-400/60 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          {content}
        </button>
      );
    }
    case 'usage': {
      const usage = entry.usage;
      if (!usage) return null;
      return (
        <p className="text-[12px] leading-relaxed tabular-nums text-slate-400" data-testid="usage-footer">
          {formatTokens(usage.input)} in · {formatTokens(usage.output)} out · {formatTokens(usage.cached)}{' '}
          cached
          {usage.model ? ` · ${usage.model}` : ''}
          {usage.local ? ' · local' : ' · api'}
        </p>
      );
    }
    case 'session.idle':
      return <p className="text-[12px] italic text-slate-400">session idle</p>;
    case 'session.error':
      return (
        <p className="rounded-md border border-rose-800 bg-rose-950/50 px-2 py-1 text-[12px] text-rose-200">
          {entry.error}
        </p>
      );
    default:
      return null;
  }
}

export interface ActivityTabProps {
  events: AgentEvent[];
  /** File-edit chips jump to the Diff tab; the drawer owns tab selection. */
  onOpenFile?(path: string): void;
}

/**
 * The live activity stream. Rows follow the tail while the reader is at the bottom; scrolling up
 * pins the view and reveals a "jump to latest" pill. Long streams are windowed (see `windowing.ts`).
 *
 * Consecutive identical tool calls collapse into one row with a `×N` badge ("ran tests ×3") so a
 * 200-event session reads as a handful of intentions instead of 200 near-identical cards.
 */
export function ActivityTab({ events, onOpenFile }: ActivityTabProps) {
  const entries = useMemo(() => groupToolCalls(buildTimeline(events)), [events]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const [atBottom, setAtBottom] = useState(true);

  const range = computeWindow({
    count: entries.length,
    scrollTop,
    viewportHeight,
    rowHeight: DEFAULT_ROW_HEIGHT,
  });
  const visible = entries.slice(range.start, range.end);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight || 480);
    setAtBottom(isAtBottom(element));
  };

  // Follow new events only while the reader has not scrolled away from the tail.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !atBottom || entries.length === 0) return;
    element.scrollTop = element.scrollHeight;
    setScrollTop(element.scrollTop);
  }, [entries.length, atBottom]);

  const jumpToLatest = () => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    setScrollTop(element.scrollTop);
    setAtBottom(true);
  };

  if (entries.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-slate-400">
        No activity yet — the bird is still stretching its wings. 🐦
      </p>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="activity-list"
        data-virtualized={range.virtualized ? 'true' : 'false'}
      >
        <ol className="divide-y divide-slate-900" aria-label="Agent activity">
          {range.topPad > 0 ? <li aria-hidden="true" style={{ height: range.topPad }} /> : null}
          {visible.map((entry) => (
            <li key={entry.id} data-kind={entry.kind} className="flex gap-3 px-3 py-2">
              <time className="w-14 shrink-0 pt-0.5 text-right font-mono text-[12px] tabular-nums text-slate-400">
                {formatClock(entry.ts)}
              </time>
              <div className="min-w-0 flex-1">
                <EntryBody entry={entry} onOpenFile={onOpenFile} />
              </div>
            </li>
          ))}
          {range.bottomPad > 0 ? <li aria-hidden="true" style={{ height: range.bottomPad }} /> : null}
        </ol>
      </div>

      {!atBottom ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-sky-600 bg-sky-950 px-3 py-1 text-[12px] font-medium text-sky-200 shadow-lg hover:bg-sky-900"
        >
          <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
