import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const SKILL_DIR = import.meta.dir;
const SKILL_MD = join(SKILL_DIR, 'SKILL.md');
const TRIGGERS = ['parallelise this', 'split into tasks', 'run a swarm'];

/** Read a file as UTF-8, failing loudly if it is missing. */
function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Parse the YAML frontmatter with Bun's parser (no extra dependency). */
function frontmatter(text: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match?.[1]) throw new Error('SKILL.md does not start with YAML frontmatter');
  return Bun.YAML.parse(match[1]) as Record<string, unknown>;
}

/** Every file below `dir`, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out.sort();
}

/** Markdown links in `text`, minus external and anchor-only targets. */
function relativeLinks(text: string): string[] {
  const links: string[] = [];
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    const target = match[1]?.trim();
    if (!target) continue;
    if (target.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    links.push(target);
  }
  return links;
}

describe('SKILL.md frontmatter', () => {
  const text = read(SKILL_MD);
  const meta = frontmatter(text);

  test('declares the required Agent Skills fields', () => {
    expect(meta.name).toBe('starling');
    expect(typeof meta.description).toBe('string');
    expect(String(meta.description).length).toBeGreaterThan(40);
    expect(meta.license).toBe('MIT');
    expect(typeof meta.compatibility).toBe('string');
  });

  test('name matches the skill directory and the portable-name regex', () => {
    expect(meta.name).toBe(basename(SKILL_DIR));
    expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(String(meta.name).length).toBeLessThanOrEqual(64);
  });

  test('description is within the 1024-character limit and carries the trigger phrases', () => {
    const description = String(meta.description).toLowerCase();
    expect(description.length).toBeLessThanOrEqual(1024);
    for (const trigger of TRIGGERS) {
      expect(description).toContain(trigger);
    }
    expect(description).toContain('multi-part');
  });

  test('compatibility is within the spec limit and metadata is a string map', () => {
    expect(String(meta.compatibility).length).toBeLessThanOrEqual(500);
    const metadata = meta.metadata as Record<string, unknown>;
    expect(metadata).toBeDefined();
    expect(metadata.version).toBe('0.1');
  });

  test('body stays under the recommended length', () => {
    expect(text.split('\n').length).toBeLessThanOrEqual(300);
  });
});

describe('skill references', () => {
  const markdown = walk(SKILL_DIR).filter((path) => path.endsWith('.md'));

  test('ships the four reference files named in SKILL.md', () => {
    for (const name of ['goals.md', 'lanes.md', 'flock.md', 'troubleshooting.md']) {
      expect(existsSync(join(SKILL_DIR, 'reference', name))).toBe(true);
    }
  });

  test('every relative link in every markdown file resolves to a real file', () => {
    const broken: string[] = [];
    for (const file of markdown) {
      for (const raw of relativeLinks(read(file))) {
        const target = raw.split('#')[0]?.replace(/^<|>$/g, '');
        if (!target) continue;
        const path = resolve(dirname(file), target);
        if (!existsSync(path)) broken.push(`${basename(file)} -> ${raw}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('ships two clearly labelled illustrative examples', () => {
    const examples = walk(join(SKILL_DIR, 'examples')).filter((path) => path.endsWith('.md'));
    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const file of examples) {
      const text = read(file);
      expect(text.startsWith('# Worked transcript')).toBe(true);
      expect(text.toLowerCase()).toContain('illustrative');
    }
  });

  test('ships the four documented scripts plus the shared library, all executable', () => {
    for (const name of ['plan.sh', 'run.sh', 'status.sh', 'replay-demo.sh', 'lib.sh']) {
      const path = join(SKILL_DIR, 'scripts', name);
      expect(existsSync(path)).toBe(true);
    }
    for (const name of ['plan.sh', 'run.sh', 'status.sh', 'replay-demo.sh']) {
      const mode = statSync(join(SKILL_DIR, 'scripts', name)).mode;
      expect(mode & 0o111).toBeGreaterThan(0);
    }
  });

  test('does not reference the removed section placeholder or an unversioned TODO', () => {
    const all = markdown.map(read).join('\n');
    expect(all).not.toContain('TODO:');
    expect(all).not.toContain('TODO(epic-');
  });
});
