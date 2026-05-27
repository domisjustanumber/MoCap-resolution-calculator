import { test, expect } from '@playwright/test';

test.describe('Motion presets', () => {
  test('walking preset is active by default', async ({ page }) => {
    await page.goto('/');
    const walkingBtn = page.locator('#qc-velocity-presets .vel-preset[data-velocity="walking"]');
    await expect(walkingBtn).toHaveClass(/active/);
    const velInput = page.locator('#velocity-custom');
      await expect(velInput).toHaveValue('1.5');
      await expect(page.locator('#accel-custom')).toHaveValue('0.5');
      await expect(page.locator('#angular-custom')).toHaveValue('10');
  });

  test('sports preset sets velocity to 5 and updates motion fields', async ({ page }) => {
    await page.goto('/');
    await page.locator('#qc-velocity-presets .vel-preset[data-velocity="sports"]').click();
    await page.waitForTimeout(300);
    const velInput = page.locator('#velocity-custom');
    await expect(velInput).toHaveValue('5');
    await expect(page.locator('#accel-custom')).toHaveValue('4.0');
    await expect(page.locator('#angular-custom')).toHaveValue('60');
  });

  test('static preset zeroes all motion', async ({ page }) => {
    await page.goto('/');
    await page.locator('#qc-velocity-presets .vel-preset[data-velocity="static"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#velocity-custom')).toHaveValue('0');
    await expect(page.locator('#accel-custom')).toHaveValue('0.0');
    await expect(page.locator('#angular-custom')).toHaveValue('0');
  });
});

test.describe('Motion presets interaction', () => {
  test('changing QC accel marks preset as custom', async ({ page }) => {
    await page.goto('/');
    await page.locator('#accel-custom').fill('3');
    await page.locator('#accel-custom').dispatchEvent('input');
    await page.waitForTimeout(200);
    const walkingBtn = page.locator('#qc-velocity-presets .vel-preset[data-velocity="walking"]');
    await expect(walkingBtn).not.toHaveClass(/active/);
  });
});

test.describe('Light level default', () => {
  test('defaults to Indoor (100 lux)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#luxAtSubject')).toHaveValue('100');
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
