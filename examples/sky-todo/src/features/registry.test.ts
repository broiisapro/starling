import { describe, expect, test } from 'bun:test'
import { createFeatureRegistry, defineFeature, type FeatureModule } from './registry'
import { mountTestApp } from '../testing/dom'

function feature(id: string, onRegister?: () => void): FeatureModule {
  return defineFeature({
    id,
    register() {
      onRegister?.()
    },
  })
}

describe('feature registry', () => {
  test('lists discovered features', () => {
    const registry = createFeatureRegistry([feature('alpha'), feature('beta')])
    expect(registry.list()).toEqual(['alpha', 'beta'])
  })

  test('rejects duplicate ids', () => {
    expect(() => createFeatureRegistry([feature('same'), feature('same')])).toThrow('twice')
  })

  test('registers every feature exactly once and returns the ids', () => {
    const calls: string[] = []
    const registry = createFeatureRegistry([
      feature('one', () => calls.push('one')),
      feature('two', () => calls.push('two')),
    ])
    const { ctx } = mountTestApp()
    expect(registry.registerAll(ctx)).toEqual(['one', 'two'])
    expect(calls).toEqual(['one', 'two'])
  })

  test('defineFeature rejects malformed ids and modules', () => {
    expect(() => defineFeature({ id: 'Not Kebab', register: () => undefined })).toThrow('kebab-case')
    expect(() =>
      defineFeature({ id: 'ok', register: undefined } as unknown as FeatureModule),
    ).toThrow('register')
  })
})
