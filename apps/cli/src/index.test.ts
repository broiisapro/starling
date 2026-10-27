import { describe, expect, test } from 'bun:test';
import { PACKAGE as CORE_PACKAGE } from '@starling/core';
import { makeGoal } from '@starling/core/testing';
import {
  analyzePlan,
  compose,
  createCliContext,
  createProgram,
  detectModelProfile,
  LiveView,
  PACKAGE,
  readEventsJsonl,
  renderFlock,
  renderLive,
  renderPlan,
  renderStatus,
  runDoctor,
} from './index';

describe('@starling/cli public surface', () => {
  test('exports its package name and imports core', () => {
    expect(PACKAGE).toBe('@starling/cli');
    expect(CORE_PACKAGE).toBe('@starling/core');
    expect(makeGoal().text.length).toBeGreaterThan(0);
  });

  test('exports the composition root, renderers and command framework', () => {
    for (const value of [
      compose,
      createProgram,
      createCliContext,
      renderPlan,
      renderLive,
      renderStatus,
      renderFlock,
      LiveView,
      analyzePlan,
      runDoctor,
      detectModelProfile,
      readEventsJsonl,
    ]) {
      expect(typeof value).toBe('function');
    }
  });
});
