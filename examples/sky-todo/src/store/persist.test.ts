import { describe, expect, test } from 'bun:test'
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  loadTodos,
  migrateState,
  saveTodos,
  serializeTodos,
  type StorageLike,
} from './persist'
import type { Todo } from './todos'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  dump(): Record<string, string>
} {
  const data = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return data.get(key) ?? null
    },
    setItem(key, value) {
      data.set(key, value)
    },
    dump() {
      return Object.fromEntries(data)
    },
  }
}

const sample: Todo[] = [
  { id: 'a', title: 'Ship it', done: false, createdAt: 1_700_000_000_000, due: '2026-11-01', tags: ['work'] },
  { id: 'b', title: 'Rest', done: true, createdAt: 1_700_000_001_000, tags: [] },
]

describe('persistence', () => {
  test('round-trips todos through storage', () => {
    const storage = memoryStorage()
    saveTodos(storage, sample)
    const loaded = loadTodos(storage)
    expect(loaded.error).toBeUndefined()
    expect(loaded.migrated).toBe(false)
    expect(loaded.todos).toEqual(sample)
  })

  test('writes the current schema version', () => {
    const state = JSON.parse(serializeTodos(sample)) as { version: number; todos: unknown[] }
    expect(state.version).toBe(SCHEMA_VERSION)
    expect(state.todos).toHaveLength(2)
  })

  test('returns an empty list when nothing is stored', () => {
    expect(loadTodos(memoryStorage())).toEqual({ todos: [], migrated: false })
  })

  test('survives corrupt JSON without throwing', () => {
    const loaded = loadTodos(memoryStorage({ [STORAGE_KEY]: '{not json' }))
    expect(loaded.todos).toEqual([])
    expect(loaded.error).toContain('JSON')
  })

  test('migrates v1 items to v2 todos', () => {
    const v1 = {
      version: 1,
      items: [
        { id: 'old', text: 'From v1', done: true, createdAt: 42 },
        { id: 'older', text: 'No tags yet', done: false },
      ],
    }
    const loaded = loadTodos(memoryStorage({ [STORAGE_KEY]: JSON.stringify(v1) }), { now: 99 })
    expect(loaded.migrated).toBe(true)
    expect(loaded.todos[0]).toMatchObject({ id: 'old', title: 'From v1', done: true, tags: [] })
    expect(loaded.todos[1]).toMatchObject({ title: 'No tags yet', createdAt: 99, tags: [] })
  })

  test('migrates a bare legacy array', () => {
    const loaded = loadTodos(
      memoryStorage({ [STORAGE_KEY]: JSON.stringify([{ id: 'legacy', text: 'Hello', done: false }]) }),
      { now: 5 },
    )
    expect(loaded.migrated).toBe(true)
    expect(loaded.todos[0]?.title).toBe('Hello')
  })

  test('refuses state from a newer schema instead of mangling it', () => {
    const loaded = loadTodos(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 99, todos: [] }) }))
    expect(loaded.todos).toEqual([])
    expect(loaded.error).toContain('v99')
  })

  test('drops invalid entries but keeps the good ones', () => {
    const raw = {
      version: 2,
      todos: [
        { id: 'ok', title: 'Keep me', done: false, createdAt: 1, tags: [] },
        { id: 'no-title', done: false },
        'nonsense',
      ],
    }
    const loaded = loadTodos(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) }))
    expect(loaded.todos.map((todo) => todo.id)).toEqual(['ok'])
  })

  test('migrateState is a pure, reusable hook', () => {
    const { state } = migrateState({ version: 1, items: [{ text: 'x' }] }, 7)
    expect(state.version).toBe(2)
    expect(state.todos[0]?.createdAt).toBe(7)
  })
})
