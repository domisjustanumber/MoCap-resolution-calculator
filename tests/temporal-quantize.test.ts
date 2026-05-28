import { describe, it, expect } from 'vitest';
import {
  enumerateRegionShutterDenoms,
  idealMaxShutterDenomFromExposure,
  isValidRegionFps,
  isValidRegionShutterDenom,
  nearestValidShutterIndex,
  snapFpsToRegion,
  snapShutterToRegion,
  snapTimingPreservingSnr,
  shuttersForFpsSearch,
  validShutterDenomsForRegion,
} from '../src/temporalQuantize';

describe('temporalQuantize', () => {
  it('enumerates 50 Hz shutter grid', () => {
    expect(enumerateRegionShutterDenoms(50, 200)).toEqual([25, 50, 100, 150, 200]);
  });

  it('validShutterDenomsForRegion respects min exposure (fps)', () => {
    const valid = validShutterDenomsForRegion(50, 30, 8000);
    expect(valid[0]).toBe(50);
    expect(valid).not.toContain(25);
    expect(valid.every((d) => isValidRegionShutterDenom(d, 50) && d >= 30)).toBe(true);
  });

  it('nearestValidShutterIndex picks closest grid point', () => {
    const valid = [25, 50, 100, 150, 200];
    expect(nearestValidShutterIndex(valid, 50)).toBe(1);
    expect(nearestValidShutterIndex(valid, 48)).toBe(1);
    expect(nearestValidShutterIndex(valid, 90)).toBe(2);
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

  it('idealMaxShutterDenomFromExposure uses SNR floor when longer than motion ceiling', () => {
    const denom = idealMaxShutterDenomFromExposure(
      { tMinusSnr: 1 / 50, tMotionMax: 1 / 30, tSaturation: 10 },
      8000,
    );
    expect(denom).toBe(50);
    expect(denom).not.toBe(30);
  });

  it('idealMaxShutterDenomFromExposure floors continuous cap (no round-up)', () => {
    const denom = idealMaxShutterDenomFromExposure(
      { tMinusSnr: 1 / 49.6, tMotionMax: 1 / 30, tSaturation: 10 },
      8000,
    );
    expect(denom).toBe(49);
  });

  it('shuttersForFpsSearch includes grid steps up to SNR-based ideal cap', () => {
    const shutters = shuttersForFpsSearch(25, 50, 8000, 50);
    expect(shutters).toContain(25);
    expect(shutters).toContain(50);
    expect(shutters.length).toBeGreaterThan(1);
    const motionOnlyCap = shuttersForFpsSearch(25, 30, 8000, 50);
    expect(motionOnlyCap).not.toContain(50);
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
