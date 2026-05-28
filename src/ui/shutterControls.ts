import {
  nearestValidShutterIndex,
  snapShutterToRegion,
  validShutterDenomsForRegion,
} from '../temporalQuantize';
import {
  getEffectiveFrameRate,
  getEffectiveRegionHz,
  getEffectiveShutterDenom,
  getFrameRate,
  getMaxShutterLimit,
  getRegionHz,
  getShutterDenom,
  isLinkMode,
  setShutterDenom,
  setTemporalShutterDenom,
} from '../temporalState';

export type ShutterTab = 'spatial' | 'sync';

const gridBySlider = new WeakMap<HTMLInputElement, readonly number[]>();

export function shutterContext(tab: ShutterTab): {
  regionHz: number;
  minFps: number;
  denom: number;
} {
  if (tab === 'spatial' || isLinkMode()) {
    return { regionHz: getRegionHz(), minFps: getFrameRate(), denom: getShutterDenom() };
  }
  return {
    regionHz: getEffectiveRegionHz(),
    minFps: getEffectiveFrameRate(),
    denom: getEffectiveShutterDenom(),
  };
}

export function snapShutterForTab(denom: number, tab: ShutterTab): number {
  const { regionHz, minFps } = shutterContext(tab);
  return snapShutterToRegion(denom, regionHz, minFps, getMaxShutterLimit(), 'nearest');
}

/** Configure range input: discrete indices on regional grid, or integer step when region is free. */
export function configureShutterSlider(slider: HTMLInputElement, tab: ShutterTab): void {
  const max = getMaxShutterLimit();
  const { regionHz, minFps, denom } = shutterContext(tab);
  const snapped = snapShutterToRegion(denom, regionHz, minFps, max, 'nearest');

  if (regionHz > 0) {
    const valid = validShutterDenomsForRegion(regionHz, minFps, max);
    if (valid.length === 0) return;
    gridBySlider.set(slider, valid);
    slider.min = '0';
    slider.max = String(valid.length - 1);
    slider.step = '1';
    if (slider !== document.activeElement) {
      slider.value = String(nearestValidShutterIndex(valid, snapped));
    }
  } else {
    gridBySlider.delete(slider);
    slider.min = String(minFps);
    slider.max = String(max);
    slider.step = '1';
    if (slider !== document.activeElement) {
      slider.value = String(snapped);
    }
  }
}

/** Map slider position to a valid shutter denominator (always on regional grid when locked). */
export function denomFromShutterSlider(slider: HTMLInputElement, tab: ShutterTab): number {
  const raw = parseInt(slider.value, 10);
  if (isNaN(raw)) return shutterContext(tab).denom;

  const grid = gridBySlider.get(slider);
  if (grid && grid.length > 0) {
    const idx = Math.max(0, Math.min(grid.length - 1, raw));
    if (String(idx) !== slider.value) slider.value = String(idx);
    return grid[idx];
  }

  const { regionHz, minFps } = shutterContext(tab);
  return snapShutterToRegion(raw, regionHz, minFps, getMaxShutterLimit(), 'nearest');
}

export function syncShutterPair(
  slider: HTMLInputElement | null,
  input: HTMLInputElement | null,
  denom: number,
  tab: ShutterTab,
): void {
  if (slider) configureShutterSlider(slider, tab);
  if (input) {
    const max = getMaxShutterLimit();
    input.max = String(max);
    input.min = String(shutterContext(tab).minFps);
    if (input !== document.activeElement) input.value = String(denom);
  }
}

export function mirrorShutterDenom(
  denom: number,
  tab: ShutterTab,
  except?: HTMLElement | null,
): void {
  const syncSlider = document.getElementById('sync-shutter-slider') as HTMLInputElement | null;
  const spatialSlider = document.getElementById('spatial-shutter-slider') as HTMLInputElement | null;
  const syncInput = document.getElementById('sync-shutter-input') as HTMLInputElement | null;
  const spatialInput = document.getElementById('spatial-shutter-input') as HTMLInputElement | null;

  const sliders = tab === 'spatial' ? [spatialSlider] : [syncSlider];
  const inputs = tab === 'spatial' ? [spatialInput] : [syncInput];

  for (const el of sliders) {
    if (!el || el === except || el === document.activeElement) continue;
    configureShutterSlider(el, tab);
  }
  for (const el of inputs) {
    if (el && el !== except && el !== document.activeElement) {
      el.value = String(denom);
    }
  }
}

export function applyShutterChange(
  d: number,
  tab: ShutterTab,
  refreshAll: () => void,
  refreshTemporalOnly: () => void,
): void {
  const snapped = snapShutterForTab(d, tab);
  if (isLinkMode()) {
    setShutterDenom(snapped);
    refreshAll();
    return;
  }
  if (tab === 'spatial') {
    setShutterDenom(snapped);
    refreshAll();
  } else {
    setTemporalShutterDenom(snapped);
    refreshTemporalOnly();
  }
}

export function bindShutterControls(
  slider: HTMLInputElement | null,
  input: HTMLInputElement | null,
  tab: ShutterTab,
  refreshAll: () => void,
  refreshTemporalOnly: () => void,
): void {
  if (slider) {
    slider.addEventListener('input', () => {
      const d = denomFromShutterSlider(slider, tab);
      mirrorShutterDenom(d, tab, slider);
      applyShutterChange(d, tab, refreshAll, refreshTemporalOnly);
    });
  }
  if (input) {
    input.addEventListener('input', () => {
      const parsed = parseInt(input.value, 10);
      if (isNaN(parsed) || parsed < 1) return;
      const d = snapShutterForTab(parsed, tab);
      mirrorShutterDenom(d, tab, input);
      applyShutterChange(d, tab, refreshAll, refreshTemporalOnly);
    });
  }
}
