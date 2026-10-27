/**
 * Directory-tree rendering with a character budget.
 *
 * The tree is the cheapest way to give a worker a sense of the repo ("where does this project
 * keep things?"). It has to stay small: `maxChars` is enforced by collapsing progressively more
 * directories and then by truncating whole entries, never by cutting a line in half.
 */
import type { RepoFile } from '@starling/core';

export interface RenderTreeOptions {
  /** Hard character budget for the returned string. Default 4000. */
  maxChars?: number;
  /** Optional line printed first (usually the repo root's basename). */
  root?: string;
}

const DEFAULT_MAX_CHARS = 4000;
const MAX_LINE_CHARS = 160;
/** A flat folder this big is always collapsed; 42 generated component files should not eat the tree. */
const FLAT_DIR_COLLAPSE = 20;

interface DirNode {
  name: string;
  files: string[];
  dirs: Map<string, DirNode>;
  count: number;
}

function emptyNode(name: string): DirNode {
  return { name, files: [], dirs: new Map(), count: 0 };
}

function buildTree(paths: readonly string[]): DirNode {
  const root = emptyNode('');
  for (const path of paths) {
    const segments = path.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;
    let node = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i] as string;
      let child = node.dirs.get(segment);
      if (child === undefined) {
        child = emptyNode(segment);
        node.dirs.set(segment, child);
      }
      node = child;
    }
    node.files.push(segments.at(-1) as string);
  }
  countFiles(root);
  return root;
}

function countFiles(node: DirNode): number {
  node.files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let total = node.files.length;
  for (const child of node.dirs.values()) total += countFiles(child);
  node.count = total;
  return total;
}

function sortedDirs(node: DirNode): DirNode[] {
  return [...node.dirs.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line;
  return `${line.slice(0, MAX_LINE_CHARS - 1)}…`;
}

interface RenderPass {
  collapseOver: number;
  maxDepth: number;
}

const PASSES: readonly RenderPass[] = [
  { collapseOver: Number.POSITIVE_INFINITY, maxDepth: Number.POSITIVE_INFINITY },
  { collapseOver: 40, maxDepth: Number.POSITIVE_INFINITY },
  { collapseOver: 20, maxDepth: 10 },
  { collapseOver: 10, maxDepth: 8 },
  { collapseOver: 5, maxDepth: 6 },
  { collapseOver: 2, maxDepth: 4 },
  { collapseOver: 0, maxDepth: 3 },
  { collapseOver: 0, maxDepth: 2 },
  { collapseOver: 0, maxDepth: 1 },
  { collapseOver: 0, maxDepth: 0 },
];

function renderPass(root: DirNode, pass: RenderPass, rootLabel: string | undefined): string[] {
  const lines: string[] = [];
  if (rootLabel !== undefined && rootLabel.length > 0) lines.push(rootLabel);

  const walk = (node: DirNode, prefix: string, depth: number): void => {
    interface Entry {
      kind: 'file' | 'dir';
      name: string;
      dir?: DirNode;
    }
    const entries: Entry[] = [
      ...node.files.map((name): Entry => ({ kind: 'file', name })),
      ...sortedDirs(node).map((dir): Entry => ({ kind: 'dir', name: dir.name, dir })),
    ];
    entries.forEach((entry, index) => {
      const last = index === entries.length - 1;
      const branch = last ? '└── ' : '├── ';
      const nextPrefix = prefix + (last ? '    ' : '│   ');
      if (entry.kind === 'file') {
        lines.push(truncateLine(`${prefix}${branch}${entry.name}`));
        return;
      }
      const dir = entry.dir as DirNode;
      const collapse =
        (dir.dirs.size === 0 && dir.count > FLAT_DIR_COLLAPSE) ||
        dir.count > pass.collapseOver ||
        depth >= pass.maxDepth;
      if (collapse) {
        lines.push(truncateLine(`${prefix}${branch}${entry.name}/ (${dir.count} files)`));
        return;
      }
      lines.push(truncateLine(`${prefix}${branch}${entry.name}/`));
      walk(dir, nextPrefix, depth + 1);
    });
  };

  walk(root, '', 0);
  return lines;
}

function truncateToBudget(lines: readonly string[], maxChars: number): string {
  const full = lines.join('\n');
  if (full.length <= maxChars) return full;
  for (let kept = lines.length - 1; kept >= 0; kept -= 1) {
    const omitted = lines.length - kept;
    const candidate = `${lines.slice(0, kept).join('\n')}\n… (${omitted} more entries, tree truncated)`;
    if (candidate.length <= maxChars) return candidate;
  }
  return '';
}

/**
 * Render an indented tree of `files` within `maxChars`.
 *
 * ```ts
 * renderTree(map.files, { maxChars: 2000, root: 'sky-todo' });
 * ```
 *
 * Big flat folders always collapse to `src/components/ (42 files)`. Everything else collapses only
 * when the budget demands it, so a small repo keeps every path visible.
 */
export function renderTree(
  files: readonly (string | Pick<RepoFile, 'path'>)[],
  opts: RenderTreeOptions = {},
): string {
  const maxChars = Math.max(0, opts.maxChars ?? DEFAULT_MAX_CHARS);
  if (maxChars === 0) return '';
  const paths = files.map((file) => (typeof file === 'string' ? file : file.path));
  const tree = buildTree(paths);

  for (const pass of PASSES) {
    const lines = renderPass(tree, pass, opts.root);
    const text = lines.join('\n');
    if (text.length <= maxChars) return text;
  }

  // Every pass was still too big (a repo with thousands of root-level files): truncate entries.
  const mostAggressive = PASSES.at(-1) as RenderPass;
  const lines = renderPass(tree, mostAggressive, opts.root);
  const truncated = truncateToBudget(lines, maxChars);
  return truncated.length > 0 ? truncated : '';
}
