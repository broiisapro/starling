import { expect, type Page } from '@playwright/test';
import { makeWire, wireSlotX } from '../src/features/sky/layout';

/**
 * Shared harness for the dashboard suite.
 *
 * Two ways to get the dashboard into a state:
 *
 * - `openReplay` plays the recorded launch-day run for real, at 16x, exactly like `?demo=1` on stage.
 * - `openEndState` injects the same fixture into the store in one shot, so behavioural tests do not
 *   pay 22 s of playback each. The injected state is byte-for-byte what the player produces at the
 *   end of the run (same reducer, same rebasing), it just skips the waiting.
 */

export const LAPTOP = { width: 1280, height: 720 } as const;
export const PROJECTOR = { width: 1920, height: 1080 } as const;

/** `?demo=1` forces the recorded run; 16x is the stage speed. */
export const REPLAY_URL = '/?demo=1&speed=16';

/** The run has seven tasks and all seven land. Kept in one place so every assertion agrees. */
export const TASK_COUNT = 7;

/** Demo speed tabs the shell renders (src/lib/speed.ts). */
export const SPEED = 16;

/** A page-level console recorder. `errors` is what a stage failure would print. */
export interface ConsoleWatch {
  errors: string[];
}

export function watchConsole(page: Page): ConsoleWatch {
  const watch: ConsoleWatch = { errors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') watch.errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    watch.errors.push(`pageerror: ${error.message}`);
  });
  return watch;
}

/** Boot the dashboard in demo mode and let the player start. */
export async function openReplay(page: Page): Promise<void> {
  await page.goto(REPLAY_URL);
  // The first event is delivered synchronously on mount, so this is a fast, honest boot check.
  await expect(page.getByTestId('queue-landed')).toBeVisible();
}

/**
 * Wait for the 16x replay to reach the run's own end state.
 *
 * "Seven on the wire" happens at ~265 s of run time, but the fixture keeps publishing metrics until
 * `run.finished` at 356 s — and `run.status` only flips there, which is why the run picker's label is
 * the end marker. The frozen elapsed clock proves the player is not mid-sample.
 */
export async function waitForEndState(page: Page): Promise<void> {
  await expect(page.getByRole('combobox', { name: 'Active run' })).toContainText('finished');
  await expect(page.getByTestId('queue-landed')).toHaveText(`${TASK_COUNT} of ${TASK_COUNT}`);
  await expect(page.getByTestId('metrics-merged')).toHaveText(String(TASK_COUNT));
  await expect(page.getByText(`${TASK_COUNT}/${TASK_COUNT} landed`)).toBeVisible();
  await expect(page.locator('[data-starling-queue] [data-column="wire"]')).toHaveCount(TASK_COUNT);

  const elapsed = page.getByTestId('metrics-elapsed');
  const finishedAt = await elapsed.textContent();
  await page.waitForTimeout(700);
  expect(await elapsed.textContent()).toBe(finishedAt);
}

// ── store bridge ─────────────────────────────────────────────────────────────

/** The subset of the zustand store the harness touches. Mirrors src/data/store.ts. */
export interface StoreBridge {
  getState(): {
    reset(): void;
    setConnection(connection: 'demo' | 'live' | 'offline'): void;
    ingestMany(events: readonly unknown[]): void;
    activeRunId?: string;
    runs: Record<string, { plan?: { tasks: { key: string; title: string }[] } }>;
  };
}

/** `__STARLING_SKY__` is the dev-only store handle AppShell installs (src/app/AppShell.tsx). */
interface SkyWindow {
  __STARLING_SKY__?: StoreBridge;
}

const SKY_WINDOW_TYPE = 'the dev-only store handle is missing; did the dev server strip import.meta.env.DEV?';

/**
 * Load the dashboard with no replay running and push the whole fixture into the store.
 *
 * `?demo=0` forces the live branch of the data layer, which means no player timers are rewriting
 * the store underneath us. `/api/events` is held open (never answered) so the shell does not flap
 * between `live` and `offline`; there is no Starling server in this suite and the demo needs none.
 */
export async function openEndState(page: Page): Promise<void> {
  await page.route('**/api/events*', () => {
    // Deliberately never fulfilled: an EventSource stays CONNECTING, so no retry storms, no noise.
  });
  await page.goto('/?demo=0');
  await page.waitForFunction(
    () => {
      const sky = (window as unknown as SkyWindow).__STARLING_SKY__;
      return typeof sky?.getState === 'function';
    },
    null,
    { timeout: 15_000 },
  );

  await page.evaluate(async () => {
    const sky = (window as unknown as SkyWindow).__STARLING_SKY__;
    if (sky === undefined) throw new Error('missing store bridge');
    // Vite serves the module the app itself imports, so this is the same fixture instance.
    const demo = (await import('/src/data/demo.ts')) as {
      demoEvents(): unknown[];
      rebaseEvents(events: readonly unknown[], now: number): unknown[];
    };
    const events = demo.rebaseEvents(demo.demoEvents(), Date.now());
    sky.getState().reset();
    sky.getState().setConnection('demo');
    sky.getState().ingestMany(events);
  });

  await expect(page.getByTestId('queue-landed')).toHaveText(`${TASK_COUNT} of ${TASK_COUNT}`);
}

/** Read a task's title from the store (used to prove the drawer shows the bird we clicked). */
export async function taskTitle(page: Page, taskKey: string): Promise<string> {
  const title = await page.evaluate((key) => {
    const sky = (window as unknown as SkyWindow).__STARLING_SKY__;
    if (sky === undefined) throw new Error(SKY_WINDOW_TYPE);
    const state = sky.getState();
    const run = state.activeRunId === undefined ? undefined : state.runs[state.activeRunId];
    return run?.plan?.tasks.find((task) => task.key === key)?.title;
  }, taskKey);
  if (title === undefined) throw new Error(`no plan task titled ${taskKey}`);
  return title;
}

// ── the sky ──────────────────────────────────────────────────────────────────

/**
 * Points where merged flocks perch on the wire. At the end of the run every task is merged, and a
 * merged flock sits on its wire slot (with a couple of pixels of jitter) rather than flying, so
 * clicking one is deterministic even while the birds are animating.
 *
 * `mergedSlot` is assigned in plan order, so slot index === plan index.
 */
export async function wirePerchPoints(page: Page, slots = TASK_COUNT): Promise<{ x: number; y: number }[]> {
  const box = await page.getByTestId('sky-view').locator('canvas').boundingBox();
  if (box === null) throw new Error('the sky canvas has no bounding box');
  const wire = makeWire(Math.round(box.width), Math.round(box.height));
  const points: { x: number; y: number }[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    const x = wireSlotX(wire, slot, slots);
    points.push({ x: box.x + x, y: box.y + wire.yAt(x) - 5 });
  }
  return points;
}

/** The one element the Sky renders on hover (an absolutely positioned, click-through tooltip). */
const SKY_TOOLTIP = '[data-testid="sky-view"] div[style*="left"]';

/** Hover a point in the sky and return the task key the tooltip names. */
export async function hoverBird(page: Page, point: { x: number; y: number }): Promise<string> {
  await page.mouse.move(point.x, point.y);
  const tooltip = page.locator(SKY_TOOLTIP);
  await expect(tooltip).toHaveCount(1);
  const text = (await tooltip.textContent()) ?? '';
  // The tooltip's last line ends with `· <task-key>`.
  const key = /·\s*([a-z0-9-]+)\s*$/.exec(text.trim())?.[1];
  if (key === undefined) throw new Error(`no task key in the sky tooltip: ${JSON.stringify(text)}`);
  return key;
}

/** Horizontal overflow of the page itself (inner scrollers are allowed and are not this). */
export async function horizontalOverflow(
  page: Page,
): Promise<{ root: number; body: number; viewport: number }> {
  return page.evaluate(() => ({
    root: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
}
