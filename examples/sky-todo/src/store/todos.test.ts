import { describe, expect, test } from 'bun:test'
import { createTodoStore } from './todos'

function fixedStore() {
  let clock = 1_000
  let counter = 0
  return createTodoStore([], {
    now: () => {
      clock += 1
      return clock
    },
    idFactory: () => {
      counter += 1
      return `todo_${counter}`
    },
  })
}

describe('todo store', () => {
  test('adds a trimmed todo with defaults', () => {
    const store = fixedStore()
    const todo = store.add('  Ship the demo  ')
    expect(todo.title).toBe('Ship the demo')
    expect(todo.done).toBe(false)
    expect(todo.tags).toEqual([])
    expect('due' in todo).toBe(false)
    expect(todo.createdAt).toBeGreaterThan(0)
    expect(store.all()).toHaveLength(1)
  })

  test('normalizes tags and keeps a valid due date', () => {
    const store = fixedStore()
    const todo = store.add('Water the plants', { due: '2026-10-30', tags: ['#Home', ' home ', 'Errand'] })
    expect(todo.due).toBe('2026-10-30')
    expect(todo.tags).toEqual(['errand', 'home'])
  })

  test('rejects empty titles and malformed due dates', () => {
    const store = fixedStore()
    expect(() => store.add('   ')).toThrow('title')
    expect(() => store.add('ok', { due: '30/10/2026' })).toThrow('YYYY-MM-DD')
  })

  test('toggles done', () => {
    const store = fixedStore()
    const todo = store.add('one')
    expect(store.toggle(todo.id)?.done).toBe(true)
    expect(store.toggle(todo.id)?.done).toBe(false)
    expect(store.toggle('missing')).toBeUndefined()
  })

  test('updates fields and can clear the due date', () => {
    const store = fixedStore()
    const todo = store.add('two', { due: '2026-01-02' })
    const updated = store.update(todo.id, { title: ' two! ', tags: ['X'], due: undefined })
    expect(updated?.title).toBe('two!')
    expect(updated?.tags).toEqual(['x'])
    expect(updated?.due).toBeUndefined()
    expect(store.update('missing', { title: 'x' })).toBeUndefined()
  })

  test('updates a due date without touching the title', () => {
    const store = fixedStore()
    const todo = store.add('three')
    const updated = store.update(todo.id, { due: '2026-02-03' })
    expect(updated?.title).toBe('three')
    expect(updated?.due).toBe('2026-02-03')
  })

  test('removes todos', () => {
    const store = fixedStore()
    const todo = store.add('four')
    expect(store.remove(todo.id)).toBe(true)
    expect(store.remove(todo.id)).toBe(false)
    expect(store.all()).toHaveLength(0)
  })

  test('clearDone reports how many it removed and keeps open tasks', () => {
    const store = fixedStore()
    const first = store.add('done one')
    store.add('open')
    const second = store.add('done two')
    store.toggle(first.id)
    store.toggle(second.id)
    expect(store.clearDone()).toBe(2)
    expect(store.all().map((todo) => todo.title)).toEqual(['open'])
    expect(store.clearDone()).toBe(0)
  })

  test('notifies subscribers with snapshots until they unsubscribe', () => {
    const store = fixedStore()
    const seen: string[][] = []
    const off = store.subscribe((todos) => seen.push(todos.map((todo) => todo.title)))
    store.add('a')
    store.add('b')
    off()
    store.add('c')
    expect(seen).toEqual([['a'], ['a', 'b']])
  })

  test('replaceAll swaps the whole list and emits', () => {
    const store = fixedStore()
    let events = 0
    store.subscribe(() => {
      events += 1
    })
    store.replaceAll([{ id: 'x', title: 'imported', done: false, createdAt: 1, tags: ['t'] }])
    expect(store.all()[0]?.title).toBe('imported')
    expect(events).toBe(1)
  })

  test('all() hands out copies so callers cannot mutate the store', () => {
    const store = fixedStore()
    store.add('safe', { tags: ['a'] })
    const snapshot = store.all()
    const first = snapshot[0]
    if (!first) throw new Error('expected a todo')
    first.tags.push('mutated')
    first.title = 'changed'
    expect(store.all()[0]?.title).toBe('safe')
    expect(store.all()[0]?.tags).toEqual(['a'])
  })
})
