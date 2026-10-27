import type { ExecOptions, ExecResult } from '@starling/core';

export interface FakeGhCall {
  cmd: string[];
  cwd: string;
}

export interface FakeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
  comments: string[];
  closeReason?: string;
}

export interface FakePr {
  url: string;
  base: string;
  head: string;
  title: string;
  body: string;
}

/**
 * GitHub's documented hard cap, captured from real `gh` in the Epic 43 sandbox:
 * `GraphQL: Body is too long (maximum is 65536 characters) (createIssue|createPullRequest)`.
 */
export const REAL_BODY_LIMIT = 65_536;

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '', durationMs: 1 });
const fail = (stderr: string): ExecResult => ({ code: 1, stdout: '', stderr, durationMs: 1 });
const json = (value: unknown): ExecResult => ok(JSON.stringify(value));

/**
 * In-memory `gh`/`git` for tracker tests (L23: no real gh calls). Stateful enough that a second
 * `syncPlan` can prove idempotency and that the failure switches below can reproduce the exact
 * stderr real `gh` 2.98 printed during the Epic 43 sandbox run.
 */
export class FakeGh {
  readonly calls: FakeGhCall[] = [];
  readonly labels = new Set<string>();
  readonly issues: FakeIssue[] = [];
  readonly prs: FakePr[] = [];

  authenticated = true;
  repoViewFails = false;
  /** Set to model `gh repo view` failing but `git remote get-url origin` working (a worktree). */
  originRemote: string | undefined;
  pushStderr: string | undefined;
  existingPrUrl: string | undefined;

  /** Real text: `label with name "x" already exists; use --force to update its color …`. */
  labelAlreadyExistsOnce = false;
  /** Real text: `could not add label: 'starling:task' not found` — the label-creation race. */
  issueCreateMissingLabelOnce = false;
  /** Real text: `GraphQL: No commits between <base> and <head> (createPullRequest)`. */
  noCommitsBetween = false;
  /** Enforce GitHub's real body cap instead of accepting any size. */
  enforceBodyLimit = true;
  /**
   * Hide the newest issue from the next N `issue list` calls. Real GitHub does this for a second or
   * two after a write (observed in the Epic 43 sandbox), which is how a re-sync creates duplicates.
   */
  issueListLag = 0;
  /** Return `stderr` once for the first call whose argv starts with `prefix`. */
  failOnce: { prefix: string[]; stderr: string } | undefined;

  private nextIssue = 100;
  private nextPr = 1;
  private labelRacePending = false;
  private missingLabelPending = false;
  private failOnceUsed = false;

  exec = async (cmd: string[], opts: ExecOptions): Promise<ExecResult> => {
    this.calls.push({ cmd: [...cmd], cwd: opts.cwd });
    try {
      return await this.handle(cmd);
    } catch (err) {
      return fail(`fake gh: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Calls whose argv starts with every element of `prefix`. */
  callsStartingWith(...prefix: string[]): FakeGhCall[] {
    return this.calls.filter((call) => prefix.every((part, i) => call.cmd[i] === part));
  }

  issue(number: number): FakeIssue | undefined {
    return this.issues.find((candidate) => candidate.number === number);
  }

  private async handle(cmd: string[]): Promise<ExecResult> {
    const once = this.failOnce;
    if (once !== undefined && !this.failOnceUsed) {
      const matches = once.prefix.every((part, i) => cmd[i] === part);
      if (matches) {
        this.failOnceUsed = true;
        return fail(once.stderr);
      }
    }

    const [bin, area, action] = cmd;
    if (bin === 'git' && area === 'push') {
      return this.pushStderr === undefined ? ok('') : fail(this.pushStderr);
    }
    if (bin === 'git' && area === 'remote' && action === 'get-url') {
      return this.originRemote === undefined
        ? fail("error: No such remote 'origin'")
        : ok(`${this.originRemote}\n`);
    }
    if (bin !== 'gh') return fail(`fake gh: unsupported command ${cmd.join(' ')}`);

    if (area === 'auth' && action === 'status') {
      return this.authenticated
        ? ok('github.com\n  ✓ Logged in to github.com account acme\n')
        : fail('You are not logged into any GitHub hosts. Run gh auth login to authenticate.');
    }

    if (area === 'repo' && action === 'view') {
      return this.repoViewFails
        ? fail('none of the git remotes correspond to a known GitHub host')
        : json({ nameWithOwner: 'acme/sky-todo' });
    }

    if (area === 'label' && action === 'list') {
      return json([...this.labels].map((name) => ({ name })));
    }

    if (area === 'label' && action === 'create') {
      const name = cmd[3];
      if (name === undefined) return fail('fake gh: label create needs a name');
      if (this.labelAlreadyExistsOnce && !this.labelRacePending) {
        // The other Starling process created it between our `label list` and our `label create`.
        this.labelRacePending = true;
        this.labels.add(name);
        return fail(
          `label with name "${name}" already exists; use \`--force\` to update its color and description`,
        );
      }
      this.labels.add(name);
      return ok('');
    }

    if (area === 'issue' && action === 'list') {
      const label = flag(cmd, '--label');
      let visible = this.issues;
      if (this.issueListLag > 0) {
        this.issueListLag -= 1;
        visible = visible.slice(0, -1);
      }
      return json(
        visible
          .filter((issue) => label === undefined || issue.labels.includes(label))
          .map((issue) => ({ number: issue.number, body: issue.body })),
      );
    }

    if (area === 'issue' && action === 'create') {
      const body = await readBody(cmd);
      const tooLong = tooLongBody(body, this.enforceBodyLimit);
      if (tooLong !== undefined) return fail(tooLong);
      if (this.issueCreateMissingLabelOnce && !this.missingLabelPending) {
        this.missingLabelPending = true;
        const labels = allFlags(cmd, '--label');
        // Model the real race: the label existed a moment ago (`label list` saw it) and is gone.
        const missing = labels.find((label) => this.labels.has(label)) ?? labels[0];
        if (missing !== undefined) {
          this.labels.delete(missing);
          return fail(`could not add label: '${missing}' not found`);
        }
      }
      const number = this.nextIssue;
      this.nextIssue += 1;
      const issue: FakeIssue = {
        number,
        title: flag(cmd, '--title') ?? '',
        body,
        labels: allFlags(cmd, '--label'),
        state: 'open',
        comments: [],
      };
      this.issues.push(issue);
      return ok(`https://github.com/acme/sky-todo/issues/${number}\n`);
    }

    if (area === 'issue' && action === 'comment') {
      const target = this.issue(Number(cmd[3]));
      if (target === undefined) return fail(`fake gh: no issue ${cmd[2]}`);
      const body = await readBody(cmd);
      const tooLong = tooLongBody(body, this.enforceBodyLimit);
      if (tooLong !== undefined) return fail(tooLong);
      target.comments.push(body);
      return ok(`https://github.com/acme/sky-todo/issues/${target.number}\n`);
    }

    if (area === 'issue' && action === 'close') {
      const target = this.issue(Number(cmd[3]));
      if (target === undefined) return fail(`fake gh: no issue ${cmd[2]}`);
      target.state = 'closed';
      target.closeReason = flag(cmd, '--reason');
      return ok('');
    }

    if (area === 'pr' && action === 'create') {
      const base = flag(cmd, '--base') ?? '';
      const head = flag(cmd, '--head') ?? '';
      if (this.existingPrUrl !== undefined) {
        return fail(
          `a pull request for branch "${head}" into branch "${base}" already exists:\n${this.existingPrUrl}`,
        );
      }
      if (this.noCommitsBetween) {
        return fail(
          `pull request create failed: GraphQL: No commits between ${base} and ${head} (createPullRequest)`,
        );
      }
      const body = await readBody(cmd);
      const tooLong = tooLongBody(body, this.enforceBodyLimit);
      if (tooLong !== undefined) return fail(tooLong);
      const url = `https://github.com/acme/sky-todo/pull/${this.nextPr}`;
      this.nextPr += 1;
      this.prs.push({
        url,
        base,
        head,
        title: flag(cmd, '--title') ?? '',
        body,
      });
      return ok(`${url}\n`);
    }

    return fail(`fake gh: unsupported command ${cmd.join(' ')}`);
  }
}

/** The exact GraphQL error real gh prints when a body is over GitHub's cap. */
function tooLongBody(body: string, enforce: boolean): string | undefined {
  if (!enforce || body.length <= REAL_BODY_LIMIT) return undefined;
  return `pull request create failed: GraphQL: Body is too long (maximum is ${REAL_BODY_LIMIT} characters) (createPullRequest)`;
}

function flag(cmd: string[], name: string): string | undefined {
  const index = cmd.indexOf(name);
  return index === -1 ? undefined : cmd[index + 1];
}

function allFlags(cmd: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < cmd.length; i += 1) {
    const value = cmd[i + 1];
    if (cmd[i] === name && value !== undefined) values.push(value);
  }
  return values;
}

async function readBody(cmd: string[]): Promise<string> {
  const path = flag(cmd, '--body-file');
  if (path === undefined) return '';
  return Bun.file(path).text();
}
