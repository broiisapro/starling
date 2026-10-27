import { expect, test } from '@playwright/test';
import { horizontalOverflow, LAPTOP, openReplay, PROJECTOR, waitForEndState } from './support';

/**
 * Two screens, two snapshots: the laptop (1280x720) and the projector (1920x1080), both at the end
 * of the 16x replay. A broken layout on stage is unrecoverable, so the whole dashboard is compared,
 * not just the panels that have DOM assertions elsewhere.
 *
 * The Sky's canvas is masked: boids are the only deliberately moving pixels and Epic 47 owns a
 * proper pause hook (FIX REQUEST). Everything else at the end state is deterministic — all tasks
 * are merged, so no elapsed clock ticks, and no node is busy, so no `animate-ping` runs.
 */
const SIZES = [
  { name: '1280x720', ...LAPTOP },
  { name: '1920x1080', ...PROJECTOR },
] as const;

for (const size of SIZES) {
  test(`the end of the replay at ${size.name}: no horizontal overflow, visual snapshot`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await openReplay(page);
    await waitForEndState(page);

    // The page itself must never scroll sideways. Inner scrollers (the queue board, long lanes)
    // are allowed and are not measured here.
    const overflow = await horizontalOverflow(page);
    expect(overflow.root).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.body).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.viewport).toBe(size.width);

    await expect(page).toHaveScreenshot(`end-${size.name}.png`, {
      mask: [page.getByTestId('sky-view').locator('canvas')],
      maskColor: '#050b18',
    });
  });
}
