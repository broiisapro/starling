import { expect, test } from '@playwright/test';
import { hoverBird, openEndState, TASK_COUNT, taskTitle, wirePerchPoints } from './support';

/**
 * The Sky is the one region a pointer user is expected to touch, and the drawer is the only way to
 * read a task's story. Both are canvas-driven, so they get real mouse input here rather than a
 * DOM click on a fixture element.
 */
test.describe('the sky', () => {
  test.beforeEach(async ({ page }) => {
    await openEndState(page);
  });

  test('clicking a bird opens that task in the drawer, and Esc closes it', async ({ page }) => {
    const points = await wirePerchPoints(page);
    expect(points).toHaveLength(TASK_COUNT);

    // Every merged flock perches on the wire, so each of the seven tasks is hoverable. The tooltip
    // is the source of truth for "which bird is under the cursor" — no assumption about slot order.
    const keys: string[] = [];
    for (const point of points) keys.push(await hoverBird(page, point));
    expect(new Set(keys).size).toBe(TASK_COUNT);

    const key = keys[0];
    if (key === undefined) throw new Error('the sky rendered no birds');
    const title = await taskTitle(page, key);

    await page.mouse.click(points[0]?.x ?? 0, points[0]?.y ?? 0);

    const drawer = page.getByTestId('agent-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('aria-label', `Task ${key} details`);
    await expect(drawer).toContainText(key);
    await expect(drawer).toContainText(title);
    // The recorded run ends with every task merged, so the drawer header agrees.
    await expect(page.getByTestId('drawer-status')).toHaveText('merged');

    // Esc is the documented way out (Layout closes the drawer; the drawer also binds Esc itself).
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  test('a queue card opens the drawer too, and a second selection swaps the contents', async ({ page }) => {
    const cards = page.locator('[data-starling-queue] [data-column="wire"]');
    await expect(cards).toHaveCount(TASK_COUNT);

    await cards.nth(0).click();
    const drawer = page.getByTestId('agent-drawer');
    await expect(drawer).toBeVisible();
    const first = (await drawer.getAttribute('aria-label')) ?? '';

    await cards.nth(1).click();
    const second = (await drawer.getAttribute('aria-label')) ?? '';
    expect(second).not.toBe(first);
    await expect(drawer).toContainText('Activity');

    await page.getByRole('button', { name: 'Close agent drawer' }).click();
    await expect(drawer).toHaveCount(0);
  });
});
