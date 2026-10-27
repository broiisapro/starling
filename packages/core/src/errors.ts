/** The one error type Starling throws across package boundaries. Always carries a machine code. */
export type StarlingErrorCode =
  | 'EXEC_TIMEOUT'
  | 'EXEC_FAILED'
  | 'CONFIG_INVALID'
  | 'INVALID_ARGUMENT'
  | 'NOT_IMPLEMENTED'
  | 'LLM_ERROR'
  | 'REPOMAP_ERROR'
  | 'PLAN_INVALID'
  | 'WORKSPACE_ERROR'
  | 'RUNNER_ERROR'
  | 'AUDIT_ERROR'
  | 'MERGE_ERROR'
  | 'NODE_OFFLINE'
  | 'STORE_ERROR'
  | 'UNKNOWN';

export interface StarlingErrorOptions {
  cause?: unknown;
  /** Extra structured context, safe to log (never secrets). */
  details?: Record<string, unknown>;
}

export class StarlingError extends Error {
  readonly code: StarlingErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: StarlingErrorCode, message: string, options: StarlingErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'StarlingError';
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
  }
}

/** True when `err` is a StarlingError carrying `code` (or any StarlingError when code is omitted). */
export function isStarlingError(err: unknown, code?: StarlingErrorCode): err is StarlingError {
  return err instanceof StarlingError && (code === undefined || err.code === code);
}

/** Wrap any thrown value in a StarlingError without losing the original cause. */
export function toStarlingError(err: unknown, code: StarlingErrorCode, message?: string): StarlingError {
  if (err instanceof StarlingError) return err;
  const detail = err instanceof Error ? err.message : String(err);
  return new StarlingError(code, message ?? detail, { cause: err });
}
