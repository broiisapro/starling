/**
 * Cheap, parser-free symbol extraction.
 *
 * The planner only needs "what lives where" — enough to name lanes and orient a worker. Tree-sitter
 * is explicitly out of scope, so every extractor is a small, line-anchored regex. False negatives
 * are acceptable; false positives (matching inside comments or strings) are rare enough to live
 * with, and each file is capped at 40 symbols.
 */
import { SYMBOL_LANGUAGES } from './languages';

const MAX_SYMBOLS = 40;
const MAX_CSS_SELECTORS = 20;

interface Hit {
  name: string;
  index: number;
}

function collect(source: string, patterns: readonly RegExp[]): Hit[] {
  const hits: Hit[] = [];
  for (const pattern of patterns) {
    // Fresh lastIndex per call because the regexes are module-level and stateful with /g.
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      const name = match[1]?.trim();
      if (name !== undefined && name.length > 0) {
        hits.push({ name, index: match.index + (match[0].length - name.length) });
      }
      if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
      match = pattern.exec(source);
    }
  }
  return hits;
}

function finish(hits: readonly Hit[], limit = MAX_SYMBOLS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hit of [...hits].sort((a, b) => a.index - b.index)) {
    const name = sanitize(hit.name);
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

/** Strip decorators (`@Component`), keywords and trailing punctuation from a captured name. */
function sanitize(raw: string): string {
  let name = raw.trim();
  name = name.replace(/^["']|["']$/g, '');
  name = name.replace(/[;{}=]+$/g, '');
  name = name.replace(/\s+as\s+.*$/, '');
  if (name.length > 80) {
    const short = name.slice(0, 80);
    const cut = short.search(/[^\w$.-]/);
    name = cut > 0 ? short.slice(0, cut) : short;
  }
  return name;
}

const TS_PATTERNS: readonly RegExp[] = [
  /\bexport\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:interface|type|enum|namespace|module)\s+([A-Za-z_$][\w$]*)/g,
  /\bexports\.([A-Za-z_$][\w$]*)\s*=/g,
  /\bmodule\.exports\.([A-Za-z_$][\w$]*)\s*=/g,
  /\bexport\s+default\s+(?!function\b|class\b|async\b)([A-Za-z_$][\w$]*)\s*;?/g,
];

/** `export { a, b as c, type D }` → a, c, D (specifiers only, never the whole clause). */
const TS_EXPORT_LIST = /\bexport\s*(?:type\s*)?\{([^}]*)\}/g;

function typescriptSymbols(source: string): string[] {
  const hits = collect(source, TS_PATTERNS);
  TS_EXPORT_LIST.lastIndex = 0;
  let match = TS_EXPORT_LIST.exec(source);
  while (match !== null) {
    const body = match[1] ?? '';
    for (const rawSpecifier of body.split(',')) {
      const specifier = rawSpecifier.trim().replace(/^type\s+/, '');
      if (specifier.length === 0) continue;
      const parts = specifier.split(/\s+as\s+/);
      const name = (parts.at(-1) ?? specifier).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) hits.push({ name, index: match.index });
    }
    if (TS_EXPORT_LIST.lastIndex === match.index) TS_EXPORT_LIST.lastIndex += 1;
    match = TS_EXPORT_LIST.exec(source);
  }
  return finish(hits);
}

const PYTHON_PATTERNS: readonly RegExp[] = [
  /^(?:async\s+)?def\s+([A-Za-z_]\w*)/gm,
  /^class\s+([A-Za-z_]\w*)/gm,
];

const GO_PATTERNS: readonly RegExp[] = [
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm,
  /^type\s+([A-Za-z_]\w*)/gm,
];

const RUST_PATTERNS: readonly RegExp[] = [
  /^pub(?:\([^)]*\))?\s+(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/gm,
  /^pub(?:\([^)]*\))?\s+(?:struct|enum|trait|type|const|static|mod)\s+([A-Za-z_]\w*)/gm,
];

const CSS_BLOCK = /^([^\s{};][^{}\n;]*)\{/gm;
const CSS_CLASS = /\.(-?[_a-zA-Z][\w-]*)/g;

/** Top-level class selectors only: lines starting at column 0 that open a rule. */
function cssSymbols(source: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  CSS_BLOCK.lastIndex = 0;
  let block = CSS_BLOCK.exec(source);
  while (block !== null && names.length < MAX_CSS_SELECTORS) {
    const selector = block[1] ?? '';
    if (!selector.trimStart().startsWith('@')) {
      CSS_CLASS.lastIndex = 0;
      let cls = CSS_CLASS.exec(selector);
      while (cls !== null && names.length < MAX_CSS_SELECTORS) {
        const name = cls[1];
        if (name !== undefined && !seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
        cls = CSS_CLASS.exec(selector);
      }
    }
    if (CSS_BLOCK.lastIndex === block.index) CSS_BLOCK.lastIndex += 1;
    block = CSS_BLOCK.exec(source);
  }
  return names;
}

const MARKDOWN_HEADING = /^#{1,2}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;

function markdownSymbols(source: string): string[] {
  const hits: Hit[] = [];
  MARKDOWN_HEADING.lastIndex = 0;
  let match = MARKDOWN_HEADING.exec(source);
  while (match !== null) {
    const heading = (match[1] ?? '').replace(/[*_`]/g, '').trim();
    hits.push({ name: heading, index: match.index });
    if (MARKDOWN_HEADING.lastIndex === match.index) MARKDOWN_HEADING.lastIndex += 1;
    match = MARKDOWN_HEADING.exec(source);
  }
  return finish(hits);
}

/**
 * Extract declared, top-level symbols from `source` for `lang`. Returns `[]` for languages without
 * an extractor (JSON, YAML, HTML, …). Order follows the file, never alphabetical.
 */
export function extractSymbols(source: string, lang: string): string[] {
  if (!SYMBOL_LANGUAGES.has(lang)) return [];
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return typescriptSymbols(source);
    case 'python':
      return finish(collect(source, PYTHON_PATTERNS));
    case 'go':
      return finish(collect(source, GO_PATTERNS));
    case 'rust':
      return finish(collect(source, RUST_PATTERNS));
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return cssSymbols(source);
    case 'markdown':
      return markdownSymbols(source);
    default:
      return [];
  }
}

/** The cap, exported so tests and docs agree on one number. */
export const SYMBOL_CAP = MAX_SYMBOLS;
