import { test, expect } from '@playwright/test';

test.describe('Motion presets', () => {
  test('walking preset is active by default', async ({ page }) => {
    await page.goto('/');
    const walkingBtn = page.locator('#qc-velocity-presets .vel-preset[data-velocity="walking"]');
    await expect(walkingBtn).toHaveClass(/active/);
    await expect(page.locator('#accel-custom')).toHaveValue('0.5');
    await expect(page.locator('#angular-custom')).toHaveValue('10');
  });

  test('running preset sets velocity to 8 and updates motion fields', async ({ page }) => {
    await page.goto('/');
    await page.locator('#qc-velocity-presets .vel-preset[data-velocity="running"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#accel-custom')).toHaveValue('3.0');
    await expect(page.locator('#angular-custom')).toHaveValue('15');
  });

  test('agility preset sets velocity to 1 and updates motion fields', async ({ page }) => {
    await page.goto('/');
    await page.locator('#qc-velocity-presets .vel-preset[data-velocity="agility"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#accel-custom')).toHaveValue('2.0');
    await expect(page.locator('#angular-custom')).toHaveValue('150');
  });

  test('static preset zeroes all motion', async ({ page }) => {
    await page.goto('/');
    await page.locator('#qc-velocity-presets .vel-preset[data-velocity="static"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#accel-custom')).toHaveValue('0');
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
