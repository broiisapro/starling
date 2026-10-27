import { describe, expect, test } from 'bun:test';
import { PACKAGE as CORE_PACKAGE, newId } from '@starling/core';
import { makeGoal } from '@starling/core/testing';
import {
  AUDITOR_SYSTEM_PROMPT,
  chooseAuditorModel,
  createAuditor,
  DEFAULT_AUDITOR_PROFILE,
  missingTestsSignal,
  PACKAGE,
  parseAuditorProfile,
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
});
