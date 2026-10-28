import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static checks over every workflow file in `.github/workflows`.
 *
 * They do not replace a real run; they catch the edits that make a real run pointless: a job with
 * no timeout, an unpinned action, a lockfile-less install, a secret beyond `GITHUB_TOKEN`, a
 * required-check name that quietly disappeared, or the README badge's workflow being renamed.
 */

const WORKFLOWS_DIR = join(import.meta.dir, '..');
const REPO_ROOT = join(WORKFLOWS_DIR, '..', '..');
const REQUIRED_CI_NAMES = ['lint + typecheck', 'test (ubuntu-latest)', 'test (macos-latest)'];
const REQUIRED_WEB_BUILD_NAMES = ['build apps/web'];

interface Workflow {
  file: string;
  raw: string;
  doc: Record<string, unknown>;
}

function loadWorkflows(): Workflow[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
      const parsed: unknown = Bun.YAML.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(`${file} did not parse to a YAML mapping`);
      }
      return { file, raw, doc: parsed as Record<string, unknown> };
    });
}

const WORKFLOWS = loadWorkflows();

function byFile(file: string): Workflow {
  const workflow = WORKFLOWS.find((candidate) => candidate.file === file);
  if (workflow === undefined) throw new Error(`missing workflow ${file}`);
  return workflow;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function jobsOf(doc: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(asRecord(doc.jobs))) result[key] = asRecord(value);
  return result;
}

function stepsOf(job: Record<string, unknown>): Record<string, unknown>[] {
  const steps = job.steps;
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => asRecord(step));
}

function allSteps(doc: Record<string, unknown>): Record<string, unknown>[] {
  return Object.values(jobsOf(doc)).flatMap((job) => stepsOf(job));
}

function runScripts(doc: Record<string, unknown>): string[] {
  return allSteps(doc)
    .map((step) => (typeof step.run === 'string' ? step.run : ''))
    .filter((run) => run.length > 0);
}

function usesRefs(doc: Record<string, unknown>): string[] {
  return allSteps(doc)
    .map((step) => (typeof step.uses === 'string' ? step.uses : ''))
    .filter((uses) => uses.length > 0);
}

function triggersOf(doc: Record<string, unknown>): Record<string, unknown> {
  // YAML 1.1 parsers turn the bare key `on` into the boolean true; accept both spellings.
  const value = doc.on ?? doc['true'];
  if (typeof value === 'string') return { [value]: {} };
  if (Array.isArray(value)) return Object.fromEntries(value.map((name) => [String(name), {}]));
  return asRecord(value);
}

describe('workflow files', () => {
  test('every workflow parses and has the expected jobs', () => {
    expect(WORKFLOWS.map((workflow) => workflow.file).sort()).toEqual([
      'ci.yml',
      'e2e.yml',
      'nightly.yml',
      'pages.yml',
      'pr-size.yml',
      'web-build.yml',
    ]);
    for (const workflow of WORKFLOWS) {
      expect(Object.keys(jobsOf(workflow.doc)).length).toBeGreaterThan(0);
    }
  });

  test('every job has a numeric timeout-minutes', () => {
    for (const workflow of WORKFLOWS) {
      for (const [key, job] of Object.entries(jobsOf(workflow.doc))) {
        expect({ file: workflow.file, job: key, timeout: job['timeout-minutes'] }).toMatchObject({
          timeout: expect.any(Number),
        });
      }
    }
  });

  test('BUN_VERSION matches .bun-version everywhere it is declared', () => {
    const pinned = readFileSync(join(REPO_ROOT, '.bun-version'), 'utf8').trim();
    expect(pinned).toBe('1.4.4');
    for (const workflow of WORKFLOWS) {
      const env = asRecord(workflow.doc.env);
      expect({ file: workflow.file, bun: env.BUN_VERSION }).toMatchObject({ bun: pinned });
    }
  });

  test('every bun install uses --frozen-lockfile', () => {
    for (const workflow of WORKFLOWS) {
      for (const run of runScripts(workflow.doc)) {
        for (const line of run.split('\n')) {
          if (!/\bbun install\b/.test(line)) continue;
          expect({ file: workflow.file, line }).toMatchObject({
            line: expect.stringContaining('--frozen-lockfile'),
          });
        }
      }
    }
  });

  test('no secret is referenced except GITHUB_TOKEN', () => {
    for (const workflow of WORKFLOWS) {
      for (const match of workflow.raw.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) {
        expect({ file: workflow.file, secret: match[1] }).toMatchObject({ secret: 'GITHUB_TOKEN' });
      }
    }
  });

  test('permissions are declared once, at the top level', () => {
    for (const workflow of WORKFLOWS) {
      expect({ file: workflow.file, has: asRecord(workflow.doc.permissions) }).toMatchObject({
        has: expect.any(Object),
      });
      for (const [key, job] of Object.entries(jobsOf(workflow.doc))) {
        expect({ file: workflow.file, job: key, permissions: job.permissions }).toMatchObject({
          permissions: undefined,
        });
      }
    }
  });

  test('no workflow sets STARLING_LIVE', () => {
    for (const workflow of WORKFLOWS) {
      const code = workflow.raw
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect({ file: workflow.file, live: /STARLING_LIVE/.test(code) }).toMatchObject({ live: false });
    }
  });

  test('every action is pinned to a major version or a full commit SHA', () => {
    for (const workflow of WORKFLOWS) {
      for (const uses of usesRefs(workflow.doc)) {
        expect({ file: workflow.file, uses }).toMatchObject({
          uses: expect.stringMatching(/^[\w.-]+\/[\w.-]+@(v\d+(\.\d+)*|[0-9a-f]{40})$/),
        });
      }
    }
  });

  test('the required check names still exist', () => {
    const ciNames = Object.values(jobsOf(byFile('ci.yml').doc)).map((job) => job.name);
    for (const name of REQUIRED_CI_NAMES) expect(ciNames).toContain(name);
    const webBuildNames = Object.values(jobsOf(byFile('web-build.yml').doc)).map((job) => job.name);
    for (const name of REQUIRED_WEB_BUILD_NAMES) expect(webBuildNames).toContain(name);
  });

  test('the README badge still points at ci.yml', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('ci.yml/badge.svg');
    expect(readme).toContain('/actions/workflows/ci.yml');
  });
});

describe('ci.yml layout', () => {
  const doc = byFile('ci.yml').doc;

  test('the Ubuntu tests are split and aggregated by the required check', () => {
    const jobs = jobsOf(doc);
    const aggregator = jobs.test;
    expect(aggregator).toBeDefined();
    expect(aggregator?.name).toBe('test (ubuntu-latest)');
    expect(aggregator?.needs).toEqual(['test-packages', 'test-web']);
    expect(aggregator?.if).toBe('always()');
    expect(jobs['test-packages']?.name).toBe('test packages');
    expect(jobs['test-web']?.name).toBe('test web');
  });

  test('the two halves run the split root scripts', () => {
    const runs = runScripts(doc);
    expect(runs.some((run) => run.includes('bun run test:packages'))).toBe(true);
    expect(runs.some((run) => run.includes('bun run test:web'))).toBe(true);
  });

  test('a site job typechecks, tests and builds site/', () => {
    const site = jobsOf(doc).site;
    expect(site?.name).toBe('site');
    const runs = stepsOf(site ?? {}).map((step) => String(step.run ?? ''));
    expect(runs).toContain('bun run --cwd site typecheck');
    expect(runs).toContain('bun run --cwd site test');
    expect(runs).toContain('bun run --cwd site build');
  });

  test('the typecheck step covers tools, evals, site and the workflow scripts', () => {
    const step = allSteps(doc).find((candidate) =>
      String(candidate.name ?? '').includes('Typecheck what the root loop misses'),
    );
    const run = String(step?.run ?? '');
    expect(run).toContain('tools/*/tsconfig.json');
    expect(run).toContain('evals/tsconfig.json');
    expect(run).toContain('site/tsconfig.json');
    expect(run).toContain('.github/workflows/scripts/tsconfig.json');
    expect(run).toContain('apps/web/e2e/tsconfig.json');
    // Conditional: Epic 140 adds the e2e tsconfig, so the step must skip when it is absent.
    expect(run).toContain('[ ! -f "$config" ]');
  });

  test('the static workflow tests and the offline docs link check run in CI', () => {
    expect(runScripts(doc).some((run) => run.includes('bun test .github/workflows/scripts'))).toBe(true);
    const links = jobsOf(doc)['docs-links'];
    expect(links?.['continue-on-error']).toBe(true);
    const uses = stepsOf(links ?? {}).map((step) => String(step.uses ?? ''));
    expect(uses).toContain('lycheeverse/lychee-action@v2');
  });

  test('the docs link check is offline over the documented files', () => {
    const links = jobsOf(doc)['docs-links'];
    const step = stepsOf(links ?? {}).find((candidate) =>
      String(candidate.uses ?? '').startsWith('lycheeverse/'),
    );
    const args = String(asRecord(step?.with).args ?? '');
    expect(args).toContain('--offline');
    expect(args).toContain('--include-fragments');
    expect(args).toContain('README.md');
    expect(args).toContain('CONTRIBUTING.md');
    expect(args).toContain('docs/**/*.md');
    expect(args).toContain('skills/**/*.md');
    expect(args).toContain('fixtures');
  });
});

describe('new workflows have the triggers their owners need', () => {
  test('pages deploys site/dist on main and can be dispatched', () => {
    const doc = byFile('pages.yml').doc;
    const triggers = triggersOf(doc);
    expect(triggers.workflow_dispatch).toBeDefined();
    const push = asRecord(triggers.push);
    expect(push.branches).toEqual(['main']);
    expect(push.paths).toContain('site/**');
    const raw = JSON.stringify(doc);
    expect(raw).toContain('site/dist');
    expect(raw).toContain('actions/deploy-pages@v4');
  });

  test('e2e runs on PR paths, nightly and manual dispatch', () => {
    const doc = byFile('e2e.yml').doc;
    const triggers = triggersOf(doc);
    expect(triggers.workflow_dispatch).toBeDefined();
    expect(Array.isArray(triggers.schedule)).toBe(true);
    expect(asRecord(triggers.pull_request).paths).toEqual([
      'apps/web/**',
      'fixtures/runs/**',
      '.github/workflows/e2e.yml',
    ]);
    const job = jobsOf(doc).playwright;
    expect(job?.['runs-on']).toBe('macos-latest');
    const suite = stepsOf(job ?? {}).find((step) => step.id === 'e2e');
    expect(suite?.['continue-on-error']).toBe(true);
    const env = asRecord(suite?.env);
    expect(env.STARLING_E2E_PORT).toBe('4777');
    expect(String(env.TMPDIR)).toContain('runner.temp');
  });

  test('nightly has a jittered cron, a PR self-check and keeps its JSON for 14 days', () => {
    const doc = byFile('nightly.yml').doc;
    const triggers = triggersOf(doc);
    expect(triggers.workflow_dispatch).toBeDefined();
    const schedule = triggers.schedule;
    expect(Array.isArray(schedule)).toBe(true);
    const cron = asRecord((schedule as unknown[])[0]).cron;
    expect(cron).toBe('23 6 * * *');
    expect(asRecord(triggers.pull_request).paths).toContain('.github/workflows/nightly.yml');

    const checkout = allSteps(doc).find((step) => String(step.uses ?? '').includes('actions/checkout'));
    expect(asRecord(checkout?.with)['fetch-depth']).toBe(0);

    const runs = runScripts(doc).join('\n');
    expect(runs).toContain('evals/run.ts planner --impl mock');
    expect(runs).toContain('evals/run.ts auditor --impl mock');
    expect(runs).toContain('tools/load/index.ts --quick');
    expect(runs).toContain('tools/stats/collect.ts --no-gh --logs none --out stats.json');

    const upload = allSteps(doc).find((step) => String(step.uses ?? '').includes('upload-artifact'));
    expect(asRecord(upload?.with)['retention-days']).toBe(14);
    expect(String(asRecord(upload?.with).name)).toContain('nightly-');
  });

  test('pr-size is write-scoped, fork-safe and ignores the generated paths', () => {
    const doc = byFile('pr-size.yml').doc;
    expect(asRecord(doc.permissions)['pull-requests']).toBe('write');
    expect(triggersOf(doc).pull_request).toBeDefined();
    const job = jobsOf(doc).label;
    expect(String(job?.if)).toContain('head.repo.full_name == github.repository');
    const runs = runScripts(doc).join('\n');
    expect(runs).toContain('bun .github/workflows/scripts/pr-size.ts');
  });
});
