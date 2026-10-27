import type { RunCommand } from './exec';

/** The subset of `gh pr list --json …` the stats page needs. */
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  mergedAt?: string;
  headRefName?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}

export const PR_FIELDS = [
  'number',
  'title',
  'url',
  'mergedAt',
  'headRefName',
  'additions',
  'deletions',
  'changedFiles',
];

export interface PullRequestResult {
  /** `null` means GitHub was unavailable (no `gh`, no auth, no network) — not "no PRs". */
  prs: PullRequest[] | null;
  note?: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Validate one JSON object from `gh`; `undefined` for anything the page could not use. */
export function parsePullRequest(value: unknown): PullRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const number = optionalNumber(record.number);
  const title = optionalString(record.title);
  const url = optionalString(record.url);
  if (number === undefined || title === undefined || url === undefined) return undefined;
  return {
    number,
    title,
    url,
    mergedAt: optionalString(record.mergedAt),
    headRefName: optionalString(record.headRefName),
    additions: optionalNumber(record.additions),
    deletions: optionalNumber(record.deletions),
    changedFiles: optionalNumber(record.changedFiles),
  };
}

export function parsePullRequestList(json: string): PullRequest[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const pr = parsePullRequest(entry);
    return pr === undefined ? [] : [pr];
  });
}

/**
 * Ask `gh` for every merged PR. Never throws for the usual "no gh / not logged in" cases: it
 * returns `null` plus a note so the collector can degrade instead of failing the whole run.
 */
export async function readMergedPullRequests(
  run: RunCommand,
  repo: string,
  limit = 300,
): Promise<PullRequestResult> {
  let result: Awaited<ReturnType<RunCommand>>;
  try {
    result = await run(
      ['gh', 'pr', 'list', '--state', 'merged', '--limit', String(limit), '--json', PR_FIELDS.join(',')],
      { cwd: repo },
    );
  } catch (error) {
    return { prs: null, note: `gh: unavailable (${(error as Error).message})` };
  }
  if (result.code !== 0) {
    const reason = result.stderr.trim().split('\n')[0] ?? `exit ${result.code}`;
    return { prs: null, note: `gh: pr list failed (${reason})` };
  }
  const prs = parsePullRequestList(result.stdout);
  if (prs.length === 0 && result.stdout.trim() !== '[]') {
    return { prs: null, note: 'gh: returned output that was not a PR list' };
  }
  return { prs };
}

/** Which epic a PR belongs to: `epic(NN)` in the title, else `epic/NN-slug` as the branch. */
export function epicNumberOfPr(pr: PullRequest): string | undefined {
  const titleMatch = /epic\((\d+)\)/i.exec(pr.title);
  if (titleMatch?.[1] !== undefined) return titleMatch[1].padStart(2, '0');
  const branchMatch = /^(?:origin\/)?epic\/(\d+)-/.exec(pr.headRefName ?? '');
  if (branchMatch?.[1] !== undefined) return branchMatch[1].padStart(2, '0');
  return undefined;
}

/** Epic number → its merged PR. When two PRs claim the same epic, the highest number wins. */
export function indexPullRequests(prs: PullRequest[]): Map<string, PullRequest> {
  const byEpic = new Map<string, PullRequest>();
  for (const pr of prs) {
    const epic = epicNumberOfPr(pr);
    if (epic === undefined) continue;
    const existing = byEpic.get(epic);
    if (existing === undefined || existing.number < pr.number) byEpic.set(epic, pr);
  }
  return byEpic;
}
