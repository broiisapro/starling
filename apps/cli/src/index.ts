#!/usr/bin/env bun
/** `starling` — the CLI. Commands are stubs until their epics land (see `src/program.ts`). */
export const PACKAGE = '@starling/cli' as const;
export { createProgram } from './program';

import { createProgram } from './program';

if (import.meta.main) {
  const program = createProgram();
  await program.parseAsync(process.argv);
}
