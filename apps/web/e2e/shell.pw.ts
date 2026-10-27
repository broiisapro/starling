import { expect, test } from '@playwright/test';
import { openEndState, openReplay, TASK_COUNT, watchConsole } from './support';

/**
 * The shell: it boots, every region paints, and the keyboard drives the whole stage.
 *
 * A broken dashboard on stage is the one failure we cannot recover from, so these are the cheapest
 * and most valuable guarantees in the suite.
 */

test.describe('the shell loads', () => {
  test('boots in demo mode with no console errors and every region on screen', async ({ page }) => {
    const console_ = watchConsole(page);
    await openReplay(page);

    // ── top bar ────────────────────────────────────────────────────────────────────────────────
    const topBar = page.getByRole('banner');
    await expect(topBar).toContainText('Starling');
    await expect(page.getByRole('combobox', { name: 'Active run' })).toBeEnabled();
    // The connection badge says `demo`: this is the recorded run, not a live server.
    await expect(topBar).toContainText('demo');
    // The speed control is on the stage speed.
    await expect(page.getByRole('tab', { name: '16×' })).toHaveAttribute('aria-selected', 'true');

    // ── five regions, no error-boundary fallbacks ──────────────────────────────────────────────
    await expect(page.locator('[data-region="flock"]')).toBeVisible();
    await expect(page.locator('[data-region="sky"]')).toBeVisible();
    await expect(page.locator('[data-region="strip"]')).toBeVisible();
    await expect(page.locator('[data-region="queue"]')).toBeVisible();
    await expect(page.locator('[data-region="metrics"]')).toBeVisible();
    await expect(page.locator('[data-region-placeholder]')).toHaveCount(0);

    // ── each region's panel actually rendered ──────────────────────────────────────────────────
    await expect(page.getByTestId('flock-panel')).toBeVisible();
    await expect(page.getByTestId('sky-view').locator('canvas')).toBeVisible();
    await expect(page.getByTestId('metrics-panel')).toBeVisible();
    await expect(page.locator('[data-starling-queue]')).toBeVisible();
    // The DAG is mounted from the same `plan.created` event (it is hidden, not unmounted, in Sky view).
    await expect(page.getByTestId('dag-canvas')).toBeAttached();
    await expect(page.locator('[data-testid^="task-node-"]')).toHaveCount(TASK_COUNT);

    // Give the player a couple of seconds of real activity, then demand silence.
    await page.waitForTimeout(2_500);
    expect(console_.errors).toEqual([]);
  });
});

test.describe('keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await openEndState(page);
  });

  test('1 and 2 switch the centre view', async ({ page }) => {
    const sky = page.locator('[data-view="sky"]');
    const dag = page.locator('[data-view="dag"]');

    await expect(sky).toHaveAttribute('data-active', 'true');
    await expect(dag).toHaveAttribute('data-active', 'false');

    await page.keyboard.press('2');
    await expect(dag).toHaveAttribute('data-active', 'true');
    await expect(sky).toHaveAttribute('data-active', 'false');
    await expect(sky).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByRole('region', { name: 'Flight plan region' })).toBeVisible();
    // The whole plan is in the graph, and the wire state reached every node.
    await expect(page.locator('[data-testid^="task-node-"]')).toHaveCount(TASK_COUNT);

    await page.keyboard.press('1');
    await expect(sky).toHaveAttribute('data-active', 'true');
    await expect(dag).toHaveAttribute('data-active', 'false');
  });

  test('b folds the bottom strip away and back', async ({ page }) => {
    await expect(page.locator('[data-region="queue"]')).toBeVisible();
    await page.keyboard.press('b');
    await expect(page.locator('[data-region="queue"]')).toHaveCount(0);
    await expect(page.locator('[data-region="metrics"]')).toHaveCount(0);
    const collapsed = page.locator('[data-region="strip"] button[aria-expanded="false"]');
    await expect(collapsed).toContainText('Landing strip');
    await expect(collapsed).toContainText('7 on the wire');

    await page.keyboard.press('b');
    await expect(page.locator('[data-region="queue"]')).toBeVisible();
    await expect(page.locator('[data-region="metrics"]')).toBeVisible();
  });

  test('f folds the flock rail away and back', async ({ page }) => {
    await expect(page.getByTestId('flock-panel')).toBeVisible();
    await page.keyboard.press('f');
    await expect(page.getByTestId('flock-panel')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Expand the flock region' })).toBeVisible();

    await page.keyboard.press('f');
    await expect(page.getByTestId('flock-panel')).toBeVisible();
  });

  test('? opens the shortcut card and Esc closes it', async ({ page }) => {
    await page.keyboard.press('?');
    const help = page.getByTestId('keyboard-help');
    await expect(help).toBeVisible();
    await expect(help).toContainText('Keyboard shortcuts');
    await expect(help).toContainText('Sky — the murmuration');
    await expect(help).toContainText('This help');

    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
  });
});
