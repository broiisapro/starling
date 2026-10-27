/**
 * The prompt-ready text rendering of a `RepoMap`.
 *
 * Two consumers, two shapes:
 * - the planner wants breadth ("which folders exist, what languages, how do I test this?");
 * - the prompt compiler wants depth on a lane (`focus` globs expand those files to symbols and
 *   summaries while the rest stay a one-line path).
 *
 * `maxTokens` is enforced on characters (`tokens × 4`), at line boundaries, with an honest
 * "N more files" tail so a reader never assumes the list is complete.
 */

import type { RepoFile, RepoMap } from '@starling/core';
import { matchesAny } from '@starling/core';
import { isTestFile } from './summaries';

export interface RenderRepoMapOptions {
  /** Approximate token budget (characters ÷ 4). Default 4000. */
  maxTokens?: number;
  /** Globs whose files get symbols + summary. Everything else stays a path. */
  focus?: string[];
}

export const DEFAULT_RENDER_MAX_TOKENS = 4000;

const MAX_FILE_LINE_CHARS = 220;

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

function fileLine(file: RepoFile, detail: boolean): string {
  const head = `- ${file.path} (${file.lang})`;
  if (!detail) return head;
  const symbols = file.symbols.length > 0 ? `: ${file.symbols.join(', ')}` : '';
  const summary = file.summary === undefined ? '' : ` — ${file.summary}`;
  const line = `${head}${symbols}${summary}`;
  return line.length > MAX_FILE_LINE_CHARS ? `${line.slice(0, MAX_FILE_LINE_CHARS - 1)}…` : line;
}

function scoreFile(file: RepoFile, focused: boolean): number {
  const focusedBonus = focused ? 100 : 0;
  const symbols = file.symbols.length > 0 ? 4 : 0;
  const tests = isTestFile(file.path) ? -1 : 0;
  const lang = LANGUAGE_WEIGHT[file.lang] ?? 0;
  return focusedBonus + symbols + tests + lang + Math.min(file.bytes / 10_000, 1);
}

function languageSummary(languages: Record<string, number>): string {
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([lang, count]) => `${lang} ${count}`)
    .join(', ');
}

/**
 * Render a repo map for a prompt.
 *
 * ```ts
 * renderRepoMap(map, { maxTokens: 1500, focus: ['src/features/theme/**'] });
 * ```
 */
export function renderRepoMap(map: RepoMap, opts: RenderRepoMapOptions = {}): string {
  const maxTokens = opts.maxTokens ?? DEFAULT_RENDER_MAX_TOKENS;
  const budget = Math.max(0, Math.floor(maxTokens * 4));
  if (budget === 0) return '';

  const focus = opts.focus?.filter((glob) => glob.trim().length > 0) ?? [];
  const hasFocus = focus.length > 0;
  const files = map.files
    .map((file) => ({ file, focused: hasFocus && matchesAny(file.path, focus) }))
    .map((entry) => ({ ...entry, score: scoreFile(entry.file, entry.focused) }))
    .sort((a, b) => b.score - a.score || (a.file.path < b.file.path ? -1 : 1));

  const lines: string[] = [];
  let used = 0;
  const push = (line: string): boolean => {
    const add = lines.length === 0 ? line.length : line.length + 1;
    if (used + add > budget) return false;
    lines.push(line);
    used += add;
    return true;
  };

  push(`# Repo map: ${map.root}`);
  const languages = languageSummary(map.languages);
  if (languages.length > 0) push(`Languages: ${languages}`);
  if (map.testCommand !== undefined) push(`Test: ${map.testCommand}`);
  if (map.lintCommand !== undefined) push(`Lint: ${map.lintCommand}`);

  if (map.tree.length > 0) {
    push('');
    let treeTruncated = false;
    for (const line of map.tree.split('\n')) {
      if (!push(line)) {
        treeTruncated = true;
        break;
      }
    }
    if (treeTruncated) push('… (tree truncated)');
  }

  if (map.files.length > 0) {
    push('');
    push(`Files (${map.files.length}):`);
    let shown = 0;
    for (const entry of files) {
      const detail = !hasFocus || entry.focused;
      if (!push(fileLine(entry.file, detail))) break;
      shown += 1;
    }
    const omitted = map.files.length - shown;
    if (omitted > 0) push(`… (${omitted} more files)`);
  }

  return lines.join('\n');
}
