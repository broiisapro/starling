import type { AgentEvent } from '@starling/core';
import { ArrowDown, CheckCircle2, ChevronRight, FileCode2, Minus, Plus, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTimeline, type TimelineEntry } from './activity';
import { formatClock, formatTokens } from './format';
import { MarkdownLite } from './MarkdownLite';
import { computeWindow, DEFAULT_ROW_HEIGHT, isAtBottom } from './windowing';

function ToolRow({ entry }: { entry: TimelineEntry }) {
  const tool = entry.tool;
  if (!tool) return null;
  const status =
    tool.ok === true ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-300">
        <CheckCircle2 aria-hidden="true" className="h-3 w-3" /> ok
      </span>
    ) : tool.ok === false ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-300">
        <XCircle aria-hidden="true" className="h-3 w-3" /> err
      </span>
    ) : (
      <span className="text-[10px] text-slate-500">…</span>
    );

  return (
    <details className="group rounded-md border border-slate-800 bg-slate-900/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="h-3 w-3 shrink-0 text-slate-500 transition-transform group-open:rotate-90"
        />
        <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
          {tool.name}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300" title={tool.summary}>
          {tool.summary}
        </span>
        {status}
      </summary>
      <div className="border-t border-slate-800 px-2 py-1.5">
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-400">
          {tool.detail ?? 'No result recorded yet.'}
        </pre>
      </div>
    </details>
  );
}

function EntryBody({ entry }: { entry: TimelineEntry }) {
  switch (entry.kind) {
    case 'session.started':
      return (
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
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
      return (
        <span
          className="inline-flex max-w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-2 py-1"
          data-testid="file-chip"
        >
          <FileCode2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-sky-300" />
          <span className="truncate font-mono text-[11px] text-slate-200">{file.path}</span>
          <span className="inline-flex shrink-0 items-center text-[10px] font-medium text-emerald-300">
            <Plus aria-hidden="true" className="h-3 w-3" />
            {file.added}
          </span>
          <span className="inline-flex shrink-0 items-center text-[10px] font-medium text-rose-300">
            <Minus aria-hidden="true" className="h-3 w-3" />
            {file.removed}
          </span>
        </span>
      );
    }
    case 'usage': {
      const usage = entry.usage;
      if (!usage) return null;
      return (
        <p className="text-[10px] leading-relaxed text-slate-500" data-testid="usage-footer">
          {formatTokens(usage.input)} in · {formatTokens(usage.output)} out · {formatTokens(usage.cached)}{' '}
          cached
          {usage.model ? ` · ${usage.model}` : ''}
          {usage.local ? ' · local' : ' · api'}
        </p>
      );
    }
    case 'session.idle':
      return <p className="text-[11px] italic text-slate-500">session idle</p>;
    case 'session.error':
      return (
        <p className="rounded-md border border-rose-800 bg-rose-950/50 px-2 py-1 text-[11px] text-rose-200">
          {entry.error}
        </p>
      );
    default:
      return null;
  }
}

/**
 * The live activity stream. Rows follow the tail while the reader is at the bottom; scrolling up
 * pins the view and reveals a "jump to latest" pill. Long streams are windowed (see `windowing.ts`).
 */
export function ActivityTab({ events }: { events: AgentEvent[] }) {
  const entries = useMemo(() => buildTimeline(events), [events]);
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
      <p className="p-6 text-center text-sm text-slate-500">
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
              <time className="w-12 shrink-0 pt-0.5 text-right font-mono text-[10px] text-slate-600">
                {formatClock(entry.ts)}
              </time>
              <div className="min-w-0 flex-1">
                <EntryBody entry={entry} />
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
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-sky-600 bg-sky-950 px-3 py-1 text-[11px] font-medium text-sky-200 shadow-lg hover:bg-sky-900"
        >
          <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
