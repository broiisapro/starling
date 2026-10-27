import type { Todo } from '../store/todos'

export const MS_PER_DAY = 86_400_000

export type DateInput = string | number | Date

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Midnight at the start of the given day, in the viewer's local timezone. */
export function startOfDay(date: Date): Date {
  const copy = new Date(date.getTime())
  copy.setHours(0, 0, 0, 0)
  return copy
}

/**
 * Parses a calendar day in local time. `YYYY-MM-DD` is treated as a plain day,
 * not as UTC midnight, so it never shifts across the date line.
 */
export function parseDay(value: DateInput): Date {
  if (value instanceof Date) return startOfDay(value)
  if (typeof value === 'number') return startOfDay(new Date(value))
  const day = ISO_DAY.exec(value)
  if (day) {
    return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Not a date: ${value}`)
  return startOfDay(parsed)
}

/** Parses timestamps as-is and calendar days as local midnight. */
export function toDate(value: DateInput): Date {
  if (value instanceof Date) return new Date(value.getTime())
  if (typeof value === 'number') return new Date(value)
  if (ISO_DAY.test(value)) return parseDay(value)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Not a date: ${value}`)
  return parsed
}

/** `YYYY-MM-DD`, the format the store and the `<input type="date">` both use. */
export function formatIso(value: DateInput): string {
  const date = toDate(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Compact `M/D/YYYY` label used by badges and exports. */
export function formatMdy(value: DateInput): string {
  const date = toDate(value)
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}

/** `Oct 27` — friendlier for a badge. */
export function formatShort(value: DateInput): string {
  const date = toDate(value)
  const month = SHORT_MONTHS[date.getMonth()] ?? '???'
  return `${month} ${date.getDate()}`
}

export function todayIso(now: Date = new Date()): string {
  return formatIso(now)
}

/** Whole calendar days from `now` to `due`. Negative means the due day has passed. */
export function daysUntil(due: DateInput, now: Date = new Date()): number {
  return Math.round((parseDay(due).getTime() - startOfDay(now).getTime()) / MS_PER_DAY)
}

export function isOverdue(due: string | undefined, now: Date = new Date()): boolean {
  if (!due) return false
  return new Date(due).getTime() < now.getTime()
}

/** "today", "tomorrow", "in 3 days", "yesterday", "4 days ago". */
export function relativeDays(due: DateInput, now: Date = new Date()): string {
  const days = daysUntil(due, now)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`
}

/** Soonest due date first; todos without a due date stay somewhere in the middle. */
export function sortByDue(todos: readonly Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const left = a.due ? formatMdy(a.due) : formatMdy(a.createdAt)
    const right = b.due ? formatMdy(b.due) : formatMdy(b.createdAt)
    return left < right ? -1 : left > right ? 1 : 0
  })
}
