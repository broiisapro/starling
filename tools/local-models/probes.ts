/**
 * probes.ts — the machine facts the safety rails and the memory columns depend on.
 *
 * Everything is behind a small interface so `--dry-run` and the tests can supply deterministic
 * numbers instead of measuring the laptop they happen to run on. The real implementation shells
 * out to the same tools `host.ts` already uses (no `ollama` CLI: see ollama-admin.ts).
 */

import { shell } from './host';
import { listResident, type ResidentEntry } from './ollama-admin';

export interface BenchProbes {
  /** Free system RAM in GB, or null when the platform cannot report it. */
  freeRamGb(): Promise<number | null>;
  /** How many opencode processes are alive. Above the rail, a benchmark would starve them. */
  openCodeProcesses(): Promise<number>;
  listResident(host: string): Promise<ResidentEntry[]>;
}

export type ShellFn = (cmd: string[]) => string;

/** Parse `memory_pressure -Q` into a free-RAM figure. Pure so it can be tested on any machine. */
export function freeRamGbFrom(memoryPressure: string, ramGb: number): number | null {
  const percent = /free percentage:\s+(\d+)/.exec(memoryPressure)?.[1];
  if (!percent) return null;
  return Number(((Number(percent) / 100) * ramGb).toFixed(1));
}

/** Count opencode processes in `ps -axo command` output. Our own `ps` line is excluded. */
export function countOpenCodeProcesses(psOutput: string): number {
  return psOutput
    .split('\n')
    .filter((line) => /(^|\s|\/)opencode(\s|$)/.test(line) || /OpenCode\.app/.test(line))
    .filter((line) => !/grep\s/.test(line)).length;
}

export function ramGbFrom(sysctl: string): number {
  const bytes = Number(sysctl.trim());
  return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1024 ** 3) : 0;
}

/** The real machine. `run` is injectable so the parsers above can be tested without spawning. */
export function hostProbes(run: ShellFn = shell): BenchProbes {
  return {
    async freeRamGb(): Promise<number | null> {
      const ramGb = ramGbFrom(run(['sysctl', '-n', 'hw.memsize']));
      if (ramGb === 0) return null;
      return freeRamGbFrom(run(['memory_pressure', '-Q']), ramGb);
    },
    async openCodeProcesses(): Promise<number> {
      return countOpenCodeProcesses(run(['ps', '-axo', 'command']));
    },
    listResident,
  };
}

/** Deterministic stand-in for `--dry-run` and tests: no shell, no daemon. */
export function fakeProbes(
  opts: { freeRamGb?: number | null; openCodeProcesses?: number } = {},
): BenchProbes {
  return {
    async freeRamGb(): Promise<number | null> {
      return opts.freeRamGb === undefined ? 12 : opts.freeRamGb;
    },
    async openCodeProcesses(): Promise<number> {
      return opts.openCodeProcesses ?? 0;
    },
    listResident,
  };
}
