/**
 * audit-request.ts — the one audit request shape both tools send to a local model.
 *
 * `smoke.ts` proved the shape (a strict JSON-schema verdict) and `bench.ts` replays it across a
 * corpus of cases, so the schema, the system prompt and the user-message builder live here and
 * neither entrypoint can drift from the other.
 *
 * Not product code: @starling/auditor (Epic 16) owns the real one. This is the proposal it can
 * start from — see docs/epic-28-local-bench.md.
 */

import type { Verdict } from './ollama';

/** JSON Schema handed to Ollama as `response_format.json_schema` / `format`. */
export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    pass: {
      type: 'boolean',
      description: 'true only if every definition-of-done item is satisfied',
    },
    summary: {
      type: 'string',
      description: 'one or two sentences: what was checked and what is wrong',
    },
    fixInstructions: {
      type: 'string',
      description: 'exact, actionable steps for the coding agent; omit when pass is true',
    },
  },
  required: ['pass', 'summary'],
  additionalProperties: false,
} as const;

export const AUDIT_SYSTEM = [
  'You are Starling’s auditor. You judge one coding agent’s diff against a definition of done.',
  'Be strict and literal: if a definition-of-done item is not visible in the diff, it is not done.',
  'Read the test output: a failing test means the work is not done.',
  'A file outside the lane is a failure even when the code is good.',
  'Reply with a single JSON object and nothing else.',
].join(' ');

export interface AuditRequestInput {
  goal: string;
  definitionOfDone: string[];
  diff: string;
  /** Tail of the test run, verbatim. Omitted for docs-only cases. */
  testOutput?: string;
  /** Globs the task may modify. When present, a change outside them fails the audit. */
  lane?: { owns: string[]; reads: string[] };
}

/**
 * Build the user message. Case diffs are embedded untouched so a fake server can identify the case
 * from the prompt (see fake-ollama.ts); keep the fences and the section order stable.
 */
export function buildAuditUser(input: AuditRequestInput): string {
  const lines: string[] = [`GOAL: ${input.goal}`, ''];

  if (input.lane) {
    lines.push(
      'LANE (the task may only modify files matching `owns`; `reads` is read-only):',
      `- owns: ${input.lane.owns.join(', ') || '(nothing)'}`,
      `- reads: ${input.lane.reads.join(', ') || '(nothing)'}`,
      '',
    );
  }

  lines.push('DEFINITION OF DONE:');
  input.definitionOfDone.forEach((item, i) => {
    lines.push(`${i + 1}. ${item}`);
  });
  lines.push('');

  if (input.testOutput) {
    lines.push('TEST OUTPUT (tail):', '```text', input.testOutput.trimEnd(), '```', '');
  }

  lines.push('DIFF:', '```diff', input.diff.trimEnd(), '```', '');
  lines.push('Return {pass, summary, fixInstructions}.');

  return lines.join('\n');
}

/** Convenience wrapper: the schema and both messages in one object. */
export function auditRequest(input: AuditRequestInput): {
  system: string;
  user: string;
  schema: typeof VERDICT_SCHEMA;
} {
  return { system: AUDIT_SYSTEM, user: buildAuditUser(input), schema: VERDICT_SCHEMA };
}

/** The verdict contract this tool proposes to @starling/auditor. Re-exported for one import site. */
export type { Verdict };
