import { describe, expect, test } from 'bun:test'
import itemCount from './index'
import { createFeatureRegistry } from '../registry'
import { mountTestApp } from '../../testing/dom'

function bootWithCount() {
  const app = mountTestApp()
  createFeatureRegistry([itemCount]).registerAll(app.ctx)
  app.app.refresh()
  return app
}

describe('item-count feature', () => {
  test('renders an empty-state label in the footer slot', () => {
    const { root } = bootWithCount()
    const label = root.querySelector('[data-role="item-count"]')
    expect(label?.textContent).toBe('No tasks yet')
    expect(label?.closest('[data-slot="footer"]')).not.toBeNull()
  })

  test('counts tasks and completed tasks', () => {
    const { store, root } = bootWithCount()
    store.add('one')
    expect(root.querySelector('[data-role="item-count"]')?.textContent).toBe('1 task · 0 done')
    store.add('two')
    store.toggle(store.all()[1]?.id ?? '')
    expect(root.querySelector('[data-role="item-count"]')?.textContent).toBe('2 tasks · 1 done')
  })

  test('is only registered once', () => {
    const { ctx, slots } = bootWithCount()
    expect(() => itemCount.register(ctx)).toThrow('already has an item')
    expect(slots.items('footer').filter((item) => item.id === 'item-count')).toHaveLength(1)
  })
})
