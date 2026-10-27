import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverFeatureModulesFromDisk } from './discover.node'
import { createFeatureRegistry } from './registry'
import { mountTestApp } from '../testing/dom'

const featuresDir = fileURLToPath(new URL('.', import.meta.url))

function featureFolders(): string[] {
  return readdirSync(featuresDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(featuresDir, entry.name, 'index.ts')))
    .map((entry) => entry.name)
    .sort()
}

describe('auto-discovery', () => {
  test('finds every feature folder that has an index.ts', async () => {
    const features = await discoverFeatureModulesFromDisk()
    expect(features.map((feature) => feature.id)).toContain('item-count')
    expect(features).toHaveLength(featureFolders().length)
  })

  test('every discovered module is registerable and ids are unique', async () => {
    const features = await discoverFeatureModulesFromDisk()
    const ids = features.map((feature) => feature.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const feature of features) expect(typeof feature.register).toBe('function')
  })

  test('booting the discovered feature set reaches the footer slot', async () => {
    const features = await discoverFeatureModulesFromDisk()
    const app = mountTestApp()
    createFeatureRegistry(features).registerAll(app.ctx)
    app.app.refresh()
    expect(app.root.querySelector('[data-role="item-count"]')?.textContent).toBe('No tasks yet')
    app.store.add('a discovered task')
    expect(app.root.querySelector('[data-role="item-count"]')?.textContent).toBe(
      '1 task · 0 done',
    )
  })
})
