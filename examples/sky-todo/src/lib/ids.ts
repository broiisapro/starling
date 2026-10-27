let sequence = 0

/**
 * Short, collision-resistant id. Human-readable prefix makes debugging the
 * event log and localStorage dumps a lot easier.
 */
export function createId(prefix = 'id'): string {
  sequence = (sequence + 1) % 0xffff
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${prefix}_${Date.now().toString(36)}${sequence.toString(36)}${random}`
}

/** Test-only: reset the in-module counter so ids are predictable per test run. */
export function resetIdSequence(): void {
  sequence = 0
}
