import { createEl } from '../../ui/dom'
import { defineFeature } from '../registry'
import './item-count.css'

/**
 * Example feature: proves the whole contract end to end. It owns one folder,
 * one footer slot item and one stylesheet; nothing else in the app changes.
 */
export default defineFeature({
  id: 'item-count',
  register(ctx) {
    ctx.slots.register({
      id: 'item-count',
      slot: 'footer',
      order: 10,
      render({ doc, store }) {
        const todos = store.all()
        const done = todos.filter((todo) => todo.done).length
        const label =
          todos.length === 0
            ? 'No tasks yet'
            : `${todos.length} ${todos.length === 1 ? 'task' : 'tasks'} · ${done} done`
        return createEl(doc, 'span', {
          className: 'item-count',
          text: label,
          attrs: { 'aria-live': 'polite' },
          dataset: { role: 'item-count' },
        })
      },
    })
  },
})
