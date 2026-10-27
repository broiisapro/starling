import { createId } from '../lib/ids'

export interface Todo {
  id: string
  title: string
  done: boolean
  /** Epoch ms. */
  createdAt: number
  /** Calendar day, `YYYY-MM-DD`, local time. */
  due?: string
  tags: string[]
}

export interface NewTodo {
  due?: string
  tags?: readonly string[]
}

export type TodoPatch = Partial<Pick<Todo, 'title' | 'done' | 'due' | 'tags'>>

export type TodoListener = (todos: readonly Todo[]) => void

export interface TodoStore {
  all(): Todo[]
  get(id: string): Todo | undefined
  add(title: string, init?: NewTodo): Todo
  update(id: string, patch: TodoPatch): Todo | undefined
  toggle(id: string): Todo | undefined
  remove(id: string): boolean
  clearDone(): number
  replaceAll(todos: readonly Todo[]): void
  subscribe(listener: TodoListener): () => void
}

export interface TodoStoreOptions {
  now?: () => number
  idFactory?: () => string
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function requireTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('A todo needs a title')
  return trimmed
}

export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return []
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#/, '').toLowerCase()
    if (tag) seen.add(tag)
  }
  return [...seen].sort()
}

function cloneTodo(todo: Todo): Todo {
  return { ...todo, tags: [...todo.tags] }
}

function assertDue(due: string | undefined): string | undefined {
  if (due === undefined) return undefined
  if (!ISO_DAY.test(due)) throw new Error(`Due dates must look like YYYY-MM-DD (got "${due}")`)
  return due
}

export function createTodoStore(
  initial: readonly Todo[] = [],
  options: TodoStoreOptions = {},
): TodoStore {
  let todos = initial.map(cloneTodo)
  const listeners = new Set<TodoListener>()
  const now = options.now ?? (() => Date.now())
  const idFactory = options.idFactory ?? (() => createId('todo'))

  const snapshot = (): Todo[] => todos.map(cloneTodo)

  function emit(): void {
    const next = snapshot()
    for (const listener of [...listeners]) listener(next)
  }

  function indexOf(id: string): number {
    return todos.findIndex((todo) => todo.id === id)
  }

  return {
    all() {
      return snapshot()
    },
    get(id) {
      const todo = todos.find((entry) => entry.id === id)
      return todo ? cloneTodo(todo) : undefined
    },
    add(title, init = {}) {
      const todo: Todo = {
        id: idFactory(),
        title: requireTitle(title),
        done: false,
        createdAt: now(),
        tags: normalizeTags(init.tags),
      }
      const due = assertDue(init.due)
      if (due) todo.due = due
      todos = [...todos, todo]
      emit()
      return cloneTodo(todo)
    },
    update(id, patch) {
      const index = indexOf(id)
      if (index < 0) return undefined
      const current = todos[index]
      if (!current) return undefined
      const next: Todo = { ...current }
      if (patch.title !== undefined) next.title = requireTitle(patch.title)
      if (patch.done !== undefined) next.done = patch.done
      if ('due' in patch) {
        const due = assertDue(patch.due)
        if (due) next.due = due
        else delete next.due
      }
      if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags)
      todos = todos.map((todo, position) => (position === index ? next : todo))
      emit()
      return cloneTodo(next)
    },
    toggle(id) {
      const index = indexOf(id)
      const current = todos[index]
      if (index < 0 || !current) return undefined
      const next: Todo = { ...current, done: !current.done }
      todos = todos.map((todo, position) => (position === index ? next : todo))
      emit()
      return cloneTodo(next)
    },
    remove(id) {
      const index = indexOf(id)
      if (index < 0) return false
      todos = todos.filter((_, position) => position !== index)
      emit()
      return true
    },
    clearDone() {
      const remaining = todos.filter((todo) => !todo.done)
      const removed = todos.length - remaining.length
      if (removed > 0) {
        todos = remaining
        emit()
      }
      return removed
    },
    replaceAll(next) {
      todos = next.map(cloneTodo)
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
