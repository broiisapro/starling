/**
 * The locked zod copy (4.6.7, ARCHITECTURE L21) used for the eval case schemas.
 *
 * `zod` is a dependency of `@starling/core`, and `evals/` sits outside the Bun workspace, so the
 * bare specifier is not visible here. Bun's isolated install store puts the exact pinned package at
 * a deterministic path; importing that entry keeps the harness on the same zod version as the
 * contracts instead of adding a second copy. If the store layout ever changes, `bun install` at the
 * root recreates this path, and at checkpoint C1 evals can become a workspace with a real dep.
 */
export * from '../../node_modules/.bun/zod@4.6.7/node_modules/zod/index.js';
