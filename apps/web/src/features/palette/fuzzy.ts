/**
 * Fuzzy matching for the command palette.
 *
 * The matcher is a small dynamic-programming alignment rather than a greedy left-to-right scan. A
 * greedy scan finds *a* subsequence, not the best one: `abc` in `a_x_b_c__abc` would match the four
 * scattered letters at the front and score worse than the consecutive `abc` at the end. The palette
 * is typed at ~10 keystrokes a second by someone who knows where they are going, so the ranking has
 * to be the best alignment, not the first one.
 *
 * Everything here is pure and deterministic: scores are numbers with fixed bonuses, ties are broken
 * by lower-cased label and then id, never by locale or object order.
 */

/** One highlighted span of the *matched text*, half-open: `[start, end)`. */
export type MatchRange = [number, number];

export interface FuzzyMatch {
  /** Higher is better. Only comparable within one query. */
  score: number;
  /** Merged half-open ranges of matched code units, in ascending order. */
  ranges: MatchRange[];
}

/* Scoring constants. Tuned by the tests in `fuzzy.test.ts`; change them together with the ranking
 * fixtures so a future tweak cannot silently reorder the demo's palette. */
const MATCH_SCORE = 1;
const WORD_START_BONUS = 5;
const PREFIX_BONUS = 8;
const CONSECUTIVE_BONUS = 4;
const POSITION_PENALTY = 0.01;

/** A secondary field is worth less than the label, so a keyword never outranks a visible title. */
const HINT_WEIGHT = 0.85;
const KEYWORD_WEIGHT = 0.75;

const WORD_CHAR = /[\p{L}\p{N}]/u;

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  return !WORD_CHAR.test(text.charAt(index - 1));
}

function charScore(text: string, index: number, first: boolean): number {
  let score = MATCH_SCORE - index * POSITION_PENALTY;
  if (isWordStart(text, index)) score += WORD_START_BONUS;
  if (first && index === 0) score += PREFIX_BONUS;
  return score;
}

/** Collapse matched positions into half-open ranges: 0,1,2,5 → [[0,3],[5,6]]. */
function toRanges(positions: readonly number[]): MatchRange[] {
  const ranges: MatchRange[] = [];
  for (const position of positions) {
    const last = ranges.at(-1);
    if (last !== undefined && last[1] === position) last[1] = position + 1;
    else ranges.push([position, position + 1]);
  }
  return ranges;
}

/**
 * Case-insensitive subsequence score for `query` inside `text`.
 *
 * Returns `undefined` when the query is not a subsequence. An empty (or whitespace-only) query
 * matches everything with score `0` and no ranges, which is what an empty palette input wants.
 */
export function fuzzyScore(query: string, text: string): FuzzyMatch | undefined {
  const needle = query.trim().toLowerCase();
  if (needle === '') return { score: 0, ranges: [] };
  const haystack = text.toLowerCase();
  if (needle.length > haystack.length) return undefined;

  const n = haystack.length;
  const m = needle.length;
  const negative = Number.NEGATIVE_INFINITY;

  // `layers[j][i]` is the best score for needle[0..j] with needle[j] matched at haystack[i].
  // `froms[j][i]` is the previous matched index for that best alignment (-1 on the first char).
  const layers: Float64Array[] = [];
  const froms: Int32Array[] = [];

  for (let j = 0; j < m; j += 1) {
    const layer = new Float64Array(n).fill(negative);
    const from = new Int32Array(n).fill(-1);
    const previous = layers[j - 1];
    // Best score of the previous layer at least one character earlier (a non-consecutive jump),
    // with its index, so the backtrack knows exactly where the jump came from.
    let bestJump = negative;
    let bestJumpIndex = -1;

    for (let i = 0; i < n; i += 1) {
      if (previous !== undefined) {
        const candidate = i - 2;
        if (candidate >= 0) {
          const candidateScore = previous[candidate] ?? negative;
          if (candidateScore > bestJump) {
            bestJump = candidateScore;
            bestJumpIndex = candidate;
          }
        }
      }
      if (haystack.charAt(i) !== needle.charAt(j)) continue;

      const base = charScore(haystack, i, j === 0);
      if (j === 0) {
        layer[i] = base;
        continue;
      }
      if (previous === undefined) continue;

      const consecutive = previous[i - 1] ?? negative;
      let best = negative;
      let source = -1;
      if (consecutive > negative) {
        best = consecutive + CONSECUTIVE_BONUS;
        source = i - 1;
      }
      if (bestJump > best) {
        best = bestJump;
        source = bestJumpIndex;
      }
      if (source >= 0) {
        layer[i] = best + base;
        from[i] = source;
      }
    }

    layers.push(layer);
    froms.push(from);
  }

  const last = layers[m - 1];
  if (last === undefined) return undefined;

  let end = -1;
  let bestScore = negative;
  for (let i = 0; i < n; i += 1) {
    const score = last[i] ?? negative;
    if (score > bestScore) {
      bestScore = score;
      end = i;
    }
  }
  if (end < 0) return undefined;

  const positions: number[] = [];
  let cursor = end;
  for (let j = m - 1; j >= 0; j -= 1) {
    positions.push(cursor);
    cursor = froms[j]?.[cursor] ?? -1;
  }
  positions.reverse();

  return { score: bestScore, ranges: toRanges(positions) };
}

/** Anything that can be searched. `hint` and `keywords` are secondary to the visible label. */
export interface Rankable {
  id?: string;
  label: string;
  hint?: string;
  keywords?: readonly string[];
}

export interface Ranked<T extends Rankable = Rankable> {
  item: T;
  score: number;
  /** Ranges into `item.label` only. Empty when the label itself did not match. */
  ranges: MatchRange[];
}

/** Deterministic, locale-independent label order (case-insensitive, then exact). */
function compareLabels(a: string, b: string): number {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function scoreItem(needle: string, item: Rankable): Ranked<Rankable> | undefined {
  const label = fuzzyScore(needle, item.label);
  let score = label?.score ?? Number.NEGATIVE_INFINITY;

  if (item.hint !== undefined) {
    const hint = fuzzyScore(needle, item.hint);
    if (hint !== undefined) score = Math.max(score, hint.score * HINT_WEIGHT);
  }
  for (const keyword of item.keywords ?? []) {
    const match = fuzzyScore(needle, keyword);
    if (match !== undefined) score = Math.max(score, match.score * KEYWORD_WEIGHT);
  }

  if (score === Number.NEGATIVE_INFINITY) return undefined;
  return { item, score, ranges: label?.ranges ?? [] };
}

/**
 * Rank items for a query.
 *
 * An empty query is not a search: the input order is kept (the shell/playground decides what
 * "most useful first" means) and no ranges are highlighted. `limit` caps the work and the render:
 * 500 tasks cost one alignment each on the first keystroke, but only 50 rows are ever mounted.
 */
export function rankItems<T extends Rankable>(query: string, items: readonly T[], limit = 50): Ranked<T>[] {
  if (limit <= 0) return [];
  const needle = query.trim();
  if (needle === '') {
    return items.slice(0, limit).map((item) => ({ item, score: 0, ranges: [] }));
  }

  const scored: Array<Ranked<T> & { order: number }> = [];
  items.forEach((item, order) => {
    const match = scoreItem(needle, item);
    if (match !== undefined) scored.push({ ...match, item, order });
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const byLabel = compareLabels(a.item.label, b.item.label);
    if (byLabel !== 0) return byLabel;
    const idA = a.item.id ?? '';
    const idB = b.item.id ?? '';
    if (idA !== idB) return idA < idB ? -1 : 1;
    return a.order - b.order;
  });

  return scored.slice(0, limit).map(({ item, score, ranges }) => ({ item, score, ranges }));
}
