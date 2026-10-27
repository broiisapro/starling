/** Tiny class-name joiner (no clsx dependency, no template-string soup). */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => typeof value === 'string' && value !== '').join(' ');
}
