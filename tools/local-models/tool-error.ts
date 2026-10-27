/**
 * tool-error.ts — the error type shared by the local-model tools.
 *
 * `tools/` is deliberately not a workspace (see docs/epic-02-repo-ops.md): these scripts must run
 * on a bare checkout with nothing but Bun, so they do not import `@starling/core`. This is the
 * tools-local equivalent of `StarlingError`: always carries a machine code, never a bare throw.
 */

export type ToolErrorCode =
  | 'USAGE'
  | 'CASE_INVALID'
  | 'RAIL_REFUSED'
  | 'OLLAMA_UNREACHABLE'
  | 'NO_ELIGIBLE_MODEL';

export class ToolError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ToolError';
    this.code = code;
  }
}

/** True when `err` is a ToolError carrying `code` (or any ToolError when code is omitted). */
export function isToolError(err: unknown, code?: ToolErrorCode): err is ToolError {
  return err instanceof ToolError && (code === undefined || err.code === code);
}
