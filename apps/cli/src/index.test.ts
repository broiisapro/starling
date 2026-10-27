import { describe, expect, test } from 'bun:test';
import { PACKAGE as CORE_PACKAGE } from '@starling/core';
import { makeGoal } from '@starling/core/testing';
import { createProgram, PACKAGE } from './index';

describe('@starling/cli skeleton', () => {
  test('exports its package name and imports core', () => {
    expect(PACKAGE).toBe('@starling/cli');
    expect(CORE_PACKAGE).toBe('@starling/core');
    expect(makeGoal().text.length).toBeGreaterThan(0);
  });

  test('registers every locked CLI command', () => {
    const program = createProgram();
    expect(program.commands.map((c) => c.name())).toEqual([
      'plan',
      'run',
      'replay',
      'dash',
      'perch',
      'flock',
      'status',
      'doctor',
      'init',
    ]);
  });

  test('help mentions the flock pitch', () => {
    const help = createProgram().helpInformation();
    expect(help).toContain('starling');
    expect(help).toContain('murmuration');
    expect(help).toContain('--version');
  });

  test('stubs accept their documented arguments and options', () => {
    const program = createProgram();
    const run = program.commands.find((c) => c.name() === 'run');
    expect(run?.options.map((o) => o.long)).toContain('--max-parallel');
    expect(run?.options.map((o) => o.long)).toContain('--fully-open');
    const perch = program.commands.find((c) => c.name() === 'perch');
    expect(perch?.options.map((o) => o.long)).toContain('--hub');
  });
});
