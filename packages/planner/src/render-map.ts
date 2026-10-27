/**
 * Legacy, planner-local repo-map rendering.
 *
 * @deprecated Use `@starling/repomap`'s `renderRepoMap(map, { maxTokens })` instead; it is the
 * single renderer shared by planner and worker prompts, and the planner prompt has defaulted to it
 * since Epic 48 (`DEFAULT_MAP_RENDERER`). This module is kept only to reproduce the recorded A/B
 * (`docs/epic-48-planner-quality.md`) and is scheduled for removal. Nothing in the planner calls it
 * unless a caller explicitly asks for `MapRenderer = 'verbose'`.
 */
import type { RepoMap } from '@starling/core';

/**
 * @deprecated Use `@starling/repomap`'s `RenderRepoMapOptions` (`maxTokens`, `focus`, `lanes`,
 * `related`). Kept for the deprecated verbose renderer only.
 */
export interface RenderRepoMapOptions {
  /** Hard cap on listed files. The rest are summarised as a count. */
  maxFiles?: number;
  /** Symbol names shown per file. */
  maxSymbols?: number;
  /** Characters of each file summary kept. */
  summaryChars?: number;
  /** Lines of the pre-rendered tree kept. */
  maxTreeLines?: number;
}

const DEFAULTS = {
  maxFiles: 120,
  maxSymbols: 8,
  summaryChars: 160,
  maxTreeLines: 80,
} as const;

function clampPositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function renderLanguages(languages: Record<string, number>): string {
  const entries = Object.entries(languages).sort(([a, countA], [b, countB]) =>
    countB === countA ? a.localeCompare(b) : countB - countA,
  );
  if (entries.length === 0) return 'unknown';
  return entries.map(([lang, count]) => `${lang} ${count}`).join(', ');
}

/**
 * Render a repo map as the plain-text block the planner prompt embeds.
 *
 * @deprecated Use `renderRepoMap` from `@starling/repomap` with `{ maxTokens }` instead. See the
 * module header for why this one survives and when it will go.
 */
export function renderRepoMap(map: RepoMap, options: RenderRepoMapOptions = {}): string {
  const maxFiles = clampPositive(options.maxFiles, DEFAULTS.maxFiles);
  const maxSymbols = clampPositive(options.maxSymbols, DEFAULTS.maxSymbols);
  const summaryChars = clampPositive(options.summaryChars, DEFAULTS.summaryChars);
  const maxTreeLines = clampPositive(options.maxTreeLines, DEFAULTS.maxTreeLines);

  const lines: string[] = [];
  lines.push(`Root: ${map.root}`);
  lines.push(`Languages: ${renderLanguages(map.languages)}`);
  lines.push(`Test command: ${map.testCommand ?? 'unknown — infer from the map'}`);
  lines.push(`Lint command: ${map.lintCommand ?? 'unknown'}`);
  lines.push(`Files: ${map.files.length} (token estimate ~${map.tokenEstimate})`);

  const tree = map.tree.trim();
  if (tree !== '') {
    const treeLines = tree.split('\n');
    lines.push('');
    lines.push('Tree:');
    lines.push(...treeLines.slice(0, maxTreeLines));
    if (treeLines.length > maxTreeLines) {
      lines.push(`… ${treeLines.length - maxTreeLines} more tree lines omitted`);
    }
  }

  const files = [...map.files].sort((a, b) => a.path.localeCompare(b.path));
  lines.push('');
  lines.push('Files (path (bytes, language) — symbols — summary):');
  for (const file of files.slice(0, maxFiles)) {
    const meta = `${file.path} (${file.bytes} B, ${file.lang})`;
    const symbols =
      file.symbols.length === 0
        ? ''
        : ` — symbols: ${file.symbols.slice(0, maxSymbols).join(', ')}${
            file.symbols.length > maxSymbols ? ', …' : ''
          }`;
    const summary =
      file.summary === undefined || file.summary.trim() === ''
        ? ''
        : ` — ${truncate(file.summary, summaryChars)}`;
    lines.push(`- ${meta}${symbols}${summary}`);
  }
  if (files.length > maxFiles) {
    lines.push(`… ${files.length - maxFiles} more files omitted`);
  }

  return lines.join('\n');
}
