import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Browser end-to-end suite for the dashboard (Epic 71).
 *
 * Runs against the real Vite dev server (`bun run dev`) because that is the server a developer and
 * the stage laptop actually use: same React tree, same demo bucket, same raw fixture import. The
 * demo never needs `/api`, so the suite works with no Starling server running.
 *
 * Not part of `bun run test`: files are named `*.pw.ts` so Bun's runner never picks them up, and
 * CI wiring is deliberately out of scope (FIX REQUEST to Epic 52, see docs/epic-71-web-e2e.md).
 */
/**
 * The dev server port.
 *
 * It must be identical in the runner and in every worker (Playwright loads this config in both), so
 * it is derived from the working directory rather than the pid. Deriving it from the worktree also
 * keeps a dozen agents on this laptop from reusing each other's server — which is exactly what
 * happened the first time this suite ran on a hardcoded port.
 */
function portForCwd(cwd: string): number {
  let hash = 2166136261;
  for (let i = 0; i < cwd.length; i += 1) {
    hash ^= cwd.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 4300 + ((hash >>> 0) % 700);
}

const PORT = Number(process.env.STARLING_E2E_PORT ?? portForCwd(process.cwd()));
const BASE_URL = `http://127.0.0.1:${PORT}`;
/**
 * Failure artifacts live in the OS temp directory, not in the repo: Vite watches `apps/web`, and a
 * trace written mid-run would reload the page under a running test.
 */
const ARTIFACTS = join(tmpdir(), 'starling-web-e2e', String(PORT));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  // Playwright writes traces/screenshots here; it lives outside the repo (see ARTIFACTS above).
  outputDir: ARTIFACTS,
  // Stable, platform-free snapshot names: `e2e/__screenshots__/end-1280x720.png`.
  snapshotPathTemplate: 'e2e/__screenshots__/{arg}{ext}',
  // One dev server, one canvas animation loop, one 16x replay: parallel tabs would fight for frames
  // and make the timing assertions flaky. Everything here is cheap enough to run serially.
  fullyParallel: false,
  workers: 1,
  // A committed `.only` would silently shrink the suite; fail instead.
  forbidOnly: true,
  // The 16x replay is ~22 s of wall clock; two of those in one test plus snapshots is still < 120 s.
  timeout: 120_000,
  expect: {
    timeout: 30_000,
    toHaveScreenshot: {
      // Canvas boids are the only moving pixels and they are masked (see e2e/visual.pw.ts).
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      // Fonts fall back to the platform stack, so allow a little anti-aliasing drift.
      threshold: 0.25,
      maxDiffPixelRatio: 0.01,
    },
  },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    // Timestamps are relative, but pinning the zone keeps any date label stable.
    timezoneId: 'UTC',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    // `--host 127.0.0.1` keeps the server on IPv4 so the URL below is the one Vite actually binds.
    command: `bun run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    // Never attach to a server we did not start: a dozen agents share this laptop and one of them
    // may already be serving another worktree on a nearby port. The port is per-worktree (above).
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
