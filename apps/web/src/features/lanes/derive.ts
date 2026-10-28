import type { MergeResult, PlanIssue, TaskSpec } from '@starling/core/browser';
import { globsOverlap, matchesGlob, normalizeGlobPath } from '@starling/core/browser';
import { diffKey, type SkyState } from '../../data/reducer';

/**
 * Lane map derivation: "who owns which patch of sky".
 *
 * Everything here is pure — `SkyState` in, tree + overlaps + counts out — so the view can be tested
 * without a DOM and the treemap can be re-laid-out on every event without touching React state.
 *
 * Sources (all read defensively, because a recording is just JSON):
 * - lane globs from the active run's plan (`owns` colours a tile, `reads` fades it);
 * - touched files from `agentLog[key]` `file.edited` events, `state.diffs`, and a structural
 *   `task.diff` event (Epic 49 may add one — it is not in core's union yet);
 * - conflicts from `merge.result` events (`status: 'conflict'`);
 * - violations from `verdicts[key][*].laneViolations`.
 */

export type LaneNodeKind = 'repo' | 'dir' | 'file';

/** One node of the repo tree. Directory `owners`/`readers` are the union of their descendants'. */
export interface LaneNode {
  path: string;
  name: string;
  children: LaneNode[];
  owners: string[];
  readers: string[];
  /** Lines added + removed at or below this node. */
  touched: number;
  conflict: boolean;
  violation: boolean;
  /** Treemap weight: touched lines, else 1 per file, else 1 per lane glob. */
  weight: number;
  /** Additive (Epic 115): file vs directory, so the view can draw frames and the list can say so. */
  kind: LaneNodeKind;
  /** Additive (Epic 115): this exact path is claimed or edited by two or more tasks. */
  overlap: boolean;
}

/** A pair of tasks whose `owns` globs collide, with the colliding glob pairs. */
export interface LaneOverlap {
  a: string;
  b: string;
  globs: string[];
}

export interface LaneSummary {
  lanes: number;
  overlaps: number;
  filesTouched: number;
  conflicts: number;
  linesTouched: number;
  violations: number;
}

export interface LaneModel {
  runId?: string;
  tasks: TaskSpec[];
  tree: LaneNode;
  overlaps: LaneOverlap[];
  summary: LaneSummary;
  /** `plan.created` issues with `code: 'lane-overlap'` for this run, when the event survived the cap. */
  issues: PlanIssue[];
}

interface TouchedFile {
  path: string;
  lines: number;
  knownLines: boolean;
  editors: Set<string>;
}

interface Draft {
  path: string;
  name: string;
  kind: LaneNodeKind;
  children: Map<string, Draft>;
  owners: Set<string>;
  readers: Set<string>;
  /** Tasks that claimed *this exact path* (a glob target), used for the hatch flag. */
  directOwners: Set<string>;
  lines: number;
  knownLines: boolean;
  globs: number;
  conflict: boolean;
  violation: boolean;
}

const WILDCARD = /[*?[]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/** The active run, without importing the store-backed selector module into a pure helper. */
function activeRun(state: SkyState) {
  return state.activeRunId === undefined ? undefined : state.runs[state.activeRunId];
}

/**
 * The static part of a lane glob: everything before the first wildcard.
 *
 * `src/features/theme/**` → directory `src/features/theme`; `src/ui/styles.css` → file. A glob that
 * starts with a wildcard (`*.ts`) owns the repo root.
 */
export function globTarget(glob: string): { path: string; kind: LaneNodeKind } {
  const normalized = normalizeGlobPath(glob);
  const wildcard = normalized.search(WILDCARD);
  const path = (wildcard === -1 ? normalized : normalized.slice(0, wildcard)).replace(/\/+$/, '');
  return { path, kind: wildcard === -1 ? 'file' : 'dir' };
}

function createDraft(path: string, kind: LaneNodeKind): Draft {
  return {
    path,
    name: path === '' ? 'repo' : (path.split('/').filter(Boolean).at(-1) ?? path),
    kind,
    children: new Map(),
    owners: new Set(),
    readers: new Set(),
    directOwners: new Set(),
    lines: 0,
    knownLines: false,
    globs: 0,
    conflict: false,
    violation: false,
  };
}

function ensureDraft(root: Draft, path: string, kind: LaneNodeKind): Draft {
  if (path === '') return root;
  let current = root;
  let walked = '';
  for (const segment of path.split('/').filter(Boolean)) {
    walked = walked === '' ? segment : `${walked}/${segment}`;
    let child = current.children.get(segment);
    if (child === undefined) {
      child = createDraft(walked, 'dir');
      current.children.set(segment, child);
    }
    current = child;
  }
  if (kind === 'dir') {
    // A directory claim upgrades a file placeholder; a file never downgrades a directory.
    if (current.children.size === 0) current.kind = 'dir';
  } else if (current.children.size === 0) {
    current.kind = 'file';
  }
  return current;
}

function addTouched(
  files: Map<string, TouchedFile>,
  rawPath: unknown,
  added: unknown,
  removed: unknown,
  editor: string,
): void {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') return;
  const path = normalizeGlobPath(rawPath);
  if (path === '') return;
  const existing = files.get(path) ?? {
    path,
    lines: 0,
    knownLines: false,
    editors: new Set<string>(),
  };
  const add = finiteNumber(added);
  const remove = finiteNumber(removed);
  if (add !== undefined || remove !== undefined) {
    existing.knownLines = true;
    existing.lines += (add ?? 0) + (remove ?? 0);
  }
  existing.editors.add(editor);
  files.set(path, existing);
}

function collectTouched(
  state: SkyState,
  runId: string,
  tasks: readonly TaskSpec[],
): Map<string, TouchedFile> {
  const files = new Map<string, TouchedFile>();

  for (const task of tasks) {
    for (const event of state.agentLog[task.key] ?? []) {
      if (event.runId !== runId || event.kind !== 'file.edited') continue;
      const data = isRecord(event.data) ? event.data : {};
      addTouched(files, data.path, data.added, data.removed, task.key);
    }

    const diff = state.diffs[diffKey(runId, task.key)];
    if (diff !== undefined) {
      for (const file of diff.files) {
        addTouched(files, file.path, file.added, file.removed, task.key);
      }
    }
  }

  // `task.diff` is not in core's union yet (Epic 49 may publish it); detect it structurally.
  for (const event of state.events) {
    const candidate = event as unknown as { type: string; runId: string; payload?: unknown };
    if (candidate.type !== 'task.diff' || candidate.runId !== runId || !isRecord(candidate.payload)) {
      continue;
    }
    const payload = candidate.payload;
    const taskKey = typeof payload.taskKey === 'string' ? payload.taskKey : undefined;
    if (taskKey === undefined || !tasks.some((task) => task.key === taskKey)) continue;
    const diff = isRecord(payload.diff) ? payload.diff : payload;
    const listed = diff.files;
    if (!Array.isArray(listed)) continue;
    for (const file of listed) {
      if (!isRecord(file)) continue;
      addTouched(files, file.path, file.added, file.removed, taskKey);
    }
  }

  return files;
}

/** `merge.result` payloads for this run. Falls back to `state.merges` once the event cap evicted them. */
function mergeResultsForRun(state: SkyState, runId: string, taskKeys: ReadonlySet<string>): MergeResult[] {
  const fromEvents: MergeResult[] = [];
  for (const event of state.events) {
    if (event.runId !== runId || event.type !== 'merge.result') continue;
    fromEvents.push(event.payload);
  }
  if (fromEvents.length > 0) return fromEvents;
  return state.merges.filter((merge) => taskKeys.has(merge.taskKey));
}

/** Every pair of tasks whose owned globs could collide. Stable in plan order. */
export function laneOverlaps(tasks: readonly TaskSpec[]): LaneOverlap[] {
  const overlaps: LaneOverlap[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const a = tasks[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < tasks.length; j += 1) {
      const b = tasks[j];
      if (b === undefined) continue;
      const globs = globsOverlap(a.lane.owns, b.lane.owns);
      if (globs.length > 0) overlaps.push({ a: a.key, b: b.key, globs });
    }
  }
  return overlaps;
}

/** Plan issues of the one kind this view can draw: two lanes that the validator says collide. */
export function laneOverlapIssues(state: SkyState, runId = state.activeRunId): PlanIssue[] {
  const issues: PlanIssue[] = [];
  for (const event of state.events) {
    if (event.type !== 'plan.created') continue;
    if (runId !== undefined && event.runId !== runId) continue;
    for (const issue of event.payload.issues) {
      if (issue.code === 'lane-overlap') issues.push(issue);
    }
  }
  return issues;
}

function sortByPlanOrder(keys: Iterable<string>, order: ReadonlyMap<string, number>): string[] {
  return [...new Set(keys)].sort((a, b) => {
    const ai = order.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bi = order.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ai === bi ? a.localeCompare(b) : ai - bi;
  });
}

function leafWeight(draft: Draft): number {
  if (draft.knownLines && draft.lines > 0) return draft.lines;
  if (draft.globs > 0) return draft.globs;
  return 1;
}

function finalize(draft: Draft, order: ReadonlyMap<string, number>): LaneNode {
  const children = [...draft.children.values()]
    .map((child) => finalize(child, order))
    .sort((a, b) => (b.weight === a.weight ? a.path.localeCompare(b.path) : b.weight - a.weight));

  const owners = sortByPlanOrder([...draft.owners, ...children.flatMap((child) => child.owners)], order);
  const readers = sortByPlanOrder([...draft.readers, ...children.flatMap((child) => child.readers)], order);
  const childLines = children.reduce((sum, child) => sum + child.touched, 0);
  const childWeight = children.reduce((sum, child) => sum + child.weight, 0);

  return {
    path: draft.path,
    name: draft.name,
    children,
    owners,
    readers,
    touched: draft.lines + childLines,
    conflict: draft.conflict || children.some((child) => child.conflict),
    violation: draft.violation || children.some((child) => child.violation),
    weight: children.length > 0 ? childWeight : leafWeight(draft),
    kind: draft.kind,
    overlap: draft.directOwners.size >= 2,
  };
}

/** Flat pre-order rows (root excluded) for the accessible table view. */
export function laneRows(tree: LaneNode): LaneNode[] {
  const rows: LaneNode[] = [];
  const walk = (node: LaneNode): void => {
    for (const child of node.children) {
      rows.push(child);
      walk(child);
    }
  };
  walk(tree);
  return rows;
}

export function buildLaneModel(state: SkyState): LaneModel {
  const run = activeRun(state);
  const tasks = run?.plan?.tasks ?? [];
  const order = new Map(tasks.map((task, index) => [task.key, index] as const));
  const taskKeys = new Set(tasks.map((task) => task.key));
  const root = createDraft('', 'repo');

  // 1. Lane claims and reads become the skeleton, so a fresh plan draws before any work happens.
  for (const task of tasks) {
    for (const glob of task.lane.owns) {
      const target = globTarget(glob);
      const node = ensureDraft(root, target.path, target.kind);
      node.owners.add(task.key);
      node.directOwners.add(task.key);
      node.globs += 1;
    }
    for (const glob of task.lane.reads) {
      const target = globTarget(glob);
      const node = ensureDraft(root, target.path, target.kind);
      node.readers.add(task.key);
      node.globs += 1;
    }
  }

  const laneOwners = (path: string): string[] =>
    tasks.filter((task) => task.lane.owns.some((glob) => matchesGlob(path, glob))).map((task) => task.key);

  // 2. Touched files. The agent that wrote a file is its de-facto owner even outside its lane; the
  //    declared lane owner (if any) is added too, which is what makes a violation visible in colour.
  const touched = run === undefined ? new Map<string, TouchedFile>() : collectTouched(state, run.id, tasks);
  for (const file of touched.values()) {
    const node = ensureDraft(root, file.path, 'file');
    if (file.knownLines) node.knownLines = true;
    node.lines += file.lines;
    for (const editor of file.editors) node.directOwners.add(editor);
    for (const owner of laneOwners(file.path)) node.owners.add(owner);
  }

  // 3. Conflicts: a merge result with conflicted files paints those paths red (and their frames).
  const conflictFiles = new Set<string>();
  if (run !== undefined) {
    for (const merge of mergeResultsForRun(state, run.id, taskKeys)) {
      if (merge.status !== 'conflict') continue;
      for (const raw of merge.conflictedFiles) {
        const path = normalizeGlobPath(raw);
        if (path === '') continue;
        conflictFiles.add(path);
        const node = ensureDraft(root, path, 'file');
        node.conflict = true;
        for (const owner of laneOwners(path)) node.owners.add(owner);
      }
    }
  }

  // 4. Lane violations from the auditor: the task wrote outside its lane even if the merge was clean.
  const violationFiles = new Set<string>();
  for (const task of tasks) {
    for (const verdict of state.verdicts[task.key] ?? []) {
      for (const raw of verdict.laneViolations) {
        const path = normalizeGlobPath(raw);
        if (path === '') continue;
        violationFiles.add(path);
        const node = ensureDraft(root, path, 'file');
        node.violation = true;
        for (const owner of laneOwners(path)) node.owners.add(owner);
      }
    }
  }

  const tree = finalize(root, order);
  const overlaps = laneOverlaps(tasks);
  const summary: LaneSummary = {
    lanes: tasks.length,
    overlaps: overlaps.length,
    filesTouched: touched.size,
    conflicts: conflictFiles.size,
    linesTouched: [...touched.values()].reduce((sum, file) => sum + (file.knownLines ? file.lines : 0), 0),
    violations: violationFiles.size,
  };

  const model: LaneModel = { tasks, tree, overlaps, summary, issues: laneOverlapIssues(state, run?.id) };
  if (run !== undefined) model.runId = run.id;
  return model;
}

/** The deliverable's single entry point. */
export function buildLaneTree(state: SkyState): LaneNode {
  return buildLaneModel(state).tree;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/** The summary strip: "7 lanes · 0 overlaps · 8 files touched · 0 conflicts". */
export function formatLaneSummary(summary: LaneSummary): string {
  return [
    `${summary.lanes} ${plural(summary.lanes, 'lane')}`,
    `${summary.overlaps} ${plural(summary.overlaps, 'overlap')}`,
    `${summary.filesTouched} ${plural(summary.filesTouched, 'file')} touched`,
    `${summary.conflicts} ${plural(summary.conflicts, 'conflict')}`,
  ].join(' · ');
}

/** Small helper shared by the view: the first owner (or reader) is the tile's colour source. */
export function primaryLaneOwner(node: LaneNode): string | undefined {
  return node.owners[0] ?? node.readers[0];
}
