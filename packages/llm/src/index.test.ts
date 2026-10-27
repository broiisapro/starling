import { describe, expect, test } from 'bun:test';
import { PACKAGE as CORE_PACKAGE, newId } from '@starling/core';
import { makeGoal } from '@starling/core/testing';
import * as llm from './index.ts';
import { PACKAGE } from './index.ts';

describe('@starling/llm public surface', () => {
  test('exports its package name', () => {
    expect(PACKAGE).toBe('@starling/llm');
  });

  test('imports @starling/core and @starling/core/testing', () => {
    expect(CORE_PACKAGE).toBe('@starling/core');
    expect(newId()).toHaveLength(26);
    expect(makeGoal().text.length).toBeGreaterThan(0);
  });

  test('exports the router entry points and profile helpers', () => {
    expect(typeof llm.createLLM).toBe('function');
    expect(typeof llm.createLLMFromEnv).toBe('function');
    expect(typeof llm.applyProfile).toBe('function');
    expect(typeof llm.createOpencodeCompletionClient).toBe('function');
    expect(llm.LLM_BAD_JSON).toBe('LLM_BAD_JSON');
    expect(llm.LLM_PROFILES).toEqual(['opencode', 'deepseek', 'local']);
  });
});
