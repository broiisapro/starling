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

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '', durationMs: 1 });
const fail = (stderr: string): ExecResult => ({ code: 1, stdout: '', stderr, durationMs: 1 });
const json = (value: unknown): ExecResult => ok(JSON.stringify(value));

/**
 * In-memory `gh`/`git` for tracker tests (L23: no real gh calls). Stateful enough that a second
 * `syncPlan` can prove idempotency: labels and issues created by the first call are visible to the
 * second.
 */
export class FakeGh {
  readonly calls: FakeGhCall[] = [];
  readonly labels = new Set<string>();
  readonly issues: FakeIssue[] = [];
  readonly prs: FakePr[] = [];

  authenticated = true;
  repoViewFails = false;
  pushStderr: string | undefined;
  existingPrUrl: string | undefined;

  private nextIssue = 100;
  private nextPr = 1;

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
    const [bin, area, action] = cmd;
    if (bin === 'git' && area === 'push') {
      return this.pushStderr === undefined ? ok('') : fail(this.pushStderr);
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
      this.labels.add(name);
      return ok('');
    }

    if (area === 'issue' && action === 'list') {
      const label = flag(cmd, '--label');
      return json(
        this.issues
          .filter((issue) => label === undefined || issue.labels.includes(label))
          .map((issue) => ({ number: issue.number, body: issue.body })),
      );
    }

    if (area === 'issue' && action === 'create') {
      const number = this.nextIssue;
      this.nextIssue += 1;
      const issue: FakeIssue = {
        number,
        title: flag(cmd, '--title') ?? '',
        body: await readBody(cmd),
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
      target.comments.push(await readBody(cmd));
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
      const url = `https://github.com/acme/sky-todo/pull/${this.nextPr}`;
      this.nextPr += 1;
      this.prs.push({
        url,
        base,
        head,
        title: flag(cmd, '--title') ?? '',
        body: await readBody(cmd),
      });
      return ok(`${url}\n`);
    }

    return fail(`fake gh: unsupported command ${cmd.join(' ')}`);
  }
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
