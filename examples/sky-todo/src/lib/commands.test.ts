import { describe, expect, test } from 'bun:test'
import { createCommandBus } from './commands'

describe('command bus', () => {
  test('runs a registered command', () => {
    const commands = createCommandBus()
    let calls = 0
    commands.register('help:open', () => {
      calls += 1
    })
    expect(commands.run('help:open')).toBe(true)
    expect(calls).toBe(1)
  })

  test('returns false for an unknown command', () => {
    const commands = createCommandBus()
    expect(commands.run('nope')).toBe(false)
    expect(commands.has('nope')).toBe(false)
  })

  test('rejects duplicate names so features cannot silently fight', () => {
    const commands = createCommandBus()
    commands.register('search:focus', () => undefined)
    expect(() => commands.register('search:focus', () => undefined)).toThrow('already registered')
  })

  test('unregistering removes the handler', () => {
    const commands = createCommandBus()
    const off = commands.register('theme:toggle', () => undefined)
    expect(commands.names()).toEqual(['theme:toggle'])
    off()
    expect(commands.names()).toEqual([])
    expect(commands.run('theme:toggle')).toBe(false)
  })
})
