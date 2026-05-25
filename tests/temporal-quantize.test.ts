import { describe, it, expect } from 'vitest';
import {
  enumerateRegionShutterDenoms,
  isValidRegionFps,
  isValidRegionShutterDenom,
  snapFpsToRegion,
  snapShutterToRegion,
  snapTimingPreservingSnr,
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
    expect(result.shutterDenom).toBe(50);
  });
});
