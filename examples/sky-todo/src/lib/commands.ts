export type CommandHandler = () => void

export interface CommandBus {
  /** Registers a handler. Throws when the name is taken, so two features can't silently fight. */
  register(name: string, handler: CommandHandler): () => void
  /** Runs a command. Returns false when nobody registered it. */
  run(name: string): boolean
  has(name: string): boolean
  names(): string[]
}

/**
 * Named UI intents (focus the composer, open help, clear done…) so features can
 * trigger each other without importing each other or editing shared files.
 */
export function createCommandBus(): CommandBus {
  const handlers = new Map<string, CommandHandler>()

  return {
    register(name, handler) {
      if (handlers.has(name)) throw new Error(`Command already registered: ${name}`)
      handlers.set(name, handler)
      return () => {
        if (handlers.get(name) === handler) handlers.delete(name)
      }
    },
    run(name) {
      const handler = handlers.get(name)
      if (!handler) return false
      handler()
      return true
    },
    has(name) {
      return handlers.has(name)
    },
    names() {
      return [...handlers.keys()].sort()
    },
  }
}
