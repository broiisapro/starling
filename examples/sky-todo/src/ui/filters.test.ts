import { describe, expect, test } from 'bun:test'
import { createFilterRegistry } from './filters'
import { mountTestApp } from '../testing/dom'

const todos = [
  { id: 'a', title: 'Alpha', done: false, createdAt: 1, tags: ['home'] },
  { id: 'b', title: 'Beta', done: false, createdAt: 2, tags: ['work'] },
]

describe('filter registry', () => {
  test('with no filters it passes everything through', () => {
    const filters = createFilterRegistry()
    expect(filters.size()).toBe(0)
    expect(filters.apply(todos)).toEqual(todos)
  })

  test('ANDs every filter and supports removal', () => {
    const filters = createFilterRegistry()
    const offA = filters.add((todo) => !todo.done)
    const offB = filters.add((todo) => todo.tags.includes('work'))
    expect(filters.size()).toBe(2)
    expect(filters.apply(todos).map((todo) => todo.id)).toEqual(['b'])
    offB()
    expect(filters.apply(todos).map((todo) => todo.id)).toEqual(['a', 'b'])
    offA()
    expect(filters.size()).toBe(0)
  })

  test('the app shell renders only visible todos and leaves counts alone', () => {
    const { root, store, filters, app } = mountTestApp({
      initial: [
        { id: 'a', title: 'Keep', done: false, createdAt: 1, tags: [] },
        { id: 'b', title: 'Hide', done: false, createdAt: 2, tags: [] },
      ],
    })
    filters.add((todo) => todo.id === 'a')
    app.refresh()
    expect([...root.querySelectorAll('.todo-title')].map((node) => node.textContent)).toEqual([
      'Keep',
    ])
    expect(root.querySelector('[data-role="remaining"]')?.textContent).toBe('2 tasks left')
    store.add('Also hidden')
    expect(root.querySelectorAll('.todo-item')).toHaveLength(1)
  })
})
