import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';
import { createState, applyPreset } from '../src/state';
import { runOptimization } from '../src/optimizer';
import { calculateResults } from '../src/engine';
import { calculateExposureOptimizer } from '../src/exposure';
import { SENSOR_RADIOMETRY } from '../presets';
import { setRegionHz, getMotionParams, setMotionParams } from '../src/temporalState';
import { MOTION_MTF50_CONST } from '../src/constants';

function featureMmAt(app: ReturnType<typeof createState>, distanceM: number, shutterDenom: number, fps: number) {
  const motion = getMotionParams();
  const shutterS = 1 / shutterDenom;
  const results = calculateResults(app.state, app.derived, motion, shutterS, fps, 0, false);
  const focalLength = app.state.focalLength;
  const vEff = motion.linearVelocity + 0.5 * motion.acceleration * shutterS;
  const vRot = (motion.angularVelocity * Math.PI / 180) * motion.subjectHalfWidth;
  const vTotal = Math.sqrt(vEff * vEff + vRot * vRot);
  const vImg = vTotal * focalLength / distanceM;
  const fTemporal = MOTION_MTF50_CONST / (vImg * shutterS);
  const fEffective = Math.min(results.fcAberrated, results.fNyquistSkipped, fTemporal, results.fDRLimited) * results.formatEfficiency;
  return (500 / fEffective * distanceM) / focalLength;
}

function snrAt(app: ReturnType<typeof createState>, shutterDenom: number, fps: number) {
  const motion = getMotionParams();
  const baseline = calculateResults(app.state, app.derived, motion, 0.000001, 999999, 0, false);
  const radiometry = SENSOR_RADIOMETRY[app.activeSensorPreset];
  const exp = calculateExposureOptimizer(app.state, app.derived, radiometry, motion, baseline.fEffective, 1 / shutterDenom);
  return exp.snrAtOptimalDb;
}

describe('default optimize vs 1/60', () => {
  it('reports comparison for default presets', () => {
    setRegionHz(50);
    setMotionParams({ linearVelocity: 1.5, acceleration: 0.5, angularVelocity: 10, subjectHalfWidth: 0.5 });
    const out: Record<string, unknown> = {};

    for (const regionHz of [50, 60]) {
    for (const preset of ['pi-cam-v1', 'pi-hq-cam'] as const) {
      setRegionHz(regionHz);
      const app = applyPreset(createState(), {}, preset);
      app.state.measurementMode = 'monochrome';
      const beforeResults = calculateResults(app.state, app.derived, getMotionParams(), 1 / 60, 30, 0, false);
      const before = {
        fps: 30, sd: 60, res: `${app.state.extractedWidth}x${app.state.extractedHeight}`,
        snr: snrAt(app, 60, 30),
        feat1m: featureMmAt(app, 1, 60, 30),
        feat2m: featureMmAt(app, 2, 60, 30),
        bottleneck: beforeResults.bottleneckType,
      };

      const result = runOptimization(app, getMotionParams(), 5, 10);
      expect(result).not.toBeNull();
      if (result) {
        app.state.extractedWidth = result.extractedWidth;
        app.state.extractedHeight = result.extractedHeight;
        app.state.selectedV4l2Mode = result.selectedV4l2Mode;
        app.state.readoutPitchMultiplier = result.readoutPitchMultiplier;
        app.state.readoutFullFoV = result.readoutFullFoV;
        app.state.readoutMethod = result.readoutMethod;
      }

      const afterResults = calculateResults(app.state, app.derived, getMotionParams(), 1 / result!.shutterDenom, result!.fps, 0, false);
      out[`${preset}@${regionHz}Hz`] = {
        before,
        after: {
          fps: result!.fps,
          sd: result!.shutterDenom,
          res: `${result!.extractedWidth}x${result!.extractedHeight}`,
          snr: snrAt(app, result!.shutterDenom, result!.fps),
          feat1m: featureMmAt(app, 1, result!.shutterDenom, result!.fps),
          feat2m: featureMmAt(app, 2, result!.shutterDenom, result!.fps),
          snrMet: result!.snrMet,
          bottleneck: afterResults.bottleneckType,
          atOneSixtiethSameConfig: {
            snr: snrAt(app, 60, result!.fps),
            feat1m: featureMmAt(app, 1, 60, result!.fps),
            feat2m: featureMmAt(app, 2, 60, result!.fps),
          },
        },
      };
    }
    }

    writeFileSync('tests/optimize-compare-out.json', JSON.stringify(out, null, 2));
    expect(Object.keys(out).length).toBe(4);
  });
});
