import { describe, expect, test } from 'bun:test'
import { bootApp } from './main'
import { createTestDom } from './testing/dom'
import { STORAGE_KEY, type StorageLike } from './store/persist'

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

describe('bootApp', () => {
  test('mounts the shell and persists edits', () => {
    const storage = memoryStorage()
    const { root } = createTestDom()
    const app = bootApp(root, { storage })
    expect(root.querySelector('.app')).not.toBeNull()
    app.store.add('from the browser')
    expect(storage.getItem(STORAGE_KEY)).toContain('from the browser')
    expect(root.querySelectorAll('.todo-item')).toHaveLength(1)
    app.destroy()
    expect(root.children).toHaveLength(0)
  })

  test('restores saved todos on the next boot', () => {
    const storage = memoryStorage()
    const first = bootApp(createTestDom().root, { storage, clock: () => 42 })
    first.store.add('remember me')
    first.destroy()
    const second = bootApp(createTestDom().root, { storage })
    expect(second.store.all().map((todo) => todo.title)).toEqual(['remember me'])
    expect(second.store.all()[0]?.createdAt).toBe(42)
  })

  test('works without storage and reports unreadable state', () => {
    const { root } = createTestDom()
    const noStorage = bootApp(root, { storage: null })
    expect(noStorage.loadError).toBeUndefined()
    noStorage.store.add('memory only')
    noStorage.destroy()

    const broken = bootApp(createTestDom().root, {
      storage: memoryStorage({ [STORAGE_KEY]: '{oops' }),
    })
    expect(broken.loadError).toContain('JSON')
    expect(broken.store.all()).toHaveLength(0)
  })
})
