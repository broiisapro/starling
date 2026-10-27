import type { RunCommand } from './exec';
import { mustRun, outputLines } from './exec';

/** A `epic-NN-complete` tag. */
export interface GitTag {
  number: string;
  name: string;
  sha: string;
  createdAt: string;
}

/** What git knows about one epic's work. */
export interface EpicGitStats {
  branch?: string;
  commits: number;
  firstCommitAt?: string;
  added: number;
  removed: number;
  files: number;
  testsAdded: number;
  /** Which evidence produced these numbers, for the page's footnote and for debugging. */
  basis: 'branch' | 'squash' | 'tag-range' | 'none';
}

export interface TestCount {
  tests: number;
  testFiles: number;
}

export interface GitSnapshot {
  head?: string;
  headAt?: string;
  /** Ref used as the base for per-epic diffs (`main`, `origin/main`, or `HEAD`). */
  baseRef: string;
  tags: Map<string, GitTag>;
  epics: Map<string, EpicGitStats>;
  /** Epic number → branch slug, from `epic/NN-slug` refs. */
  branches: Map<string, string>;
  testsAtHead: TestCount;
  notes: string[];
}

const TEST_DECLARATION = '^[[:space:]]*(test|it)(\\.(each|skip|only|todo|failing))?\\(';
const TEST_PATHSPECS = ['*.test.ts', '*.test.tsx'];

const EMPTY: EpicGitStats = {
  commits: 0,
  added: 0,
  removed: 0,
  files: 0,
  testsAdded: 0,
  basis: 'none',
};

function isTestPath(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

function parseNumstat(stdout: string): Pick<EpicGitStats, 'added' | 'removed' | 'files'> {
  let added = 0;
  let removed = 0;
  let files = 0;
  for (const line of outputLines(stdout)) {
    const [rawAdded, rawRemoved] = line.split('\t');
    if (rawAdded === undefined || rawRemoved === undefined) continue;
    files += 1;
    // Binary files report `-` instead of a count.
    if (rawAdded !== '-') added += Number(rawAdded) || 0;
    if (rawRemoved !== '-') removed += Number(rawRemoved) || 0;
  }
  return { added, removed, files };
}

/** Test declarations (`test(…)` / `it(…)`) and test files present at a git ref. */
export async function countTestsAt(run: RunCommand, repo: string, ref: string): Promise<TestCount> {
  // `ls-tree` treats a wildcard pathspec literally, so list the tree and filter instead.
  const tree = await run(['git', 'ls-tree', '-r', '--name-only', ref], { cwd: repo });
  const testFiles = tree.code === 0 ? outputLines(tree.stdout).filter(isTestPath).length : 0;

  const grep = await run(['git', 'grep', '-h', '-E', TEST_DECLARATION, ref, '--', ...TEST_PATHSPECS], {
    cwd: repo,
  });
  // git grep exits 1 when nothing matched, which is simply "no tests at this ref".
  const tests = grep.code === 0 ? outputLines(grep.stdout).length : 0;
  return { tests, testFiles };
}

async function readRefs(run: RunCommand, repo: string): Promise<string[]> {
  const stdout = await mustRun(
    run,
    ['git', 'for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
    repo,
  );
  return outputLines(stdout).filter((ref) => !ref.endsWith('/HEAD'));
}

async function readTags(run: RunCommand, repo: string): Promise<GitTag[]> {
  const stdout = await mustRun(
    run,
    [
      'git',
      'for-each-ref',
      '--format=%(refname:short)%09%(objectname:short)%09%(creatordate:iso-strict)',
      'refs/tags',
    ],
    repo,
  );
  const tags: GitTag[] = [];
  for (const line of outputLines(stdout)) {
    const [name, sha, createdAt] = line.split('\t');
    if (name === undefined || sha === undefined || createdAt === undefined) continue;
    const match = /^epic-(\d+)-complete$/.exec(name);
    if (match?.[1] === undefined) continue;
    const parsed = Date.parse(createdAt);
    if (!Number.isFinite(parsed)) continue;
    tags.push({ number: match[1].padStart(2, '0'), name, sha, createdAt: new Date(parsed).toISOString() });
  }
  return tags;
}

/** Map epic number → branch slug from `epic/NN-slug` refs, preferring `origin/`. */
function readBranches(refs: string[]): Map<string, string> {
  const branches = new Map<string, string>();
  for (const ref of refs) {
    const match = /^(?:origin\/)?epic\/(\d+)-(.+)$/.exec(ref);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const number = match[1].padStart(2, '0');
    if (ref.startsWith('origin/') || !branches.has(number)) branches.set(number, match[2]);
  }
  return branches;
}

/** Squash-merge commits on the base branch: `epic(NN): …`. */
async function readSquashCommits(
  run: RunCommand,
  repo: string,
  baseRef: string,
): Promise<Map<string, { sha: string; at: string }>> {
  const stdout = await mustRun(run, ['git', 'log', '--format=%H%x09%cI%x09%s', baseRef], repo);
  const commits = new Map<string, { sha: string; at: string }>();
  for (const line of outputLines(stdout)) {
    const [sha, at, subject] = line.split('\t');
    if (sha === undefined || at === undefined || subject === undefined) continue;
    const match = /^epic\((\d+)\)/.exec(subject);
    if (match?.[1] === undefined) continue;
    const number = match[1].padStart(2, '0');
    if (!commits.has(number)) commits.set(number, { sha, at });
  }
  return commits;
}

async function branchStats(
  run: RunCommand,
  repo: string,
  baseRef: string,
  branch: string,
): Promise<EpicGitStats> {
  const count = await run(['git', 'rev-list', '--count', `${baseRef}..${branch}`], { cwd: repo });
  const commits = count.code === 0 ? Number.parseInt(count.stdout.trim(), 10) || 0 : 0;
  if (commits === 0) return EMPTY;

  // Author date, not committer date: a rebase before the PR rewrites committer dates to push time,
  // which would make every C1 epic look like it took ten seconds.
  const first = await run(['git', 'log', '--reverse', '--format=%aI', `${baseRef}..${branch}`], {
    cwd: repo,
  });
  const firstCommitAt = first.code === 0 ? outputLines(first.stdout)[0] : undefined;
  const numstat = await run(['git', 'diff', '--numstat', `${baseRef}...${branch}`], { cwd: repo });
  const added = await run(['git', 'diff', '--diff-filter=A', '--name-only', `${baseRef}...${branch}`], {
    cwd: repo,
  });

  return {
    branch,
    commits,
    firstCommitAt,
    ...parseNumstat(numstat.stdout),
    testsAdded: outputLines(added.stdout).filter(isTestPath).length,
    basis: 'branch',
  };
}

async function commitStats(run: RunCommand, repo: string, sha: string, at: string): Promise<EpicGitStats> {
  const numstat = await run(['git', 'show', '--numstat', '--format=', sha], { cwd: repo });
  const added = await run(['git', 'show', '--diff-filter=A', '--name-only', '--format=', sha], { cwd: repo });
  return {
    commits: 1,
    firstCommitAt: at,
    ...parseNumstat(numstat.stdout),
    testsAdded: outputLines(added.stdout).filter(isTestPath).length,
    basis: 'squash',
  };
}

async function tagRangeStats(
  run: RunCommand,
  repo: string,
  fromRef: string,
  toRef: string,
): Promise<EpicGitStats> {
  const numstat = await run(['git', 'diff', '--numstat', fromRef, toRef], { cwd: repo });
  const added = await run(['git', 'diff', '--diff-filter=A', '--name-only', fromRef, toRef], { cwd: repo });
  const commits = await run(['git', 'rev-list', '--count', `${fromRef}..${toRef}`], { cwd: repo });
  return {
    commits: commits.code === 0 ? Number.parseInt(commits.stdout.trim(), 10) || 0 : 0,
    ...parseNumstat(numstat.stdout),
    testsAdded: outputLines(added.stdout).filter(isTestPath).length,
    basis: 'tag-range',
  };
}

/**
 * Read everything the collector needs from git in one pass.
 *
 * Per epic the evidence is picked in order of quality: the still-pushed `epic/NN-slug` branch (real
 * commit count and first-commit time), then the squash commit on the base branch, then the diff
 * between the two neighbouring tags. That ordering is why a doctored or pruned repo still produces
 * numbers instead of an empty page.
 */
export async function readGitSnapshot(run: RunCommand, repo: string): Promise<GitSnapshot> {
  const notes: string[] = [];
  const refs = await readRefs(run, repo);
  const tags = await readTags(run, repo);
  const tagByNumber = new Map(tags.map((tag) => [tag.number, tag]));
  const branches = readBranches(refs);

  const headRef = await run(['git', 'rev-parse', '--short', 'HEAD'], { cwd: repo });
  const headAt = await run(['git', 'log', '-1', '--format=%cI'], { cwd: repo });
  const baseRef = refs.includes('main') ? 'main' : refs.includes('origin/main') ? 'origin/main' : 'HEAD';
  if (baseRef === 'HEAD') notes.push('git: no main branch found; using HEAD as the diff base');

  const squashes = baseRef === 'HEAD' ? new Map() : await readSquashCommits(run, repo, baseRef);

  // Only epics git has actually seen work for: a completing tag or a pushed `epic/NN-slug` branch.
  // Unstarted rows in `epics.tsv` would otherwise flood the snapshot (and the page) with zeros.
  const numbers = new Set<string>([...tagByNumber.keys(), ...branches.keys()]);
  const epics = new Map<string, EpicGitStats>();

  const tagsInOrder = [...tags].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.number.localeCompare(b.number),
  );
  const tagIndex = new Map(tagsInOrder.map((tag, index) => [tag.number, index]));

  for (const number of [...numbers].sort()) {
    const branch = branches.get(number);
    const branchRef =
      branch === undefined
        ? undefined
        : refs.includes(`epic/${number}-${branch}`)
          ? `epic/${number}-${branch}`
          : `origin/epic/${number}-${branch}`;

    let stats: EpicGitStats = EMPTY;
    if (branchRef !== undefined) stats = await branchStats(run, repo, baseRef, branchRef);
    if (stats.commits === 0) {
      const squash = squashes.get(number);
      if (squash !== undefined) stats = await commitStats(run, repo, squash.sha, squash.at);
    }
    if (stats.commits === 0 && tagByNumber.has(number)) {
      const index = tagIndex.get(number) ?? 0;
      const previous = index > 0 ? tagsInOrder[index - 1] : undefined;
      const previousRef = previous?.name ?? `${tagByNumber.get(number)?.name}^`;
      stats = await tagRangeStats(run, repo, previousRef, tagByNumber.get(number)?.name ?? 'HEAD');
      stats.basis = 'tag-range';
    }
    epics.set(number, stats);
  }

  return {
    head: headRef.code === 0 ? headRef.stdout.trim() : undefined,
    headAt: headAt.code === 0 ? headAt.stdout.trim() : undefined,
    baseRef,
    tags: tagByNumber,
    epics,
    branches,
    testsAtHead: await countTestsAt(run, repo, 'HEAD'),
    notes,
  };
}

/** The directory of a git repository (so the collector works from any cwd), or `null`. */
export async function gitToplevel(run: RunCommand, cwd: string): Promise<string | null> {
  const result = await run(['git', 'rev-parse', '--show-toplevel'], { cwd });
  if (result.code !== 0) return null;
  const path = result.stdout.trim();
  return path.length === 0 ? null : path;
}
