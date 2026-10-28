import { describe, expect, test } from 'bun:test';
import { isStarlingError } from '@starling/core';
import {
  applySectionBudgets,
  capSections,
  createPromptCompiler,
  DEFAULT_MAX_CHARS,
  DEFAULT_SECTION_BUDGETS,
  estimateTokens,
  fitSections,
  fixerSections,
  resolveOptions,
  type SectionId,
  type SectionInput,
  trimMarker,
} from './index.ts';
import { skyTodoContext, themeFailureVerdict } from './testing/context.ts';

const SECTION_IDS: SectionId[] = [
  'role',
  'project',
  'task',
  'lane',
  'siblings',
  'orientation',
  'verification',
  'git',
  'finish',
  'fix-detail',
];

function sections(): SectionInput[] {
  return [
    { id: 'role', text: 'role section', priority: 100 },
    { id: 'project', text: 'project section', priority: 90 },
    { id: 'task', text: 'task section', priority: 0 },
    { id: 'lane', text: 'lane section', priority: 0 },
    { id: 'siblings', text: 'siblings section', priority: 40 },
    { id: 'orientation', text: 'orientation section', priority: 30 },
    { id: 'verification', text: 'verification section', priority: 80 },
    { id: 'git', text: 'git section', priority: 70 },
    { id: 'finish', text: 'finish section', priority: 0 },
  ];
}

describe('DEFAULT_SECTION_BUDGETS', () => {
  test('covers every section with a positive token ceiling', () => {
    for (const id of SECTION_IDS) {
      expect(DEFAULT_SECTION_BUDGETS[id]).toBeGreaterThan(0);
      expect(Number.isFinite(DEFAULT_SECTION_BUDGETS[id])).toBe(true);
    }
    expect(Object.keys(DEFAULT_SECTION_BUDGETS).sort()).toEqual([...SECTION_IDS].sort());
  });

  test('the marker is exact and greppable', () => {
    expect(trimMarker(1234)).toBe('[… 1234 chars trimmed to fit the prompt budget]');
  });
});

describe('capSections', () => {
  test('leaves ordinary sections untouched and reports their size', () => {
    const result = capSections(sections());
    expect(result.text).toContain('task section');
    expect(result.report).toHaveLength(sections().length);
    for (const entry of result.report) expect(entry.truncated).toBe(false);
    expect(result.report.map((entry) => entry.id)).toEqual(sections().map((entry) => entry.id));
  });

  test('truncates an oversized section at its ceiling and marks the cut', () => {
    const huge = 'x'.repeat(40_000);
    const result = capSections([
      { id: 'task', text: 'task', priority: 0 },
      { id: 'orientation', text: huge, priority: 30 },
    ]);
    const orientation = result.report.find((entry) => entry.id === 'orientation');
    expect(orientation?.truncated).toBe(true);
    expect(orientation?.tokens).toBeLessThanOrEqual(DEFAULT_SECTION_BUDGETS.orientation);
    expect(result.text).toContain('chars trimmed to fit the prompt budget');
    expect(result.text).not.toContain(huge);
  });

  test('never truncates the task, lane or finish line', () => {
    const tiny = 'y'.repeat(20_000);
    const result = capSections(
      [
        { id: 'task', text: tiny, priority: 0 },
        { id: 'lane', text: tiny, priority: 0 },
        { id: 'finish', text: tiny, priority: 0 },
      ],
      { ...DEFAULT_SECTION_BUDGETS, task: 1, lane: 1, finish: 1 },
    );
    for (const entry of result.report) expect(entry.truncated).toBe(false);
    expect(result.text).toContain(tiny);
  });

  test('honours `required` for any section', () => {
    const result = capSections([{ id: 'role', text: 'z'.repeat(10_000), priority: 1, required: true }], {
      ...DEFAULT_SECTION_BUDGETS,
      role: 1,
    });
    expect(result.report[0]?.truncated).toBe(false);
    expect(result.text).toContain('z'.repeat(10_000));
  });

  test('joins sections in their original order with blank lines', () => {
    const result = capSections([
      { id: 'role', text: 'one', priority: 1 },
      { id: 'task', text: 'two', priority: 0 },
    ]);
    expect(result.text).toBe('one\n\ntwo');
  });

  test('is deterministic', () => {
    const input = sections();
    expect(capSections(input)).toEqual(capSections(input));
  });
});

describe('fitSections', () => {
  test('returns the input unchanged when it already fits', () => {
    const input = sections();
    const result = fitSections(input, 1_000);
    expect(result.text).toBe(capSections(input).text);
    for (const entry of result.report) expect(entry.truncated).toBe(false);
  });

  test('trims the lowest priority first, leaving higher priorities alone', () => {
    const role = 'r'.repeat(4_000);
    const orientation = 'o'.repeat(8_000);
    const siblings = 's'.repeat(2_000);
    const input: SectionInput[] = [
      { id: 'role', text: role, priority: 100 },
      { id: 'task', text: 'task spec', priority: 0 },
      { id: 'siblings', text: siblings, priority: 40 },
      { id: 'orientation', text: orientation, priority: 30 },
    ];
    const before = estimateTokens(capSections(input).text);
    const budget = Math.floor(before * 0.6);
    const result = fitSections(input, budget);
    const byId = Object.fromEntries(result.report.map((entry) => [entry.id, entry]));
    expect(byId.orientation?.truncated).toBe(true);
    expect(result.text).toContain('chars trimmed to fit the prompt budget');
    // 60% of ~3.5k tokens is still enough for role + task + the truncated orientation.
    expect(byId.siblings?.truncated).toBe(false);
    expect(byId.task?.truncated).toBe(false);
  });

  test('empties optional sections before crossing a protected one', () => {
    const input: SectionInput[] = [
      { id: 'orientation', text: 'o'.repeat(4_000), priority: 30 },
      { id: 'siblings', text: 's'.repeat(4_000), priority: 40 },
      { id: 'task', text: 'the task spec', priority: 0 },
    ];
    const result = fitSections(input, 5);
    expect(result.text).toContain('the task spec');
    expect(result.report.filter((entry) => entry.id !== 'task').every((entry) => entry.tokens === 0)).toBe(
      true,
    );
  });

  test('reports can stay over budget when protected sections alone exceed it', () => {
    const input: SectionInput[] = [{ id: 'task', text: 't'.repeat(4_000), priority: 0 }];
    const result = fitSections(input, 10);
    expect(result.text).toContain('t'.repeat(4_000));
    expect(result.report[0]?.tokens).toBeGreaterThan(10);
  });

  test('respects the requested total when it can', () => {
    const result = fitSections(
      [
        { id: 'role', text: 'r'.repeat(4_000), priority: 100 },
        { id: 'orientation', text: 'o'.repeat(40_000), priority: 30 },
        { id: 'task', text: 'task', priority: 0 },
      ],
      1_000,
    );
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(1_000);
  });

  test('rejects a non-positive or non-finite budget', () => {
    for (const totalTokens of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      try {
        fitSections(sections(), totalTokens);
        throw new Error(`expected totalTokens=${totalTokens} to be rejected`);
      } catch (error) {
        expect(isStarlingError(error, 'INVALID_ARGUMENT')).toBe(true);
      }
    }
  });

  test('is deterministic', () => {
    const input = sections();
    expect(fitSections(input, 10)).toEqual(fitSections(input, 10));
  });
});

describe('budgets on a real fixer prompt', () => {
  const ctx = skyTodoContext('theme');
  const hugeVerdict = {
    ...themeFailureVerdict(),
    checks: Array.from({ length: 100 }, (_, index) => ({
      name: `check-${index}`,
      ok: false,
      detail: `failing check ${index}: ${'log line '.repeat(20)}`,
    })),
    fixInstructions: 'Fix it. '.repeat(4_000),
  };
  const options = resolveOptions();
  const promptSections = fixerSections(ctx, hugeVerdict, options);

  test('the giant fix detail is capped even without an overall budget', () => {
    const capped = capSections(promptSections);
    const fixDetail = capped.report.find((entry) => entry.id === 'fix-detail');
    expect(fixDetail?.truncated).toBe(true);
    expect(fixDetail?.tokens).toBeLessThanOrEqual(DEFAULT_SECTION_BUDGETS['fix-detail']);
    expect(capped.text).toContain('chars trimmed to fit the prompt budget');
    // The task spec and handback survive untouched.
    expect(capped.text).toContain(hugeVerdict.checks[0]?.name ?? 'check-0');
    expect(capped.text).toContain('<<<STARLING_HANDBACK');
  });

  test('a 3x over-budget fixer trims fix-detail first and keeps the task intact', () => {
    const full = estimateTokens(fitSections(promptSections, 1_000_000).text);
    const budget = Math.floor(full / 3);
    const result = fitSections(promptSections, budget);
    const byId = Object.fromEntries(result.report.map((entry) => [entry.id, entry]));
    expect(byId['fix-detail']?.truncated).toBe(true);
    expect(byId.task?.truncated).toBe(false);
    expect(byId.lane?.truncated).toBe(false);
    expect(byId.finish?.truncated).toBe(false);
    for (const item of ctx.task.definitionOfDone) expect(result.text).toContain(item);
    for (const glob of ctx.task.lane.owns) expect(result.text).toContain(glob);
    expect(result.text).toContain('<<<STARLING_HANDBACK');
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(budget);
  });

  test('the compiled fixer stays under DEFAULT_MAX_CHARS with 100 failed checks', () => {
    const compiled = createPromptCompiler().fixer(ctx, hugeVerdict);
    expect(compiled.length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS);
  });
});

describe('PromptCompilerOptions.budgetTokens', () => {
  test('is absent from resolved options unless asked for', () => {
    expect('budgetTokens' in resolveOptions()).toBe(false);
    expect(resolveOptions({ budgetTokens: 1234 }).budgetTokens).toBe(1234);
  });

  test('rejects non-positive budgets eagerly', () => {
    for (const budgetTokens of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      try {
        createPromptCompiler({ budgetTokens });
        throw new Error(`expected budgetTokens=${budgetTokens} to be rejected`);
      } catch (error) {
        expect(isStarlingError(error, 'INVALID_ARGUMENT')).toBe(true);
      }
    }
  });

  test('a generous budget is byte-identical to no budget', () => {
    const ctx = skyTodoContext('csv-export');
    expect(createPromptCompiler({ budgetTokens: 6_000 }).worker(ctx)).toBe(
      createPromptCompiler().worker(ctx),
    );
  });

  test('trims sections but never the task or lane facts', () => {
    const ctx = skyTodoContext('csv-export');
    const generous = createPromptCompiler().worker(ctx);
    const tight = createPromptCompiler({ budgetTokens: 1_200 }).worker(ctx);
    expect(tight.length).toBeLessThanOrEqual(generous.length);
    for (const item of ctx.task.definitionOfDone) expect(tight).toContain(item);
    for (const glob of ctx.task.lane.owns) expect(tight).toContain(glob);
    expect(tight).toContain('<<<STARLING_HANDBACK');
  });

  test('applySectionBudgets only caps when no total is given', () => {
    const input = sections();
    expect(applySectionBudgets(input).text).toBe(capSections(input).text);
    expect(applySectionBudgets(input, 100).text.length).toBeLessThanOrEqual(capSections(input).text.length);
  });
});
