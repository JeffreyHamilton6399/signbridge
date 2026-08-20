import { expect, test } from '@playwright/test';

/**
 * These cover the things a unit test cannot: that the disclaimer is actually on
 * screen, that the camera flow explains itself before asking, and that the
 * worker starts and produces landmarks against a fake video device.
 */

test.describe('shell', () => {
  test('shows the disclaimer before anything else', async ({ page }) => {
    await page.goto('/');
    const disclaimer = page.getByRole('note');
    await expect(disclaimer).toBeVisible();
    await expect(disclaimer).toContainText('not an interpreter');
  });

  test('never uses the word "interpreter" for the software itself', async ({ page }) => {
    await page.goto('/');
    // Settings hydrate from IndexedDB first; reading body before that returns
    // the loading screen, which contains none of the copy under test.
    await expect(page.getByRole('note')).toBeVisible();
    const body = (await page.textContent('body')) ?? '';
    // Every occurrence must be a disclaimer about human interpreters.
    const matches = [...body.matchAll(/interpreter/gi)];
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      const context = body.slice(Math.max(0, match.index! - 60), match.index! + 60);
      expect(context).toMatch(/not an interpreter|qualified|certified|place of an interpreter/i);
    }
  });

  test('explains what happens to video before requesting the camera', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/nothing leaves this device/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /turn on the camera/i })).toBeVisible();
  });

  test('opens settings and shows on-device-only locked on', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();

    // Stated without anything having to be expanded first. Settings is an
    // accordion, and this is the one claim that must not be foldable.
    await expect(dialog.getByText('Everything stays on this device.')).toBeVisible();

    await dialog.getByRole('button', { name: /^Privacy/ }).click();
    const toggle = dialog.getByRole('switch', { name: 'On-device only' });
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeDisabled();
  });

  test('keeps advanced settings out of the way until asked for', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });

    // Recognition opens by default; its advanced dials do not.
    await expect(dialog.getByText('Dwell time to commit')).toBeVisible();
    await expect(dialog.getByText('Smoothing window')).toHaveCount(0);

    await dialog.getByRole('switch', { name: 'Show advanced settings' }).click();
    await expect(dialog.getByText('Smoothing window')).toBeVisible();
  });

  test('switches to reverse mode and translates without a camera', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Reverse/ }).click();
    await page.getByLabel('English').fill('I went to the store yesterday');
    await expect(page.getByText('YESTERDAY', { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/Time is established first/)).toBeVisible();
    await expect(page.getByText('Approximate', { exact: true })).toBeVisible();
  });

  test('is keyboard reachable', async ({ page }) => {
    await page.goto('/');
    // Press against <body> rather than page.keyboard, so the key lands in the
    // document instead of wherever the browser happened to leave focus.
    await page.locator('body').press('Tab');
    await expect(page.getByRole('link', { name: /skip to controls/i })).toBeFocused();
  });
});

test.describe('camera pipeline', () => {
  test('starts the camera and reports frames', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /turn on the camera/i }).click();

    // The video element becomes visible only once a stream is attached.
    await expect(page.locator('video')).toHaveJSProperty('readyState', 4, { timeout: 20_000 });

    await page.getByRole('button', { name: 'Debug' }).click();
    const debug = page.getByText(/Landmarking/);
    await expect(debug).toBeVisible();
  });

  test('recovers with a clear message when the camera is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => {
        const error = new Error('busy');
        error.name = 'NotReadableError';
        return Promise.reject(error);
      };
    });
    await page.goto('/');
    await page.getByRole('button', { name: /turn on the camera/i }).click();
    await expect(page.getByRole('alert')).toContainText('in use by another app');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});

test.describe('immersive mode', () => {
  test('tapping the view clears the controls but never the disclaimer', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /turn on the camera/i }).click();
    await expect(page.locator('video')).toHaveJSProperty('readyState', 4, { timeout: 20_000 });

    const controls = page.getByRole('button', { name: 'Backspace' });
    await expect(controls).toBeVisible();

    await page.getByRole('button', { name: 'Hide controls' }).click();
    await expect(controls).toBeHidden();

    // The disclaimer is non-dismissible, and "clearing the chrome" is not an
    // exception to that.
    await expect(page.getByRole('note')).toBeVisible();

    await page.getByRole('button', { name: 'Show controls' }).click();
    await expect(controls).toBeVisible();
  });
});
