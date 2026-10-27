import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { FeatureModule } from './registry'

const FEATURES_DIR = fileURLToPath(new URL('.', import.meta.url))

/**
 * Bun-only twin of Vite's `import.meta.glob` discovery, used by tests so the
 * "new feature folder = new feature" contract is verifiable without a build.
 * The browser always uses the glob in `features/index.ts`.
 */
export async function discoverFeatureModulesFromDisk(
  dir: string = FEATURES_DIR,
): Promise<FeatureModule[]> {
  const features: FeatureModule[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const indexPath = join(dir, entry.name, 'index.ts')
    if (!existsSync(indexPath)) continue
    const module = (await import(pathToFileURL(indexPath).href)) as { default?: FeatureModule }
    const feature = module.default
    if (!feature) throw new Error(`src/features/${entry.name}/index.ts has no default export`)
    features.push(feature)
  }
  return features.sort((a, b) => a.id.localeCompare(b.id))
}
