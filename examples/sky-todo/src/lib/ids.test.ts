import { expect, test } from 'bun:test'
import { createId, resetIdSequence } from './ids'

test('ids are unique and carry their prefix', () => {
  resetIdSequence()
  const ids = new Set<string>()
  for (let index = 0; index < 1000; index += 1) ids.add(createId('todo'))
  expect(ids.size).toBe(1000)
  for (const id of ids) expect(id.startsWith('todo_')).toBe(true)
})

test('the prefix defaults to id', () => {
  expect(createId().startsWith('id_')).toBe(true)
})
