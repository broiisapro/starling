/**
 * One worker prompt per repo shape, generated from a real (synthetic) checkout.
 *
 * The sky-todo fixture is a tiny vanilla app; these six are the shapes a plan actually meets: a
 * pnpm TypeScript monorepo, a pytest Python package, a Go service, a Rust workspace, a Vite/React
 * feature tree and a few-hundred-file codebase where the budget has to make choices.
 *
 * Each shape is written to a temp dir, mapped by the real `createRepoMapper` (no LLM, no network),
 * compiled by the real compiler and snapshot with the temp path normalised, so the snapshot is
 * stable across machines and reviewers can see exactly what a worker would read.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Goal, Plan, PromptContext, RepoMap, TaskSpec } from '@starling/core';
import { exec } from '@starling/core';
import { createRepoMapper } from '@starling/repomap';
import { createPromptCompiler } from './index.ts';

interface Shape {
  name: string;
  goal: string;
  files: Record<string, string>;
  task: Omit<TaskSpec, 'lane'> & { lane: TaskSpec['lane'] };
  /** Paths the task owns that must appear in the map excerpt. */
  expectOwned: string[];
  /** A path that must rank above the orientation tail. */
  expectNeighbour?: string;
}

const CONVENTION = 'Conventional Commits scoped to the task key; commit small and often.';

function shapeTask(
  key: string,
  title: string,
  goal: string,
  owns: string[],
  reads: string[],
  dependsOn: string[] = [],
): TaskSpec {
  return {
    key,
    title,
    goal,
    deliverables: [`A focused change inside ${owns[0]}`],
    outOfScope: ['Unrelated refactors'],
    definitionOfDone: ['The repository test command passes', 'A new test covers the behaviour'],
    dependsOn,
    lane: { owns, reads },
    estimateMin: 15,
  };
}

function planFor(task: TaskSpec): Plan {
  const sibling = shapeTask('sibling', 'A parallel lane', 'Work that runs at the same time.', ['docs/**'], []);
  return {
    id: '01jd2k7m3p4q5r6s7t8v9w0z1',
    goalId: '01jd2k7m3p4q5r6s7t8v9w0z2',
    summary: `Two lane-disjoint tasks; ${task.key} owns its feature folder, the sibling owns docs.`,
    tasks: [task, sibling],
    lockedDecisions: [CONVENTION],
    model: { provider: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
    createdAt: 1_731_000_000_000,
  };
}

function contextFor(root: string, map: RepoMap, shape: Shape): PromptContext {
  const goal: Goal = {
    id: '01jd2k7m3p4q5r6s7t8v9w0z2',
    text: shape.goal,
    repoPath: root,
    baseBranch: 'main',
    createdAt: 1_731_000_000_000,
    constraints: [],
  };
  return {
    goal,
    plan: planFor(shape.task),
    map,
    task: shape.task,
    branch: `starling/9w0x1y/${shape.task.key}`,
  };
}

async function buildRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'starling-shape-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  const init = await exec(['git', 'init', '-q', '-b', 'main'], { cwd: root, timeoutMs: 15_000 });
  if (init.code !== 0) throw new Error(`git init failed: ${init.stderr}`);
  return root;
}

/** 40 feature folders × 10 files: enough that the 6k map budget must drop most of them. */
function largeRepoFiles(): Record<string, string> {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .' } }),
    'README.md': '# Large app\n\nA synthetic checkout with 41 feature folders.\n',
  };
  for (let feature = 0; feature < 40; feature += 1) {
    for (let file = 0; file < 10; file += 1) {
      files[`src/features/feature-${feature}/module-${file}.ts`] =
        `export function feature${feature}Module${file}(value: number): number {\n  return value + ${file};\n}\n`;
    }
  }
  files['src/features/search/index.ts'] =
    'export function initSearch(): void {\n  // filters the visible list\n}\n';
  files['src/features/search/index.test.ts'] =
    'import { initSearch } from "./index";\n\ntest("mounts", () => {\n  initSearch();\n});\n';
  return files;
}

const SHAPES: Shape[] = [
  {
    name: 'pnpm monorepo',
    goal: 'Add a tooltip component to the shared UI package and use it in the docs site.',
    files: {
      'package.json': JSON.stringify({ private: true, scripts: { build: 'tsup' } }),
      'pnpm-workspace.yaml': "packages:\n  - packages/*\n",
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'packages/ui/package.json': JSON.stringify({ name: '@acme/ui', scripts: { test: 'vitest' } }),
      'packages/ui/src/index.ts': 'export { Button } from "./button"\n',
      'packages/ui/src/button.tsx':
        'export interface ButtonProps { label: string }\nexport function Button({ label }: ButtonProps) {\n  return <button>{label}</button>\n}\n',
      'packages/ui/src/button.test.tsx': 'import { Button } from "./button"\n',
      'packages/core/package.json': JSON.stringify({ name: '@acme/core', scripts: { test: 'vitest' } }),
      'packages/core/src/index.ts': 'export { createStore } from "./store"\n',
      'packages/core/src/store.ts':
        'export interface Store<T> { get(): T; set(next: T): void }\nexport function createStore<T>(initial: T): Store<T> {\n  let value = initial\n  return { get: () => value, set: (next) => { value = next } }\n}\n',
      'packages/core/src/store.test.ts': 'import { createStore } from "./store"\n',
      'docs/index.md': '# Docs\n',
    },
    task: shapeTask(
      'tooltip',
      'Tooltip component',
      'Add a Tooltip to @acme/ui that wraps Button and shows a label on hover and focus.',
      ['packages/ui/src/**'],
      ['packages/core/src/index.ts'],
    ),
    expectOwned: ['packages/ui/src/index.ts', 'packages/ui/src/button.tsx'],
    expectNeighbour: 'packages/core/src/store.ts',
  },
  {
    name: 'python package',
    goal: 'Add a --verbose flag to the CLI and cover it with a test.',
    files: {
      'pyproject.toml':
        '[project]\nname = "acme-cli"\nversion = "0.1.0"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n',
      'README.md': '# acme-cli\n\n## Usage\n',
      'src/acme/__init__.py': 'from .core import run\n',
      'src/acme/core.py': 'def run(message: str) -> str:\n    return message.strip()\n',
      'src/acme/cli.py':
        'import argparse\n\nfrom .core import run\n\n\ndef main(argv: list[str] | None = None) -> int:\n    parser = argparse.ArgumentParser()\n    parser.add_argument("message")\n    args = parser.parse_args(argv)\n    print(run(args.message))\n    return 0\n\n\nclass Command:\n    pass\n',
      'tests/test_core.py': 'from acme.core import run\n\n\ndef test_run_strips():\n    assert run(" hi ") == "hi"\n',
      'tests/test_cli.py': 'from acme.cli import main\n\n\ndef test_main():\n    assert main(["hi"]) == 0\n',
    },
    task: shapeTask(
      'verbose-flag',
      'CLI verbose flag',
      'Add --verbose to acme.cli.main that prints the resolved message to stderr.',
      ['src/acme/cli.py', 'tests/test_cli.py'],
      ['src/acme/core.py'],
    ),
    expectOwned: ['src/acme/cli.py', 'tests/test_cli.py'],
    expectNeighbour: 'src/acme/core.py',
  },
  {
    name: 'go service',
    goal: 'Add a /health endpoint to the HTTP service.',
    files: {
      'go.mod': 'module example.com/acme\n\ngo 1.23\n',
      Makefile: 'test:\n\tgo test ./...\n\nlint:\n\tgolangci-lint run\n',
      'cmd/server/main.go':
        'package main\n\nimport (\n\t"log"\n\t"net/http"\n)\n\nfunc main() {\n\tmux := http.NewServeMux()\n\tlog.Fatal(http.ListenAndServe(":8080", mux))\n}\n',
      'internal/handler/handler.go':
        'package handler\n\nimport "net/http"\n\ntype Handler struct{ next http.Handler }\n\nfunc (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {\n\tw.WriteHeader(http.StatusOK)\n}\n',
      'internal/handler/handler_test.go':
        'package handler\n\nimport "testing"\n\nfunc TestHandler(t *testing.T) {\n\tt.Parallel()\n}\n',
      'internal/config/config.go':
        'package config\n\ntype Config struct { Port int }\n\nfunc Load() Config { return Config{Port: 8080} }\n',
      'README.md': '# acme service\n',
    },
    task: shapeTask(
      'health-endpoint',
      'Health endpoint',
      'Serve GET /health from the handler package and return JSON with a status field.',
      ['internal/handler/**'],
      ['internal/config/config.go'],
    ),
    expectOwned: ['internal/handler/handler.go', 'internal/handler/handler_test.go'],
    expectNeighbour: 'internal/config/config.go',
  },
  {
    name: 'rust workspace',
    goal: 'Add a lenient parsing mode to the core crate.',
    files: {
      'Cargo.toml': '[workspace]\nmembers = ["crates/core", "crates/cli"]\nresolver = "2"\n',
      'crates/core/Cargo.toml': '[package]\nname = "acme-core"\nversion = "0.1.0"\n',
      'crates/core/src/lib.rs': 'pub mod parse;\n\npub fn version() -> &\'static str {\n    "0.1.0"\n}\n',
      'crates/core/src/parse.rs':
        'pub struct Parser {\n    strict: bool,\n}\n\nimpl Parser {\n    pub fn new() -> Self {\n        Self { strict: true }\n    }\n\n    pub fn parse(&self, input: &str) -> Option<&str> {\n        if self.strict && input.is_empty() {\n            None\n        } else {\n            Some(input)\n        }\n    }\n\n    fn reset(&mut self) {\n        self.strict = true;\n    }\n}\n',
      'crates/cli/Cargo.toml': '[package]\nname = "acme-cli"\nversion = "0.1.0"\n',
      'crates/cli/src/main.rs': 'fn main() {\n    let parser = acme_core::parse::Parser::new();\n    println!("{:?}", parser.parse("hi"));\n}\n',
      'README.md': '# acme-core\n',
    },
    task: shapeTask(
      'lenient-parse',
      'Lenient parsing',
      'Add Parser::lenient() and a test that accepts empty input in lenient mode.',
      ['crates/core/src/parse.rs'],
      ['crates/core/src/lib.rs'],
    ),
    expectOwned: ['crates/core/src/parse.rs'],
    expectNeighbour: 'crates/core/src/lib.rs',
  },
  {
    name: 'vite react app',
    goal: 'Add live search filtering to the visible list.',
    files: {
      'package.json': JSON.stringify({
        scripts: { test: 'vitest', lint: 'eslint .', build: 'vite build' },
      }),
      'vite.config.ts': 'import { defineConfig } from "vite"\nexport default defineConfig({})\n',
      'index.html': '<div id="root"></div>\n',
      'src/main.tsx': 'import { App } from "./App"\n\nconsole.log(App)\n',
      'src/App.tsx':
        'import { initSearch } from "./features/search"\n\nexport function App() {\n  return <main>{initSearch()}</main>\n}\n',
      'src/store/todos.ts':
        'export interface Todo { id: string; text: string }\nexport function visibleTodos(todos: Todo[], query: string): Todo[] {\n  return todos.filter((todo) => todo.text.includes(query))\n}\n',
      'src/features/search/index.ts': 'export function initSearch(): string {\n  return "search"\n}\n',
      'src/features/search/index.test.ts': 'import { initSearch } from "./index"\n',
      'src/features/theme/index.ts': 'export function initTheme(): void {}\n',
      'src/components/Button.tsx': 'export function Button({ label }: { label: string }) {\n  return <button>{label}</button>\n}\n',
      'README.md': '# vite app\n',
    },
    task: shapeTask(
      'live-search',
      'Live search',
      'Filter the visible todo list on every keystroke, reusing visibleTodos from the store.',
      ['src/features/search/**'],
      ['src/store/todos.ts', 'src/App.tsx'],
    ),
    expectOwned: ['src/features/search/index.ts', 'src/features/search/index.test.ts'],
    expectNeighbour: 'src/store/todos.ts',
  },
  {
    name: 'large repo',
    goal: 'Add live search filtering to a 400-file feature tree.',
    files: largeRepoFiles(),
    task: shapeTask(
      'live-search',
      'Live search',
      'Filter the visible list on every keystroke.',
      ['src/features/search/**'],
      ['src/features/feature-0/module-0.ts'],
    ),
    expectOwned: ['src/features/search/index.ts', 'src/features/search/index.test.ts'],
  },
];

describe('worker prompts on real repo shapes', () => {
  for (const shape of SHAPES) {
    test(`worker prompt — ${shape.name}`, async () => {
      const root = await buildRepo(shape.files);
      try {
        const map = await createRepoMapper().map(root);
        const prompt = createPromptCompiler().worker(contextFor(root, map, shape)).replaceAll(root, '<repo>');

        expect(prompt).toMatchSnapshot();

        const orientation = prompt.slice(
          prompt.indexOf('## Repo orientation'),
          prompt.indexOf('## How to verify'),
        );

        // The lane is what the map is for: every editable file must be listed, in the lane group.
        const laneStart = orientation.indexOf('In your lane (editable):');
        expect(laneStart).toBeGreaterThan(0);
        for (const path of shape.expectOwned) expect(orientation).toContain(path);

        // A neighbour (read or imported file) is ranked above the orientation tail.
        if (shape.expectNeighbour !== undefined) {
          const neighbour = orientation.indexOf(shape.expectNeighbour);
          const others = orientation.indexOf('Other files (orientation only):');
          expect(neighbour).toBeGreaterThan(laneStart);
          if (others !== -1) expect(others).toBeGreaterThan(neighbour);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 30_000);
  }

  test('the large repo map stays focused: the lane and its neighbours, not 400 paths', async () => {
    const shape = SHAPES.at(-1) as Shape;
    const root = await buildRepo(shape.files);
    try {
      const map = await createRepoMapper().map(root);
      expect(map.files.length).toBeGreaterThan(400);
      const prompt = createPromptCompiler().worker(contextFor(root, map, shape));
      const mapSection = prompt.slice(prompt.indexOf('## Repo orientation'), prompt.indexOf('## How to verify'));
      const otherStart = mapSection.indexOf('Other files (orientation only):');
      const otherLines = mapSection
        .slice(otherStart)
        .split('\n')
        .filter((line) => line.startsWith('- '));
      expect(otherLines.length).toBeGreaterThan(0);
      expect(otherLines.length).toBeLessThanOrEqual(30);
      // One line per directory: the tail shows the breadth of the tree, not 30 modules of one folder.
      const dirs = otherLines.map((line) => line.split('/').slice(0, 4).join('/'));
      expect(new Set(dirs).size).toBe(dirs.length);
      expect(mapSection.length).toBeLessThan(7000);
      expect(mapSection).toContain('more files not shown');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
