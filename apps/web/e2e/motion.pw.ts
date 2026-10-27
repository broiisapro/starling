import { expect, type Page, test } from '@playwright/test';
import { openEndState, PROJECTOR } from './support';

/**
 * Reduced motion is an accessibility promise, not a style tweak: with `prefers-reduced-motion:
 * reduce` the Sky becomes a static status map ("calm") and every panel drops its animation.
 *
 * The Sky has no test hook for pausing its simulation (FIX REQUEST to Epic 47 in the handback), so
 * this reads the real canvas pixels: if the murmuration were still flying, two samples would differ.
 */
interface CanvasSample {
  /** Cheap fingerprint of the sampled pixels. */
  hash: number;
  /** Sampled pixels that are brighter than the night sky. Proves the canvas is not blank. */
  lit: number;
  pixels: number;
}

async function sampleCanvas(page: Page): Promise<CanvasSample> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="sky-view"] canvas');
    if (canvas === null) throw new Error('the sky canvas is not in the DOM');
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('the sky canvas has no 2d context');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let hash = 0;
    let lit = 0;
    // Every fourth pixel: enough to catch motion, cheap enough to run twice per test.
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (r + g + b > 36) lit += 1;
      hash = (hash * 33 + r * 3 + g * 5 + b * 7) % 4_294_967_296;
    }
    return { hash, lit, pixels: Math.floor(data.length / 4) };
  });
}

test.describe('reduced motion', () => {
  test.use({ viewport: PROJECTOR });

  test('the sky stops flying and every panel goes calm', async ({ page }) => {
    await openEndState(page);

    // ── baseline: the murmuration is moving ────────────────────────────────────────────────────
    const moving = await sampleCanvas(page);
    expect(moving.lit).toBeGreaterThan(200);
    await page.waitForTimeout(400);
    const movingAgain = await sampleCanvas(page);
    expect(movingAgain.hash).not.toBe(moving.hash);

    // ── system asks for reduced motion ─────────────────────────────────────────────────────────
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Every motion-carrying panel reports it (this is the shared stylesheet's switch)…
    await expect(page.getByTestId('metrics-panel')).toHaveAttribute('data-reduced-motion', 'true');
    await expect(page.locator('[data-starling-queue]')).toHaveAttribute('data-reduced-motion', 'true');
    await expect(page.getByTestId('roost-card').first()).toHaveAttribute('data-animated', 'false');

    // …and the Sky parks every bird: two samples 500 ms apart are identical.
    await page.waitForTimeout(500);
    const calm = await sampleCanvas(page);
    await page.waitForTimeout(500);
    const calmAgain = await sampleCanvas(page);
    expect(calmAgain.hash).toBe(calm.hash);
    // The calm map still drew something (a blank canvas would defeat the point).
    expect(calm.lit).toBeGreaterThan(200);
  });

  test('the calm sky is a readable status map, not an empty box', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openEndState(page);

    // The accessibility summary is the textual version of the same picture.
    await expect(page.getByTestId('sky-view')).toHaveAttribute(
      'aria-label',
      '7 tasks: 7 merged · 2 machines',
    );

    const sample = await sampleCanvas(page);
    expect(sample.lit).toBeGreaterThan(200);
    expect(sample.pixels).toBeGreaterThan(10_000);
  });
});
