import { describe, expect, test } from 'bun:test';
import { PACKAGE as CORE_PACKAGE } from '@starling/core';
import { createGitHubTracker, isGitHubError, PACKAGE, renderFinalPRBody } from './index.ts';

describe('@starling/github', () => {
  test('exports its package name and public surface', () => {
    expect(PACKAGE).toBe('@starling/github');
    expect(CORE_PACKAGE).toBe('@starling/core');
    expect(typeof createGitHubTracker).toBe('function');
    expect(typeof isGitHubError).toBe('function');
    expect(typeof renderFinalPRBody).toBe('function');
  });
});
