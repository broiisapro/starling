// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
export interface WorkerHandback {
  status: 'complete' | 'partial';
  summary: string;
  filesChanged: string[];
  testsAdded: string[];
  notes?: string;
}

const HANDBACK_RE = /<<<STARLING_HANDBACK\r?\n([\s\S]*?)\r?\n?STARLING_HANDBACK>>>/;

/**
 * Pull the worker handback block out of an agent's final message.
 *
 * Returns `undefined` when there is no block or it is malformed: a handback is optional enrichment
 * for the PR body and must never turn a successful merge into an error.
 */
export function parseWorkerHandback(text: string): WorkerHandback | undefined {
  const match = HANDBACK_RE.exec(text);
  if (match === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1] ?? '');
  } catch {
    return undefined;
  }
  return isWorkerHandback(parsed) ? parsed : undefined;
}

/** Remove the machine-readable handback block so the human notes do not repeat it. */
export function stripWorkerHandback(text: string): string {
  return text.replace(HANDBACK_RE, '').trim();
}

function isWorkerHandback(value: unknown): value is WorkerHandback {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.status === 'complete' || v.status === 'partial') &&
    typeof v.summary === 'string' &&
    isStringArray(v.filesChanged) &&
    isStringArray(v.testsAdded) &&
    (v.notes === undefined || typeof v.notes === 'string')
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
