// biome-ignore-all lint/suspicious/noArrayIndexKey: patch lines have no stable identity beyond their position
import type { DiffSummary } from '@starling/core';
import { FileWarning } from 'lucide-react';
import { diffFiles, type PatchLineKind } from './diff';

const LINE_CLASS: Record<PatchLineKind, string> = {
  add: 'bg-emerald-950/50 text-emerald-200',
  del: 'bg-rose-950/50 text-rose-200',
  hunk: 'bg-slate-900 font-medium text-sky-300',
  meta: 'text-slate-500',
  ctx: 'text-slate-400',
};

/** Read-only unified diff view: file list first, then one collapsible block per file. */
export function DiffTab({ diff }: { diff?: DiffSummary }) {
  if (!diff) {
    return <p className="p-6 text-center text-sm text-slate-500">No diff recorded yet.</p>;
  }

  const files = diffFiles(diff);

  return (
    <div className="space-y-3 p-3" data-testid="diff-tab">
      {diff.truncated ? (
        <p
          className="flex items-start gap-1.5 rounded-md border border-amber-800/70 bg-amber-950/40 px-2 py-1.5 text-[11px] text-amber-200"
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
            className="flex items-center gap-2 font-mono text-[11px]"
            data-testid="diff-file-row"
          >
            <span className="min-w-0 flex-1 truncate text-slate-200" title={file.path}>
              {file.path}
            </span>
            <span className="text-emerald-300" title={`${file.added} lines added`}>
              +{file.added}
            </span>
            <span className="text-rose-300" title={`${file.removed} lines removed`}>
              −{file.removed}
            </span>
          </li>
        ))}
      </ul>

      {files.length === 0 ? (
        <p className="text-center text-[11px] text-slate-500">The patch mentions no files.</p>
      ) : null}

      <div className="space-y-2">
        {files.map((file) => (
          <details
            key={file.path}
            open
            className="overflow-hidden rounded-md border border-slate-800 bg-slate-950/60"
            data-testid={`diff-file-${file.path}`}
          >
            <summary className="flex cursor-pointer items-center gap-2 bg-slate-900/70 px-2 py-1 font-mono text-[11px] text-slate-200">
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
              <span className="text-emerald-300">+{file.added}</span>
              <span className="text-rose-300">−{file.removed}</span>
            </summary>
            {file.lines.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] italic text-slate-500">
                No textual patch for this file (binary, renamed or truncated).
              </p>
            ) : (
              <div className="max-h-[45vh] overflow-auto">
                <div className="font-mono text-[11px] leading-relaxed">
                  {file.lines.map((line, index) => (
                    <div
                      // Patch lines have no stable id; index is the row identity here.
                      key={`${file.path}:${index}`}
                      className={`whitespace-pre px-2 ${LINE_CLASS[line.kind]}`}
                      data-line-kind={line.kind}
                    >
                      {line.text.length > 0 ? line.text : ' '}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
