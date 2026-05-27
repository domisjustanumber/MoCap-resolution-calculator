import { describe, it, expect } from 'vitest';
import {
  enumerateRegionShutterDenoms,
  isValidRegionFps,
  isValidRegionShutterDenom,
  snapFpsToRegion,
  snapShutterToRegion,
  snapTimingPreservingSnr,
  shuttersForFpsSearch,
} from '../src/temporalQuantize';

describe('temporalQuantize', () => {
  it('enumerates 50 Hz shutter grid', () => {
    expect(enumerateRegionShutterDenoms(50, 200)).toEqual([25, 50, 100, 150, 200]);
  });

  it('validates region fps and shutter', () => {
    expect(isValidRegionFps(25, 50)).toBe(true);
    expect(isValidRegionFps(15, 50)).toBe(false);
    expect(isValidRegionShutterDenom(50, 50)).toBe(true);
    expect(isValidRegionShutterDenom(30, 50)).toBe(false);
  });

  it('snaps shutter floor for longer exposure', () => {
    expect(snapShutterToRegion(35, 50, 25, 8000, 'floor')).toBe(25);
    expect(snapShutterToRegion(60, 50, 30, 8000, 'floor')).toBe(50);
  });

  it('snaps fps to nearest region value', () => {
    expect(snapFpsToRegion(28, 50, 120, 'nearest')).toBe(25);
    expect(snapFpsToRegion(40, 50, 120, 'nearest')).toBe(50);
  });

  it('shuttersForFpsSearch uses full regional grid, not only preset-like cap', () => {
    const shutters = shuttersForFpsSearch(120, 1750, 8000, 60);
    expect(shutters.length).toBeGreaterThan(1);
    expect(shutters.every((d) => isValidRegionShutterDenom(d, 60) && d >= 120 && d <= 1740)).toBe(true);
    expect(shutters).toContain(120);
    expect(shutters).toContain(1740);
    expect(shutters).not.toContain(1750);
    expect(shutters).not.toContain(1800);
  });

  it('shuttersForFpsSearch includes every valid regional step up to floored cap', () => {
    const shutters = shuttersForFpsSearch(120, 1860, 8000, 60);
    expect(shutters.length).toBeGreaterThan(1);
    expect(shutters.every((d) => isValidRegionShutterDenom(d, 60) && d >= 120 && d <= 1860)).toBe(true);
    expect(shutters).toContain(120);
    expect(shutters).toContain(1860);
    expect(shutters).not.toContain(1920);
  });

  it('shuttersForFpsSearch floors off-grid ideal to nearest valid regional value', () => {
    const shutters = shuttersForFpsSearch(120, 1750, 8000, 60);
    expect(shutters.every((d) => d <= 1740)).toBe(true);
    expect(shutters).toContain(1740);
    expect(shutters).not.toContain(1750);
  });

  it('prefers on-grid timing when SNR still passes', () => {
    const result = snapTimingPreservingSnr(
      { fps: 15, shutterDenom: 15 },
      50,
      60,
      8000,
      (fps, shutter) => shutter <= 25,
    );
    expect(result.onRegionGrid).toBe(true);
    expect(result.fps).toBe(25);
    expect(result.shutterDenom).toBe(25);
  });

  it('snap does not lower fps below the winner timing', () => {
    const result = snapTimingPreservingSnr(
      { fps: 120, shutterDenom: 1920 },
      60,
      120,
      8000,
      (fps, shutter) => fps >= 120 && shutter >= fps,
    );
    expect(result.fps).toBeGreaterThanOrEqual(120);
    expect(isValidRegionFps(result.fps, 60)).toBe(true);
  });

  it('snaps to grid when on-grid cannot meet SNR', () => {
    const result = snapTimingPreservingSnr(
      { fps: 15, shutterDenom: 15 },
      50,
      60,
      8000,
      (fps, shutter) => fps === 15 && shutter === 15,
    );
    expect(result.onRegionGrid).toBe(true);
    expect(result.fps).toBe(25);
    expect(result.shutterDenom).toBe(25);
  });
});
