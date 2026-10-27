import { expect, test } from '@playwright/test';
import { openReplay, PROJECTOR, SPEED, TASK_COUNT, waitForEndState, watchConsole } from './support';

/**
 * The replay itself: the recorded launch-day run, played at 16x, must land every task and tell the
 * open-weight story in the meter. This is the one test that pays the full ~22 s of playback, because
 * it is the only one that can catch a player that drifts from the reducer, a stale fixture or a
 * panel that only updates on the last event.
 */
test.describe('the 16x replay', () => {
  // Two screens' worth of layout, both read by the flock rail and the metrics panel below.
  test.use({ viewport: PROJECTOR });

  test('reaches the end state: seven on the wire, two roosts, a real API cost', async ({ page }) => {
    test.setTimeout(120_000);
    const console_ = watchConsole(page);

    await openReplay(page);
    // Mid-run: the plan is in the store before the first task moves.
    await expect(page.locator('[data-testid^="task-node-"]')).toHaveCount(TASK_COUNT);
    await expect(page.getByRole('tab', { name: `${SPEED}×` })).toHaveAttribute('aria-selected', 'true');

    await waitForEndState(page);

    // ── the queue board ────────────────────────────────────────────────────────────────────────
    await expect(page.getByTestId('queue-landed')).toHaveText('7 of 7');
    await expect(page.locator('[data-starling-queue] [data-column="wire"]')).toHaveCount(TASK_COUNT);
    await expect(page.locator('[data-starling-queue] [data-column-section="grounded"]')).toContainText(
      'All clear',
    );

    // ── the flock: the Air dropped and rejoined, so both roosts are on screen ───────────────────
    const roost = page.getByTestId('roost-card');
    await expect(roost).toHaveCount(2);
    await expect(page.getByTestId('flock-panel')).toHaveAttribute('data-node-count', '2');
    await expect(page.getByTestId('flock-summary')).toContainText('2 roosts');
    await expect(roost.filter({ hasText: 'MacBook Air' })).toHaveAttribute('data-status', 'online');

    // ── the meter: real API spend, local audits, and the savings claim ─────────────────────────
    const api = page.getByTestId('cost-api');
    await expect(api).not.toHaveText('$0.00');
    await expect(api).toHaveText(/^\$\d+\.\d{2}$/);
    await expect(page.getByTestId('cost-local')).toHaveText('$0.00');
    await expect(page.getByTestId('cost-saved')).toHaveText(/^\$\d+\.\d{2}$/);
    await expect(page.getByTestId('cost-meter')).toContainText(/[1-9]\d* local calls?/);
    await expect(page.getByTestId('metrics-merged')).toHaveText('7');
    await expect(page.getByTestId('metrics-failed')).toHaveText('0');

    // Nothing on the way here may have logged an error (React, canvas, replay, panels).
    expect(console_.errors).toEqual([]);
  });
});
