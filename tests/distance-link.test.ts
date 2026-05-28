import { describe, it, expect, beforeEach } from 'vitest';
import {
  setLinkMode,
  setTemporalDistance,
  getTemporalDistance,
  setOnLinkModeChange,
} from '../src/temporalState';
import { calculateExposureOptimizer } from '../src/exposure';
import { calculateDerived } from '../src/engine';
import { SENSOR_RADIOMETRY } from '../presets';
import type { AppState, MotionParams } from '../src/types';

function makeState(distanceToSubject: number): AppState {
  return {
    focalLength: 3.04,
    diagonalFov: 0,
    aperture: 2.0,
    wavelength: 550,
    pixelPitch: 1.12,
    nativeWidth: 3280,
    nativeHeight: 2464,
    olpfPresent: true,
    extractedWidth: 3280,
    extractedHeight: 2464,
    outputFormat: 'nv12',
    mjpgQuality: 80,
    h264Qp: 23,
    h264BitrateMbps: 4,
    readoutMethod: 'binning',
    selectedV4l2Mode: -1,
    readoutPitchMultiplier: 1,
    readoutFullFoV: true,
    measurementMode: 'monochrome',
    lensTier: 'mid-glass',
    shutterType: 'rolling',
    distanceToSubject,
    dynamicRangeDb: 66,
    luxAtSubject: 50000,
    subjectReflectance: 0.18,
    desiredSnrDb: 15,
    temperatureC: 25,
    lensTransmission: 0.85,
    gain: 0,
  };
}

const motion: MotionParams = {
  linearVelocity: 5,
  acceleration: 0,
  angularVelocity: 0,
  subjectHalfWidth: 0.1,
};

describe('target vs camera distance', () => {
  beforeEach(() => {
    setLinkMode(false);
    setTemporalDistance(5);
    setOnLinkModeChange((linked) => {
      if (linked) setTemporalDistance(3);
    });
  });

  it('exposure motion ceiling uses target distance only when unlinked', () => {
    const radiometry = SENSOR_RADIOMETRY['imx219'];
    const near = calculateExposureOptimizer(
      makeState(1),
      calculateDerived(makeState(1)),
      radiometry,
      motion,
      100,
    );
    const far = calculateExposureOptimizer(
      makeState(4),
      calculateDerived(makeState(4)),
      radiometry,
      motion,
      100,
    );
    expect(getTemporalDistance()).toBe(5);
    expect(far.tMotionMax / near.tMotionMax).toBeCloseTo(4, 0.15);
  });

  it('linking copies target distance into temporal distance via callback', () => {
    setTemporalDistance(5);
    setLinkMode(true);
    expect(getTemporalDistance()).toBe(3);
  });
});
