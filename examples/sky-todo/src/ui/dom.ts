export interface ElOptions {
  className?: string
  text?: string
  html?: never
  attrs?: Record<string, string | undefined>
  dataset?: Record<string, string | undefined>
}

/**
 * Small `createElement` helper. Kept in one place so features don't need to
 * repeat the `doc.createElement` + class + dataset dance.
 */
export function createEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  options: ElOptions = {},
  children: readonly (Node | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag)
  if (options.className) element.className = options.className
  if (options.text !== undefined) element.textContent = options.text
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value !== undefined) element.setAttribute(name, value)
  }
  for (const [name, value] of Object.entries(options.dataset ?? {})) {
    if (value !== undefined) element.setAttribute(`data-${name}`, value)
  }
  for (const child of children) {
    if (child) element.appendChild(child)
  }
  return element
}
