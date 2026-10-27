# Sky Todo features

Every feature lives in **one folder** here and touches **no file outside it**.
A new folder with an `index.ts` is picked up automatically: in Vite the app
glob-imports `./*/index.ts` (eager), so there is no central registration list to
edit and two agents can never conflict on one.

```
src/features/<your-feature>/
  index.ts          default-exports defineFeature({ id, register(ctx) })
  <anything>.css    imported from index.ts; Vite bundles it
  index.test.ts     optional, colocated
```

`id` must be kebab-case and unique. Test it with `bun test`.

## The contract

```ts
import { defineFeature } from '../registry'

export default defineFeature({
  id: 'my-feature',
  register(ctx) {
    // ctx = { doc, root, store, slots, commands }
  },
})
```

`ctx` gives you:

| Field      | What it is                                                                 |
| ---------- | -------------------------------------------------------------------------- |
| `doc`      | The document to create nodes with (`doc.createElement`). Never use `document`. |
| `root`     | The mounted app container (`#app > .app`).                                  |
| `store`    | Todo store: `all()`, `add()`, `update()`, `toggle()`, `remove()`, `clearDone()`, `replaceAll()`, `subscribe()`. |
| `slots`    | Slot registry — register renderable items (below).                          |
| `commands` | Named UI intents so features can trigger each other without importing each other. |
| `filters`  | View filters — hide rows without touching the store (search, tag chips).    |
| `refresh`  | Re-renders the list and every slot; call it after changing local state.     |

`register()` runs once at boot, before the first paint.

## Slots

| Slot            | Where it renders                          | Good for                          |
| --------------- | ----------------------------------------- | --------------------------------- |
| `header-right`  | Right side of the header                  | theme toggle, settings            |
| `toolbar`       | Above the list                            | search box, filter chips, export  |
| `item-badges`   | Inside every todo row (per-todo host)     | due-date badges, tag chips        |
| `footer`        | Bottom row, next to counts                | stats, hints, extra actions       |
| `overlay`       | Below the list, in the card               | modals, help sheet, toasts        |

```ts
ctx.slots.register({
  id: 'my-feature:badge', // unique within the slot
  slot: 'item-badges',
  order: 20,              // optional, lower renders first (default 100)
  render({ doc, todo }) { // called on every render; `todo` is set for item-badges
    if (!todo?.due) return null
    return doc.createElement('span')
  },
})
```

`render` must return a **fresh node** each time (or `null`). The app re-renders
slots after every store change. Keep per-feature state in the closure.

## Commands

Commands are the cross-feature API. Register the ones you own, run the ones you
need; never import another feature's module.

| Command            | Owner       | Does                                  |
| ------------------ | ----------- | ------------------------------------- |
| `todo:new`         | app shell   | Focuses the composer input            |
| `todo:clear-done`  | app shell   | Removes completed todos               |

Examples: a search feature registers `search:focus`; help registers `help:open`;
shortcuts runs `todo:new`, `search:focus` and `help:open` on `n`, `/`, `?`.

Registering a name twice throws — pick a namespaced name (`<feature>:<action>`).

## Filters

A filter hides rows from the view without changing stored data. All filters are
ANDed; counts in the footer still describe the whole list.

```ts
const off = ctx.filters.add((todo) => todo.title.toLowerCase().includes(query))
ctx.refresh() // after the query changes
// off() removes the filter
```

Search and tag chips are built this way, so neither feature edits the renderer.

## Styles

Base colours are CSS custom properties in `src/ui/styles.css` (`--sky-bg`,
`--sky-surface`, `--sky-text`, `--sky-accent`, `--sky-border`, `--sky-muted`,
`--sky-danger`, `--sky-radius`). Consume the variables; don't hard-code colours.
Put your CSS in your own folder and `import './my-feature.css'` from
`index.ts`. A theme feature can redefine the variables on `[data-theme='…']`.

## Testing

Tests are colocated and run with `bun test`. For DOM work, build a document with
happy-dom:

```ts
import { createTestDom } from '../../testing/dom'
const { doc, root } = createTestDom()
```

`src/features/discovery.test.ts` boots every folder through
`src/features/discover.node.ts` and asserts it registers cleanly, so a broken
feature fails CI without anyone editing a shared file.
