import { describe, expect, test } from 'bun:test'
import { mountTestApp } from '../testing/dom'

describe('app shell', () => {
  test('shows the empty state when there are no todos', () => {
    const { root } = mountTestApp()
    expect(root.querySelectorAll('.todo-item')).toHaveLength(0)
    expect(root.querySelector('.empty')?.hasAttribute('hidden')).toBe(false)
    expect(root.textContent).toContain('Nothing in the sky yet')
  })

  test('renders existing todos in order', () => {
    const { root } = mountTestApp({
      initial: [
        { id: 'a', title: 'First', done: false, createdAt: 1, tags: [] },
        { id: 'b', title: 'Second', done: true, createdAt: 2, tags: [] },
      ],
    })
    const titles = [...root.querySelectorAll('.todo-title')].map((node) => node.textContent)
    expect(titles).toEqual(['First', 'Second'])
    expect(root.querySelector('[data-id="b"]')?.classList.contains('is-done')).toBe(true)
  })

  test('adds a todo through the composer and clears the field', () => {
    const { doc, root, store, window, app } = mountTestApp()
    const form = root.querySelector('form')
    if (!form) throw new Error('no form')
    app.input.value = '  New bird  '
    // reason: happy-dom's Event class is DOM-compatible at runtime but not nominally typed.
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event)
    expect(store.all().map((todo) => todo.title)).toEqual(['New bird'])
    expect(app.input.value).toBe('')
    expect(root.querySelector('.todo-title')?.textContent).toBe('New bird')
    expect(doc.activeElement).toBe(app.input)
  })

  test('ignores blank submissions', () => {
    const { root, store, window, app } = mountTestApp()
    app.input.value = '   '
    root
      .querySelector('form')
      ?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event)
    expect(store.all()).toHaveLength(0)
  })

  test('toggles a todo from its checkbox', () => {
    const { root, store } = mountTestApp({
      initial: [{ id: 'a', title: 'Toggle me', done: false, createdAt: 1, tags: [] }],
    })
    const checkbox = root.querySelector('[data-action="toggle"]')
    if (!(checkbox instanceof Object) || !('click' in checkbox)) throw new Error('no checkbox')
    ;(checkbox as unknown as HTMLElement).click()
    expect(store.all()[0]?.done).toBe(true)
    expect(root.querySelector('[data-id="a"]')?.classList.contains('is-done')).toBe(true)
  })

  test('removes a todo with its delete button', () => {
    const { root, store } = mountTestApp({
      initial: [{ id: 'a', title: 'Remove me', done: false, createdAt: 1, tags: [] }],
    })
    ;(root.querySelector('[data-action="remove"]') as unknown as HTMLElement).click()
    expect(store.all()).toHaveLength(0)
    expect(root.querySelectorAll('.todo-item')).toHaveLength(0)
  })

  test('clears completed todos from the footer', () => {
    const { root, store } = mountTestApp({
      initial: [
        { id: 'a', title: 'Done', done: true, createdAt: 1, tags: [] },
        { id: 'b', title: 'Open', done: false, createdAt: 2, tags: [] },
      ],
    })
    ;(root.querySelector('[data-action="clear-done"]') as unknown as HTMLElement).click()
    expect(store.all().map((todo) => todo.id)).toEqual(['b'])
  })

  test('updates the remaining count and empty state', () => {
    const { root, store, app } = mountTestApp()
    const remaining = () => root.querySelector('[data-role="remaining"]')?.textContent
    expect(remaining()).toBe('0 tasks left')
    store.add('one')
    expect(remaining()).toBe('1 task left')
    store.add('two')
    expect(remaining()).toBe('2 tasks left')
    store.toggle(store.all()[0]?.id ?? '')
    expect(remaining()).toBe('1 task left')
    store.clearDone()
    expect(root.querySelector('.empty')?.hasAttribute('hidden')).toBe(true)
    expect(app.input.isConnected).toBe(true)
  })

  test('renders registered slots and refreshes them with the store', () => {
    const { root, doc, slots, store, app } = mountTestApp()
    slots.register({
      id: 'custom-footer',
      slot: 'footer',
      render: ({ doc: d, store: s }) => {
        const node = d.createElement('em')
        node.textContent = `total:${s.all().length}`
        return node
      },
    })
    slots.register({
      id: 'badge',
      slot: 'item-badges',
      render: ({ doc: d, todo }) => {
        const node = d.createElement('span')
        node.className = 'badge'
        node.textContent = todo?.done ? 'done' : 'open'
        return node
      },
    })
    app.refresh()
    expect(root.querySelector('.slot-footer em')?.textContent).toBe('total:0')
    store.add('hello')
    expect(root.querySelector('.slot-footer em')?.textContent).toBe('total:1')
    expect(root.querySelector('.badge')?.textContent).toBe('open')
    expect(doc.querySelectorAll('.todo-item')).toHaveLength(1)
  })

  test('exposes shell commands', () => {
    const { commands, store, app } = mountTestApp()
    commands.run('todo:new')
    expect(app.input.ownerDocument.activeElement).toBe(app.input)
    store.add('x')
    store.toggle(store.all()[0]?.id ?? '')
    commands.run('todo:clear-done')
    expect(store.all()).toHaveLength(0)
  })

  test('destroy clears the mount point and its commands', () => {
    const { root, commands, app } = mountTestApp()
    app.destroy()
    expect(root.children).toHaveLength(0)
    expect(commands.has('todo:new')).toBe(false)
  })
})
