import type {
  AuditInput,
  DiffSummary,
  ExecOptions,
  ExecResult,
  PromptContext,
  TaskSpec,
} from '@starling/core';
import { BASE_TS, makeGoal, makePlan, makeRepoMap, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import type { AuditorLlmVerdict, ExecFn } from './types';

export const WORKTREE = '/tmp/starling-worktrees/run-1/csv-export';
export const BRANCH = 'starling/run-1/csv-export';

export function csvExportTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return makeTaskSpec({
    key: 'csv-export',
    title: 'CSV export',
    goal: 'Export the current todo list as a CSV download with a proper header row and escaped fields.',
    deliverables: [
      'src/features/export/index.ts exports exportCsv(todos) and initExportButton()',
      'Fields containing commas or quotes are escaped',
      'Downloaded filename is sky-todo-YYYY-MM-DD.csv',
    ],
    outOfScope: ['Importing CSV'],
    definitionOfDone: [
      'bun test passes',
      'A round-trip test covers commas, quotes and newlines',
      'The button is disabled when the list is empty',
    ],
    dependsOn: [],
    lane: {
      owns: ['src/features/export/**'],
      reads: ['src/store/todos.ts', 'src/main.ts'],
    },
    estimateMin: 15,
    ...overrides,
  });
}

export const EXPORT_PATCH = `diff --git a/src/features/export/index.ts b/src/features/export/index.ts
new file mode 100644
index 0000000..1a2b3c4
--- /dev/null
+++ b/src/features/export/index.ts
@@ -0,0 +1,14 @@
+import { visibleTodos } from '../../store/todos';
+
+export function exportCsv(todos: readonly Todo[]): string {
+  const header = 'id,title,done,createdAt,due,tags';
+  const rows = todos.map((todo) => [todo.id, escape(todo.title), todo.done, todo.createdAt, todo.due ?? '', todo.tags.join(';')].join(','));
+  return [header, ...rows].join('\\r\\n');
+}
+
+function escape(value: string): string {
+  return /[",\\n]/.test(value) ? \`"\${value.replace(/"/g, '""')}"\` : value;
+}
+
+export function initExportButton(): void {}
`;

export function csvDiff(overrides: Partial<DiffSummary> = {}): DiffSummary {
  return {
    files: [{ path: 'src/features/export/index.ts', added: 14, removed: 0 }],
    patch: EXPORT_PATCH,
    truncated: false,
    ...overrides,
  };
}

export interface AuditInputOptions {
  task?: TaskSpec;
  diff?: DiffSummary;
  changedFiles?: string[];
  /** `null` removes the test command from the prompt context. */
  testCommand?: string | null;
  /** `null` removes the lint command from the repo map. */
  lintCommand?: string | null;
  attempt?: number;
  worktreePath?: string | null;
}

export function makeAuditInput(options: AuditInputOptions = {}): AuditInput {
  const task = options.task ?? csvExportTask();
  const goal = makeGoal({
    text: 'Export the todo list as CSV with correct quoting.',
    repoPath: '/tmp/sky-todo',
  });
  const plan = makePlan({
    goalId: goal.id,
    tasks: [task],
    lockedDecisions: [
      'Vanilla TypeScript + Vite, no UI framework',
      'Tests live beside their sources and run with bun test',
    ],
  });
  const lintCommand =
    options.lintCommand === null ? undefined : (options.lintCommand ?? 'bunx biome check .');
  const map = makeRepoMap({ root: '/tmp/sky-todo', testCommand: 'bun test', lintCommand });
  const testCommand = options.testCommand === null ? undefined : (options.testCommand ?? map.testCommand);
  const ctx: PromptContext = {
    goal,
    plan,
    map,
    task,
    branch: BRANCH,
    ...(testCommand === undefined ? {} : { testCommand }),
  };
  const run = makeTaskRun({
    runId: 'run-1',
    taskKey: task.key,
    status: 'auditing',
    branch: BRANCH,
    ...(options.worktreePath === null ? {} : { worktreePath: options.worktreePath ?? WORKTREE }),
    attempts: options.attempt ?? 1,
    startedAt: BASE_TS,
  });

  return {
    ctx,
    run,
    diff: options.diff ?? csvDiff(),
    changedFiles:
      options.changedFiles ??
      (options.diff?.files.map((file) => file.path) || ['src/features/export/index.ts']),
    attempt: options.attempt ?? 1,
  };
}

export interface FakeExec {
  fn: ExecFn;
  calls: Array<{ cmd: string[]; opts: ExecOptions }>;
}

/** Injected command runner: never spawns a process, records argv and cwd for assertions. */
export function fakeExec(
  handler: (command: string, opts: ExecOptions) => Partial<ExecResult> | Promise<Partial<ExecResult>>,
): FakeExec {
  const calls: Array<{ cmd: string[]; opts: ExecOptions }> = [];
  const fn: ExecFn = async (cmd, opts) => {
    calls.push({ cmd, opts });
    const result = await handler(cmd[2] ?? '', opts);
    return {
      code: result.code ?? 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      durationMs: result.durationMs ?? 1,
    };
  };
  return { fn, calls };
}

/** A well-formed reviewer verdict that meets every csv-export DoD item. */
export function passingVerdict(overrides: Partial<AuditorLlmVerdict> = {}): AuditorLlmVerdict {
  return {
    pass: true,
    summary: 'CSV export is implemented with RFC 4180 quoting and covers commas and quotes.',
    dod: [
      { item: 'bun test passes', met: true, evidence: 'test output: 12 pass' },
      {
        item: 'A round-trip test covers commas, quotes and newlines',
        met: true,
        evidence: 'src/features/export/index.test.ts',
      },
      {
        item: 'The button is disabled when the list is empty',
        met: true,
        evidence: 'initExportButton disables the button when todos.length === 0',
      },
    ],
    ...overrides,
  };
}

/** `MockLLM` script entry: a JSON body for `completeJson`. */
export function llmJson(verdict: AuditorLlmVerdict): { text: string } {
  return { text: JSON.stringify(verdict) };
}
