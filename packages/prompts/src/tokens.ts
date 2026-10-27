/**
 * Token estimation. Deliberately crude: ~4 characters per token is the usual English-and-code
 * ratio, and the compiler only needs this for budgeting and logs, never for billing.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
