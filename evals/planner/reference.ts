import { type Goal, type Plan, StarlingError, type TaskSpec } from '../lib/core';
import { makePlan, makeTaskSpec } from '../lib/core-testing';

interface Seed {
  key: string;
  title: string;
  goal: string;
  owns: string[];
  reads?: string[];
  dependsOn?: string[];
  deliverables: string[];
  definitionOfDone?: string[];
}

const TEST_STEP = 'Colocated tests cover the new behaviour and `bun test` is green';

/**
 * Reference decompositions ("answer keys") for every planner case.
 *
 * These are deliberately written by hand, separate from the case JSON: if a case and its reference
 * drift apart, `run.ts planner --impl mock` drops below 0.95 and the harness catches itself. The
 * mock run is therefore a self-test of the eval, not evidence about the real planner (that is Wave
 * 2 / Epic 48).
 */
const REFERENCE_TASKS: Record<string, Seed[]> = {
  'sky-todo-launch-day': [
    {
      key: 'theme',
      title: 'Dark mode with a persisted toggle',
      goal: 'Add a dark theme and a header toggle that remembers the choice across reloads.',
      owns: ['src/features/theme/**'],
      reads: ['src/ui/slots.ts', 'src/main.ts'],
      deliverables: [
        'src/features/theme/index.ts registers a header-right toggle',
        'data-theme on documentElement switches the palette',
      ],
    },
    {
      key: 'search',
      title: 'Live search filtering',
      goal: 'Filter the visible todo list as the user types, using the existing filter API.',
      owns: ['src/features/search/**'],
      reads: ['src/ui/filters.ts', 'src/ui/slots.ts'],
      deliverables: ['toolbar search input', 'clearing the field restores every row'],
    },
    {
      key: 'csv-export',
      title: 'CSV export with RFC 4180 quoting',
      goal: 'Add a toolbar button that downloads the todo list as CSV.',
      owns: ['src/features/export/**'],
      reads: ['src/store/todos.ts', 'src/ui/slots.ts', 'src/lib/dates.ts'],
      deliverables: ['Export CSV toolbar button', 'Fields containing a comma, quote or newline are quoted'],
    },
    {
      key: 'shortcuts',
      title: 'Keyboard shortcuts for new, search and help',
      goal: 'Bind n, / and ? on document and dispatch the matching commands.',
      owns: ['src/features/shortcuts/**'],
      reads: ['src/lib/commands.ts'],
      deliverables: [
        'One keydown listener that ignores typing targets',
        'n runs todo:new, / runs search:focus, ? runs help:open',
      ],
    },
    {
      key: 'help-overlay',
      title: 'Help sheet listing the keyboard shortcuts',
      goal: 'Add a help dialog that lists n, / and ? and closes on Escape.',
      owns: ['src/features/help/**'],
      reads: ['src/lib/commands.ts', 'src/ui/slots.ts'],
      dependsOn: ['shortcuts'],
      deliverables: [
        'overlay slot item rendering a dialog',
        'Escape, the close button and a backdrop click all close it',
      ],
    },
    {
      key: 'dates-fix',
      title: 'Fix overdue check and due-date sorting',
      goal: 'isOverdue must compare local calendar days; sortByDue must keep undated todos after dated ones.',
      owns: ['src/lib/dates.ts', 'src/lib/dates.test.ts'],
      deliverables: [
        'isOverdue compares calendar days in local time',
        'sortByDue sorts chronologically and leaves undated todos last',
      ],
    },
    {
      key: 'due-badges',
      title: 'Due-date badges on todo rows',
      goal: 'Render a due-date badge per row using the fixed date helpers.',
      owns: ['src/features/due-dates/**'],
      reads: ['src/lib/dates.ts', 'src/ui/slots.ts'],
      dependsOn: ['dates-fix'],
      deliverables: ['item-badges slot item', 'overdue badges carry an is-overdue class'],
    },
  ],
  'sky-todo-launch-day-xl': [
    {
      key: 'theme',
      title: 'Dark mode with a persisted toggle',
      goal: 'Add a dark theme and a header toggle that remembers the choice across reloads.',
      owns: ['src/features/theme/**'],
      deliverables: ['header-right toggle', 'persisted data-theme choice'],
    },
    {
      key: 'search',
      title: 'Live search filtering',
      goal: 'Filter the visible todo list as the user types.',
      owns: ['src/features/search/**'],
      deliverables: ['toolbar search input', 'clearing restores every row'],
    },
    {
      key: 'csv-export',
      title: 'CSV export with RFC 4180 quoting',
      goal: 'Add a toolbar button that downloads the todo list as CSV.',
      owns: ['src/features/export/**'],
      deliverables: ['Export CSV toolbar button', 'RFC 4180 quoting'],
    },
    {
      key: 'shortcuts',
      title: 'Keyboard shortcuts for new, search and help',
      goal: 'Bind n, / and ? on document and dispatch the matching commands.',
      owns: ['src/features/shortcuts/**'],
      deliverables: ['one keydown listener', 'n, / and ? mapped to commands'],
    },
    {
      key: 'help-overlay',
      title: 'Help sheet listing the keyboard shortcuts',
      goal: 'Add a help dialog listing the shortcuts and closing on Escape.',
      owns: ['src/features/help/**'],
      dependsOn: ['shortcuts'],
      deliverables: ['overlay dialog', 'Escape and backdrop close it'],
    },
    {
      key: 'dates-fix',
      title: 'Fix overdue check and due-date sorting',
      goal: 'Compare local calendar days and sort undated todos last.',
      owns: ['src/lib/dates.ts', 'src/lib/dates.test.ts'],
      deliverables: ['local-day isOverdue', 'stable sortByDue'],
    },
    {
      key: 'due-badges',
      title: 'Due-date badges on todo rows',
      goal: 'Render a due-date badge per row using the fixed helpers.',
      owns: ['src/features/due-dates/**'],
      dependsOn: ['dates-fix'],
      deliverables: ['item-badges item', 'is-overdue class'],
    },
    {
      key: 'undo',
      title: 'Undo and redo the todo list',
      goal: 'Keep a bounded history of store snapshots and expose undo/redo commands.',
      owns: ['src/features/undo/**'],
      reads: ['src/store/todos.ts', 'src/lib/commands.ts'],
      deliverables: ['toolbar undo and redo buttons', 'bounded 50-snapshot history'],
    },
    {
      key: 'stats',
      title: 'Completion stats in the footer',
      goal: 'Show done / total and a percentage in the footer.',
      owns: ['src/features/stats/**'],
      reads: ['src/store/todos.ts', 'src/ui/slots.ts', 'src/lib/dates.ts'],
      deliverables: ['footer slot item with done / total and a percentage', 'empty state reads 0% complete'],
    },
    {
      key: 'tags',
      title: 'Tag chips and tag filtering',
      goal: 'Render tag chips and filter the list by the selected tags.',
      owns: ['src/features/tags/**'],
      reads: ['src/ui/filters.ts', 'src/ui/slots.ts', 'src/store/todos.ts'],
      deliverables: ['toolbar chip row of the tags in use', 'selecting chips ANDs the filter'],
    },
  ],
  'sky-todo-quick-wins': [
    {
      key: 'title-count',
      title: 'Open-task count in the browser tab title',
      goal: 'Keep document.title in sync with the number of open todos.',
      owns: ['src/features/title-count/**'],
      reads: ['src/store/todos.ts'],
      deliverables: ['store subscription', 'document.title reads Sky Todo (N open)'],
    },
    {
      key: 'today',
      title: "Today's date in the header",
      goal: 'Render the current date in the header-right slot.',
      owns: ['src/features/today/**'],
      reads: ['src/lib/dates.ts', 'src/ui/slots.ts'],
      deliverables: ['header-right slot item', 'title attribute holds the full ISO date'],
    },
    {
      key: 'tag-count',
      title: 'Distinct tag count in the footer',
      goal: 'Show how many distinct tags are in use in the footer.',
      owns: ['src/features/tag-count/**'],
      reads: ['src/store/todos.ts', 'src/ui/slots.ts'],
      deliverables: ['footer slot item', 'correct singular and plural wording'],
    },
  ],
  'sky-todo-will-fail-audit': [
    {
      key: 'csv-export',
      title: 'CSV export with quoting tests',
      goal: 'Add CSV export with tests for commas, quotes and newlines.',
      owns: ['src/features/export/**'],
      reads: ['src/store/todos.ts', 'src/ui/slots.ts'],
      deliverables: [
        'Export CSV toolbar button',
        'RFC 4180 quoting with CRLF rows',
        'Tests for commas, embedded quotes, newlines and the header row',
      ],
    },
  ],
  'sky-todo-conflict-bait': [
    {
      key: 'date-sort',
      title: 'Sort-by-due toggle in the footer',
      goal: 'Toggle the footer list between insertion order and sortByDue.',
      owns: ['src/ui/render.ts', 'src/ui/styles.css'],
      reads: ['src/lib/dates.ts'],
      deliverables: ['footer button with aria-pressed', 'uses the existing sortByDue helper'],
    },
    {
      key: 'delete-all',
      title: 'Delete-all button in the footer',
      goal: 'Clear the store from a confirmed footer action.',
      owns: ['src/ui/render.ts', 'src/ui/styles.css'],
      reads: ['src/store/todos.ts'],
      deliverables: ['Delete all button with a confirm step', 'disabled when the list is empty'],
    },
  ],
  'express-notes-auth-search': [
    {
      key: 'auth',
      title: 'Bearer-token auth middleware',
      goal: 'Reject note requests without a valid bearer token.',
      owns: ['src/middleware/auth.ts'],
      reads: ['src/app.ts', 'src/routes/notes.ts'],
      deliverables: [
        'requireToken rejects a missing or invalid bearer token',
        'valid tokens continue to the notes routes',
      ],
    },
    {
      key: 'notes-search',
      title: 'Full-text search over notes',
      goal: 'Filter notes by a q query parameter over title and body.',
      owns: ['src/routes/notes.ts', 'test/notes.test.ts'],
      reads: ['src/store/notes.ts', 'src/middleware/auth.ts'],
      dependsOn: ['auth'],
      deliverables: [
        'q filters titles and bodies case-insensitively',
        'tests cover an empty query and a match',
      ],
    },
  ],
  'express-notes-pagination-rate-limit': [
    {
      key: 'notes-pagination',
      title: 'Paginated GET /notes responses',
      goal: 'Return one page of notes with a limit and an opaque cursor.',
      owns: ['src/routes/notes.ts', 'test/notes.test.ts'],
      reads: ['src/store/notes.ts'],
      deliverables: ['limit and cursor query parameters', 'nextCursor in the response envelope'],
    },
    {
      key: 'rate-limit',
      title: 'Rate-limiting middleware for the API',
      goal: 'Throttle requests per IP with a fixed window.',
      owns: ['src/middleware/rate-limit.ts', 'test/rate-limit.test.ts'],
      reads: ['src/app.ts'],
      deliverables: ['fixed-window per-IP limiter', '429 with a Retry-After header when exceeded'],
    },
  ],
  'python-cli-json-config': [
    {
      key: 'json-output',
      title: 'JSON output mode for the list command',
      goal: 'Add --json to the list command while keeping the plain-text default.',
      owns: ['src/todo_cli/commands/list.py', 'src/todo_cli/output/**'],
      reads: ['src/todo_cli/store.py'],
      deliverables: ['--json prints an array of objects', 'plain text stays the default'],
    },
    {
      key: 'config',
      title: 'Load defaults from a TOML config file',
      goal: 'Read defaults from ~/.config/todo/config.toml and apply them in the CLI.',
      owns: ['src/todo_cli/config.py', 'src/todo_cli/cli.py'],
      reads: ['pyproject.toml'],
      deliverables: ['config.py parses the TOML file', 'cli.py applies configured defaults'],
    },
  ],
};

/** Build the reference plan for a case. `goal` supplies the goal id so scoring sees a real Plan. */
export function referencePlan(caseName: string, goal: Goal): Plan {
  const seeds = REFERENCE_TASKS[caseName];
  if (seeds === undefined) {
    throw new StarlingError('INVALID_ARGUMENT', `No reference plan for planner case "${caseName}"`);
  }
  return makePlan({
    goalId: goal.id,
    summary: `Reference decomposition for ${caseName}.`,
    tasks: seeds.map(toTask),
    lockedDecisions: [
      'Vanilla TypeScript + Vite in sky-todo; features are discovered by a glob, never a shared registry.',
      'Slots, commands and filters are read-only contracts shared by every feature.',
    ],
  });
}

/** Case names that have a hand-written reference plan. */
export function referenceCaseNames(): string[] {
  return Object.keys(REFERENCE_TASKS).sort();
}

function toTask(seed: Seed): TaskSpec {
  return makeTaskSpec({
    key: seed.key,
    title: seed.title,
    goal: seed.goal,
    deliverables: seed.deliverables,
    outOfScope: ['Changing behaviour outside the lane'],
    definitionOfDone: seed.definitionOfDone ?? [TEST_STEP, 'The stated deliverable works end to end'],
    dependsOn: seed.dependsOn ?? [],
    lane: { owns: seed.owns, reads: seed.reads ?? ['src/main.ts'] },
    estimateMin: 15,
  });
}
