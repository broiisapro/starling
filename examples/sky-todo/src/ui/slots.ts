import type { CommandBus } from '../lib/commands'
import type { TodoStore } from '../store/todos'

export const SLOT_NAMES = [
  'header-right',
  'toolbar',
  'item-badges',
  'footer',
  'overlay',
] as const

export type SlotName = (typeof SLOT_NAMES)[number]

export interface SlotHost {
  doc: Document
  store: TodoStore
  commands: CommandBus
  /** Only set for the per-todo `item-badges` slot. */
  todo?: import('../store/todos').Todo
}

export interface SlotItem {
  /** Unique within its slot. Use your feature id plus a suffix when you add several. */
  id: string
  slot: SlotName
  /** Lower numbers render first. Defaults to 100. */
  order?: number
  /** Called on every render pass; return a fresh node (or null to render nothing). */
  render(host: SlotHost): Node | null
}

export interface SlotRegistry {
  register(item: SlotItem): () => void
  items(slot: SlotName): readonly SlotItem[]
  has(slot: SlotName, id: string): boolean
  /** Replaces the container's children with the slot's items. Returns how many rendered. */
  render(slot: SlotName, container: Element, host: SlotHost): number
}

const DEFAULT_ORDER = 100

export function createSlotRegistry(): SlotRegistry {
  const slots = new Map<SlotName, SlotItem[]>()
  for (const name of SLOT_NAMES) slots.set(name, [])

  return {
    register(item) {
      if (!SLOT_NAMES.includes(item.slot)) throw new Error(`Unknown slot: ${item.slot}`)
      const bucket = slots.get(item.slot)
      if (!bucket) throw new Error(`Unknown slot: ${item.slot}`)
      if (bucket.some((entry) => entry.id === item.id)) {
        throw new Error(`Slot ${item.slot} already has an item called ${item.id}`)
      }
      bucket.push(item)
      bucket.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER) || a.id.localeCompare(b.id))
      return () => {
        const next = slots.get(item.slot)
        if (!next) return
        const index = next.indexOf(item)
        if (index >= 0) next.splice(index, 1)
      }
    },
    items(slot) {
      return [...(slots.get(slot) ?? [])]
    },
    has(slot, id) {
      return (slots.get(slot) ?? []).some((entry) => entry.id === id)
    },
    render(slot, container, host) {
      const nodes: Node[] = []
      for (const item of slots.get(slot) ?? []) {
        const node = item.render(host)
        if (node) nodes.push(node)
      }
      container.replaceChildren(...nodes)
      return nodes.length
    },
  }
}
