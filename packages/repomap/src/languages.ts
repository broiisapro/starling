/**
 * Extension-based language detection.
 *
 * There is deliberately no parser or `language-map` dependency (ASSIGNMENT: no parser deps, stay
 * cheap). Script flavours collapse into one family — `.ts`, `.tsx`, `.mts` are all `typescript`,
 * `.js`, `.jsx`, `.mjs`, `.cjs` are all `javascript` — because the planner budgets by family, not by
 * file flavour. The raw extension is still visible in `RepoFile.path`.
 */

const BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  java: 'java',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  php: 'php',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  svelte: 'svelte',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'config',
  cfg: 'config',
  conf: 'config',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  sql: 'sql',
  xml: 'xml',
  lua: 'lua',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  scala: 'scala',
  clj: 'clojure',
  cljs: 'clojure',
  pl: 'perl',
  r: 'r',
  jl: 'julia',
  tf: 'terraform',
  proto: 'protobuf',
  graphql: 'graphql',
  gql: 'graphql',
  txt: 'text',
  csv: 'csv',
  proto3: 'protobuf',
};

/** Files that carry a language but have no useful extension. */
const BY_FILENAME: Readonly<Record<string, string>> = {
  makefile: 'make',
  gnumakefile: 'make',
  dockerfile: 'docker',
  containerfile: 'docker',
  gemfile: 'ruby',
  rakefile: 'ruby',
  'cmakelists.txt': 'cmake',
  jenkinsfile: 'groovy',
  '.gitignore': 'text',
  '.dockerignore': 'text',
  '.npmrc': 'text',
  '.nvmrc': 'text',
  '.editorconfig': 'text',
  '.env': 'text',
};

/** The language bucket for a path. Unknown extensions are `other`; extensionless files are `text`. */
export function langForPath(path: string): string {
  const segments = path.split('/');
  const base = (segments.at(-1) ?? '').toLowerCase();
  const named = BY_FILENAME[base];
  if (named !== undefined) return named;

  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'text';
  const ext = base.slice(dot + 1);
  return BY_EXTENSION[ext] ?? 'other';
}

/** Languages whose files carry `symbols` from the regex extractors in `symbols.ts`. */
export const SYMBOL_LANGUAGES: ReadonlySet<string> = new Set([
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'css',
  'scss',
  'sass',
  'less',
  'markdown',
]);

/** Lockfiles are large, generated and never useful in a prompt. */
const LOCKFILES: ReadonlySet<string> = new Set([
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'cargo.lock',
  'poetry.lock',
  'pdm.lock',
  'uv.lock',
  'gemfile.lock',
  'composer.lock',
  'go.sum',
  'mix.lock',
  'flake.lock',
  'pubspec.lock',
  'packages.lock.json',
]);

export function isLockfile(path: string): boolean {
  const base = (path.split('/').at(-1) ?? '').toLowerCase();
  return LOCKFILES.has(base);
}

/** Directories we never descend into even when git lists a committed file there. */
const SKIP_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  '.starling',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  'target',
]);

/**
 * True when a repo-relative path should be excluded from the map.
 *
 * `git ls-files -co --exclude-standard` already hides untracked ignored files, but a committed
 * `node_modules` or `dist` would still show up, so the guard is not redundant.
 */
export function isSkippedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.length === 0 || normalized.endsWith('/')) return true;
  if (isLockfile(normalized)) return true;
  const segments = normalized.split('/');
  for (const segment of segments.slice(0, -1)) {
    if (SKIP_SEGMENTS.has(segment.toLowerCase())) return true;
  }
  return false;
}
