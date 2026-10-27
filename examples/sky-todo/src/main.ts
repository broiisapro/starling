import { createCommandBus, type CommandBus } from './lib/commands'
import { loadTodos, saveTodos, type StorageLike } from './store/persist'
import { createTodoStore, type TodoStore } from './store/todos'
import { createSlotRegistry, type SlotRegistry } from './ui/slots'
import { mountApp, type AppHandle } from './ui/render'
import { bootFeatures } from './features'
import type { FeatureRegistry } from './features/registry'

export interface BootOptions {
  /** `null` disables persistence; omit to use `localStorage` when available. */
  storage?: StorageLike | null
  clock?: () => number
}

export interface SkyTodoApp {
  store: TodoStore
  slots: SlotRegistry
  commands: CommandBus
  app: AppHandle
  registry: FeatureRegistry
  /** Set when saved state was unreadable; the app starts empty instead. */
  loadError?: string
  destroy(): void
}

function browserStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage
    if (!storage) return null
    const probe = '__sky_todo_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    // Safari private mode and blocked-cookie contexts throw on access.
    return null
  }
}

/** Wires store + persistence + UI + every auto-discovered feature. */
export function bootApp(root: HTMLElement, options: BootOptions = {}): SkyTodoApp {
  const storage = options.storage === undefined ? browserStorage() : options.storage
  const loaded = storage ? loadTodos(storage) : { todos: [], migrated: false }
  const store = createTodoStore(loaded.todos, options.clock ? { now: options.clock } : {})
  const slots = createSlotRegistry()
  const commands = createCommandBus()

  const app = mountApp(root, { store, slots, commands })
  const registry = bootFeatures({ doc: root.ownerDocument, root, store, slots, commands })
  app.refresh()

  const unsubscribe = storage
    ? store.subscribe((todos) => {
        try {
          saveTodos(storage, todos)
        } catch {
          // Quota or private-mode failures must never break the UI.
        }
      })
    : () => undefined

  const handle: SkyTodoApp = {
    store,
    slots,
    commands,
    app,
    registry,
    destroy() {
      unsubscribe()
      app.destroy()
    },
  }
  if (loaded.error) handle.loadError = loaded.error
  return handle
}

if (typeof document !== 'undefined') {
  const mountPoint = document.getElementById('app')
  if (mountPoint) bootApp(mountPoint)
}
