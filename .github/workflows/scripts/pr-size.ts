/**
 * PR size labelling (Epic 150).
 *
 * `sizeLabel` is pure so the threshold and ignore rules are testable without GitHub or a network.
 * The small `main` at the bottom reads the PR's changed files from the GitHub API via `gh`, creates
 * the five labels idempotently, and swaps whichever `size/*` label is currently applied.
 *
 * The changed-line count is additions + deletions of every file that is *not* an ignore pattern.
 * Lockfiles, fixtures, snapshots, recordings and generated results are excluded because a PR that
 * touches one of them says nothing about review effort (and would turn every PR into `size/XL`).
 */

import { appendFileSync } from 'node:fs';
import { StarlingError } from '../../../packages/core/src/index.ts';

export type SizeLabel = 'size/XS' | 'size/S' | 'size/M' | 'size/L' | 'size/XL';

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

/** Changed lines at or below this value get the label (in order). */
export const SIZE_THRESHOLDS = [10, 100, 500, 1000] as const;

export const SIZE_LABELS: ReadonlyArray<{ name: SizeLabel; color: string; description: string }> = [
  { name: 'size/XS', color: '0e8a16', description: '≤ 10 changed lines' },
  { name: 'size/S', color: '1d76db', description: '≤ 100 changed lines' },
  { name: 'size/M', color: 'fbca04', description: '≤ 500 changed lines' },
  { name: 'size/L', color: 'd93f0b', description: '≤ 1000 changed lines' },
  { name: 'size/XL', color: 'b60205', description: '> 1000 changed lines' },
];

/**
 * Paths that do not count towards review size.
 *
 * A pattern without a slash matches a basename at any depth (`*.jsonl`, `bun.lock`); a pattern with
 * a slash is matched against the repo-relative path, where `*` is one segment and `**` is zero or
 * more segments.
 */
export const IGNORED_PATTERNS: readonly string[] = [
  'bun.lock',
  'fixtures/**',
  '**/__snapshots__/**',
  '**/__screenshots__/**',
  '*.jsonl',
  'tools/*/results/**',
  'tools/stats/out/**',
];

/** Normalise a path from the API to forward slashes without a leading `./`. */
export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function matchSegment(pattern: string, segment: string): boolean {
  let regex = '^';
  for (const char of pattern) {
    if (char === '*') regex += '[^/]*';
    else if (char === '?') regex += '[^/]';
    else regex += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${regex}$`).test(segment);
}

function matchSegments(pattern: string[], path: string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const [head, ...rest] = pattern;
  if (head === '**') {
    for (let skip = 0; skip <= path.length; skip += 1) {
      if (matchSegments(rest, path.slice(skip))) return true;
    }
    return false;
  }
  if (path.length === 0) return false;
  const segment = path[0];
  if (segment === undefined || head === undefined || !matchSegment(head, segment)) return false;
  return matchSegments(rest, path.slice(1));
}

/** True when a repo-relative path is excluded from the size calculation. */
export function isIgnored(path: string): boolean {
  const normalized = normalizePath(path);
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  return IGNORED_PATTERNS.some((pattern) => {
    if (pattern.includes('/')) return matchSegments(pattern.split('/'), segments);
    // No slash: a basename rule, matched at any depth (e.g. `*.jsonl`).
    return segments.some((segment) => matchSegment(pattern, segment));
  });
}

/** Additions + deletions of every file that counts towards size. */
export function changedLines(files: readonly ChangedFile[]): number {
  return files.reduce((total, file) => {
    if (isIgnored(file.path)) return total;
    return total + Math.max(0, file.additions) + Math.max(0, file.deletions);
  }, 0);
}

/** The size bucket for a PR. Boundaries are inclusive: exactly 10 lines is still `size/XS`. */
export function sizeLabel(files: readonly ChangedFile[]): SizeLabel {
  const lines = changedLines(files);
  const labels: SizeLabel[] = ['size/XS', 'size/S', 'size/M', 'size/L', 'size/XL'];
  for (let index = 0; index < SIZE_THRESHOLDS.length; index += 1) {
    const threshold = SIZE_THRESHOLDS[index];
    if (threshold !== undefined && lines <= threshold) {
      const label = labels[index];
      if (label !== undefined) return label;
    }
  }
  return 'size/XL';
}

// ── gh plumbing (the only part that needs a network) ────────────────────────

interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Injectable runner so the labelling flow can be tested without spawning `gh`. */
export type GhRunner = (args: readonly string[]) => CommandOutput;

export const runGh: GhRunner = (args) => {
  const result = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? 1,
  };
};

function ghOrThrow(run: GhRunner, args: readonly string[]): string {
  const result = run(args);
  if (result.exitCode !== 0) {
    throw new StarlingError('GH_COMMAND', `gh ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Parse the TSV emitted by `gh api ... --jq '.[] | [.filename,.additions,.deletions] | @tsv'`. */
export function parseChangedFiles(tsv: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of tsv.split('\n')) {
    if (line.trim().length === 0) continue;
    const [path, additions, deletions] = line.split('\t');
    if (path === undefined) continue;
    files.push({
      path,
      additions: Number(additions ?? 0) || 0,
      deletions: Number(deletions ?? 0) || 0,
    });
  }
  return files;
}

export function readChangedFiles(run: GhRunner, repo: string, pullNumber: string): ChangedFile[] {
  const tsv = ghOrThrow(run, [
    'api',
    `repos/${repo}/pulls/${pullNumber}/files?per_page=100`,
    '--paginate',
    '--jq',
    '.[] | [.filename, .additions, .deletions] | @tsv',
  ]);
  return parseChangedFiles(tsv);
}

/** Create/update every size label. `--force` makes this idempotent on reruns. */
export function ensureLabels(run: GhRunner): void {
  for (const label of SIZE_LABELS) {
    ghOrThrow(run, [
      'label',
      'create',
      label.name,
      '--force',
      '--color',
      label.color,
      '--description',
      label.description,
    ]);
  }
}

export function currentLabels(run: GhRunner, repo: string, pullNumber: string): string[] {
  const output = ghOrThrow(run, ['api', `repos/${repo}/issues/${pullNumber}/labels`, '--jq', '.[].name']);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function removeLabel(run: GhRunner, repo: string, pullNumber: string, label: string): void {
  // `size/XS` contains a slash, so the label must be URL-encoded in the path.
  ghOrThrow(run, [
    'api',
    '--method',
    'DELETE',
    `repos/${repo}/issues/${pullNumber}/labels/${encodeURIComponent(label)}`,
  ]);
}

function addLabel(run: GhRunner, repo: string, pullNumber: string, label: SizeLabel): void {
  ghOrThrow(run, [
    'api',
    '--method',
    'POST',
    `repos/${repo}/issues/${pullNumber}/labels`,
    '-f',
    `labels[]=${label}`,
  ]);
}

/**
 * Swap the size label for one PR. Exported (rather than only run in `main`) so a test can prove the
 * full sequence against a fake runner.
 */
export function applySizeLabel(
  run: GhRunner,
  repo: string,
  pullNumber: string,
  files: readonly ChangedFile[],
): { label: SizeLabel; lines: number } {
  const label = sizeLabel(files);
  const lines = changedLines(files);
  ensureLabels(run);
  const existing = currentLabels(run, repo, pullNumber).filter((name) => name.startsWith('size/'));
  for (const name of existing) {
    if (name !== label) removeLabel(run, repo, pullNumber, name);
  }
  if (!existing.includes(label)) addLabel(run, repo, pullNumber, label);
  return { label, lines };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', `${name} is not set`);
  }
  return value.trim();
}

function main(): void {
  const repo = requiredEnv('GITHUB_REPOSITORY');
  const pullNumber = requiredEnv('PR_NUMBER');
  const files = readChangedFiles(runGh, repo, pullNumber);
  const { label, lines } = applySizeLabel(runGh, repo, pullNumber, files);
  const ignored = files.filter((file) => isIgnored(file.path)).length;
  console.log(
    `${label}: ${lines} changed lines across ${files.length - ignored} counted files ` +
      `(${ignored} ignored, ${files.length} total)`,
  );
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath !== undefined) {
    appendFileSync(summaryPath, `PR size: **${label}** — ${lines} changed lines (${ignored} ignored)\n`);
  }
}

if (import.meta.main) main();
