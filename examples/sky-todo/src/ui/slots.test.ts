import { describe, expect, test } from 'bun:test'
import { createTodoStore } from '../store/todos'
import { createCommandBus } from '../lib/commands'
import { createSlotRegistry } from './slots'
import { createTestDom } from '../testing/dom'

function host(todoId?: string) {
  const { doc } = createTestDom()
  const store = createTodoStore([
    { id: 'a', title: 'Alpha', done: false, createdAt: 1, tags: [] },
  ])
  return { doc, store, commands: createCommandBus(), ...(todoId ? { todo: store.get(todoId) } : {}) }
}

describe('slot registry', () => {
  test('sorts items by order then id', () => {
    const slots = createSlotRegistry()
    slots.register({ id: 'b', slot: 'footer', order: 5, render: () => null })
    slots.register({ id: 'a', slot: 'footer', order: 5, render: () => null })
    slots.register({ id: 'z', slot: 'footer', order: 1, render: () => null })
    expect(slots.items('footer').map((item) => item.id)).toEqual(['z', 'a', 'b'])
  })

  test('rejects a duplicate id inside one slot', () => {
    const slots = createSlotRegistry()
    slots.register({ id: 'dup', slot: 'toolbar', render: () => null })
    expect(() => slots.register({ id: 'dup', slot: 'toolbar', render: () => null })).toThrow(
      'already has an item',
    )
  })

  test('stops rendering after the unregister callback', () => {
    const slots = createSlotRegistry()
    const off = slots.register({
      id: 'temp',
      slot: 'header-right',
      render: ({ doc }) => doc.createElement('span'),
    })
    expect(slots.has('header-right', 'temp')).toBe(true)
    off()
    expect(slots.has('header-right', 'temp')).toBe(false)
  })

  test('renders every item into the container and reports the count', () => {
    const slots = createSlotRegistry()
    const { doc } = createTestDom()
    slots.register({
      id: 'one',
      slot: 'toolbar',
      render: ({ doc: d }) => {
        const node = d.createElement('span')
        node.textContent = 'first'
        return node
      },
    })
    slots.register({ id: 'skip', slot: 'toolbar', render: () => null })
    const container = doc.createElement('div')
    container.appendChild(doc.createElement('i'))
    const count = slots.render('toolbar', container, host())
    expect(count).toBe(1)
    expect(container.textContent).toBe('first')
  })

  test('per-todo slots see the todo', () => {
    const slots = createSlotRegistry()
    const { doc } = createTestDom()
    slots.register({
      id: 'title',
      slot: 'item-badges',
      render: ({ doc: d, todo }) => {
        const node = d.createElement('span')
        node.textContent = todo?.title ?? 'missing'
        return node
      },
    })
    const container = doc.createElement('div')
    const context = host('a')
    slots.render('item-badges', container, {
      doc: context.doc,
      store: context.store,
      commands: context.commands,
      todo: context.todo,
    })
    expect(container.textContent).toBe('Alpha')
  })
})
