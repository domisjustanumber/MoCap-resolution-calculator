import { test, expect } from '@playwright/test';

test.describe('Motion presets', () => {
  test('walking preset is active by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.vel-preset.active');
    const walkingBtn = page.locator('.vel-preset[data-velocity="walking"]');
    await expect(walkingBtn).toHaveClass(/active/);
    const velInput = page.locator('#velocity-custom');
      await expect(velInput).toHaveValue('1.5');
      await expect(page.locator('#accel-custom')).toHaveValue('0.5');
      await expect(page.locator('#angular-custom')).toHaveValue('10');
  });

  test('sports preset sets velocity to 5 and updates motion fields', async ({ page }) => {
    await page.goto('/');
    await page.click('.vel-preset[data-velocity="sports"]');
    await page.waitForTimeout(300);
    const velInput = page.locator('#velocity-custom');
    await expect(velInput).toHaveValue('5');
    const accelInput = page.locator('#motion-accel-input');
    await expect(accelInput).toHaveValue('4.0');
    const angularInput = page.locator('#motion-angular-input');
      await expect(angularInput).toHaveValue('60');
      await expect(page.locator('#accel-custom')).toHaveValue('4.0');
      await expect(page.locator('#angular-custom')).toHaveValue('60');
  });

  test('static preset zeroes all motion', async ({ page }) => {
    await page.goto('/');
    await page.click('.vel-preset[data-velocity="static"]');
    await page.waitForTimeout(300);
    await expect(page.locator('#velocity-custom')).toHaveValue('0');
    await expect(page.locator('#motion-accel-input')).toHaveValue('0.0');
    await expect(page.locator('#motion-angular-input')).toHaveValue('0');
  });
});

test.describe('Motion fieldset', () => {
  test('renders in the detailed controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#motion-accel')).toBeVisible();
    await expect(page.locator('#motion-angular')).toBeVisible();
    await expect(page.locator('#motion-halfwidth')).toBeVisible();
  });

  test('changing QC accel marks preset as custom', async ({ page }) => {
    await page.goto('/');
    await page.locator('#accel-custom').fill('3');
    await page.locator('#accel-custom').dispatchEvent('input');
    await page.waitForTimeout(200);
    const walkingBtn = page.locator('.vel-preset[data-velocity="walking"]');
    await expect(walkingBtn).not.toHaveClass(/active/);
  });
});

test.describe('Light level default', () => {
  test('defaults to Indoor (100 lux)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#luxAtSubject')).toHaveValue('100');
  });
});

test.describe('Acceleration tab', () => {
  test('shows subject acceleration and rotation cards', async ({ page }) => {
    await page.goto('/');
    await page.click('#tab-acceleration');
    await page.waitForTimeout(300);
    const subjAccel = page.locator('#accel-subject-accel');
    const subjRot = page.locator('#accel-subject-rot');
    await expect(subjAccel).toBeVisible();
    await expect(subjRot).toBeVisible();
  });
});

test.describe('Build output', () => {
  test('page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});
