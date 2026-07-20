import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?static=1');
  await expect.poll(() => page.evaluate(() => window.__PAINE_EXPLORER__?.ready)).toBe(true);
});

test('loads the vista and exposes the expected controls', async ({ page }) => {
  test.setTimeout(60_000);
  await expect(page.getByRole('heading', { name: 'Torres del Paine' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch navigation mode' })).toBeVisible();
  await expect(page.locator('#loading')).toHaveClass(/complete/);
  await expect(page).toHaveScreenshot('opening-vista.png', { maxDiffPixelRatio: .035, timeout: 15_000 });
  await page.evaluate(() => window.__PAINE_EXPLORER__?.view('alternate'));
  await page.waitForTimeout(250);
  await expect(page).toHaveScreenshot('alternate-vista.png', { maxDiffPixelRatio: .035, timeout: 15_000 });
});

test('switches modes, resets the camera, and persists quality', async ({ page }) => {
  await page.getByRole('button', { name: 'Switch navigation mode' }).click();
  await expect.poll(() => page.evaluate(() => window.__PAINE_EXPLORER__?.mode())).toBe('fly');
  await page.getByRole('button', { name: 'Change visual quality' }).click();
  await expect.poll(() => page.evaluate(() => window.__PAINE_EXPLORER__?.quality())).toBe('medium');
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__PAINE_EXPLORER__?.ready)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__PAINE_EXPLORER__?.quality())).toBe('medium');
  await page.getByRole('button', { name: 'Reset viewpoint' }).click();
  const camera = await page.evaluate(() => window.__PAINE_EXPLORER__?.camera());
  expect(camera?.[0]).toBeCloseTo(-35);
  expect(camera?.[1]).toBeCloseTo(24);
  expect(camera?.[2]).toBeCloseTo(145);
});

test('resizes cleanly and opens the attribution panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'About' }).click();
  await expect(page.locator('#about-panel')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByText(/Copernicus DEM GLO-30/)).toBeVisible();
});

test('uses only same-origin runtime assets', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') externalRequests.push(request.url());
  });
  await page.goto('/?static=1');
  await expect.poll(() => page.evaluate(() => window.__PAINE_EXPLORER__?.ready)).toBe(true);
  expect(externalRequests).toEqual([]);
});
