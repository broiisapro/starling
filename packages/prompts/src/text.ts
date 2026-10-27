/** Small, dependency-free text helpers shared by the prompt builders. */

/** Join sections with a blank line, dropping empty ones so optional sections leave no gaps. */
export function joinSections(sections: Array<string | undefined>): string {
  return sections
    .map((section) => (section ?? '').trim())
    .filter((section) => section.length > 0)
    .join('\n\n');
}

/** `- a` lines. Pass `indent` for nested bullets. */
export function bullets(items: string[], indent = ''): string {
  return items.map((item) => `${indent}- ${item}`).join('\n');
}

/** `1. a` lines, numbered from one. Deterministic: no locale formatting. */
export function numbered(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

/** Backtick a value for readability, without exploding on values that already contain backticks. */
export function code(value: string): string {
  return value.includes('`') ? value : `\`${value}\``;
}

/** Human byte size, fixed precision so snapshots never vary by locale. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pluralise with an explicit plural form: no `Intl`, no surprises. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Clamp a multi-line string to `maxChars`, marking the cut so a reader knows it was truncated. */
export function clamp(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, Math.max(0, maxChars));
  return `${text.slice(0, maxChars - 3).trimEnd()}…`;
}
