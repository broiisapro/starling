/**
 * The worker handback: the machine-readable block every agent finishes with (ARCHITECTURE §8).
 *
 * Workers are chatty. They wrap the block in fences, add a trailing "Let me know if…", or paste
 * an earlier copy before the final one. The parser is therefore forgiving about everything except
 * the JSON itself: it takes the *last* block and returns `undefined` rather than throwing.
 */
import { HANDBACK_END, HANDBACK_START, type WorkerHandback, WorkerHandbackSchema } from './handshake';
import { bullets } from './text';

/** Strip a surrounding markdown fence (` ```json … ``` `), keeping the JSON untouched. */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
}

/**
 * Find the last `<<<STARLING_HANDBACK … STARLING_HANDBACK>>>` block and validate it.
 *
 * Returns `undefined` when there is no complete block, the JSON does not parse, or a required
 * field is missing/ill-typed. Unknown fields are ignored.
 */
export function parseHandback(text: string): WorkerHandback | undefined {
  const end = text.lastIndexOf(HANDBACK_END);
  if (end === -1) return undefined;
  const start = text.lastIndexOf(HANDBACK_START, end);
  if (start === -1) return undefined;

  const raw = text.slice(start + HANDBACK_START.length, end);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return undefined;
  }

  const result = WorkerHandbackSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/** The finish-line text shared by worker, fixer and resolver prompts. */
export function handbackInstructions(): string {
  return [
    'End your final message with exactly this block. Starling parses it; a missing or unparseable block counts as a partial result:',
    '',
    HANDBACK_START,
    '{"status":"<complete|partial>","summary":"<one line>","filesChanged":["<paths>"],"testsAdded":["<test files>"],"notes":"<optional>"}',
    HANDBACK_END,
    '',
    bullets([
      'Replace every `<…>` placeholder. The template is an example, not a valid handback.',
      '`status` is `"complete"` only when every definition-of-done item is met; otherwise use `"partial"`.',
      '`filesChanged` lists every file you changed; `testsAdded` lists every test file you added or extended.',
      'Keep `summary` to one line. Valid JSON only: no comments, no trailing commas. No fence is needed.',
    ]),
  ].join('\n');
}
