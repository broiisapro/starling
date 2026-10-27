#!/usr/bin/env bun
/**
 * real-prompts.ts — is the repo-map excerpt in a worker prompt focused on the lane?
 *
 *   bun packages/prompts/bench/real-prompts.ts [--dir CACHE] [--repo name]
 *
 * Uses the clones the repomap bench caches (`<tmp>/starling-repomap-bench` by default), maps each
 * real checkout, writes a plausible TaskSpec whose lane exists in that checkout, and compiles the
 * worker prompt. For each repo it reports how much of the excerpt is lane/neighbour material, how
 * many lane files made it, and how big the prompt got. No model is called.
 *
 * Run `packages/repomap/bench/real-repos.ts` first (or pass the same `--dir`), then this.
 */
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Goal, Plan, PromptContext, TaskSpec } from '@starling/core';
import { matchesAny } from '@starling/core';
import { createRepoMapper } from '@starling/repomap';
import { createPromptCompiler, estimateTokens } from '../src/index.ts';

interface Case {
  repo: string;
  goal: string;
  owns: string[];
  reads: string[];
}

const CASES: readonly Case[] = [
  {
    repo: 'changesets',
    goal: 'Add a --dry-run flag to the version command.',
    owns: ['packages/cli/src/**'],
    reads: ['packages/config/src/index.ts'],
  },
  {
    repo: 'click',
    goal: 'Add a case-insensitive choice option type.',
    owns: ['src/click/core.py'],
    reads: ['src/click/types.py', 'src/click/exceptions.py'],
  },
  {
    repo: 'gin',
    goal: 'Bind a new content type in the binder.',
    owns: ['binding/**'],
    reads: ['context.go'],
  },
  {
    repo: 'serde',
    goal: 'Add a deserializer for a new primitive.',
    owns: ['serde_core/src/de/**'],
    reads: ['serde_core/src/lib.rs'],
  },
  {
    repo: 'bulletproof-react',
    goal: 'Add a filter to the discussions list.',
    owns: ['apps/react-vite/src/features/discussions/**'],
    reads: ['apps/react-vite/src/lib/api-client.ts'],
  },
  {
    repo: 'django',
    goal: 'Add a backend feature flag for JSON columns.',
    owns: ['django/db/backends/base/**'],
    reads: ['django/db/backends/utils.py', 'django/db/models/sql/query.py'],
  },
];

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function task(c: Case): TaskSpec {
  return {
    key: 'lane-change',
    title: 'One focused change',
    goal: c.goal,
    deliverables: [`A change inside ${c.owns[0]}`],
    outOfScope: ['Unrelated refactors'],
    definitionOfDone: ['The repository test command passes', 'A new test covers the behaviour'],
    dependsOn: [],
    lane: { owns: c.owns, reads: c.reads },
    estimateMin: 20,
  };
}

function planFor(spec: TaskSpec): Plan {
  const sibling: TaskSpec = {
    ...spec,
    key: 'sibling',
    title: 'Parallel lane',
    lane: { owns: ['docs/**'], reads: [] },
  };
  return {
    id: '01jd2k7m3p4q5r6s7t8v9w0z1',
    goalId: '01jd2k7m3p4q5r6s7t8v9w0z2',
    summary: 'Two lane-disjoint tasks.',
    tasks: [spec, sibling],
    lockedDecisions: ['Conventional Commits.'],
    model: { provider: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
    createdAt: 1_731_000_000_000,
  };
}

function excerpt(prompt: string): string {
  return prompt.slice(prompt.indexOf('## Repo orientation'), prompt.indexOf('## How to verify'));
}

interface Row {
  repo: string;
  laneFiles: string;
  neighbours: number;
  tail: number;
  excerptChars: number;
  promptTokens: number;
  note: string;
}

async function main(): Promise<number> {
  const cacheDir = argValue(process.argv.slice(2), '--dir') ?? join(tmpdir(), 'starling-repomap-bench');
  const only = argValue(process.argv.slice(2), '--repo');
  const cases = only === undefined ? CASES : CASES.filter((c) => c.repo === only);
  const mapper = createRepoMapper();
  const compiler = createPromptCompiler();
  const rows: Row[] = [];

  for (const c of cases) {
    const root = join(cacheDir, c.repo);
    if (!existsSync(root)) {
      process.stderr.write(`missing clone ${root}; run the repomap bench first\n`);
      return 2;
    }
    const map = await mapper.map(root);
    const spec = task(c);
    const goal: Goal = {
      id: '01jd2k7m3p4q5r6s7t8v9w0z2',
      text: c.goal,
      repoPath: root,
      baseBranch: 'main',
      createdAt: 1_731_000_000_000,
      constraints: [],
    };
    const ctx: PromptContext = {
      goal,
      plan: planFor(spec),
      map,
      task: spec,
      branch: 'starling/9w0x1y/lane-change',
    };
    const prompt = compiler.worker(ctx);
    const section = excerpt(prompt);
    const laneGlobs = [...c.owns, ...c.reads];
    const laneTotal = map.files.filter((file) => matchesAny(file.path, laneGlobs)).length;
    const headings = {
      owned: section.indexOf('In your lane (editable):'),
      read: section.indexOf('You will read:'),
      related: section.indexOf('Neighbours (importers, imports, siblings):'),
      other: section.indexOf('Other files (orientation only):'),
    };
    const laneBlock = section.slice(
      headings.owned,
      headings.related === -1 ? headings.other : headings.related,
    );
    const laneFileLines = laneBlock.split('\n').filter((line) => line.startsWith('- ')).length;
    const relatedBlock =
      headings.related === -1
        ? ''
        : section.slice(headings.related, headings.other === -1 ? undefined : headings.other);
    const tailBlock = headings.other === -1 ? '' : section.slice(headings.other);
    rows.push({
      repo: c.repo,
      laneFiles: `${laneFileLines}/${laneTotal}`,
      neighbours: relatedBlock.split('\n').filter((line) => line.startsWith('- ')).length,
      tail: tailBlock.split('\n').filter((line) => line.startsWith('- ')).length,
      excerptChars: section.length,
      promptTokens: estimateTokens(prompt),
      note: prompt.includes('more files not shown') ? 'truncated' : 'complete',
    });
  }

  process.stdout.write(
    '| repo | lane files shown | neighbours | orientation tail | excerpt chars | prompt tokens | note |\n',
  );
  process.stdout.write('|---|---|---|---|---|---|---|\n');
  for (const row of rows) {
    process.stdout.write(
      `| ${row.repo} | ${row.laneFiles} | ${row.neighbours} | ${row.tail} | ${row.excerptChars} | ${row.promptTokens} | ${row.note} |\n`,
    );
  }
  const missing = rows.filter((row) => {
    const [shown, total] = row.laneFiles.split('/').map(Number);
    return shown !== total;
  });
  if (missing.length > 0) {
    process.stdout.write(`\nlane files missing: ${missing.map((row) => row.repo).join(', ')}\n`);
    return 1;
  }
  process.stdout.write('\nEvery lane file appears in the excerpt.\n');
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
