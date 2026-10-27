import type { TaskStatus } from '@starling/core';
import type { Palette } from './palette';

/** Stable, executable-looking glyphs. Kept unicode: every modern terminal handles them. */
const ICONS: Record<TaskStatus, string> = {
  pending: '·',
  ready: '○',
  running: '◐',
  auditing: '◎',
  fixing: '✎',
  merging: '⇄',
  merged: '✔',
  failed: '✘',
  conflict: '⚡',
  cancelled: '–',
};

const LABELS: Record<TaskStatus, string> = {
  pending: 'pending',
  ready: 'ready',
  running: 'running',
  auditing: 'audit',
  fixing: 'fixing',
  merging: 'merge',
  merged: 'merged',
  failed: 'failed',
  conflict: 'conflict',
  cancelled: 'cancel',
};

export function taskIcon(status: TaskStatus): string {
  return ICONS[status];
}

export function taskLabel(status: TaskStatus): string {
  return LABELS[status];
}

/** Colour a task's status cell. Merged is green, anything broken is red, work in flight is cyan. */
export function colorTaskStatus(palette: Palette, status: TaskStatus, text: string): string {
  switch (status) {
    case 'merged':
      return palette.green(text);
    case 'failed':
    case 'conflict':
      return palette.red(text);
    case 'cancelled':
      return palette.gray(text);
    case 'running':
    case 'merging':
      return palette.cyan(text);
    case 'auditing':
      return palette.yellow(text);
    case 'fixing':
      return palette.magenta(text);
    case 'ready':
      return palette.blue(text);
    case 'pending':
      return palette.gray(text);
  }
}

export function statusCell(palette: Palette, status: TaskStatus): string {
  return colorTaskStatus(palette, status, `${taskIcon(status)} ${taskLabel(status)}`);
}

/** Node status glyph, shared by `renderFlock` and the live footer. */
export function nodeStatusCell(palette: Palette, status: 'online' | 'busy' | 'offline'): string {
  if (status === 'online') return palette.green('● online');
  if (status === 'busy') return palette.cyan('◐ busy');
  return palette.red('○ offline');
}
