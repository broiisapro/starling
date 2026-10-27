/**
 * The swarm-scale worktree stress harness (Epic 57).
 *
 * Answers one question with numbers: does the git layer hold up when a run has 60 tasks?
 *
 * It generates a throwaway repository (5 000 files by default), then drives the real
 * `@starling/workspace` port exactly as the engine would:
 *
 *   1. create 60 worktrees concurrently, all from `main`;
 *   2. commit in every one of them concurrently (half of them deliberately edit the same line of a
 *      shared file, so conflict prediction has something real to find);
 *   3. diff every worktree concurrently;
 *   4. predict conflicts pairwise for 20 pairs and check the expected path is reported;
 *   5. create and fetch bundles for 10 (the Flock round trip), verifying the fetched commit;
 *   6. remove all 60 concurrently and prove nothing is left registered.
 *
 * Every call is timed individually, so the report can give p50/p95 per operation rather than one
 * aggregate number that hides the tail. Disk use is measured before removal (that is the cost the
 * swarm actually occupies), and a sparse worktree is measured against a full one.
 *
 * Design notes:
 * - No network, no models, no opencode: this measures git, which is the thing under test.
 * - Each step collects failures instead of throwing, so a report always comes back with the exact
 *   list of what broke; `ok` is false when that list is non-empty.
 * - Worktree creation is measured *including* mutex queueing, because that is the latency the engine
 *   sees when it dispatches 60 tasks at once.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkspace, type DiskUsage, diskUsage } from '../../packages/workspace/src/index.ts';

export interface StressOptions {
  /** Files in the generated repository. Default 5 000. */
  files?: number;
  /** Concurrent worktrees. Default 60. */
  worktrees?: number;
  /** Uneven pairs used for conflict prediction. Default 20. */
  conflictPairs?: number;
  /** Tasks that also round-trip through a git bundle. Default 10. */
  bundles?: number;
  /** Parent directory for the temp repo; a fresh OS temp dir when omitted. */
  root?: string;
  /** Keep the repo and worktrees on disk (the report includes their paths). */
  keep?: boolean;
  /** Measure the sparse checkout comparison. Default true. */
  sparse?: boolean;
  /** Progress sink; the CLI passes a stderr writer, tests pass nothing. */
  log?: (line: string) => void;
}

export interface OperationStat {
  operation: string;
  count: number;
  failures: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  totalMs: number;
}

export interface StressFailure {
  operation: string;
  target: string;
  message: string;
}

/** Wall clock for one phase, next to the per-call latencies (which include mutex queueing). */
export interface PhaseStat {
  phase: string;
  wallMs: number;
  count: number;
}

export interface DiskSample {
  path: string;
  bytes: number;
  files: number;
}

export interface SparseDiskSample extends DiskSample {
  directories: string[];
}

export interface StressReport {
  ok: boolean;
  repo: string;
  worktreeRoot: string;
  files: number;
  worktrees: number;
  conflictPairs: number;
  bundles: number;
  /** Repository creation + initial commit. */
  setupMs: number;
  /** Everything, setup included. */
  totalMs: number;
  /** 1/5/15-minute load average when the run started, so absolute timings are interpretable. */
  loadAverage: [number, number, number];
  /** Wall clock per phase. `create` is serialised, so its per-call latency is a queue, not a cost. */
  phases: PhaseStat[];
  operations: OperationStat[];
  failures: StressFailure[];
  checks: {
    commits: number;
    diffs: number;
    conflictsFound: number;
    conflictsExpected: number;
    conflictingPaths: string[];
    bundlesFetched: number;
    worktreesRemoved: number;
    worktreesRegisteredAfter: number;
  };
  disk: {
    perWorktree: DiskSample[];
    perWorktreeAvgBytes: number;
    perWorktreeP50Bytes: number;
    perWorktreeP95Bytes: number;
    fullWorktreeFiles: number;
    totalWorktreeBytes: number;
    /** Sampled `du -sk` allocation for up to three worktrees (apparent size hides block overhead). */
    allocatedSampleBytes?: number;
    repoGitBytes: number;
    repoCheckoutBytes: number;
    bundleBytes: number;
    sparse?: SparseDiskSample & { ratioOfFull: number; allocatedBytes?: number };
  };
  kept: boolean;
}

/** Linear-interpolated percentile over an unsorted sample. `p` is 0…100. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] ?? 0;
  const rank = Math.min(100, Math.max(0, p)) / 100;
  const index = rank * (sorted.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const a = sorted[low] ?? 0;
  const b = sorted[high] ?? a;
  return a + (b - a) * (index - low);
}

/** Round to one decimal so reports are stable enough to paste into a handback. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Build one `OperationStat` from raw timings. */
export function summarize(operation: string, durations: number[], failures: number): OperationStat {
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    operation,
    count: durations.length,
    failures,
    p50Ms: round(percentile(durations, 50)),
    p95Ms: round(percentile(durations, 95)),
    p99Ms: round(percentile(durations, 99)),
    maxMs: round(durations.length === 0 ? 0 : Math.max(...durations)),
    totalMs: round(total),
  };
}

/** `git` via Bun.spawn, argv only (same rule as the library: never a shell string). */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Starling',
      GIT_AUTHOR_EMAIL: 'starling@localhost',
      GIT_COMMITTER_NAME: 'Starling',
      GIT_COMMITTER_EMAIL: 'starling@localhost',
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`);
  }
  return stdout;
}

async function writeFileAt(root: string, relative: string, content: string): Promise<void> {
  const target = join(root, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

/**
 * Allocated bytes on disk via `du -sk`.
 *
 * Apparent size (`stat().size`) says nothing about what a 5 000-file checkout really costs, because
 * every small file still occupies a filesystem block (4 KB on APFS/ext4). `du` is the number a user
 * sees, so the report carries both. Missing/odd `du` (Windows) simply omits the sample.
 */
async function allocatedBytes(path: string): Promise<number | undefined> {
  try {
    const proc = Bun.spawn(['du', '-sk', path], { stdout: 'pipe', stderr: 'ignore' });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return undefined;
    const kb = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? '', 10);
    return Number.isFinite(kb) ? kb * 1024 : undefined;
  } catch {
    return undefined;
  }
}

/** A repository with `files` files spread over 50 directories, plus one shared file per pair. */
async function generateRepo(repo: string, files: number, pairs: number): Promise<void> {
  await mkdir(repo, { recursive: true });
  await git(repo, 'init', '-q', '-b', 'main');
  await git(repo, 'config', 'user.name', 'Starling Stress');
  await git(repo, 'config', 'user.email', 'stress@starling.local');

  const dirs = 50;
  const perDir = Math.max(1, Math.ceil(files / dirs));
  for (let dir = 0; dir < dirs; dir += 1) {
    for (let file = 0; file < perDir; file += 1) {
      if (dir * perDir + file >= files) break;
      await writeFileAt(
        repo,
        `src/mod${dir}/file${file}.ts`,
        `// generated module ${dir}/${file}\nexport const value = ${dir * perDir + file};\nexport type Kind = 'mod${dir}';\n`,
      );
    }
  }
  for (let pair = 0; pair < pairs; pair += 1) {
    await writeFileAt(
      repo,
      `shared/pair-${pair}.txt`,
      `pair ${pair} line 1\npair ${pair} line 2\npair ${pair} line 3\npair ${pair} line 4\npair ${pair} line 5\n`,
    );
  }
  await writeFileAt(repo, 'README.md', '# stress repo\n\nGenerated by tools/stress/worktrees.ts.\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-qm', 'stress: initial import');
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Run the whole stress scenario. Always resolves: inspect `report.ok`, `report.failures` and
 * `report.checks`. Throws only for a programming error (e.g. an unusable temp directory).
 */
export async function runStress(opts: StressOptions = {}): Promise<StressReport> {
  const files = Math.max(60, opts.files ?? 5000);
  const worktrees = Math.max(4, opts.worktrees ?? 60);
  const conflictPairs = Math.max(1, Math.min(opts.conflictPairs ?? 20, Math.floor(worktrees / 2)));
  const bundleCount = Math.max(1, Math.min(opts.bundles ?? 10, worktrees));
  const sparse = opts.sparse ?? true;
  const keep = opts.keep ?? false;
  const log = opts.log ?? (() => {});

  const root = opts.root ?? (await mkdtemp(join(tmpdir(), 'starling-stress-')));
  const repo = join(root, 'repo');
  const worktreeRoot = join(root, 'worktrees');
  const started = performance.now();

  const durations = new Map<string, number[]>();
  const failures: StressFailure[] = [];
  const phases: PhaseStat[] = [];
  const checks: StressReport['checks'] = {
    commits: 0,
    diffs: 0,
    conflictsFound: 0,
    conflictsExpected: conflictPairs,
    conflictingPaths: [],
    bundlesFetched: 0,
    worktreesRemoved: 0,
    worktreesRegisteredAfter: 0,
  };

  /** Time one operation, capturing failures instead of aborting the run. */
  async function step<T>(operation: string, target: string, fn: () => Promise<T>): Promise<T | undefined> {
    const at = performance.now();
    try {
      return await fn();
    } catch (err) {
      failures.push({ operation, target, message: err instanceof Error ? err.message : String(err) });
      return undefined;
    } finally {
      const list = durations.get(operation) ?? [];
      list.push(performance.now() - at);
      durations.set(operation, list);
    }
  }

  /** Time a whole phase (wall clock, so serialised queueing is not counted once per caller). */
  async function phase<T>(name: string, count: number, fn: () => Promise<T>): Promise<T> {
    const at = performance.now();
    try {
      return await fn();
    } finally {
      phases.push({ phase: name, wallMs: round(performance.now() - at), count });
    }
  }

  try {
    const setupStart = performance.now();
    await generateRepo(repo, files, conflictPairs);
    const setupMs = performance.now() - setupStart;
    log(`repo ready: ${files} files, ${conflictPairs} conflict pairs (${Math.round(setupMs)} ms)`);

    const ws = createWorkspace({ worktreeRoot });
    const branches = Array.from({ length: worktrees }, (_, index) => `starling/stress/t${index}`);

    log(`creating ${worktrees} worktrees concurrently…`);
    const created = await phase('create', worktrees, () =>
      Promise.all(
        branches.map((branch, index) =>
          step('create', branch, () => ws.create(repo, branch, 'main')).then((result) =>
            result === undefined ? undefined : { ...result, index },
          ),
        ),
      ),
    );

    log(`committing in ${worktrees} worktrees concurrently…`);
    await phase('commit', worktrees, () =>
      Promise.all(
        created.map(async (worktree) => {
          if (worktree === undefined) return;
          const index = worktree.index;
          await step('commit', branches[index] ?? '', async () => {
            await writeFileAt(worktree.path, `tasks/t${index}.txt`, `task ${index} output\n`);
            if (index < conflictPairs * 2) {
              const pair = Math.floor(index / 2);
              await writeFileAt(
                worktree.path,
                `shared/pair-${pair}.txt`,
                `pair ${pair} line 1 — task ${index}\npair ${pair} line 2\npair ${pair} line 3\n` +
                  `pair ${pair} line 4\npair ${pair} line 5\n`,
              );
            }
            const sha = await ws.commitAll(worktree.path, `stress: task ${index}`);
            if (sha === undefined) throw new Error(`commitAll returned undefined in ${worktree.path}`);
            checks.commits += 1;
          });
        }),
      ),
    );

    log(`diffing ${worktrees} worktrees concurrently…`);
    await phase('diff', worktrees, () =>
      Promise.all(
        created.map((worktree) =>
          worktree === undefined
            ? Promise.resolve(undefined)
            : step('diff', branches[worktree.index] ?? '', async () => {
                const summary = await ws.diff(worktree.path, 'main');
                if (summary.files.length === 0) {
                  throw new Error('diff came back empty after a commit');
                }
                checks.diffs += 1;
                return summary;
              }),
        ),
      ),
    );

    log(`predicting conflicts for ${conflictPairs} pairs…`);
    await phase('predict-conflicts', conflictPairs, () =>
      Promise.all(
        Array.from({ length: conflictPairs }, (_, pair) => {
          const left = `starling/stress/t${pair * 2}`;
          const right = `starling/stress/t${pair * 2 + 1}`;
          return step('predict-conflicts', `${left} vs ${right}`, async () => {
            const conflicted = await ws.predictConflicts(repo, left, right);
            const expected = `shared/pair-${pair}.txt`;
            if (!conflicted.includes(expected)) {
              throw new Error(
                `expected ${expected} among conflicted paths, got [${conflicted.join(', ') || 'none'}]`,
              );
            }
            checks.conflictsFound += 1;
            checks.conflictingPaths.push(expected);
            return conflicted;
          });
        }),
      ),
    );

    log(`creating and fetching ${bundleCount} bundles…`);
    const bundlePaths: string[] = [];
    await phase('bundles', bundleCount, async () => {
      for (let index = 0; index < bundleCount; index += 1) {
        const branch = branches[index] ?? '';
        const worktree = created[index];
        if (worktree === undefined) continue;
        const bundle = await step('bundle-create', branch, () =>
          ws.createBundle(repo, branch, { base: 'main' }),
        );
        if (bundle === undefined) continue;
        bundlePaths.push(bundle);
        await step('bundle-fetch', branch, async () => {
          const intoBranch = `stress/fetched-${index}`;
          await ws.fetchBundle(repo, bundle, branch, intoBranch);
          const [fetched, expected] = await Promise.all([
            git(repo, 'rev-parse', `refs/heads/${intoBranch}`),
            git(worktree.path, 'rev-parse', 'HEAD'),
          ]);
          if (fetched.trim() !== expected.trim()) {
            throw new Error(`fetched ${fetched.trim()} but the worktree is at ${expected.trim()}`);
          }
          checks.bundlesFetched += 1;
        });
      }
    });

    log('measuring disk use…');
    const perWorktree: DiskSample[] = [];
    let allocatedSampleBytes: number | undefined;
    await phase('disk', created.length, async () => {
      for (const worktree of created) {
        if (worktree === undefined) continue;
        const usage = await diskUsage(worktree.path);
        perWorktree.push({ path: worktree.path, bytes: usage.bytes, files: usage.files });
      }
      // `du` on three worktrees is enough to calibrate apparent size against block overhead.
      const samples: number[] = [];
      for (const sample of perWorktree.slice(0, 3)) {
        const bytes = await allocatedBytes(sample.path);
        if (bytes !== undefined) samples.push(bytes);
      }
      if (samples.length > 0) allocatedSampleBytes = Math.round(average(samples));
    });
    const repoGit = await diskUsage(join(repo, '.git'));
    const repoCheckout = await diskUsage(repo);
    const bundleBytes = (
      await Promise.all(bundlePaths.map(async (bundle) => (await stat(bundle)).size))
    ).reduce((sum, value) => sum + value, 0);

    log(`removing ${worktrees} worktrees concurrently…`);
    await phase('remove', worktrees, () =>
      Promise.all(
        created.map((worktree) => {
          if (worktree === undefined) return Promise.resolve(undefined);
          return step('remove', branches[worktree.index] ?? '', async () => {
            await ws.remove(worktree.path);
            if (existsSync(worktree.path)) throw new Error('worktree directory survived remove()');
            checks.worktreesRemoved += 1;
          });
        }),
      ),
    );
    const remaining = (await git(repo, 'worktree', 'list', '--porcelain'))
      .split('\n')
      .filter((line) => line.startsWith('worktree ')).length;
    checks.worktreesRegisteredAfter = remaining;

    let sparseSample: StressReport['disk']['sparse'];
    if (sparse) {
      log('measuring a sparse lane worktree…');
      const sparseWs = createWorkspace({
        worktreeRoot,
        sparseCheckout: () => ['src/mod0', 'src/mod1'],
      });
      await phase('sparse', 1, async () => {
        const lane = await step('create-sparse', 'starling/stress/sparse', () =>
          sparseWs.create(repo, 'starling/stress/sparse', 'main'),
        );
        if (lane === undefined) return;
        const usage: DiskUsage = await diskUsage(lane.path);
        const fullAvg = average(perWorktree.map((sample) => sample.bytes));
        sparseSample = {
          path: lane.path,
          bytes: usage.bytes,
          files: usage.files,
          directories: ['src/mod0', 'src/mod1'],
          ratioOfFull: fullAvg === 0 ? 0 : usage.bytes / fullAvg,
          ...(await allocatedBytes(lane.path).then((bytes) =>
            bytes === undefined ? {} : { allocatedBytes: bytes },
          )),
        };
        await step('remove-sparse', 'starling/stress/sparse', () => sparseWs.remove(lane.path));
      });
    }

    const worktreeBytes = perWorktree.map((sample) => sample.bytes);
    const fileCounts = perWorktree.map((sample) => sample.files);
    checks.conflictingPaths.sort();
    const operations = [...durations.entries()].map(([operation, values]) =>
      summarize(operation, values, failures.filter((failure) => failure.operation === operation).length),
    );
    operations.sort((a, b) => b.totalMs - a.totalMs);

    return {
      ok: failures.length === 0,
      repo,
      worktreeRoot,
      files,
      worktrees,
      conflictPairs,
      bundles: bundleCount,
      setupMs: round(setupMs),
      totalMs: round(performance.now() - started),
      loadAverage: loadavg() as [number, number, number],
      phases,
      operations,
      failures,
      checks,
      disk: {
        perWorktree,
        perWorktreeAvgBytes: Math.round(average(worktreeBytes)),
        perWorktreeP50Bytes: Math.round(percentile(worktreeBytes, 50)),
        perWorktreeP95Bytes: Math.round(percentile(worktreeBytes, 95)),
        fullWorktreeFiles: Math.round(average(fileCounts)),
        totalWorktreeBytes: worktreeBytes.reduce((sum, value) => sum + value, 0),
        ...(allocatedSampleBytes === undefined ? {} : { allocatedSampleBytes }),
        repoGitBytes: repoGit.bytes,
        repoCheckoutBytes: repoCheckout.bytes,
        bundleBytes,
        ...(sparseSample === undefined ? {} : { sparse: sparseSample }),
      },
      kept: keep,
    };
  } finally {
    if (!keep) await rm(root, { recursive: true, force: true });
  }
}
