import { describe, expect, test } from 'bun:test';
import { parseWorkerHandback } from './handshake';
import {
  renderFinalPRBody,
  renderMergedComment,
  renderTaskIssue,
  renderTaskPRBody,
  runSearchUrl,
  taskMarker,
} from './render';
import { HANDBACK_BLOCK, REPO, RUN_SHORT, scenarioRun, taskOf, taskRunOf } from './testing/fixtures';

describe('renderTaskIssue', () => {
  test('snapshot', () => {
    const run = scenarioRun();
    expect(renderTaskIssue(taskOf(run, 'theme'), run)).toMatchSnapshot();
  });

  test('starts with the idempotency marker and has a DoD checklist', () => {
    const run = scenarioRun();
    const body = renderTaskIssue(taskOf(run, 'theme'), run);
    expect(body.startsWith(taskMarker(run.id, 'theme'))).toBe(true);
    expect(body).toContain('### Definition of done');
    expect(body).toContain('- [ ] The theme survives a reload');
    expect(body).toContain('`src/ui/styles.css`');
  });

  test('links the run when the repo is known', () => {
    const run = scenarioRun();
    const body = renderTaskIssue(taskOf(run, 'theme'), run, { repo: REPO, prefix: 'starling' });
    expect(body).toContain(runSearchUrl(REPO, 'starling', run.id));
    expect(body).toContain(`label%3Astarling%3Arun-${RUN_SHORT}`);
  });
});

describe('renderTaskPRBody', () => {
  test('snapshot with verdict, handback and notes', () => {
    const run = scenarioRun();
    const handback = parseWorkerHandback(HANDBACK_BLOCK);
    expect(
      renderTaskPRBody(taskOf(run, 'theme'), run, {
        notes: 'Engine note: rebased onto the integration branch.',
        handback,
        closes: 100,
        repo: REPO,
      }),
    ).toMatchSnapshot();
  });

  test('snapshot without a verdict', () => {
    const run = scenarioRun();
    run.tasks.theme = { ...taskRunOf(run, 'theme'), lastVerdict: undefined };
    expect(renderTaskPRBody(taskOf(run, 'theme'), run)).toMatchSnapshot();
  });

  test('renders the verdict table with durations, usage, cost and closing issue', () => {
    const run = scenarioRun();
    const body = renderTaskPRBody(taskOf(run, 'theme'), run, { closes: 100 });
    expect(body).toContain('| Check | Result | Duration | Detail |');
    expect(body).toContain('| `tests` | ✅ | 4,200 ms | bun test: 14 pass |');
    expect(body).toContain('| API | 1,200 | 340 | 200 | $0.0004 |');
    expect(body).toContain('| Local | — | — | — | $0.0000 |');
    expect(body).toContain('**Cost:** $0.0004 API');
    expect(body).toContain('**Attempts:** 2');
    expect(body).toContain('**Node:** `hub`');
    expect(body).toContain('Closes #100');
  });

  test('renders the auditor DoD as a ticked checklist with evidence', () => {
    const run = scenarioRun();
    const body = renderTaskPRBody(taskOf(run, 'theme'), run);
    expect(body).toContain('### Definition of done');
    expect(body).toContain('- [x] bun test passes — _14 pass, 0 fail_');
    expect(body).toContain('- [x] The toggle has an aria-label — _aria-label="Toggle theme"_');
  });

  test('shows a failed DoD item as unchecked', () => {
    const run = scenarioRun();
    const body = renderTaskPRBody(taskOf(run, 'search'), run);
    expect(body).toContain('- [ ] Escape clears the query');
    expect(body).toContain('- [ ] bun test passes — _2 failing tests in search.test.ts_');
  });

  test('falls back to the plan DoD when the verdict has no itemised DoD', () => {
    const run = scenarioRun();
    const verdict = taskRunOf(run, 'theme').lastVerdict;
    if (verdict === undefined) throw new Error('fixture must have a verdict');
    run.tasks.theme = { ...taskRunOf(run, 'theme'), lastVerdict: { ...verdict, dod: undefined } };
    const body = renderTaskPRBody(taskOf(run, 'theme'), run);
    expect(body).toContain("_The auditor did not itemise the DoD; the plan's checklist is below._");
    expect(body).toContain('- [ ] The theme survives a reload');
  });

  test('marks failed checks and lane violations', () => {
    const run = scenarioRun();
    const body = renderTaskPRBody(taskOf(run, 'search'), run);
    expect(body).toContain('| `tests` | ❌ | 3,800 ms | bun test: 2 fail |');
    expect(body).toContain('**Lane violations:** - `src/store/todos.ts`');
  });

  test('renders a local-usage row and a friendly node name when the engine supplies them', () => {
    const run = scenarioRun();
    const body = renderTaskPRBody(taskOf(run, 'theme'), run, {
      localUsage: { input: 9000, output: 1200, cached: 0 },
      nodeName: "Moksh's M2 Air",
    });
    expect(body).toContain('| Local | 9,000 | 1,200 | 0 | $0.0000 |');
    expect(body).toContain('$0.0000 local');
    expect(body).toContain("**Node:** `Moksh's M2 Air`");
  });

  test("links the run's issue search in the footer", () => {
    const run = scenarioRun();
    const body = renderTaskPRBody(taskOf(run, 'theme'), run, { repo: REPO });
    expect(body).toContain(`run [\`${RUN_SHORT}\`](${runSearchUrl(REPO, 'starling', run.id)})`);
    expect(body.endsWith('created by Starling 🐦</sub>\n')).toBe(true);
  });

  test('says unassigned when no node recorded', () => {
    const run = scenarioRun();
    run.tasks.theme = { ...taskRunOf(run, 'theme'), nodeId: undefined };
    expect(renderTaskPRBody(taskOf(run, 'theme'), run)).toContain('**Node:** _unassigned_');
  });
});

describe('renderFinalPRBody', () => {
  test('snapshot', () => {
    expect(renderFinalPRBody(scenarioRun())).toMatchSnapshot();
  });

  test('lists tasks with status, node, totals and the API/local cost split', () => {
    const body = renderFinalPRBody(scenarioRun());
    expect(body).toContain('| Task | Title | Status | Node | Attempts | Cost |');
    expect(body).toContain(
      '| `theme` | Dark mode with a toggle ([PR](https://github.com/acme/sky-todo/pull/1)) | ✅ merged | `hub` | 2 | $0.0004 |',
    );
    expect(body).toContain('| `search` | Live search filtering | ❌ failed | `m2-air` | 3 | $0.0001 |');
    expect(body).toContain('**1 merged · 1 failed · 2 planned**');
    expect(body).toContain('| API | 1,700 | 460 | 200 | $0.0005 |');
    expect(body).toContain('| Local | 9,000 | 1,200 | 0 | $0.0000 |');
    expect(body).toContain('**Saved vs API:** $0.0034 across 6 local calls · **Elapsed:** 12m 34s');
  });

  test('links the run when the repo is known', () => {
    const run = scenarioRun();
    const body = renderFinalPRBody(run, { repo: REPO });
    expect(body).toContain(runSearchUrl(REPO, 'starling', run.id));
  });
});

describe('renderMergedComment', () => {
  test('snapshot for a pass', () => {
    const run = scenarioRun();
    expect(renderMergedComment(taskOf(run, 'theme'), run)).toMatchSnapshot();
  });

  test('snapshot for a failure', () => {
    const run = scenarioRun();
    expect(renderMergedComment(taskOf(run, 'search'), run)).toMatchSnapshot();
  });

  test('says so when no verdict exists', () => {
    const run = scenarioRun();
    run.tasks.theme = { ...taskRunOf(run, 'theme'), lastVerdict: undefined };
    expect(renderMergedComment(taskOf(run, 'theme'), run)).toContain(
      '_No audit verdict was recorded for this task._',
    );
  });
});

describe('runSearchUrl', () => {
  test('encodes the run label so the link survives markdown', () => {
    expect(runSearchUrl('acme/sky-todo', 'starling', '01jd2k7m3p4q5r6s7t8v9w0x2z')).toBe(
      'https://github.com/acme/sky-todo/issues?q=label%3Astarling%3Arun-9w0x2z',
    );
  });
});
