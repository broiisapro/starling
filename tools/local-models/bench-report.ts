/**
 * bench-report.ts — formatting only. The numbers come from bench-core.ts, so everything here is a
 * pure function of a result and can be snapshot-tested without a model.
 */

import type { ModelBenchResult } from './bench-core';

const cell = (value: unknown): string => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');

const pct = (n: number): string => `${Math.round(n * 100)}%`;

const ms = (n: number | null): string => (n === null ? '—' : `${Math.round(n)} ms`);

/** The headline table: one row per model, the columns that decide the recommendation. */
export function markdownTable(results: ModelBenchResult[]): string[] {
  const lines = [
    '| model | status | correct | json | TTFT | latency | tok/s | resident | free RAM |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of results) {
    const status = r.status === 'ok' ? 'ok' : `aborted: ${cell(r.abortReason ?? 'unknown')}`;
    lines.push(
      `| ${cell(r.model)} | ${status} | ${r.correct}/${r.total} (${pct(r.accuracy)}) | ${pct(r.jsonValidRate)} | ` +
        `${ms(r.ttftMsMean)} | ${ms(r.latencyMsMean)} | ${r.tokensPerSecMean ?? '—'} | ` +
        `${r.residentGb === null ? '—' : `${r.residentGb} GB`} | ` +
        `${r.freeRamBeforeGb ?? '?'} → ${r.freeRamAfterGb ?? '?'} GB |`,
    );
  }
  return lines;
}

/** Which cases a model got wrong, and why — the first thing to read when a score is surprising. */
export function missReport(results: ModelBenchResult[], perModel = 4): string[] {
  const lines: string[] = [];
  for (const r of results) {
    const wrong = r.cases.filter((c) => !c.correct);
    if (wrong.length === 0) {
      lines.push(`   ${r.model}: no misses`);
      continue;
    }
    lines.push(`   ${r.model}: missed ${wrong.length}/${r.total}`);
    for (const missed of wrong.slice(0, perModel)) {
      const attempt = r.attempts.find((a) => a.caseKey === missed.key);
      if (!attempt) {
        lines.push(`     · ${missed.key}: not attempted (run aborted early)`);
        continue;
      }
      const why = attempt.judgement.jsonValid
        ? `verdict pass=${attempt.judgement.verdict?.pass}, expected ${attempt.expectedPass}` +
          (attempt.judgement.missingMentions.length
            ? `; did not mention ${attempt.judgement.missingMentions.join(', ')}`
            : '')
        : 'invalid JSON';
      lines.push(`     · ${missed.key}: ${why}`);
    }
    if (wrong.length > perModel) lines.push(`     · … and ${wrong.length - perModel} more`);
  }
  return lines;
}

/** The one-line JSON the runbook tells Moksh to paste into starling.config.yaml. */
export function configHint(rec: { auditor: string; summarizer: string }): string {
  return `models: { auditor: { provider: ollama, model: ${rec.auditor} }, summarizer: { provider: ollama, model: ${rec.summarizer} } }`;
}
