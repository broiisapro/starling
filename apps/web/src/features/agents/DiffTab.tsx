// biome-ignore-all lint/suspicious/noArrayIndexKey: patch lines have no stable identity beyond their position
import type { DiffSummary } from '@starling/core';
import { FileWarning } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { annotateWordDiffs, diffFiles, type PatchLineKind, type PatchLineView } from './diff';

const LINE_CLASS: Record<PatchLineKind, string> = {
  add: 'bg-emerald-950/50 text-emerald-200',
  del: 'bg-rose-950/50 text-rose-200',
  hunk: 'bg-slate-900 font-medium text-sky-300',
  meta: 'text-slate-400',
  ctx: 'text-slate-300',
};

const WORD_CLASS: Record<'add' | 'del', string> = {
  add: 'rounded-sm bg-emerald-400/30 text-emerald-50',
  del: 'rounded-sm bg-rose-400/30 text-rose-50',
};

function PatchRow({ line }: { line: PatchLineView }) {
  const sign = line.kind === 'add' || line.kind === 'del' ? line.kind : undefined;
  if (line.segments === undefined || sign === undefined) {
    return <>{line.text.length > 0 ? line.text : ' '}</>;
  }

  return (
    <>
      <span aria-hidden="true">{line.text.slice(0, 1)}</span>
      {line.segments.map((segment, index) =>
        segment.changed ? (
          <mark
            // Segments are positional inside one line; there is no other identity.
            key={`${index}:${segment.text}`}
            className={`${WORD_CLASS[sign]} px-px`}
            data-word="changed"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={`${index}:${segment.text}`}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Read-only unified diff view: file list first, then one collapsible block per file.
 *
 * Two projector details: small deletion/addition runs get word-level marks (so `"light" → "dark"`
 * is visible from the back of the room instead of two fully coloured lines), and `focusPath` —
 * set by clicking a file chip in the Activity tab — opens and highlights that file block.
 */
export function DiffTab({ diff, focusPath }: { diff?: DiffSummary; focusPath?: string }) {
  const files = useMemo(() => diffFiles(diff), [diff]);
  const focusRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (focusPath === undefined) return;
    const element = focusRef.current;
    if (element === null) return;
    element.open = true;
    element.scrollIntoView?.({ block: 'nearest' });
  }, [focusPath]);

  if (!diff) {
    return <p className="p-6 text-center text-sm text-slate-400">No diff recorded yet.</p>;
  }

  return (
    <div className="space-y-3 p-3" data-testid="diff-tab">
      {diff.truncated ? (
        <p
          className="flex items-start gap-1.5 rounded-md border border-amber-800/70 bg-amber-950/40 px-2 py-1.5 text-[12px] text-amber-200"
          data-testid="diff-truncated"
        >
          <FileWarning aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          Patch truncated by the auditor — showing the first {files.length} changed{' '}
          {files.length === 1 ? 'file' : 'files'} only.
        </p>
      ) : null}

      <ul className="space-y-1" aria-label="Changed files" data-testid="diff-file-list">
        {files.map((file) => (
          <li
            key={file.path}
            className="flex items-center gap-2 font-mono text-[12px]"
            data-testid="diff-file-row"
          >
            <span className="min-w-0 flex-1 truncate text-slate-200" title={file.path}>
              {file.path}
            </span>
            <span className="tabular-nums text-emerald-300" title={`${file.added} lines added`}>
              +{file.added}
            </span>
            <span className="tabular-nums text-rose-300" title={`${file.removed} lines removed`}>
              −{file.removed}
            </span>
          </li>
        ))}
      </ul>

      {files.length === 0 ? (
        <p className="text-center text-[12px] text-slate-400">The patch mentions no files.</p>
      ) : null}

      <div className="space-y-2">
        {files.map((file) => {
          const focused = file.path === focusPath;
          const lines = annotateWordDiffs(file.lines);
          return (
            <details
              key={file.path}
              open
              ref={focused ? focusRef : undefined}
              className={`overflow-hidden rounded-md border bg-slate-950/60 ${
                focused ? 'border-sky-400/60 ring-1 ring-sky-400/40' : 'border-slate-800'
              }`}
              data-testid={`diff-file-${file.path}`}
              data-path={file.path}
              data-focused={focused ? 'true' : 'false'}
            >
              <summary className="flex cursor-pointer items-center gap-2 bg-slate-900/70 px-2 py-1 font-mono text-[12px] text-slate-200">
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
                <span className="tabular-nums text-emerald-300">+{file.added}</span>
                <span className="tabular-nums text-rose-300">−{file.removed}</span>
              </summary>
              {lines.length === 0 ? (
                <p className="px-2 py-1.5 text-[12px] italic text-slate-400">
                  No textual patch for this file (binary, renamed or truncated).
                </p>
              ) : (
                <div className="max-h-[45vh] overflow-auto">
                  <div className="font-mono text-[12px] leading-relaxed">
                    {lines.map((line, index) => (
                      <div
                        // Patch lines have no stable id; index is the row identity here.
                        key={`${file.path}:${index}`}
                        className={`whitespace-pre px-2 ${LINE_CLASS[line.kind]}`}
                        data-line-kind={line.kind}
                        data-word-diff={line.segments === undefined ? undefined : 'true'}
                      >
                        <PatchRow line={line} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </details>
          );
        })}
      </div>
    </div>
  );
}
