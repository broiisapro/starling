import type { ZodType } from 'zod';
import { z } from 'zod';

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Drop a single Markdown code fence (```json … ```), leaving other text untouched. */
export function stripFences(text: string): string {
  const match = /^\s*```(?:json|json5|javascript)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i.exec(text);
  return (match?.[1] ?? text).trim();
}

/** Find the first balanced `{…}` or `[…]`, respecting strings and escapes. */
function sliceOutermostJson(text: string): string | undefined {
  const start = text.search(/[[{]/);
  if (start === -1) return undefined;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Parse JSON from a model reply: fences stripped, surrounding prose tolerated, outermost value used.
 * Never throws; callers decide whether to repair or fail.
 */
export function extractJson(text: string): JsonParseResult {
  const unfenced = stripFences(text);
  try {
    return { ok: true, value: JSON.parse(unfenced) };
  } catch {
    const candidate = sliceOutermostJson(unfenced);
    if (candidate === undefined) return { ok: false, error: 'no JSON object or array found' };
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** JSON Schema for a zod schema, or `undefined` when the schema cannot be represented. */
export function toJsonSchemaSafe(schema: ZodType): Record<string, unknown> | undefined {
  try {
    return z.toJSONSchema(schema, { io: 'output' }) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** OpenAI-style schema names: `^[a-zA-Z0-9_-]+$`. */
export function schemaName(role: string): string {
  const slug = role.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `starling_${slug}`;
}

/**
 * The prompt-side half of structured output. Sent even when `json_schema` is available: DeepSeek
 * only has `json_object`, and every provider benefits from knowing the exact shape.
 */
export function jsonInstruction(schemaJson: Record<string, unknown> | undefined): string {
  const shape = schemaJson === undefined ? '' : `\n\nJSON Schema:\n${JSON.stringify(schemaJson)}`;
  return [
    'Reply with a single JSON value and nothing else.',
    'Do not wrap it in Markdown fences and do not add prose before or after it.',
    shape,
  ]
    .join('\n')
    .trim();
}

/** Human-readable zod issues for the repair turn. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? '(root)' : issue.path.map((p) => String(p)).join('.');
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
