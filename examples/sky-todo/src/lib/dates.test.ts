import { describe, expect, test } from 'bun:test'
import {
  daysUntil,
  formatIso,
  formatMdy,
  formatShort,
  isOverdue,
  parseDay,
  relativeDays,
  sortByDue,
  todayIso,
} from './dates'
import type { Todo } from '../store/todos'

const NOW = new Date(2026, 9, 27, 15, 30)

function todo(id: string, due?: string, createdAt = NOW.getTime()): Todo {
  const entry: Todo = { id, title: id, done: false, createdAt, tags: [] }
  if (due) entry.due = due
  return entry
}

describe('parseDay', () => {
  test('parses a calendar day as local midnight', () => {
    const day = parseDay('2026-10-27')
    expect(day.getFullYear()).toBe(2026)
    expect(day.getMonth()).toBe(9)
    expect(day.getDate()).toBe(27)
    expect(day.getHours()).toBe(0)
    expect(day.getMinutes()).toBe(0)
  })

  test('accepts Dates and epoch milliseconds', () => {
    expect(formatIso(parseDay(new Date(2026, 0, 5, 18, 0)))).toBe('2026-01-05')
    expect(formatIso(parseDay(new Date(2026, 0, 5, 18, 0).getTime()))).toBe('2026-01-05')
  })

  test('rejects nonsense', () => {
    expect(() => parseDay('not-a-day')).toThrow()
  })
})

describe('formatting', () => {
  test('formatIso pads month and day', () => {
    expect(formatIso('2026-03-04')).toBe('2026-03-04')
  })

  test('formatMdy drops the padding', () => {
    expect(formatMdy('2026-09-30')).toBe('9/30/2026')
  })

  test('formatShort gives a badge label', () => {
    expect(formatShort('2026-10-05')).toBe('Oct 5')
  })

  test('todayIso follows the supplied clock', () => {
    expect(todayIso(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })
})

describe('daysUntil', () => {
  test('counts whole local days', () => {
    expect(daysUntil('2026-10-27', NOW)).toBe(0)
    expect(daysUntil('2026-10-30', NOW)).toBe(3)
    expect(daysUntil('2026-10-24', NOW)).toBe(-3)
  })
})

describe('isOverdue', () => {
  test('is true for a day long past', () => {
    expect(isOverdue('2020-01-01', NOW)).toBe(true)
  })

  test('is false for a day far ahead', () => {
    expect(isOverdue('2099-01-01', NOW)).toBe(false)
  })

  test('is false without a due date', () => {
    expect(isOverdue(undefined, NOW)).toBe(false)
  })
})

describe('relativeDays', () => {
  test('speaks human', () => {
    expect(relativeDays('2026-10-27', NOW)).toBe('today')
    expect(relativeDays('2026-10-28', NOW)).toBe('tomorrow')
    expect(relativeDays('2026-10-30', NOW)).toBe('in 3 days')
    expect(relativeDays('2026-10-26', NOW)).toBe('yesterday')
    expect(relativeDays('2026-10-23', NOW)).toBe('4 days ago')
  })
})

describe('sortByDue', () => {
  test('returns a new array and keeps clearly ordered dates in order', () => {
    const input = [todo('sep', '2026-09-30'), todo('mar', '2026-03-04')]
    const sorted = sortByDue(input)
    expect(sorted).not.toBe(input)
    expect(sorted.map((entry) => entry.id)).toEqual(['mar', 'sep'])
    expect(input.map((entry) => entry.id)).toEqual(['sep', 'mar'])
  })
})
