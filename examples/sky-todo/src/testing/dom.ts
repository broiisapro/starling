import { Window } from 'happy-dom'
import { createCommandBus, type CommandBus } from '../lib/commands'
import { createTodoStore, type Todo, type TodoStore } from '../store/todos'
import { mountApp, type AppHandle } from '../ui/render'
import { createSlotRegistry, type SlotRegistry } from '../ui/slots'
import type { FeatureContext } from '../features/registry'

export interface TestDom {
  window: Window
  doc: Document
  root: HTMLElement
}

export interface TestApp {
  window: Window
  doc: Document
  root: HTMLElement
  store: TodoStore
  slots: SlotRegistry
  commands: CommandBus
  app: AppHandle
  ctx: FeatureContext
}

/** Fresh happy-dom document + detached mount point. */
export function createTestDom(): TestDom {
  const window = new Window({ url: 'https://sky-todo.test/' })
  // reason: happy-dom ships its own Document class; it is DOM-compatible at runtime.
  const doc = window.document as unknown as Document
  const root = doc.createElement('div')
  doc.body.appendChild(root)
  return { window, doc, root }
}

/** Mounts the real app shell (no features) for render/store tests. */
export function mountTestApp(options: { initial?: readonly Todo[] } = {}): TestApp {
  const { window, doc, root } = createTestDom()
  const store = createTodoStore(options.initial ?? [])
  const slots = createSlotRegistry()
  const commands = createCommandBus()
  const app = mountApp(root, { store, slots, commands })
  return {
    window,
    doc,
    root,
    store,
    slots,
    commands,
    app,
    ctx: { doc, root, store, slots, commands },
  }
}
