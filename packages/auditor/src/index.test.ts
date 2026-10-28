import { describe, expect, test } from 'bun:test';
import { type AuditVerdict, PACKAGE as CORE_PACKAGE, newId } from '@starling/core';
import { makeGoal } from '@starling/core/testing';
import {
  AUDITOR_SYSTEM_PROMPT,
  CHECK_LABELS,
  canonicalLanePath,
  chooseAuditorModel,
  createAuditor,
  DEFAULT_ALLOWED_COMMANDS,
  DEFAULT_AUDITOR_PROFILE,
  DEFAULT_COMMAND_POLICY,
  evaluateCommand,
  explainVerdict,
  formatVerdictExplanation,
  missingTestsSignal,
  PACKAGE,
  parseAuditorProfile,
  scrubbedEnv,
} from './index.ts';

describe('@starling/auditor exports', () => {
  test('exports its package name', () => {
    expect(PACKAGE).toBe('@starling/auditor');
  });

  test('exports a working Auditor factory and the reviewer prompt', () => {
    const auditor = createAuditor();
    expect(typeof auditor.audit).toBe('function');
    expect(AUDITOR_SYSTEM_PROMPT).toContain('New behaviour requires tests');
    expect(AUDITOR_SYSTEM_PROMPT.length).toBeGreaterThan(1_000);
  });

  test('exports the Epic 44 model choice and missing-tests guard for future epics', () => {
    expect(typeof chooseAuditorModel).toBe('function');
    expect(typeof missingTestsSignal).toBe('function');
    expect(parseAuditorProfile(undefined)).toBe(DEFAULT_AUDITOR_PROFILE);
  });

  test('imports @starling/core and @starling/core/testing', () => {
    expect(CORE_PACKAGE).toBe('@starling/core');
    expect(newId()).toHaveLength(26);
    expect(makeGoal().text.length).toBeGreaterThan(0);
  });

  test('exports the Epic 103 lane, policy and explanation surface', () => {
    expect(canonicalLanePath('src/../x').problem).toBe('traversal');
    expect(DEFAULT_COMMAND_POLICY).toEqual({ mode: 'any', scrubEnv: true });
    expect(evaluateCommand('bun test', { mode: 'allowlist' }).allowed).toBe(true);
    expect(DEFAULT_ALLOWED_COMMANDS).toContain('bun test');
    expect(scrubbedEnv({ GITHUB_TOKEN: 'x' })).toEqual({ CI: '1', GITHUB_TOKEN: '' });
    expect(CHECK_LABELS.lane).toBe('Lane');

    const verdict: AuditVerdict = {
      taskKey: 't01',
      attempt: 1,
      pass: true,
      checks: [{ name: 'lane', ok: true, detail: 'clean' }],
      laneViolations: [],
      summary: 'ok',
      model: { provider: 'starling', model: 'deterministic' },
      ts: 1,
    };
    expect(explainVerdict(verdict).level).toBe('pass');
    expect(formatVerdictExplanation(explainVerdict(verdict))).toContain('✔ Passed');
  });
});
