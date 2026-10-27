import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { HandbackStatus } from './types';

/**
 * Read the `**Status:**` line out of a handback.
 *
 * Handbacks are prose, so this is deliberately forgiving: it takes the first `Status:` line, looks
 * for the words `partial` / `complete` and otherwise reports `unknown`. A missing file is reported
 * as `missing` by the caller; a missing directory as `unavailable`.
 */
export function parseHandbackStatus(markdown: string): HandbackStatus {
  const match = /^\s*(?:\*\*)?Status:(?:\*\*)?\s*(.+)$/im.exec(markdown);
  if (match === null) return 'unknown';
  const line = (match[1] ?? '').toLowerCase();
  if (line.includes('partial')) return 'partial';
  if (line.includes('complete')) return 'complete';
  return 'unknown';
}

/**
 * Map epic number → handback status by reading `.orchestrator/handbacks/`.
 *
 * Returns `null` when the directory itself is absent so the collector can report every epic as
 * `unavailable` instead of pretending each one forgot its handback.
 */
export async function readHandbackStatuses(
  dir: string,
  epics: { number: string; slug: string }[],
): Promise<Map<string, HandbackStatus> | null> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const byNumber = new Map<string, string>();
  for (const file of files) {
    const match = /^(\d{2,})-(.+)\.md$/.exec(file);
    if (match?.[1] !== undefined) byNumber.set(match[1].padStart(2, '0'), file);
  }

  const statuses = new Map<string, HandbackStatus>();
  for (const epic of epics) {
    const file = byNumber.get(epic.number) ?? `${epic.number}-${epic.slug}.md`;
    if (!files.includes(file)) {
      statuses.set(epic.number, 'missing');
      continue;
    }
    try {
      statuses.set(epic.number, parseHandbackStatus(await readFile(join(dir, file), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        statuses.set(epic.number, 'missing');
        continue;
      }
      throw error;
    }
  }
  return statuses;
}
