/** Shared, deterministic props for the agent drawer tests. Test-only: not exported from the lane. */
import type { AgentEvent, AuditVerdict, DiffSummary, TaskSpec } from '@starling/core';
import { BASE_TS, makeAgentEvent, makeAuditVerdict, makeTaskSpec } from '@starling/core/testing';
import type { AuditCheckWithDuration } from './audit';

export const SESSION = 'ses_theme_hub_1';

export const sampleTask: TaskSpec = makeTaskSpec({
  key: 'theme',
  title: 'Dark mode with a toggle',
  goal: 'Add a dark theme and a toggle in the header that remembers the choice across reloads.',
  deliverables: ['src/features/theme/index.ts exports initTheme()', 'The toggle lives in the header'],
  outOfScope: ['Changing the default light theme'],
  definitionOfDone: ['bun test passes', 'The theme survives a reload'],
  dependsOn: [],
  lane: { owns: ['src/features/theme/**', 'src/ui/styles.css'], reads: ['src/main.ts'] },
});

export function sampleEvents(): AgentEvent[] {
  return [
    makeAgentEvent({
      ts: BASE_TS + 0,
      kind: 'session.started',
      sessionId: SESSION,
      data: { nodeId: 'hub', model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' } },
    }),
    makeAgentEvent({
      ts: BASE_TS + 1_000,
      kind: 'text',
      sessionId: SESSION,
      data: { text: 'Reading `src/lib/dates.ts` first.' },
    }),
    makeAgentEvent({
      ts: BASE_TS + 2_000,
      kind: 'tool.call',
      sessionId: SESSION,
      data: { tool: 'read', path: 'src/lib/dates.ts' },
    }),
    makeAgentEvent({
      ts: BASE_TS + 3_000,
      kind: 'tool.result',
      sessionId: SESSION,
      data: { ok: true, bytes: 1_180 },
    }),
    makeAgentEvent({
      ts: BASE_TS + 4_000,
      kind: 'file.edited',
      sessionId: SESSION,
      data: { path: 'src/features/theme/index.ts', added: 34, removed: 18 },
    }),
    makeAgentEvent({
      ts: BASE_TS + 5_000,
      kind: 'usage',
      sessionId: SESSION,
      data: {
        input: 12_400,
        output: 1_800,
        cached: 3_200,
        local: false,
        model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
      },
    }),
    makeAgentEvent({ ts: BASE_TS + 6_000, kind: 'session.idle', sessionId: SESSION, data: {} }),
  ];
}

export function failingVerdict(): AuditVerdict {
  const checks: AuditCheckWithDuration[] = [
    { name: 'tests', ok: false, detail: 'bun test: 1 failing test in src/features/theme', durationMs: 1_200 },
    { name: 'lane', ok: true, detail: 'No files outside the lane were touched' },
    { name: 'definition-of-done', ok: false, detail: 'Missing: toggle persists across reloads' },
  ];
  return makeAuditVerdict({
    taskKey: 'theme',
    attempt: 1,
    pass: false,
    ts: BASE_TS + 7_000,
    summary: 'The toggle works, but nothing proves the choice survives a reload.',
    checks,
    laneViolations: ['src/main.ts', 'index.html'],
    fixInstructions:
      'Add a test that mounts initTheme() twice with a stubbed localStorage and asserts the second mount reads data-theme="dark". Keep the change inside src/features/theme/**.',
  });
}

export function passingVerdict(): AuditVerdict {
  return makeAuditVerdict({
    taskKey: 'theme',
    attempt: 2,
    pass: true,
    ts: BASE_TS + 9_000,
    summary: 'Reload persistence is now covered by a test.',
    checks: [
      { name: 'tests', ok: true, detail: 'bun test: 14 pass, 0 fail' },
      { name: 'lane', ok: true, detail: 'No files outside the lane were touched' },
      { name: 'definition-of-done', ok: true, detail: 'Every DoD item is satisfied' },
    ],
    laneViolations: [],
  });
}

export const sampleDiff: DiffSummary = {
  files: [
    { path: 'src/lib/dates.ts', added: 2, removed: 1 },
    { path: 'src/features/theme/index.ts', added: 34, removed: 6 },
  ],
  patch: [
    'diff --git a/src/lib/dates.ts b/src/lib/dates.ts',
    '--- a/src/lib/dates.ts',
    '+++ b/src/lib/dates.ts',
    '@@ -1,3 +1,4 @@',
    ' const keep = 1;',
    '-const old = 2;',
    '+const next = 2;',
    '+const added = 3;',
    'diff --git a/src/features/theme/index.ts b/src/features/theme/index.ts',
    '--- a/src/features/theme/index.ts',
    '+++ b/src/features/theme/index.ts',
    '@@ -1 +1 @@',
    '-export const theme = "light";',
    '+export const theme = "dark";',
  ].join('\n'),
  truncated: true,
};
