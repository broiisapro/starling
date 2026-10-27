import {
  createFeatureRegistry,
  type FeatureContext,
  type FeatureModule,
  type FeatureRegistry,
} from './registry'

type FeatureModuleRecord = FeatureModule & { default?: FeatureModule }

function pickFeature(path: string, module: FeatureModuleRecord): FeatureModule {
  const feature = module.default ?? module
  if (!feature || typeof feature.register !== 'function' || typeof feature.id !== 'string') {
    throw new Error(`${path} must default-export defineFeature({ ... })`)
  }
  return feature
}

/**
 * Every folder under `src/features/` that has an `index.ts` is a feature.
 *
 * Vite rewrites the glob call below into an eager module map at build time, so a
 * new feature only has to add its own folder: no shared file is edited, and two
 * agents never touch the same line. Outside Vite (Bun's test runner) the call
 * throws and we fall back to `discover.node.ts`, which tests import directly.
 */
export function loadFeatureModules(): FeatureModule[] {
  let modules: Record<string, FeatureModuleRecord> = {}
  try {
    modules = import.meta.glob('./*/index.ts', { eager: true }) as Record<
      string,
      FeatureModuleRecord
    >
  } catch {
    return []
  }
  return Object.keys(modules)
    .sort()
    .map((path) => pickFeature(path, modules[path] as FeatureModuleRecord))
}

export function bootFeatures(ctx: FeatureContext): FeatureRegistry {
  const registry = createFeatureRegistry(loadFeatureModules())
  registry.registerAll(ctx)
  return registry
}
