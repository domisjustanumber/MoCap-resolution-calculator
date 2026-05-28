import { test, expect } from '@playwright/test';

const SLATE_700 = 'rgb(51, 65, 85)';

test.describe('CSS consistency', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#gain-slider');
  });

  test('horizontal sliders share dark track styling', async ({ page }) => {
    for (const id of ['gain-slider', 'dist-range', 'lux-slider']) {
      const bg = await page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, `#${id} track`).toBe(SLATE_700);
    }
  });

  test('vertical Y-axis slider matches horizontal slider styling', async ({ page }) => {
    const horizontal = await page.locator('#dist-range').evaluate((el) => ({
      track: getComputedStyle(el).height,
      accent: getComputedStyle(el).accentColor,
      trackBg: getComputedStyle(el).backgroundColor,
    }));
    const vertical = await page.locator('#dist-y-range').evaluate((el) => ({
      track: getComputedStyle(el).width,
      accent: getComputedStyle(el).accentColor,
    }));
    expect(vertical.track).toBe(horizontal.track);
    expect(horizontal.trackBg).toBe(SLATE_700);
    expect(vertical.accent).toBe(horizontal.accent);
  });

  test('compact inputs use shared height classes', async ({ page }) => {
    const compact = await page.locator('#accel-custom-input').evaluate((el) => ({
      height: parseFloat(getComputedStyle(el).height),
      fontSize: getComputedStyle(el).fontSize,
    }));
    expect(compact.height).toBeGreaterThanOrEqual(22);
    expect(compact.height).toBeLessThanOrEqual(28);
    expect(compact.fontSize).toBe('11px');

    const compactSm = await page.locator('#desiredSnrDb').evaluate((el) => ({
      height: parseFloat(getComputedStyle(el).height),
    }));
    expect(compactSm.height).toBeGreaterThanOrEqual(20);
    expect(compactSm.height).toBeLessThanOrEqual(26);
  });

  test('quick-control presets share chip sizing', async ({ page }) => {
    const preset = await page.locator('#qc-velocity-presets .vel-preset').first().evaluate((el) => ({
      fontSize: getComputedStyle(el).fontSize,
      paddingLeft: parseFloat(getComputedStyle(el).paddingLeft),
      borderRadius: getComputedStyle(el).borderRadius,
    }));
    expect(preset.fontSize).toBe('11px');
    expect(preset.paddingLeft).toBeCloseTo(4, 0);
    expect(parseFloat(preset.borderRadius)).toBeGreaterThan(0);
  });

  test('chart panels and metric cards use component classes', async ({ page }) => {
    await expect(page.locator('.chart-panel')).toHaveCount(2);
    await expect(page.locator('.metric-card')).toHaveCount(5);
    await expect(page.locator('#quick-controls .quick-ctrl')).toHaveCount(8);
  });

  test('no compact inputs retain inline size styles', async ({ page }) => {
    const styled = await page.locator('.input-compact, .input-compact-sm').evaluateAll((els) =>
      els.filter((el) => el.getAttribute('style')).map((el) => el.id),
    );
    expect(styled).toEqual([]);
  });

  test('exposure bar tracks use shared styling', async ({ page }) => {
    const track = await page.locator('#exp-snr-track').evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      radius: getComputedStyle(el).borderRadius,
    }));
    expect(track.radius).not.toBe('0px');
    expect(track.bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('Y-axis slider updates chart scale label', async ({ page }) => {
    const slider = page.locator('#dist-y-range');
    await slider.fill('200');
    await slider.dispatchEvent('input');
    await expect(page.locator('#dist-y-range-label')).toHaveText('200');
  });
});
