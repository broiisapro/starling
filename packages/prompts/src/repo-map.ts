/**
 * A deliberately small repo-map renderer for worker prompts.
 *
 * The repomap package owns the real renderer; this one exists so the prompt compiler is complete
 * on its own in Wave 1 (ARCHITECTURE §8 keeps siblings apart). It focuses on the task's lane:
 * files the agent may edit come first, then the files it will read, then everything else as
 * orientation. Owned and read files are never dropped for budget reasons — hiding a file the
 * agent is allowed to edit is worse than a slightly long prompt.
 */
import type { Lane, RepoFile, RepoMap } from '@starling/core';
import { matchesAny } from '@starling/core';
import { DEFAULT_MAX_REPO_MAP_CHARS, type PromptStyle } from './options';
import { clamp, formatBytes, plural } from './text';

export interface RankedRepoFiles {
  /** Files matching a lane `owns` glob: editable. */
  owned: RepoFile[];
  /** Files matching a lane `reads` glob: read-only orientation. */
  read: RepoFile[];
  /** Everything else in the map. */
  other: RepoFile[];
}

export interface RenderRepoMapOptions {
  lane?: Lane;
  /** Character budget for the whole block. Defaults to `DEFAULT_MAX_REPO_MAP_CHARS`. */
  maxChars?: number;
  style?: PromptStyle;
}

export interface RenderedRepoMap {
  text: string;
  filesShown: number;
  filesTotal: number;
  /** True when at least one file was hidden or the text was clamped. */
  truncated: boolean;
}

const OWNED_CAP: Record<PromptStyle, number> = { full: 40, compact: 16 };
const READ_CAP: Record<PromptStyle, number> = { full: 12, compact: 6 };
const OTHER_CAP: Record<PromptStyle, number> = { full: 30, compact: 0 };
const MAX_SYMBOLS = 6;

function byPath(a: RepoFile, b: RepoFile): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

/** Split the map into editable / read / other, each sorted by path so output is deterministic. */
export function rankRepoFiles(map: RepoMap, lane?: Lane): RankedRepoFiles {
  const owns = lane?.owns ?? [];
  const reads = lane?.reads ?? [];
  const owned: RepoFile[] = [];
  const read: RepoFile[] = [];
  const other: RepoFile[] = [];

  for (const file of map.files) {
    if (owns.length > 0 && matchesAny(file.path, owns)) owned.push(file);
    else if (reads.length > 0 && matchesAny(file.path, reads)) read.push(file);
    else other.push(file);
  }

  return { owned: owned.sort(byPath), read: read.sort(byPath), other: other.sort(byPath) };
}

function languageSummary(languages: Record<string, number>): string {
  return Object.entries(languages)
    .sort((a, b) => (b[1] === a[1] ? (a[0] < b[0] ? -1 : 1) : b[1] - a[1]))
    .map(([lang, count]) => `${lang} ${count}`)
    .join(', ');
}

function fileLine(file: RepoFile, withSummary: boolean): string {
  const parts = [file.path, file.lang, formatBytes(file.bytes)];
  if (file.symbols.length > 0) parts.push(`symbols: ${file.symbols.slice(0, MAX_SYMBOLS).join(', ')}`);
  const line = `- ${parts.join(' · ')}`;
  return withSummary && file.summary ? `${line} — ${file.summary}` : line;
}

/**
 * Render the map as compact orientation text. Deterministic: same map in, same string out.
 */
export function renderRepoMap(map: RepoMap, options: RenderRepoMapOptions = {}): RenderedRepoMap {
  const style = options.style ?? 'full';
  const maxChars = options.maxChars ?? DEFAULT_MAX_REPO_MAP_CHARS;
  const ranked = rankRepoFiles(map, options.lane);
  const languages = languageSummary(map.languages);
  const header = [
    `Repo: ${map.root} · ${map.files.length} ${plural(map.files.length, 'file', 'files')}${languages ? ` · ${languages}` : ''}`,
  ];
  const tools: string[] = [];
  if (map.testCommand) tools.push(`test \`${map.testCommand}\``);
  if (map.lintCommand) tools.push(`lint \`${map.lintCommand}\``);
  if (tools.length > 0) header.push(`Tools: ${tools.join(' · ')}`);

  const lineFor = (file: RepoFile): string => fileLine(file, style === 'full');
  const owned = options.lane === undefined ? [] : ranked.owned.slice(0, OWNED_CAP[style]);
  const read = options.lane === undefined ? [] : ranked.read.slice(0, READ_CAP[style]);
  const ownedLines = owned.map(lineFor);
  const readLines = read.map(lineFor);

  const assemble = (tail: string[]): string => {
    const shown = ownedLines.length + readLines.length + tail.length;
    const omitted = map.files.length - shown;
    const parts: string[] = [header.join('\n')];
    const addGroup = (title: string, lines: string[]): void => {
      if (lines.length > 0) parts.push('', title, ...lines);
    };
    if (options.lane === undefined) {
      addGroup('Files:', tail);
    } else {
      addGroup('In your lane (editable):', ownedLines);
      addGroup('You will read:', readLines);
      addGroup('Other files (orientation only):', tail);
    }
    if (omitted > 0) {
      parts.push(
        '',
        `… ${omitted} more ${plural(omitted, 'file', 'files')} not shown. Read the files you need; do not guess at paths or APIs.`,
      );
    }
    return parts.join('\n');
  };

  // Only the low-priority tail is trimmed for budget: owned and read files always stay.
  let tail =
    options.lane === undefined
      ? ranked.other.slice(0, OWNED_CAP[style]).map(lineFor)
      : ranked.other.slice(0, OTHER_CAP[style]).map(lineFor);
  let text = assemble(tail);
  while (text.length > maxChars && tail.length > 0) {
    tail = tail.slice(0, -1);
    text = assemble(tail);
  }

  const shown = ownedLines.length + readLines.length + tail.length;
  const omitted = map.files.length - shown;
  const clamped = clamp(text, maxChars);
  return {
    text: clamped,
    filesShown: shown,
    filesTotal: map.files.length,
    truncated: omitted > 0 || clamped.length < text.length,
  };
}
