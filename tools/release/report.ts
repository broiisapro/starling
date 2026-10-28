/**
 * Human-readable output for the release scripts: byte sizes and a ✓/✗ checklist.
 *
 * Kept separate from `dry-run.ts` so the formatting is unit-testable without compiling anything.
 */
export interface ChecklistItem {
  label: string;
  ok: boolean;
  /** Extra context printed after the label (a size, a path, a failure reason). */
  detail?: string;
}

/** `85.2 MB`, `1.4 KB`, `512 B` — one decimal from KB up, matching what `ls -lh` feels like. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} B`;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Render the checklist lines (`✓`/`✗`, plus a `————` title when given). */
export function renderChecklist(items: readonly ChecklistItem[], title?: string): string {
  const lines = items.map((item) => {
    const mark = item.ok ? '✓' : '✗';
    const detail = item.detail === undefined || item.detail === '' ? '' : `  ${item.detail}`;
    return `  ${mark} ${item.label}${detail}`;
  });
  if (title === undefined) return lines.join('\n');
  return [`${title}`, ...lines].join('\n');
}

/** Zero only when every item is green — the dry run's exit code. */
export function checklistExitCode(items: readonly ChecklistItem[]): number {
  return items.every((item) => item.ok) ? 0 : 1;
}
