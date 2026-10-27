export type ClassValue = string | false | null | undefined;

/** Join class names, dropping the falsy branches. Keeps conditional Tailwind strings readable. */
export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}
