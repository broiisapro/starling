import { describe, expect, test } from 'bun:test';
import { makeGoal } from '@starling/core/testing';
import { renderRepoMap as renderRepomap } from '@starling/repomap';
import {
  buildPlanPrompt,
  buildRepairMessages,
  buildRepairRequest,
  DEFAULT_MAP_RENDERER,
  PLANNER_SYSTEM_PROMPT,
  renderMapFor,
} from './prompt';
import { loadDraftFixture, loadRepoMapFixture } from './test-fixtures';

const map = loadRepoMapFixture();
const goal = makeGoal({
  id: 'goal-launch-day',
  text: 'Ship the launch-day polish for sky-todo: dark mode, search, CSV export, shortcuts, help, and the two date bugs.',
  repoPath: 'examples/sky-todo',
  baseBranch: 'main',
  constraints: ['No new runtime dependencies', 'Keep the bundle under 80 kB'],
});

describe('PLANNER_SYSTEM_PROMPT', () => {
  test('encodes the planning doctrine', () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain('one task for every capability');
    expect(PLANNER_SYSTEM_PROMPT).toContain('Never split a capability by layer');
    expect(PLANNER_SYSTEM_PROMPT).toContain('Never create a task for wiring');
    expect(PLANNER_SYSTEM_PROMPT).toContain('25 minutes');
    expect(PLANNER_SYSTEM_PROMPT).toContain('disjoint owns globs');
    expect(PLANNER_SYSTEM_PROMPT).toContain('Shared files are read-only');
    expect(PLANNER_SYSTEM_PROMPT).toContain('A producer must come before its consumers');
    expect(PLANNER_SYSTEM_PROMPT).toContain('definitionOfDone');
    expect(PLANNER_SYSTEM_PROMPT).toContain('outOfScope');
    expect(PLANNER_SYSTEM_PROMPT).toContain('lockedDecisions');
    expect(PLANNER_SYSTEM_PROMPT).toContain('No prose, no markdown fences');
  });
});

describe('buildPlanPrompt', () => {
  test('renders the goal, constraints, test command and repo map', () => {
    const prompt = buildPlanPrompt(goal, map);
    expect(prompt.system).toBe(PLANNER_SYSTEM_PROMPT);
    expect(prompt.user).toContain('Ship the launch-day polish');
    expect(prompt.user).toContain('- No new runtime dependencies');
    expect(prompt.user).toContain('Test command: bun test');
    expect(prompt.user).toContain('between 1 and 12 tasks');
    expect(prompt.user).toContain('Repo root: examples/sky-todo');
    expect(prompt.user).toContain('# Repo map: examples/sky-todo');
    expect(prompt.user).toContain('src/features/theme/index.ts');
  });

  test('defaults to the repomap renderer and can fall back to the verbose one', () => {
    const compact = renderMapFor(map);
    const verbose = renderMapFor(map, 'verbose');
    expect(DEFAULT_MAP_RENDERER).toBe('repomap');
    expect(compact).toBe(renderMapFor(map, 'repomap'));
    expect(compact).toContain('# Repo map: examples/sky-todo');
    expect(compact).not.toContain('Files (path (bytes');
    expect(verbose).toContain('Files (path (bytes');
    // The budgeted renderer must at least not be the bigger of the two on a real map.
    expect(compact.length).toBeLessThan(verbose.length);
    expect(buildPlanPrompt(goal, map, { mapRenderer: 'verbose' }).user).toContain(verbose);
  });

  test('snapshot: the full prompt is stable and reviewable', () => {
    const prompt = buildPlanPrompt(goal, map);
    expect(prompt.system).toMatchSnapshot();
    expect(prompt.user).toMatchSnapshot();
  });

  test('handles a goal with no constraints and a narrow task-count window', () => {
    const prompt = buildPlanPrompt({ ...goal, constraints: ['  ', ''] }, map, { minTasks: 3, maxTasks: 6 });
    expect(prompt.user).toContain('# Constraints\n- none');
    expect(prompt.user).toContain('between 3 and 6 tasks');
  });
});

describe('one renderer', () => {
  test('the default prompt embeds exactly @starling/repomap output', () => {
    const prompt = buildPlanPrompt(goal, map);
    const expected = renderRepomap(map, { maxTokens: 3000 });

    expect(prompt.user.endsWith(`# Repository map\n${expected}`)).toBe(true);
    expect(prompt.user).not.toContain('Files (path (bytes');
  });

  test('mapTokens is passed straight to the repomap renderer', () => {
    for (const maxTokens of [200, 800, 1500]) {
      const prompt = buildPlanPrompt(goal, map, { mapTokens: maxTokens });
      expect(prompt.user.endsWith(renderRepomap(map, { maxTokens }))).toBe(true);
    }
  });

  test('mapTokens is clamped to a floor of 200 tokens, as before', () => {
    const prompt = buildPlanPrompt(goal, map, { mapTokens: 10 });
    expect(prompt.user.endsWith(renderRepomap(map, { maxTokens: 200 }))).toBe(true);
  });

  test('the legacy renderer is reachable only by asking for it', () => {
    expect(DEFAULT_MAP_RENDERER).toBe('repomap');
    expect(buildPlanPrompt(goal, map).user).not.toContain('symbols: ');
    expect(buildPlanPrompt(goal, map, { mapRenderer: 'verbose' }).user).toContain('symbols: ');
  });
});

describe('repair turns', () => {
  const errors = [
    {
      severity: 'error' as const,
      code: 'lane-overlap' as const,
      message: 'tasks "alpha" and "beta" can run concurrently but their lanes overlap: src/ui/x <=> src/ui/x',
      taskKeys: ['alpha', 'beta'],
    },
    {
      severity: 'warn' as const,
      code: 'other' as const,
      message: 'a warning the model does not need to see',
      taskKeys: [],
    },
  ];

  test('lists only error-level issues, numbered, with their codes', () => {
    const text = buildRepairRequest(errors);
    expect(text).toContain('1. [lane-overlap]');
    expect(text).toContain('"alpha" and "beta"');
    expect(text).not.toContain('warning the model does not need to see');
    expect(text).toContain('return the COMPLETE corrected plan');
  });

  test('keeps the original request and the rejected draft in the transcript', () => {
    const prompt = buildPlanPrompt(goal, map);
    const messages = buildRepairMessages(prompt, loadDraftFixture(), errors);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[0]?.content).toBe(prompt.user);
    expect(messages[1]?.content).toContain('"summary"');
    expect(messages[2]?.content).toContain('[lane-overlap]');
  });
});
