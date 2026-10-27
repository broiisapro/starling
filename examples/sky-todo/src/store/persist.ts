import { createId } from '../lib/ids'
import { normalizeTags, type Todo } from './todos'

export const STORAGE_KEY = 'sky-todo.state'
export const SCHEMA_VERSION = 2

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PersistedState {
  version: typeof SCHEMA_VERSION
  todos: Todo[]
}

export interface LoadResult {
  todos: Todo[]
  /** True when the stored blob came from an older schema and was upgraded. */
  migrated: boolean
  /** Present when the stored blob could not be used; `todos` is then empty. */
  error?: string
}

export type Migration = (state: Record<string, unknown>) => Record<string, unknown>

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function coerceTodo(value: unknown, fallbackNow: number): Todo | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const rawTitle =
    typeof record.title === 'string'
      ? record.title
      : typeof record.text === 'string'
        ? record.text
        : ''
  const title = rawTitle.trim()
  if (!title) return undefined
  const tags =
    Array.isArray(record.tags) && record.tags.every((tag) => typeof tag === 'string')
      ? normalizeTags(record.tags as string[])
      : []
  const todo: Todo = {
    id: typeof record.id === 'string' && record.id ? record.id : createId('todo'),
    title,
    done: record.done === true,
    createdAt:
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? record.createdAt
        : fallbackNow,
    tags,
  }
  if (typeof record.due === 'string' && ISO_DAY.test(record.due)) todo.due = record.due
  return todo
}

/**
 * Schema upgrades, keyed by the version they upgrade *from*. Add a new entry
 * whenever `SCHEMA_VERSION` bumps; never rewrite old ones.
 *
 * v1 stored `{ items: [{ id, text, done }] }` before tags, due dates and
 * createdAt existed.
 */
export const migrations: Record<number, Migration> = {
  1: (state) => {
    const items = Array.isArray(state.items) ? state.items : []
    return {
      version: 2,
      todos: items.map((item) => {
        if (!item || typeof item !== 'object') return item
        const record = item as Record<string, unknown>
        return { ...record, title: record.title ?? record.text, tags: record.tags ?? [] }
      }),
    }
  },
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) return { version: 1, items: raw }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  throw new Error('Saved state is not an object')
}

export function migrateState(raw: unknown, now: number = Date.now()): {
  state: PersistedState
  migrated: boolean
} {
  let state = asRecord(raw)
  const originalVersion = typeof state.version === 'number' ? state.version : 1
  if (originalVersion > SCHEMA_VERSION) {
    throw new Error(
      `Saved data uses schema v${originalVersion}; this build understands up to v${SCHEMA_VERSION}`,
    )
  }
  let version = originalVersion
  for (let step = 0; version < SCHEMA_VERSION; step += 1) {
    if (step > 10) throw new Error('Migration loop did not converge')
    const migration = migrations[version]
    if (!migration) throw new Error(`No migration from schema v${version}`)
    state = migration(state)
    version = typeof state.version === 'number' ? state.version : version + 1
  }
  const rawTodos = Array.isArray(state.todos) ? state.todos : []
  const todos: Todo[] = []
  for (const entry of rawTodos) {
    const todo = coerceTodo(entry, now)
    if (todo) todos.push(todo)
  }
  return { state: { version: SCHEMA_VERSION, todos }, migrated: originalVersion !== SCHEMA_VERSION }
}

export function loadTodos(
  storage: StorageLike,
  options: { key?: string; now?: number } = {},
): LoadResult {
  const raw = storage.getItem(options.key ?? STORAGE_KEY)
  if (!raw) return { todos: [], migrated: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { todos: [], migrated: false, error: 'Saved state is not valid JSON' }
  }
  try {
    const { state, migrated } = migrateState(parsed, options.now ?? Date.now())
    return { todos: state.todos, migrated }
  } catch (error) {
    return {
      todos: [],
      migrated: false,
      error: error instanceof Error ? error.message : 'Saved state could not be read',
    }
  }
}

export function serializeTodos(todos: readonly Todo[]): string {
  const state: PersistedState = { version: SCHEMA_VERSION, todos: [...todos] }
  return JSON.stringify(state)
}

export function saveTodos(
  storage: StorageLike,
  todos: readonly Todo[],
  options: { key?: string } = {},
): void {
  storage.setItem(options.key ?? STORAGE_KEY, serializeTodos(todos))
}
