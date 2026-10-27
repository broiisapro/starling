/**
 * The recorded launch-day log, inlined by Vite.
 *
 * `?raw` only exists in Vite, so this module is **only** reachable through a dynamic import from
 * `Playground`. Bun's test runner imports `Playground` but passes `fixture`/`events`, so it never
 * loads this file and never has to resolve a Vite-only specifier. Keeping the `?raw` import static
 * (inside this module) is what lets Vite inline the JSONL into a lazy chunk at build time; a
 * dynamic `import('...?raw')` across the workspace root is left unresolved in production builds.
 */
import launchDay from '../../../../../fixtures/runs/sky-todo-launch-day.jsonl?raw';

export const LAUNCH_DAY_JSONL: string = launchDay;
