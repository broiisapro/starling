/**
 * The prompt-ready text rendering of a `RepoMap`.
 *
 * Two consumers, two shapes:
 * - the planner wants breadth ("which folders exist, what languages, how do I test this?") — no
 *   `lanes`, so the output is the header + tree + a flat, score-sorted file list;
 * - the prompt compiler wants depth on a lane (`lanes` + `related`), so the output is grouped
 *   editable → read → neighbours → orientation, with symbols and summaries only where they help.
 *
 * `maxTokens` is enforced on characters (`tokens × 4`), at line boundaries, with an honest
 * "N more files" tail so a reader never assumes the list is complete. Editable and read files are
 * emitted before the budget is spent: hiding a file the agent may edit is worse than a long prompt.
 */

import type { RepoFile, RepoMap } from '@starling/core';
import { matchesAny } from '@starling/core';
import { isTestFile } from './summaries';

export interface RenderRepoMapOptions {
  /** Approximate token budget (characters ÷ 4). Default 4000. Ignored when `maxChars` is set. */
  maxTokens?: number;
  /** Hard character budget. The prompt compiler budgets in characters, so it passes this. */
  maxChars?: number;
  /** Globs whose files get symbols + summary. Everything else stays a path. */
  focus?: string[];
  /** Neighbour paths (importers, imports, siblings) that rank between the focus and the rest. */
  related?: string[];
  /** Lane globs. Presence switches to the grouped, worker-facing layout. */
  lanes?: { owns: string[]; reads: string[] };
  /** `compact` drops summaries, the tree and the orientation tail. */
  style?: 'full' | 'compact';
  /** Include `map.tree`. Default true; the worker map turns it off and spends the budget on files. */
  tree?: boolean;
  /** Show `· 1.6 kB` per file. Default false (planner shape). */
  bytes?: boolean;
  /** Symbols shown per detailed file. Default all (up to the extraction cap). */
  maxSymbols?: number;
  /** Override the per-style bucket caps. */
  caps?: Partial<BucketCaps>;
}

export interface RenderedRepoMap {
  text: string;
  filesShown: number;
  filesTotal: number;
  /** True when at least one file was hidden or the text was clamped. */
  truncated: boolean;
}

export const DEFAULT_RENDER_MAX_TOKENS = 4000;

interface BucketCaps {
  owned: number;
  read: number;
  related: number;
  other: number;
}

const CAPS: Record<'full' | 'compact', BucketCaps> = {
  full: { owned: 40, read: 12, related: 24, other: 30 },
  compact: { owned: 16, read: 6, related: 12, other: 0 },
};

const PLAIN_LINE_CHARS = 220;
const LANE_LINE_CHARS = 300;

const LANGUAGE_WEIGHT: Readonly<Record<string, number>> = {
  typescript: 3,
  javascript: 3,
  python: 3,
  go: 3,
  rust: 3,
  swift: 2,
  kotlin: 2,
  java: 2,
  c: 2,
  cpp: 2,
  csharp: 2,
  ruby: 2,
  php: 2,
  css: 1,
  scss: 1,
  html: 1,
  vue: 1,
  svelte: 1,
  markdown: 0,
  json: -1,
  yaml: -1,
  toml: -1,
  text: -1,
};

export interface RankRepoFilesOptions {
  owns?: string[];
  reads?: string[];
  /** Exact paths or globs that deserve detail without being edited. */
  related?: string[];
}

export interface RankedRepoFiles {
  /** Files matching an `owns` glob: editable. */
  owned: RepoFile[];
  /** Files matching a `reads` glob: read-only orientation. */
  read: RepoFile[];
  /** Neighbours: importers, imports, siblings. Not a lane. */
  related: RepoFile[];
  /** Everything else in the map. */
  other: RepoFile[];
}

function byPath(a: RepoFile, b: RepoFile): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

function matchesRelated(path: string, related: readonly string[]): boolean {
  return related.some((entry) => (entry.includes('*') || entry.includes('?') ? matchesAny(path, [entry]) : path === entry));
}

/** Split the map into editable / read / neighbour / other, each sorted by path for determinism. */
export function rankRepoFiles(map: RepoMap, options: RankRepoFilesOptions = {}): RankedRepoFiles {
  const owns = options.owns ?? [];
  const reads = options.reads ?? [];
  const related = options.related ?? [];
  const owned: RepoFile[] = [];
  const read: RepoFile[] = [];
  const neighbours: RepoFile[] = [];
  const other: RepoFile[] = [];

  for (const file of map.files) {
    if (owns.length > 0 && matchesAny(file.path, owns)) owned.push(file);
    else if (reads.length > 0 && matchesAny(file.path, reads)) read.push(file);
    else if (related.length > 0 && matchesRelated(file.path, related)) neighbours.push(file);
    else other.push(file);
  }

  return {
    owned: owned.sort(byPath),
    read: read.sort(byPath),
    related: neighbours.sort(byPath),
    other: other.sort(byPath),
  };
}

function languageSummary(languages: Record<string, number>): string {
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([lang, count]) => `${lang} ${count}`)
    .join(', ');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clampLine(line: string, max: number): string {
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, Math.max(0, maxChars));
  return `${text.slice(0, maxChars - 3).trimEnd()}…`;
}

function scoreFile(file: RepoFile, focused: boolean): number {
  const focusedBonus = focused ? 100 : 0;
  const symbols = file.symbols.length > 0 ? 4 : 0;
  const tests = isTestFile(file.path) ? -1 : 0;
  const lang = LANGUAGE_WEIGHT[file.lang] ?? 0;
  return focusedBonus + symbols + tests + lang + Math.min(file.bytes / 10_000, 1);
}

interface LineStyle {
  detail: boolean;
  bytes: boolean;
  summaries: boolean;
  maxSymbols: number;
  maxChars: number;
}

function plainLine(file: RepoFile, style: LineStyle): string {
  const head = `- ${file.path} (${file.lang})`;
  if (!style.detail) return head;
  const symbols = file.symbols.length > 0 ? `: ${file.symbols.join(', ')}` : '';
  const summary = style.summaries && file.summary !== undefined ? ` — ${file.summary}` : '';
  return clampLine(`${head}${symbols}${summary}`, style.maxChars);
}

function laneLine(file: RepoFile, style: LineStyle): string {
  const parts = [file.path, file.lang];
  if (style.bytes) parts.push(formatBytes(file.bytes));
  if (style.detail && file.symbols.length > 0) {
    parts.push(`symbols: ${file.symbols.slice(0, style.maxSymbols).join(', ')}`);
  }
  const summary = style.detail && style.summaries && file.summary !== undefined ? ` — ${file.summary}` : '';
  return clampLine(`- ${parts.join(' · ')}${summary}`, style.maxChars);
}

/** Keep at most `perDir` files from the same directory, so the tail shows the tree's breadth. */
function limitPerDirectory(files: readonly RepoFile[], perDir: number): RepoFile[] {
  if (perDir <= 0) return [];
  const counts = new Map<string, number>();
  const out: RepoFile[] = [];
  for (const file of files) {
    const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.';
    const seen = counts.get(dir) ?? 0;
    if (seen >= perDir) continue;
    counts.set(dir, seen + 1);
    out.push(file);
  }
  return out;
}

/** Render and also report how much of the map survived, so the caller can warn about omissions. */
export function renderRepoMapDetail(
  map: RepoMap,
  opts: RenderRepoMapOptions = {},
): RenderedRepoMap {
  const style = opts.style ?? 'full';
  const budget =
    opts.maxChars ?? Math.max(0, Math.floor((opts.maxTokens ?? DEFAULT_RENDER_MAX_TOKENS) * 4));
  if (budget === 0) return { text: '', filesShown: 0, filesTotal: map.files.length, truncated: map.files.length > 0 };

  const caps: BucketCaps = { ...CAPS[style], ...opts.caps };
  const maxSymbols = opts.maxSymbols ?? 40;
  const lanes = opts.lanes;
  const ranked = rankRepoFiles(map, {
    owns: lanes?.owns,
    reads: lanes?.reads,
    related: opts.related,
  });

  const lines: string[] = [];
  let used = 0;
  const push = (line: string): void => {
    lines.push(line);
    used += line.length + 1;
  };

  let shown = 0;
  const emit = (file: RepoFile, style_: LineStyle, force: boolean, fillBudget: number): boolean => {
    const line = lanes === undefined ? plainLine(file, style_) : laneLine(file, style_);
    if (!force && used + line.length > fillBudget) return false;
    push(line);
    shown += 1;
    return true;
  };

  if (lanes === undefined) {
    push(`# Repo map: ${map.root}`);
    const languages = languageSummary(map.languages);
    if (languages.length > 0) push(`Languages: ${languages}`);
    if (map.testCommand !== undefined) push(`Test: ${map.testCommand}`);
    if (map.lintCommand !== undefined) push(`Lint: ${map.lintCommand}`);

    if (opts.tree !== false && map.tree.length > 0) {
      push('');
      for (const line of map.tree.split('\n')) {
        if (used + line.length > budget) {
          push('… (tree truncated)');
          break;
        }
        push(line);
      }
    }

    const focused = new Set<string>();
    if (opts.focus !== undefined && opts.focus.length > 0) {
      for (const file of map.files) if (matchesAny(file.path, opts.focus)) focused.add(file.path);
    }
    const related = new Set(ranked.related.map((file) => file.path));
    const ordered = [...map.files]
      .map((file) => ({ file, focused: focused.has(file.path) }))
      .map((entry) => ({ ...entry, score: scoreFile(entry.file, entry.focused) }))
      .sort((a, b) => b.score - a.score || (a.file.path < b.file.path ? -1 : 1));

    if (map.files.length > 0) {
      push('');
      push(`Files (${map.files.length}):`);
      for (const entry of ordered) {
        const detail = focused.size === 0 || entry.focused || related.has(entry.file.path);
        if (
          !emit(
            entry.file,
            {
              detail,
              bytes: opts.bytes === true,
              summaries: true,
              maxSymbols,
              maxChars: PLAIN_LINE_CHARS,
            },
            false,
            budget,
          )
        ) {
          break;
        }
      }
      const omitted = map.files.length - shown;
      if (omitted > 0) push(`… (${omitted} more files)`);
    }

    const text = truncate(lines.join('\n'), budget);
    return {
      text,
      filesShown: shown,
      filesTotal: map.files.length,
      truncated: shown < map.files.length || text.length < lines.join('\n').length,
    };
  }

  // ── lane mode: the worker-facing, grouped shape ────────────────────────────────────────────────
  /**
   * Room kept for the "N more files" footer, so an honest omission note is never the first thing
   * the budget cuts. Owned/read lines ignore it (and the budget): they are never hidden.
   */
  const FOOTER_RESERVE = 110;
  const fillBudget = Math.max(0, budget - FOOTER_RESERVE);
  push(
    `Repo: ${map.root} · ${map.files.length} ${plural(map.files.length, 'file', 'files')}${languageSummary(map.languages) ? ` · ${languageSummary(map.languages)}` : ''}`,
  );
  const tools: string[] = [];
  if (map.testCommand !== undefined) tools.push(`test \`${map.testCommand}\``);
  if (map.lintCommand !== undefined) tools.push(`lint \`${map.lintCommand}\``);
  if (tools.length > 0) push(`Tools: ${tools.join(' · ')}`);

  if (opts.tree === true && map.tree.length > 0) {
    push('');
    for (const line of map.tree.split('\n')) push(line);
  }

  const laneStyle: LineStyle = {
    detail: true,
    bytes: opts.bytes === true,
    summaries: style === 'full',
    maxSymbols,
    maxChars: LANE_LINE_CHARS,
  };
  const pathStyle: LineStyle = { ...laneStyle, detail: false };

  const buckets: Array<{
    title: string;
    files: RepoFile[];
    cap: number;
    perDir: number;
    style: LineStyle;
    force: boolean;
  }> = [
    { title: 'In your lane (editable):', files: ranked.owned, cap: caps.owned, perDir: 0, style: laneStyle, force: true },
    { title: 'You will read:', files: ranked.read, cap: caps.read, perDir: 0, style: laneStyle, force: true },
    {
      title: 'Neighbours (importers, imports, siblings):',
      files: ranked.related,
      cap: caps.related,
      perDir: 0,
      style: laneStyle,
      force: false,
    },
    {
      title: 'Other files (orientation only):',
      files: ranked.other,
      cap: caps.other,
      // One line per directory: 30 modules from the same folder is not orientation, it is noise.
      perDir: 1,
      style: pathStyle,
      force: false,
    },
  ];

  for (const bucket of buckets) {
    if (bucket.files.length === 0 || bucket.cap === 0) continue;
    const before = shown;
    const start = lines.length;
    push('');
    push(bucket.title);
    // Sampling only matters when the bucket is over its cap: a small repo shows every path.
    const candidates =
      bucket.perDir > 0 && bucket.files.length > bucket.cap
        ? limitPerDirectory(bucket.files, bucket.perDir)
        : bucket.files;
    for (const file of candidates.slice(0, bucket.cap)) {
      if (!emit(file, bucket.style, bucket.force, fillBudget)) break;
    }
    if (shown === before) {
      lines.length = start;
      used = lines.join('\n').length + (lines.length > 0 ? 1 : 0);
    }
  }

  const assembled = lines.join('\n');
  const omitted = map.files.length - shown;
  const footer =
    omitted > 0
      ? `… ${omitted} more ${plural(omitted, 'file', 'files')} not shown. Read the files you need; do not guess at paths or APIs.`
      : undefined;
  const withFooter = footer === undefined ? assembled : `${assembled}\n\n${footer}`;
  const text = truncate(withFooter, budget);
  return {
    text,
    filesShown: shown,
    filesTotal: map.files.length,
    truncated: omitted > 0 || text.length < withFooter.length,
  };
}

/**
 * Render a repo map for a prompt.
 *
 * ```ts
 * renderRepoMap(map, { maxTokens: 1500, focus: ['src/features/theme/**'] });
 * renderRepoMap(map, { maxChars: 6000, lanes: task.lane, related: ['src/main.ts'] });
 * ```
 */
export function renderRepoMap(map: RepoMap, opts: RenderRepoMapOptions = {}): string {
  return renderRepoMapDetail(map, opts).text;
}
