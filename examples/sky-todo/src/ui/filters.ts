import type { Todo } from '../store/todos'

export type TodoFilter = (todo: Todo) => boolean

export interface FilterRegistry {
  /** Adds a predicate; all predicates must pass (AND). Returns an unregister callback. */
  add(filter: TodoFilter): () => void
  /** Returns the todos that pass every registered filter. */
  apply(todos: readonly Todo[]): Todo[]
  size(): number
}

/**
 * View-level filtering (search text, tag chips). Lives outside the store so a
 * filter never changes what is persisted, and outside `render.ts` so features
 * can add one without editing shared files.
 */
export function createFilterRegistry(): FilterRegistry {
  const filters: TodoFilter[] = []
  return {
    add(filter) {
      filters.push(filter)
      return () => {
        const index = filters.indexOf(filter)
        if (index >= 0) filters.splice(index, 1)
      }
    },
    apply(todos) {
      if (filters.length === 0) return [...todos]
      return todos.filter((todo) => filters.every((filter) => filter(todo)))
    },
    size() {
      return filters.length
    },
  }
}
