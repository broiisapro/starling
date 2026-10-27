import { describe, expect, test } from 'bun:test';
import { parseWorkerHandback } from './handshake';
import {
  renderFinalPRBody,
  renderMergedComment,
  renderTaskIssue,
  renderTaskPRBody,
  taskMarker,
} from './render';
import { HANDBACK_BLOCK, scenarioRun, taskOf, taskRunOf } from './testing/fixtures';

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
      }),
    ).toMatchSnapshot();
  });

  test('snapshot without a verdict', () => {
    const run = scenarioRun();
    run.tasks.theme = { ...taskRunOf(run, 'theme'), lastVerdict: undefined };
    expect(renderTaskPRBody(taskOf(run, 'theme'), run)).toMatchSnapshot();
  });

  test('renders the verdict table, usage, cost and closing issue', () => {
    const run = scenarioRun();
    const body = renderTaskPRBody(taskOf(run, 'theme'), run, { closes: 100 });
    expect(body).toContain('| Check | Result | Detail |');
    expect(body).toContain('| `tests` | ✅ | bun test: 14 pass |');
    expect(body).toContain('| Cached input | 200 |');
    expect(body).toContain('**Cost:** $0.0004 · **Attempts:** 2');
    expect(body).toContain('Closes #100');
  });

  test('marks failed checks and lane violations', () => {
    const run = scenarioRun();
    const body = renderTaskPRBody(taskOf(run, 'search'), run);
    expect(body).toContain('| `tests` | ❌ | bun test: 2 fail |');
    expect(body).toContain('**Lane violations:** - `src/store/todos.ts`');
  });
});

describe('renderFinalPRBody', () => {
  test('snapshot', () => {
    expect(renderFinalPRBody(scenarioRun())).toMatchSnapshot();
  });

  test('lists tasks with status, totals and the API/local cost split', () => {
    const body = renderFinalPRBody(scenarioRun());
    expect(body).toContain('| Task | Title | Status | Attempts | Cost |');
    expect(body).toContain(
      '| `theme` | Dark mode with a toggle ([PR](https://github.com/acme/sky-todo/pull/1)) | ✅ merged | 2 | $0.0004 |',
    );
    expect(body).toContain('| `search` | Live search filtering | ❌ failed | 3 | $0.0001 |');
    expect(body).toContain('**1 merged · 1 failed · 2 planned**');
    expect(body).toContain('| API | 1,700 | 460 | 200 | $0.0005 |');
    expect(body).toContain('| Local | 9,000 | 1,200 | 0 | $0.0000 |');
    expect(body).toContain('**Saved vs API:** $0.0034 across 6 local calls · **Elapsed:** 12m 34s');
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
