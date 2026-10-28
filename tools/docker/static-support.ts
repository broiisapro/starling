/**
 * Parsing and matching helpers for the container-lane static tests (Epic 153).
 *
 * No Docker daemon is available on the build laptops, so the tests read the Dockerfile, the
 * `.dockerignore` and `devcontainer.json` directly. Everything here is a pure function over text or a
 * read-only helper, so the two suites next to it stay about assertions rather than plumbing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { matchesGlob } from '../../packages/core/src/index.ts';

export const ROOT = resolve(import.meta.dir, '../..');
export const BUN_VERSION = readFileSync(join(ROOT, '.bun-version'), 'utf8').trim();
export const DOCKERFILE = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
export const DOCKERIGNORE = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
export const DEVCONTAINER = readFileSync(join(ROOT, '.devcontainer/devcontainer.json'), 'utf8');
export const SMOKE = readFileSync(join(ROOT, 'tools/docker/smoke.sh'), 'utf8');

// ── Dockerfile parsing ───────────────────────────────────────────────────────────────────────────────

export interface Instruction {
  command: string;
  args: string;
  line: number;
}

export interface Stage {
  name: string;
  base: string;
  instructions: Instruction[];
}

export interface CopyInstruction {
  from?: string;
  chown?: string;
  sources: string[];
  destination: string;
  line: number;
}

/** Split a Dockerfile into instructions, joining `\\` continuations and dropping comments. */
export function parseInstructions(text: string): Instruction[] {
  const instructions: Instruction[] = [];
  let buffer = '';
  let startLine = 0;
  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (buffer === '' && (line === '' || line.startsWith('#'))) continue;
    if (buffer === '') startLine = index + 1;
    if (line.endsWith('\\')) {
      buffer += `${line.slice(0, -1).trim()} `;
      continue;
    }
    buffer += line;
    const match = /^([A-Za-z]+)\s+([\s\S]*)$/.exec(buffer);
    if (match !== null) {
      const command = (match[1] ?? '').toUpperCase();
      instructions.push({ command, args: (match[2] ?? '').trim(), line: startLine });
    }
    buffer = '';
  }
  return instructions;
}

export function parseStages(instructions: Instruction[]): Stage[] {
  const stages: Stage[] = [];
  for (const instruction of instructions) {
    if (instruction.command === 'FROM') {
      const match = /^(\S+)(?:\s+AS\s+(\S+))?$/i.exec(instruction.args);
      stages.push({
        name: match?.[2] ?? `stage-${stages.length}`,
        base: match?.[1] ?? instruction.args,
        instructions: [],
      });
      continue;
    }
    stages.at(-1)?.instructions.push(instruction);
  }
  return stages;
}

export function parseCopy(instruction: Instruction): CopyInstruction {
  const args = instruction.args.trim();
  if (args.startsWith('[')) {
    const parsed = JSON.parse(args) as string[];
    return {
      sources: parsed.slice(0, -1),
      destination: parsed.at(-1) ?? '',
      line: instruction.line,
    };
  }
  let from: string | undefined;
  let chown: string | undefined;
  const positional: string[] = [];
  for (const token of args.split(/\s+/)) {
    if (token.startsWith('--from=')) from = token.slice('--from='.length);
    else if (token.startsWith('--chown=')) chown = token.slice('--chown='.length);
    else positional.push(token);
  }
  return {
    ...(from === undefined ? {} : { from }),
    ...(chown === undefined ? {} : { chown }),
    sources: positional.slice(0, -1),
    destination: positional.at(-1) ?? '',
    line: instruction.line,
  };
}

export const INSTRUCTIONS = parseInstructions(DOCKERFILE);
export const STAGES = parseStages(INSTRUCTIONS);

export function stage(name: string): Stage {
  const found = STAGES.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Dockerfile has no stage named ${name}`);
  return found;
}

export function copiesOf(target: Stage): CopyInstruction[] {
  return target.instructions.filter((instruction) => instruction.command === 'COPY').map(parseCopy);
}

export function instructionsOf(target: Stage, command: string): Instruction[] {
  return target.instructions.filter((instruction) => instruction.command === command);
}

export function single(target: Stage, command: string): Instruction {
  const found = instructionsOf(target, command);
  if (found.length !== 1) throw new Error(`expected exactly one ${command} in ${target.name}`);
  return found[0] as Instruction;
}

// ── .dockerignore matching (Docker semantics, minus `!` re-includes) ────────────────────────────────

export const IGNORE_PATTERNS = DOCKERIGNORE.split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

/** True when Docker would leave `path` out of the build context. Ancestors count, as in Docker. */
export function isIgnored(path: string): boolean {
  const normalized = path.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (normalized === '') return false;
  const segments = normalized.split('/');
  for (const pattern of IGNORE_PATTERNS) {
    for (let i = 1; i <= segments.length; i += 1) {
      if (matchesGlob(segments.slice(0, i).join('/'), pattern)) return true;
    }
  }
  return false;
}

/** Files under `relative` that survive `.dockerignore`; ignored directories are pruned, not walked. */
export function contextFiles(relative: string): string[] {
  const absolute = join(ROOT, relative);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return isIgnored(relative) ? [] : [relative];
  const files: string[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (isIgnored(child)) continue;
      if (entry.isDirectory()) visit(join(dir, entry.name), child);
      else files.push(child);
    }
  };
  visit(absolute, relative);
  return files;
}

// ── workspace inventory (the manifests the lockfile install needs) ──────────────────────────────────

/** Every manifest Bun's workspace install reads: the root plus each `packages/*` and `apps/*` member. */
export function workspaceManifests(): string[] {
  const members = ['packages', 'apps'].flatMap((group) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}/package.json`),
  );
  return ['package.json', ...members];
}

export function isCoveredBy(path: string, sources: string[]): boolean {
  return sources.some((source) => path === source || path.startsWith(`${source.replace(/\/$/, '')}/`));
}

// ── devcontainer JSONC ──────────────────────────────────────────────────────────────────────────────

/** Strip `//` and block comments without touching string contents (the file documents itself). */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

export interface DevcontainerConfig {
  name?: string;
  build?: { dockerfile?: string; context?: string };
  image?: string;
  postCreateCommand?: string;
  postAttachCommand?: string;
  forwardPorts?: (number | string)[];
  portsAttributes?: Record<string, { label?: string }>;
  customizations?: { vscode?: { extensions?: string[] } };
  remoteEnv?: Record<string, string>;
  remoteUser?: string;
}

export const DEVCONTAINER_CONFIG = JSON.parse(stripJsonComments(DEVCONTAINER)) as DevcontainerConfig;

export const DEVCONTAINER_DOCKERFILE = readFileSync(
  join(ROOT, '.devcontainer', DEVCONTAINER_CONFIG.build?.dockerfile ?? 'Dockerfile'),
  'utf8',
);
