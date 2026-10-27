import type { StarlingErrorCode } from '@starling/core';
import { StarlingError } from '@starling/core';

/** Commander hands us `Record<string, unknown>`; these keep the command bodies type-safe. */
export function readString(options: Record<string, unknown>, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readBoolean(options: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = options[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function readNumber(options: Record<string, unknown>, key: string, fallback: number): number {
  const value = options[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new StarlingError('INVALID_ARGUMENT', `${name} must be a positive integer (got ${value})`);
  }
  return value;
}

export function failWith(code: StarlingErrorCode, message: string): never {
  throw new StarlingError(code, message);
}
