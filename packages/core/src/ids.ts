import { ulid } from 'ulid';

/** Mint a fresh lowercase ULID. Sortable by creation time, safe to use as a branch/path segment. */
export function newId(): string {
  return ulid().toLowerCase();
}

/**
 * The short, human-readable tail of an id, used in branch names (`starling/<runShort>/integration`).
 * The tail is the random part of the ULID, so two runs created in the same millisecond still differ.
 */
export function shortId(id: string): string {
  return id.length <= 6 ? id.toLowerCase() : id.slice(-6).toLowerCase();
}
