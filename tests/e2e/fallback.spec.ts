import { expect, test } from '@playwright/test';

/**
 * The Safari-in-a-worker path.
 *
 * MediaPipe decides for itself whether to trust OffscreenCanvas, and on Safari
 * 16 and earlier it does not — so when no canvas is supplied it falls back to
 * `document.createElement('canvas')`, which inside a Web Worker throws
 * "ReferenceError: Can't find variable: document" and kills the pipeline.
 *
 * These simulate that browser by removing OffscreenCanvas before the app loads.
 * The app must land on the main-thread path and keep working, not error out.
 */
test.describe('browsers that cannot host vision in a worker', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Delete it from both scopes the app might check.
      delete (globalThis as unknown as Record<string, unknown>).OffscreenCanvas;
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        get() {
          return undefined;
        },
        configurable: true,
      });
    });
  });

  test('falls back to the main thread instead of failing', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto('/');
    await page.getByRole('button', { name: /turn on the camera/i }).click();
    await expect(page.locator('video')).toHaveJSProperty('readyState', 4, { timeout: 20_000 });

    await page.getByRole('button', { name: 'Debug' }).click();
    // The debug panel names where landmarking ended up running.
    await expect(page.getByText('main thread')).toBeVisible({ timeout: 20_000 });

    // The specific crash this whole path exists to prevent.
    expect(consoleErrors.join('\n')).not.toMatch(/Can't find variable: document|document is not defined/);
  });

  test('says plainly that it is on the slower path', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /turn on the camera/i }).click();
    await expect(page.locator('video')).toHaveJSProperty('readyState', 4, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Debug' }).click();
    await expect(page.getByText(/cannot run hand tracking in a background thread/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('never surfaces a raw ReferenceError to the user', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /turn on the camera/i }).click();
    await page.waitForTimeout(6000);
    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toMatch(/ReferenceError|Can't find variable/);
  });
});
