/**
 * cases.ts — the audit-case corpus: the twelve judgments the benchmark scores a model on.
 *
 * A case is exactly what Starling's auditor receives in production: a goal, a definition of done,
 * an optional lane, the diff under review and the tail of the test run. The `expect` block is the
 * ground truth: the verdict a strict, careful auditor must reach.
 *
 * Files live in `cases/*.json` so they can be read, diffed and extended without touching code.
 * Loading validates every field: a typo in a case would silently corrupt a model's score.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AuditRequestInput, auditRequest } from './audit-request';
import { ToolError } from './tool-error';

export interface CaseExpectation {
  /** The verdict a correct auditor must return. */
  pass: boolean;
  /**
   * Words a correct answer must contain (case-insensitive) in `summary` + `fixInstructions`.
   * Keep them to one short, literal token the auditor would naturally name — the thing that is
   * wrong (`test`, `lane`, `month`), never a phrase. Enforced by the corpus test.
   */
  mustMention: string[];
}

export interface AuditCase extends AuditRequestInput {
  key: string;
  title: string;
  testOutput: string;
  expect: CaseExpectation;
  /** Why the case exists, for whoever re-reads the corpus. */
  why: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const stringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((item) => nonEmptyString(item));

function fail(source: string, message: string): never {
  throw new ToolError('CASE_INVALID', `${source}: ${message}`);
}

/** Validate one parsed JSON value into an AuditCase. Throws CASE_INVALID with the source name. */
export function parseCase(raw: unknown, source: string): AuditCase {
  if (!isRecord(raw)) return fail(source, 'expected a JSON object');

  if (!nonEmptyString(raw.key) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.key)) {
    fail(source, 'key must be kebab-case, e.g. "csv-export-no-tests"');
  }
  if (!nonEmptyString(raw.title)) fail(source, 'title must be a non-empty string');
  if (!nonEmptyString(raw.goal)) fail(source, 'goal must be a non-empty string');
  if (!stringList(raw.definitionOfDone) || raw.definitionOfDone.length === 0) {
    fail(source, 'definitionOfDone must be a non-empty array of non-empty strings');
  }
  if (!nonEmptyString(raw.diff) || !raw.diff.startsWith('diff --git ')) {
    fail(source, 'diff must be a unified diff starting with "diff --git "');
  }
  if (typeof raw.testOutput !== 'string') fail(source, 'testOutput must be a string (may be empty)');

  if (!isRecord(raw.expect)) fail(source, 'expect must be an object');
  if (typeof raw.expect.pass !== 'boolean') fail(source, 'expect.pass must be a boolean');
  if (!stringList(raw.expect.mustMention)) {
    fail(source, 'expect.mustMention must be an array of non-empty strings');
  }
  for (const term of raw.expect.mustMention) {
    if (term !== term.toLowerCase()) fail(source, `expect.mustMention "${term}" must be lowercase`);
  }

  let lane: AuditCase['lane'];
  if (raw.lane !== undefined) {
    if (!isRecord(raw.lane) || !stringList(raw.lane.owns) || !stringList(raw.lane.reads)) {
      fail(source, 'lane must be { owns: string[], reads: string[] }');
    }
    lane = { owns: raw.lane.owns, reads: raw.lane.reads };
  }

  const testOutput = (raw.testOutput as string).trimEnd();
  return {
    key: raw.key,
    title: raw.title,
    goal: raw.goal,
    ...(lane ? { lane } : {}),
    definitionOfDone: raw.definitionOfDone,
    diff: raw.diff,
    testOutput,
    expect: { pass: raw.expect.pass, mustMention: raw.expect.mustMention },
    why: nonEmptyString(raw.why) ? raw.why : '',
  };
}

/** Read and validate every `*.json` in `dir`, sorted by filename so runs are reproducible. */
export function loadCases(dir: string): AuditCase[] {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch (cause) {
    throw new ToolError('CASE_INVALID', `cannot read the case directory ${dir}`, { cause });
  }
  if (names.length === 0) throw new ToolError('CASE_INVALID', `no *.json cases in ${dir}`);

  const cases = names.map((name) => {
    const path = join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (cause) {
      throw new ToolError('CASE_INVALID', `${name}: not valid JSON`, { cause });
    }
    return parseCase(raw, name);
  });

  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.key)) throw new ToolError('CASE_INVALID', `duplicate case key "${c.key}"`);
    seen.add(c.key);
  }
  return cases;
}

/** The exact request the benchmark and smoke test send: same schema, same system prompt. */
export function caseRequest(c: AuditCase): { system: string; user: string; schema: object } {
  return auditRequest({
    goal: c.goal,
    definitionOfDone: c.definitionOfDone,
    diff: c.diff,
    ...(c.testOutput ? { testOutput: c.testOutput } : {}),
    ...(c.lane ? { lane: c.lane } : {}),
  });
}

/**
 * Identify which case an audit prompt is about, from the diff embedded in it.
 *
 * The fake server uses this to answer deterministically *without* the bench leaking the expected
 * verdict into the prompt: the only signal is the diff text, exactly what a real model reads.
 */
export function findCaseForPrompt(user: string, cases: AuditCase[]): AuditCase | undefined {
  return cases.find((c) => user.includes(c.diff.trimEnd()));
}
