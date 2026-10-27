/**
 * `@starling/core` re-export for the evals harness.
 *
 * `evals/` is deliberately *not* a Bun workspace: the root `workspaces` list is
 * `packages/*` + `apps/*` and root config is orchestrator-owned (ARCHITECTURE L21/L22). That means
 * `@starling/core` is not linked into a node_modules folder visible from `evals/`, so a bare
 * specifier would only resolve after a hand-made symlink — not reproducible from a clean clone.
 *
 * Importing the package's public entry point by path keeps the harness dependency-free and
 * runnable as `bun evals/run.ts` and `bun test evals` straight after `bun install` at the root.
 * Types come along through `export *`.
 */
export * from '../../packages/core/src/index.ts';
