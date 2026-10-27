import type { CommandBus } from '../lib/commands'
import type { TodoStore } from '../store/todos'
import type { FilterRegistry } from '../ui/filters'
import type { SlotRegistry } from '../ui/slots'

export interface FeatureContext {
  doc: Document
  /** The mounted app container. */
  root: HTMLElement
  store: TodoStore
  slots: SlotRegistry
  commands: CommandBus
  filters: FilterRegistry
  /** Re-renders the list and slots (call after changing feature-local state). */
  refresh(): void
}

export interface FeatureModule {
  /** Kebab-case, unique across the app; used in errors and slot item ids. */
  id: string
  register(ctx: FeatureContext): void
}

export interface FeatureRegistry {
  list(): readonly string[]
  /** Registers every feature. Returns the ids that ran, in order. */
  registerAll(ctx: FeatureContext): string[]
}

/** Identity helper that fails fast on a malformed feature module. */
export function defineFeature(feature: FeatureModule): FeatureModule {
  if (!/^[a-z][a-z0-9-]*$/.test(feature.id)) {
    throw new Error(`Feature id must be kebab-case, got "${feature.id}"`)
  }
  if (typeof feature.register !== 'function') {
    throw new Error(`Feature "${feature.id}" has no register() function`)
  }
  return feature
}

export function createFeatureRegistry(features: readonly FeatureModule[]): FeatureRegistry {
  const seen = new Set<string>()
  for (const feature of features) {
    if (seen.has(feature.id)) throw new Error(`Feature "${feature.id}" was discovered twice`)
    seen.add(feature.id)
  }
  return {
    list: () => [...seen],
    registerAll(ctx) {
      for (const feature of features) feature.register(ctx)
      return features.map((feature) => feature.id)
    },
  }
}
