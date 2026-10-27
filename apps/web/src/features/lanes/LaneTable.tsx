import type { LaneNode } from './derive';
import { laneRows } from './derive';
import { colourFor, type LaneColours } from './palette';

/**
 * The accessible twin of the treemap: the same tree as a table (path, owner, readers, touched,
 * flags). It is not a fallback for old browsers — it is the view a screen reader, a copy-paste, or
 * a keyboard-only user gets, and it carries the numbers the tiles only hint at.
 */

export interface LaneTableProps {
  tree: LaneNode;
  colours: LaneColours;
  titles: ReadonlyMap<string, string>;
  selectedTask?: string;
}

export function laneFlags(node: LaneNode): string[] {
  const flags: string[] = [];
  if (node.overlap) flags.push('overlap');
  if (node.conflict) flags.push('conflict');
  if (node.violation) flags.push('violation');
  if (node.owners.length === 0 && node.readers.length > 0) flags.push('read-only');
  return flags;
}

function displayTasks(keys: readonly string[], titles: ReadonlyMap<string, string>): string {
  if (keys.length === 0) return '—';
  return keys.map((key) => titles.get(key) ?? key).join(', ');
}

function indent(path: string): number {
  return Math.max(0, path.split('/').length - 1) * 12;
}

export function LaneTable({ tree, colours, titles, selectedTask }: LaneTableProps) {
  const rows = laneRows(tree);
  return (
    <div className="h-full min-h-0 overflow-auto" data-testid="lanes-table-wrap">
      <table className="w-full border-collapse text-left text-caption" data-testid="lanes-table">
        <caption className="sr-only">Lane ownership for every path in the active plan</caption>
        <thead className="sticky top-0 bg-surface-2/95 text-micro uppercase tracking-[0.12em] text-ink-4">
          <tr>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Path
            </th>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Owner
            </th>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Reads
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              Lines
            </th>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Flags
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((node) => {
            const flags = laneFlags(node);
            const owner = node.owners[0];
            const selected = selectedTask !== undefined && node.owners.includes(selectedTask);
            return (
              <tr
                key={node.path}
                data-testid="lane-row"
                data-path={node.path}
                data-kind={node.kind}
                data-selected={selected ? 'true' : 'false'}
                className={selected ? 'bg-focus/10 text-ink-1' : 'text-ink-2'}
              >
                <th scope="row" className="whitespace-nowrap px-3 py-1 font-normal">
                  <span
                    style={{ paddingLeft: indent(node.path) }}
                    className="inline-flex items-center gap-1.5"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: colourFor(colours, owner) }}
                    />
                    <span className="font-mono text-caption">
                      {node.path}
                      {node.kind === 'dir' ? '/' : ''}
                    </span>
                  </span>
                </th>
                <td className="px-3 py-1">{displayTasks(node.owners, titles)}</td>
                <td className="px-3 py-1 text-ink-3">{displayTasks(node.readers, titles)}</td>
                <td className="px-3 py-1 text-right tabular-nums">{node.touched > 0 ? node.touched : '—'}</td>
                <td className="px-3 py-1">
                  {flags.length === 0 ? (
                    <span className="text-ink-4">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {flags.map((flag) => (
                        <span
                          key={flag}
                          className={
                            flag === 'conflict' || flag === 'violation'
                              ? 'rounded-full border border-red-400/40 bg-red-400/10 px-1.5 text-red-200'
                              : flag === 'overlap'
                                ? 'rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 text-amber-200'
                                : 'rounded-full border border-hairline bg-surface-3/60 px-1.5 text-ink-3'
                          }
                        >
                          {flag}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
