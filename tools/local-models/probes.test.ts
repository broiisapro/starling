/**
 * probes.test.ts — the parsers behind the safety rails. They read text from `memory_pressure` and
 * `ps`, so the parsing gets a fake shell and the machine it runs on never matters.
 */

import { describe, expect, test } from 'bun:test';
import {
  countOpenCodeProcesses,
  fakeProbes,
  freeRamGbFrom,
  hostProbes,
  ramGbFrom,
  type ShellFn,
} from './probes';

const MEMORY_PRESSURE = `The system has 34359738368 bytes (2097152 pages with a page size of 16384).

System-wide memory free percentage: 37%`;

describe('freeRamGbFrom', () => {
  test('turns the free percentage into GB for this machine', () => {
    expect(freeRamGbFrom(MEMORY_PRESSURE, 32)).toBe(11.8);
    expect(freeRamGbFrom(MEMORY_PRESSURE, 16)).toBe(5.9);
  });

  test('returns null when memory_pressure prints something unparseable', () => {
    expect(freeRamGbFrom('', 32)).toBeNull();
    expect(freeRamGbFrom('no percentage here', 32)).toBeNull();
  });
});

describe('ramGbFrom', () => {
  test('rounds sysctl hw.memsize to whole GB', () => {
    expect(ramGbFrom('34359738368\n')).toBe(32);
    expect(ramGbFrom('17179869184\n')).toBe(16);
  });

  test('returns 0 for garbage, which the caller treats as unmeasurable', () => {
    expect(ramGbFrom('')).toBe(0);
    expect(ramGbFrom('not a number')).toBe(0);
  });
});

describe('countOpenCodeProcesses', () => {
  const PS = `/sbin/launchd
/Applications/OpenCode.app/Contents/MacOS/OpenCode
/opt/homebrew/bin/opencode serve
/opt/homebrew/bin/opencode
bun test tools/local-models
grep opencode
node /Users/moksh/Code/starling/apps/web/node_modules/.bin/vite`;

  test('counts the app, the server and the TUI, and ignores our own test runner', () => {
    expect(countOpenCodeProcesses(PS)).toBe(3);
  });

  test('does not count a grep or a path that merely contains the word', () => {
    expect(countOpenCodeProcesses('grep opencode\n/tmp/opencode-notes.md')).toBe(0);
  });
});

describe('hostProbes', () => {
  test('wires the three commands into the probes interface', async () => {
    const run: ShellFn = (cmd) => {
      const key = cmd.join(' ');
      if (key === 'sysctl -n hw.memsize') return '34359738368\n';
      if (key === 'memory_pressure -Q') return MEMORY_PRESSURE;
      if (key === 'ps -axo command') return '/opt/homebrew/bin/opencode serve\n';
      return '';
    };

    const probes = hostProbes(run);

    expect(await probes.freeRamGb()).toBe(11.8);
    expect(await probes.openCodeProcesses()).toBe(1);
  });

  test('reports null free RAM when the machine cannot be read', async () => {
    const probes = hostProbes(() => '');
    expect(await probes.freeRamGb()).toBeNull();
  });
});

describe('fakeProbes', () => {
  test('defaults to a quiet 12 GB machine and lets a test sabotage it', async () => {
    expect(await fakeProbes().freeRamGb()).toBe(12);
    expect(await fakeProbes().openCodeProcesses()).toBe(0);

    const busy = fakeProbes({ freeRamGb: 1.5, openCodeProcesses: 9 });
    expect(await busy.freeRamGb()).toBe(1.5);
    expect(await busy.openCodeProcesses()).toBe(9);
  });

  test('can simulate an unmeasurable machine', async () => {
    expect(await fakeProbes({ freeRamGb: null }).freeRamGb()).toBeNull();
  });
});
