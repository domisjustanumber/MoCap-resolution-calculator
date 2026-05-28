import { describe, it, expect } from 'vitest';
import { createState, applyPreset, recalculate } from '../src/state';
import { runOptimization, minAcceptableSnrDb } from '../src/optimizer';
import { calculateResults } from '../src/engine';
import { calculateExposureOptimizer } from '../src/exposure';
import { SENSOR_RADIOMETRY } from '../presets';
import { setRegionHz, setMotionParams, setFrameRate, setShutterDenom } from '../src/temporalState';

const walking = { linearVelocity: 1.5, acceleration: 0.5, angularVelocity: 10, subjectHalfWidth: 0.5 };

/** UI SNR — matches recalculate() / updateSnrBar() */
function uiSnrDb(app: ReturnType<typeof createState>, shutterDenom: number, fps: number): number {
  const appR = recalculate({
    ...app,
    state: { ...app.state },
  });
  setFrameRate(fps);
  setShutterDenom(shutterDenom);
  const motion = walking;
  const shutterTime = 1 / shutterDenom;
  const firstPass = calculateResults(appR.state, appR.derived, motion, shutterTime, fps, 0, false);
  const radiometry = SENSOR_RADIOMETRY[appR.activeSensorPreset];
  const exposure = calculateExposureOptimizer(
    appR.state,
    appR.derived,
    radiometry,
    motion,
    firstPass.fEffective,
    shutterTime,
    appR.state.gain === 0,
  );
  const actualElectrons = exposure.electronsPerPxPerSec * Math.max(0.00001, shutterTime);
  const RN2 = radiometry.readNoiseE ** 2;
  const DC = radiometry.darkCurrentE * shutterTime;
  const totalNoise = Math.sqrt(actualElectrons + RN2 + DC);
  return 20 * Math.log10(actualElectrons / totalNoise);
}

function defaultPiCamV1App(lux = 100) {
  setRegionHz(60);
  setMotionParams(walking);
  setFrameRate(30);
  setShutterDenom(60);
  const app = applyPreset(createState(), {}, 'pi-cam-v1');
  app.state.measurementMode = 'monochrome';
  app.state.luxAtSubject = lux;
  return recalculate(app);
}

describe('Pi Cam v1 default load — spatial slack picks 1/60', () => {
  it('at default 100 lux, 1/60 SNR is below slack band (photon-limited scene)', () => {
    const app = defaultPiCamV1App(100);
    expect(uiSnrDb(app, 60, 30)).toBeCloseTo(12.4, 0);
  });

  it('second optimize click matches first after applying result (idempotent)', () => {
    const app = defaultPiCamV1App(400);
    const r1 = runOptimization(app, walking, 5, 10);
    expect(r1).not.toBeNull();

    app.state.extractedWidth = r1!.extractedWidth;
    app.state.extractedHeight = r1!.extractedHeight;
    app.state.selectedV4l2Mode = r1!.selectedV4l2Mode;
    app.state.readoutPitchMultiplier = r1!.readoutPitchMultiplier;
    app.state.readoutFullFoV = r1!.readoutFullFoV;
    app.state.readoutMethod = r1!.readoutMethod;
    app.state.gain = r1!.optimalGain;
    recalculate(app);
    setFrameRate(r1!.fps);
    setShutterDenom(r1!.shutterDenom);

    const r2 = runOptimization(app, walking, 5, 10);
    expect(r2).not.toBeNull();
    expect(r2!.fps).toBe(r1!.fps);
    expect(r2!.shutterDenom).toBe(r1!.shutterDenom);
    expect(r2!.extractedWidth).toBe(r1!.extractedWidth);
    expect(r2!.extractedHeight).toBe(r1!.extractedHeight);
    expect(r2!.selectedV4l2Mode).toBe(r1!.selectedV4l2Mode);
  });

  it('at ~400 lux, 10% slack picks shortest on-grid shutter that meets SNR @ 1920×1080', () => {
    const app = defaultPiCamV1App(400);
    expect(uiSnrDb(app, 60, 30)).toBeCloseTo(19.8, 0);

    const result = runOptimization(app, walking, 5, 10);
    expect(result).not.toBeNull();
    expect(result!.fps).toBe(30);
    expect(result!.shutterDenom).toBeGreaterThanOrEqual(60);
    expect(result!.shutterDenom % 60).toBe(0);
    expect(result!.extractedWidth).toBeGreaterThan(0);
    expect(result!.extractedHeight).toBeGreaterThan(0);
    expect(result!.snrMet).toBe(true);

    const appAfter = recalculate({
      ...app,
      state: {
        ...app.state,
        extractedWidth: result!.extractedWidth,
        extractedHeight: result!.extractedHeight,
        selectedV4l2Mode: result!.selectedV4l2Mode,
        readoutPitchMultiplier: result!.readoutPitchMultiplier,
        readoutFullFoV: result!.readoutFullFoV,
        readoutMethod: result!.readoutMethod,
        gain: result!.optimalGain,
      },
    });
    const snr = uiSnrDb(appAfter, result!.shutterDenom, result!.fps);
    expect(snr).toBeGreaterThanOrEqual(minAcceptableSnrDb(20, 10) - 0.5);
  });

  it('at ~400 lux, 20% slack also picks worthwhile spatial over 1/30 strict', () => {
    const app = defaultPiCamV1App(400);
    const result = runOptimization(app, walking, 5, 20);
    expect(result).not.toBeNull();
    expect(result!.extractedWidth).toBe(1920);
    expect(result!.shutterDenom).toBeGreaterThanOrEqual(60);
    expect(result!.minFeatureSize).toBeLessThan(197.81);
  });
});
