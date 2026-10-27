/**
 * host.ts — the machine-side half of the local-model tooling: shell helpers, process/memory
 * probes and hardware facts. Split from ollama.ts so each file stays small and readable.
 */

import { hostname } from "node:os";

export type Snapshot = {
  ollamaPs: string;
  residentSize: string | null;
  ollamaRssMb: number;
  wiredMb: number | null;
  freePercent: number | null;
};

export function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function shell(cmd: string[]): string {
  try {
    return Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" }).stdout.toString();
  } catch {
    return "";
  }
}

/**
 * Memory while a model is (or is not) resident. On Apple silicon the MLX/GGML weights are
 * *wired GPU memory*, not process RSS, so `ps` alone understates the cost by ~18 GB —
 * `ollama ps` plus `vm_stat` wired pages are the honest sources.
 */
export function snapshot(model: string): Snapshot {
  const ps = shell(["ollama", "ps"]).trim();
  const line = ps.split("\n").find((l) => l.startsWith(model)) ?? "";
  // NAME  ID  SIZE  PROCESSOR  CONTEXT  RUNNER  UNTIL → SIZE is the third column.
  const residentSize = line ? (line.split(/\s{2,}/)[2] ?? null) : null;

  let ollamaRssMb = 0;
  for (const l of shell(["ps", "-axo", "rss,comm"]).split("\n")) {
    if (!/ollama|llama/i.test(l)) continue;
    const kb = Number.parseInt(l.trim().split(/\s+/)[0] ?? "0", 10);
    if (Number.isFinite(kb)) ollamaRssMb += Math.round(kb / 1024);
  }

  const vm = shell(["vm_stat"]);
  const pageSize = Number.parseInt(/page size of (\d+)/.exec(vm)?.[1] ?? "0", 10);
  const wiredPages = Number.parseInt(/Pages wired down:\s+(\d+)/.exec(vm)?.[1] ?? "0", 10);
  const wiredMb = pageSize && wiredPages ? Math.round((wiredPages * pageSize) / 1024 / 1024) : null;

  const mp = shell(["memory_pressure", "-Q"]);
  const free = /free percentage:\s+(\d+)/.exec(mp)?.[1];

  return { ollamaPs: ps, residentSize, ollamaRssMb, wiredMb, freePercent: free ? Number(free) : null };
}

/** Machine facts for the result file. */
export function hardware(): { hostname: string; platform: string; arch: string; cpu: string; ramGb: number } {
  return {
    hostname: hostname(),
    platform: process.platform,
    arch: process.arch,
    cpu: shell(["sysctl", "-n", "machdep.cpu.brand_string"]).trim(),
    ramGb: Math.round(Number(shell(["sysctl", "-n", "hw.memsize"]).trim()) / 1073741824),
  };
}
