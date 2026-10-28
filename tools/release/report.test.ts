/**
 * Checklist formatting: the last thing a human reads after `dry-run.ts`, so ✓/✗ and the exit code
 * have to agree with reality.
 */
import { describe, expect, test } from 'bun:test';
import { type ChecklistItem, checklistExitCode, formatBytes, renderChecklist } from './report.ts';

describe('formatBytes', () => {
  test('bytes below 1 KiB stay bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  test('KiB/MiB/GB use one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(85.2 * 1024 * 1024)).toBe('85.2 MB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB');
  });

  test('a nonsense negative size is printed, not hidden', () => {
    expect(formatBytes(-1)).toBe('-1 B');
  });
});

describe('renderChecklist', () => {
  const items: ChecklistItem[] = [
    { label: 'one', ok: true },
    { label: 'two', ok: false, detail: 'why' },
  ];

  test('marks green and red with detail', () => {
    expect(renderChecklist(items)).toBe('  ✓ one\n  ✗ two  why');
  });

  test('prints the title first when given', () => {
    expect(renderChecklist(items, 'title')).toBe('title\n  ✓ one\n  ✗ two  why');
  });

  test('an empty detail adds no trailing spaces', () => {
    expect(renderChecklist([{ label: 'x', ok: true, detail: '' }])).toBe('  ✓ x');
  });
});

describe('checklistExitCode', () => {
  test('zero when everything passed', () => {
    expect(checklistExitCode([{ label: 'a', ok: true }])).toBe(0);
  });

  test('one when anything failed', () => {
    expect(
      checklistExitCode([
        { label: 'a', ok: true },
        { label: 'b', ok: false },
      ]),
    ).toBe(1);
  });

  test('an empty checklist is green', () => {
    expect(checklistExitCode([])).toBe(0);
  });
});
