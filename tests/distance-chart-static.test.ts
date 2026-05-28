import { describe, it, expect } from 'vitest';
import { staticSceneFeatureMm, calculateResults, computeImageVelocity } from '../src/engine';
import { CHARUCO_SQUARE_TO_MIN_FEATURE, MOTION_MTF50_CONST } from '../src/constants';
import { createState, applyPreset } from '../src/state';
import { setMotionParams, getMotionParams } from '../src/temporalState';

const staticMotion = { linearVelocity: 0, acceleration: 0, angularVelocity: 0, subjectHalfWidth: 0.5 };
const walkingMotion = { linearVelocity: 1.5, acceleration: 0.5, angularVelocity: 10, subjectHalfWidth: 0.5 };

function motionFeatureMmAt(
  app: ReturnType<typeof createState>,
  distanceM: number,
  shutterDenom: number,
): number {
  const motion = getMotionParams();
  const shutterS = 1 / shutterDenom;
  const results = calculateResults(app.state, app.derived, motion, shutterS, 30, 0, false);
  const focalLength = app.state.focalLength;
  const { vTotal } = computeImageVelocity(motion, shutterS, focalLength, distanceM);
  const vImg = vTotal * focalLength / distanceM;
  const fTemporal = MOTION_MTF50_CONST / (vImg * shutterS);
  const fEffective =
    Math.min(results.fcAberrated, results.fNyquistSkipped, fTemporal, results.fDRLimited) *
    results.formatEfficiency;
  return (500 / fEffective) * distanceM / focalLength;
}

describe('staticSceneFeatureMm', () => {
  it('increases with distance for optical limits only', () => {
    const app = applyPreset(createState(), {}, 'pi-cam-v1');
    const results = calculateResults(app.state, app.derived, staticMotion, 1 / 60, 30, 0, false);
    const { fcAberrated, fNyquistSkipped, fDRLimited, formatEfficiency } = results;
    const focalLength = app.state.focalLength;
    const at2 = staticSceneFeatureMm(2, focalLength, fcAberrated, fNyquistSkipped, fDRLimited, formatEfficiency);
    const at10 = staticSceneFeatureMm(10, focalLength, fcAberrated, fNyquistSkipped, fDRLimited, formatEfficiency);
    expect(at10).toBeGreaterThan(at2);
    expect(at2).toBeGreaterThan(0);
  });

  it('is smaller than motion-limited feature for walking subject at 2 m', () => {
    setMotionParams(walkingMotion);
    const app = applyPreset(createState(), {}, 'pi-cam-v1');
    const results = calculateResults(app.state, app.derived, walkingMotion, 1 / 60, 30, 0, false);
    const { fcAberrated, fNyquistSkipped, fDRLimited, formatEfficiency } = results;
    const focalLength = app.state.focalLength;
    const staticAt2 = staticSceneFeatureMm(2, focalLength, fcAberrated, fNyquistSkipped, fDRLimited, formatEfficiency);
    const motionAt2 = motionFeatureMmAt(app, 2, 60);
    expect(staticAt2).toBeLessThan(motionAt2);
  });

  it('ChArUco square size equals static feature times CHARUCO_SQUARE_TO_MIN_FEATURE', () => {
    const app = applyPreset(createState(), {}, 'pi-cam-v1');
    const results = calculateResults(app.state, app.derived, staticMotion, 1 / 60, 30, 0, false);
    const staticAt3 = staticSceneFeatureMm(
      3,
      app.state.focalLength,
      results.fcAberrated,
      results.fNyquistSkipped,
      results.fDRLimited,
      results.formatEfficiency,
    );
    expect(staticAt3 * CHARUCO_SQUARE_TO_MIN_FEATURE).toBeCloseTo(staticAt3 * 8.8, 6);
  });
});
