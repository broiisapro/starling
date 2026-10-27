/**
 * Glob matching and conservative lane-overlap detection.
 *
 * The planner builds lanes of globs; the auditor enforces them. If two tasks can run concurrently
 * their lanes must be disjoint, so `globsOverlap` is deliberately *conservative*: it returns an
 * overlap whenever it cannot prove the patterns are disjoint. A false positive costs one
 * serialised task; a false negative costs a merge conflict.
 *
 * Supported syntax: `*` (within one path segment), `?` (one non-`/` char), `**` (zero or more
 * segments) and `[...]` character classes (with leading `!` or `^` negation). Braces and extglobs are
 * intentionally unsupported — lanes stay simple. A glob naming a directory (`src/ui`) also owns
 * everything beneath it (`src/ui/**`) because that is how workers interpret a lane.
 */

/** Normalise a path or glob: forward slashes, no `./` prefix, no duplicate or trailing slash. */
export function normalizeGlobPath(path: string): string {
  let out = path.trim().replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  out = out.replace(/\/{2,}/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function escapeRegExp(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function hasWildcard(segment: string): boolean {
  return segment.includes('*') || segment.includes('?') || segment.includes('[');
}

function segmentToRegExp(segment: string): string {
  let out = '';
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment.charAt(i);
    if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '[') {
      const close = segment.indexOf(']', i + 1);
      if (close === -1) {
        out += '\\[';
      } else {
        let body = segment.slice(i + 1, close);
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        out += `[${body.replace(/\\/g, '\\\\')}]`;
        i = close;
      }
    } else {
      out += escapeRegExp(ch);
    }
  }
  return out;
}

/** Turn a glob into a full-path regular expression. Directories do not gain implicit `/**` here. */
export function globToRegExp(glob: string): RegExp {
  const normalized = normalizeGlobPath(glob);
  const segments = normalized.split('/').filter((s) => s.length > 0);
  let source = '^';
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] as string;
    if (segment === '**') {
      if (i === segments.length - 1) {
        source += '.*';
      } else {
        source += '(?:[^/]+/)*';
      }
    } else {
      source += segmentToRegExp(segment);
      if (i !== segments.length - 1) source += '/';
    }
  }
  source += '$';
  return new RegExp(source);
}

/** True when `path` matches `glob`, applying directory semantics (`src/ui` matches `src/ui/x.ts`). */
export function matchesGlob(path: string, glob: string): boolean {
  const p = normalizeGlobPath(path);
  const g = normalizeGlobPath(glob);
  if (g === '**') return true;
  if (globToRegExp(g).test(p)) return true;
  if (g.endsWith('/**')) return p === g.slice(0, -3);
  // Only a literal trailing segment is treated as a directory. `src/*.ts` is a file glob: adding an
  // implicit `/**` would make it swallow every file below any matching file name.
  const segments = g.split('/').filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  if (last === undefined || hasWildcard(last)) return false;
  return globToRegExp(`${g}/**`).test(p);
}

/** True when the path matches at least one glob. */
export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

/** A representative string for a single-segment pattern, used to look for intersections. */
function sampleSegment(segment: string): string {
  let out = '';
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment.charAt(i);
    if (ch === '*') out += 'sample';
    else if (ch === '?') out += 'q';
    else if (ch === '[') {
      const close = segment.indexOf(']', i + 1);
      if (close === -1) {
        out += '[';
      } else {
        const body = segment.slice(i + 1, close).replace(/^[!^]/, '');
        out += body[0] ?? 'x';
        i = close;
      }
    } else out += ch;
  }
  return out;
}

function literalPrefix(segment: string): string {
  const wildcardAt = segment.search(/[*?[]/);
  return wildcardAt === -1 ? segment : segment.slice(0, wildcardAt);
}

function literalSuffix(segment: string): string {
  const wildcardAt = Math.max(segment.lastIndexOf('*'), segment.lastIndexOf('?'), segment.lastIndexOf(']'));
  return wildcardAt === -1 ? segment : segment.slice(wildcardAt + 1);
}

function segmentMatches(value: string, pattern: string): boolean {
  return globToRegExp(pattern).test(value);
}

/** Expand a `[...]` class into its member characters (ranges included; negation is not enumerated). */
function classMembers(segment: string): string[] | undefined {
  const match = /^\[([^\]]+)\]$/.exec(segment);
  if (match === null) return undefined;
  const body = match[1] ?? '';
  if (body.startsWith('!') || body.startsWith('^') || body.startsWith('\\')) return undefined;
  const chars: string[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const start = body[i];
    const dash = body[i + 1];
    const end = body[i + 2];
    if (start !== undefined && dash === '-' && end !== undefined) {
      for (let code = start.charCodeAt(0); code <= end.charCodeAt(0); code += 1) {
        chars.push(String.fromCharCode(code));
      }
      i += 2;
    } else if (start !== undefined) {
      chars.push(start);
    }
  }
  return chars;
}

/**
 * Could one path segment satisfy both patterns? Conservative: unknown → true.
 */
function segmentsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const aWild = hasWildcard(a);
  const bWild = hasWildcard(b);
  if (!aWild || !bWild) {
    if (!aWild && !bWild) return false;
    return aWild ? segmentMatches(b, a) : segmentMatches(a, b);
  }

  // Two plain character classes can be compared exactly.
  const aClass = classMembers(a);
  const bClass = classMembers(b);
  if (aClass !== undefined && bClass !== undefined) {
    const bSet = new Set(bClass);
    return aClass.some((ch) => bSet.has(ch));
  }

  // Sample both directions before falling back to structural reasoning.
  if (segmentMatches(sampleSegment(a), b) || segmentMatches(sampleSegment(b), a)) return true;

  const aPrefix = literalPrefix(a);
  const bPrefix = literalPrefix(b);
  if (aPrefix && bPrefix && !aPrefix.startsWith(bPrefix) && !bPrefix.startsWith(aPrefix)) return false;

  const aSuffix = literalSuffix(a);
  const bSuffix = literalSuffix(b);
  if (aSuffix && bSuffix && !aSuffix.endsWith(bSuffix) && !bSuffix.endsWith(aSuffix)) return false;

  // Could not prove disjointness: assume they collide.
  return true;
}

function canCoverBelow(globSegments: string[]): boolean {
  const last = globSegments[globSegments.length - 1];
  return last !== undefined && !hasWildcard(last);
}

function patternsOverlap(a: string, b: string): boolean {
  const ga = normalizeGlobPath(a);
  const gb = normalizeGlobPath(b);
  if (ga === gb) return true;
  if (ga === '**' || gb === '**') return true;
  if (ga === '' || gb === '') return false;

  const sa = ga.split('/').filter((s) => s.length > 0);
  const sb = gb.split('/').filter((s) => s.length > 0);

  let i = 0;
  let j = 0;
  while (i < sa.length && j < sb.length) {
    const x = sa[i] as string;
    const y = sb[j] as string;
    // `**` absorbs any remaining segments (including none), so both patterns can meet here.
    if (x === '**' || y === '**') return true;
    if (!segmentsOverlap(x, y)) return false;
    i += 1;
    j += 1;
  }
  if (i === sa.length && j === sb.length) return true;
  // One pattern ran out of segments. It can still match deeper paths when its final segment is a
  // literal directory name (directory semantics), or when it ended in `**` (caught above).
  if (i === sa.length) return canCoverBelow(sa);
  return canCoverBelow(sb);
}

/**
 * Return every overlapping pair as `"<a> <=> <b>"`. Empty array means the lanes are provably disjoint.
 */
export function globsOverlap(a: string[], b: string[]): string[] {
  const hits: string[] = [];
  for (const ga of a) {
    for (const gb of b) {
      if (patternsOverlap(ga, gb)) hits.push(`${ga} <=> ${gb}`);
    }
  }
  return hits;
}

/** True when the lane glob lists are provably disjoint. */
export function lanesDisjoint(a: string[], b: string[]): boolean {
  return globsOverlap(a, b).length === 0;
}
