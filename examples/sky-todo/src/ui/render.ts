import type { CommandBus } from '../lib/commands'
import type { Todo, TodoStore } from '../store/todos'
import { createEl } from './dom'
import type { FilterRegistry } from './filters'
import type { SlotHost, SlotRegistry } from './slots'

export interface MountOptions {
  store: TodoStore
  slots: SlotRegistry
  commands: CommandBus
  filters: FilterRegistry
}

export interface AppHandle {
  readonly root: HTMLElement
  readonly input: HTMLInputElement
  /** Re-renders the list, counts and every slot. Cheap; call it after any store edit. */
  refresh(): void
  destroy(): void
}

export function mountApp(root: HTMLElement, options: MountOptions): AppHandle {
  const doc = root.ownerDocument
  const { store, slots, commands, filters } = options

  const input = createEl(doc, 'input', {
    className: 'new-todo',
    attrs: {
      type: 'text',
      placeholder: 'Add a task…',
      'aria-label': 'New task',
      autocomplete: 'off',
    },
    dataset: { role: 'new-title' },
  })

  const form = createEl(
    doc,
    'form',
    { className: 'composer', dataset: { role: 'composer' } },
    [
      input,
      createEl(doc, 'button', {
        className: 'btn btn-primary',
        text: 'Add',
        attrs: { type: 'submit' },
      }),
    ],
  )

  const headerSlot = createEl(doc, 'div', {
    className: 'slot slot-header',
    dataset: { slot: 'header-right' },
  })
  const toolbarSlot = createEl(doc, 'div', {
    className: 'slot slot-toolbar',
    dataset: { slot: 'toolbar' },
  })
  const footerSlot = createEl(doc, 'div', {
    className: 'slot slot-footer',
    dataset: { slot: 'footer' },
  })
  const overlaySlot = createEl(doc, 'div', {
    className: 'slot slot-overlay',
    dataset: { slot: 'overlay' },
  })

  const header = createEl(doc, 'header', { className: 'app-header' }, [
    createEl(doc, 'div', { className: 'brand' }, [
      createEl(doc, 'span', { className: 'brand-mark', text: '🐦', attrs: { 'aria-hidden': 'true' } }),
      createEl(doc, 'h1', { className: 'brand-title', text: 'Sky Todo' }),
    ]),
    headerSlot,
  ])

  const list = createEl(doc, 'ul', {
    className: 'todo-list',
    attrs: { 'aria-label': 'Tasks' },
    dataset: { role: 'list' },
  })
  const empty = createEl(doc, 'p', {
    className: 'empty',
    text: 'Nothing in the sky yet. Add your first task.',
  })
  empty.hidden = true

  const remaining = createEl(doc, 'span', {
    className: 'remaining',
    dataset: { role: 'remaining' },
  })

  const footer = createEl(doc, 'footer', { className: 'app-footer' }, [
    remaining,
    footerSlot,
    createEl(doc, 'button', {
      className: 'btn btn-quiet',
      text: 'Clear done',
      attrs: { type: 'button' },
      dataset: { action: 'clear-done' },
    }),
  ])

  const container = createEl(doc, 'div', { className: 'app' }, [
    header,
    form,
    toolbarSlot,
    list,
    empty,
    footer,
    overlaySlot,
  ])

  root.replaceChildren(container)

  const host = (todo?: Todo): SlotHost => ({ doc, store, commands, ...(todo ? { todo } : {}) })

  function renderItem(todo: Todo): HTMLElement {
    const checkbox = createEl(doc, 'input', {
      className: 'todo-check',
      attrs: {
        type: 'checkbox',
        'aria-label': `${todo.done ? 'Mark as not done' : 'Mark as done'}: ${todo.title}`,
      },
      dataset: { action: 'toggle' },
    })
    checkbox.checked = todo.done

    const badges = createEl(doc, 'div', {
      className: 'slot slot-badges',
      dataset: { slot: 'item-badges' },
    })
    slots.render('item-badges', badges, host(todo))

    const item = createEl(doc, 'li', {
      className: todo.done ? 'todo-item is-done' : 'todo-item',
      dataset: { id: todo.id },
    }, [
      checkbox,
      createEl(doc, 'span', { className: 'todo-title', text: todo.title }),
      badges,
      createEl(doc, 'button', {
        className: 'todo-remove',
        text: '×',
        attrs: { type: 'button', 'aria-label': `Delete: ${todo.title}`, title: 'Delete' },
        dataset: { action: 'remove' },
      }),
    ])
    return item
  }

  function refresh(): void {
    const all = store.all()
    const visible = filters.apply(all)
    list.replaceChildren(...visible.map(renderItem))
    empty.hidden = visible.length > 0
    const open = all.filter((todo) => !todo.done).length
    remaining.textContent = open === 1 ? '1 task left' : `${open} tasks left`
    slots.render('header-right', headerSlot, host())
    slots.render('toolbar', toolbarSlot, host())
    slots.render('footer', footerSlot, host())
    slots.render('overlay', overlaySlot, host())
  }

  function itemId(trigger: Element): string | undefined {
    return trigger.closest('[data-id]')?.getAttribute('data-id') ?? undefined
  }

  function onSubmit(event: Event): void {
    event.preventDefault()
    const title = input.value.trim()
    if (!title) {
      input.focus()
      return
    }
    store.add(title)
    input.value = ''
    input.focus()
  }

  function onClick(event: Event): void {
    const target = event.target as Element | null
    const trigger = target && typeof target.closest === 'function' ? target.closest('[data-action]') : null
    if (!trigger) return
    const action = trigger.getAttribute('data-action')
    if (action === 'toggle') {
      const id = itemId(trigger)
      if (id) store.toggle(id)
    } else if (action === 'remove') {
      const id = itemId(trigger)
      if (id) store.remove(id)
    } else if (action === 'clear-done') {
      store.clearDone()
    }
  }

  form.addEventListener('submit', onSubmit)
  container.addEventListener('click', onClick)

  const unregisterNew = commands.register('todo:new', () => {
    input.focus()
    input.select()
  })
  const unregisterClear = commands.register('todo:clear-done', () => store.clearDone())

  const unsubscribe = store.subscribe(() => refresh())
  refresh()

  return {
    root: container,
    input,
    refresh,
    destroy() {
      unsubscribe()
      unregisterNew()
      unregisterClear()
      form.removeEventListener('submit', onSubmit)
      container.removeEventListener('click', onClick)
      root.replaceChildren()
    },
  }
}
