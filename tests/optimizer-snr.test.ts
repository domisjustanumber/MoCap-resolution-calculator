import { describe, it, expect } from 'vitest';
import { runOptimization, minAcceptableSnrDb, motionHeadroom, snrUndershootWorthwhile, spatialUndershootWorthwhile, candidateWorthwhileSnrUndershoot, pickBestWorthwhileRelaxed } from '../src/optimizer';
import { calculateDerived, calculateResults } from '../src/engine';
import { calculateExposureOptimizer } from '../src/exposure';
import { DEFAULT_STATE, createState, applyPreset, recalculate } from '../src/state';
import { SENSOR_RADIOMETRY } from '../presets';
import { setRegionHz, setFrameRate, getFrameRate, getMaxFpsLimit } from '../src/ui/temporalChart';
import { isValidRegionFps } from '../src/temporalQuantize';
import type { AppStateFull, MotionParams } from '../src/types';

const motion: MotionParams = { linearVelocity: 2, acceleration: 0, angularVelocity: 0, subjectHalfWidth: 0.5 };

function makeApp(overrides: Partial<typeof DEFAULT_STATE> = {}): AppStateFull {
  const state = { ...DEFAULT_STATE, ...overrides };
  const derived = calculateDerived(state);
  return {
    state,
    activePreset: 'pi-cam-v2',
    activeSensorPreset: 'imx219',
    activeLensPreset: 'default',
    derived,
    results: calculateResults(state, derived, motion, 1 / 60, 60, 0, false),
  };
}

function actualSnr(app: AppStateFull, result: NonNullable<ReturnType<typeof runOptimization>>): number {
  const state = {
    ...app.state,
    extractedWidth: result.extractedWidth,
    extractedHeight: result.extractedHeight,
    selectedV4l2Mode: result.selectedV4l2Mode,
    readoutPitchMultiplier: result.readoutPitchMultiplier,
    readoutFullFoV: result.readoutFullFoV,
    readoutMethod: result.readoutMethod,
  };
  const derived = calculateDerived(state);
  const baseline = calculateResults(state, derived, motion, 0.000001, 999999, 0, false);
  const radiometry = SENSOR_RADIOMETRY['imx219'];
  const shutterTime = 1 / Math.max(1, result.shutterDenom);
  const exposure = calculateExposureOptimizer(state, derived, radiometry, motion, baseline.fEffective, shutterTime);
  let snr = exposure.snrAtOptimalDb;
  if (state.measurementMode === 'colour' && state.outputFormat !== 'raw8' && state.outputFormat !== 'raw10') {
    snr -= state.outputFormat === 'uyuv' ? 3 : 6;
  }
  return snr;
}

describe('minAcceptableSnrDb', () => {
  it('applies percentage undershoot to SNR target', () => {
    expect(minAcceptableSnrDb(20, 10)).toBeCloseTo(18);
    expect(minAcceptableSnrDb(25, 0)).toBe(25);
  });
});

describe('spatialUndershootWorthwhile', () => {
  it('requires 20%+ smaller min feature size', () => {
    expect(spatialUndershootWorthwhile(100, 79)).toBe(true);
    expect(spatialUndershootWorthwhile(100, 80)).toBe(true);
    expect(spatialUndershootWorthwhile(100, 81)).toBe(true);
    expect(spatialUndershootWorthwhile(100, 84)).toBe(false);
  });
});

describe('candidateWorthwhileSnrUndershoot', () => {
  it('qualifies on spatial gain without motion under-performance', () => {
    const met = motionHeadroom({ linearVelocity: 2, acceleration: 5, angularVelocity: 0, subjectHalfWidth: 0.5 }, 60, 5);
    expect(candidateWorthwhileSnrUndershoot(met, met, 100, 70)).toBe(true);
    expect(candidateWorthwhileSnrUndershoot(met, met, 100, 85)).toBe(false);
  });
});

describe('snrUndershootWorthwhile', () => {
  it('requires under-performance and 20%+ motion gain', () => {
    const under = motionHeadroom({ linearVelocity: 2, acceleration: 20, angularVelocity: 0, subjectHalfWidth: 0.5 }, 30, 5);
    const improved = motionHeadroom({ linearVelocity: 2, acceleration: 20, angularVelocity: 0, subjectHalfWidth: 0.5 }, 40, 5);
    const marginal = motionHeadroom({ linearVelocity: 2, acceleration: 20, angularVelocity: 0, subjectHalfWidth: 0.5 }, 32, 5);

    expect(snrUndershootWorthwhile(under, improved)).toBe(true);
    expect(snrUndershootWorthwhile(under, marginal)).toBe(false);
  });

  it('does not undershoot when motion targets are already met', () => {
    const met = motionHeadroom({ linearVelocity: 2, acceleration: 5, angularVelocity: 0, subjectHalfWidth: 0.5 }, 60, 5);
    const faster = motionHeadroom({ linearVelocity: 2, acceleration: 5, angularVelocity: 0, subjectHalfWidth: 0.5 }, 80, 5);
    expect(snrUndershootWorthwhile(met, faster)).toBe(false);
  });
});

describe('runOptimization SNR guarantee', () => {
  it('meets SNR target at 50 lux when physically possible (free region)', () => {
    setRegionHz(0);
    const app = makeApp({ luxAtSubject: 50, desiredSnrDb: 25 });
    const result = runOptimization(app, motion, 5, 0);
    expect(result).not.toBeNull();
    expect(result!.snrMet).toBe(true);
    expect(actualSnr(app, result!)).toBeGreaterThanOrEqual(app.state.desiredSnrDb - 0.5);
  });

  it('meets SNR target with 50 Hz region when physically possible', () => {
    setRegionHz(50);
    const app = makeApp({ luxAtSubject: 80, desiredSnrDb: 25 });
    const result = runOptimization(app, motion, 5, 0);
    expect(result).not.toBeNull();
    expect(result!.snrMet).toBe(true);
    expect(isValidRegionFps(result!.fps, 50)).toBe(true);
    expect(actualSnr(app, result!)).toBeGreaterThanOrEqual(app.state.desiredSnrDb - 0.5);
  });

  it('does not force shutter to maxFps when longer exposure is needed (60 Hz region)', () => {
    setRegionHz(60);
    const slowMotion = { linearVelocity: 0.5, acceleration: 0, angularVelocity: 0, subjectHalfWidth: 0.5 };
    const app = makeApp({ luxAtSubject: 98, desiredSnrDb: 26, measurementMode: 'monochrome' });
    const result = runOptimization(app, slowMotion, 5, 0);
    expect(result).not.toBeNull();
    expect(isValidRegionFps(result!.fps, 60)).toBe(true);
    expect(result!.fps).toBe(30);
    expect(result!.shutterDenom).toBeLessThanOrEqual(30);
    expect(result!.snrMet).toBe(true);
    expect(actualSnr(app, result!)).toBeGreaterThanOrEqual(app.state.desiredSnrDb - 0.5);
  });

  it('reports snrMet false for unreachable targets', () => {
    setRegionHz(0);
    const app = makeApp({ luxAtSubject: 0.5, desiredSnrDb: 45 });
    const result = runOptimization(app, motion, 5, 0);
    if (result) {
      expect(result.snrMet).toBe(false);
    }
  });

  it('only uses SNR undershoot when motion targets underperform and gain is meaningful', () => {
    setRegionHz(0);
    const motionWithAccel: MotionParams = {
      linearVelocity: 2,
      acceleration: 20,
      angularVelocity: 0,
      subjectHalfWidth: 0.5,
    };
    const app = makeApp({ luxAtSubject: 18, desiredSnrDb: 26, measurementMode: 'monochrome' });
    const noUndershoot = runOptimization(app, motionWithAccel, 5, 0);
    const withUndershoot = runOptimization(app, motionWithAccel, 5, 10);

    expect(noUndershoot).not.toBeNull();
    expect(withUndershoot).not.toBeNull();

    if (noUndershoot!.snrMet && withUndershoot && withUndershoot.fps > noUndershoot!.fps) {
      const baseline = motionHeadroom(motionWithAccel, noUndershoot!.fps, 5);
      const candidate = motionHeadroom(motionWithAccel, withUndershoot.fps, 5);
      expect(snrUndershootWorthwhile(baseline, candidate)).toBe(true);
      expect(actualSnr(app, withUndershoot)).toBeLessThan(app.state.desiredSnrDb);
    }
  });

  it('Pi HQ Sports picks worthwhile relaxed option over strict when motion gains 20%+', () => {
    setRegionHz(50);
    const sports: MotionParams = { linearVelocity: 5, acceleration: 4, angularVelocity: 60, subjectHalfWidth: 0.5 };
    const app = applyPreset(createState(), {}, 'pi-hq-cam');
    app.state.luxAtSubject = 100;
    app.state.measurementMode = 'monochrome';

    const strict = runOptimization(app, sports, 5, 0);
    const relaxed = runOptimization(app, sports, 5, 50);
    expect(strict).not.toBeNull();
    expect(relaxed).not.toBeNull();
    expect(relaxed!.extractedWidth).toBe(1332);
    expect(relaxed!.extractedHeight).toBe(990);
    expect(relaxed!.fps).toBeGreaterThan(strict!.fps);
    expect(actualSnr(app, relaxed!)).toBeLessThan(app.state.desiredSnrDb);
    expect(actualSnr(app, relaxed!)).toBeGreaterThanOrEqual(minAcceptableSnrDb(app.state.desiredSnrDb, 50) - 0.5);

    const strictMotion = motionHeadroom(sports, strict!.fps, 5);
    const relaxedMotion = motionHeadroom(sports, relaxed!.fps, 5);
    expect(snrUndershootWorthwhile(strictMotion, relaxedMotion)).toBe(true);
  });

  it('prefers shorter shutter when spatial slack yields 20%+ resolution gain', () => {
    setRegionHz(60);
    const walking: MotionParams = { linearVelocity: 1.5, acceleration: 0.5, angularVelocity: 10, subjectHalfWidth: 0.5 };
    const app = applyPreset(createState(), {}, 'pi-hq-cam');
    app.state.measurementMode = 'monochrome';
    app.state.luxAtSubject = 50;

    const strictOnly = runOptimization(app, walking, 5, 0);
    const withSlack = runOptimization(app, walking, 5, 10);
    expect(strictOnly).not.toBeNull();
    expect(withSlack).not.toBeNull();
    expect(strictOnly!.shutterDenom).toBe(30);
    expect(withSlack!.shutterDenom).toBe(60);
    expect(withSlack!.minFeatureSize).toBeLessThan(strictOnly!.minFeatureSize);
    expect(spatialUndershootWorthwhile(strictOnly!.minFeatureSize, withSlack!.minFeatureSize)).toBe(true);
    expect(actualSnr(app, withSlack!)).toBeGreaterThanOrEqual(minAcceptableSnrDb(app.state.desiredSnrDb, 10) - 0.5);
  });

  it('returns only valid regional fps presets', () => {
    setRegionHz(60);
    const app = applyPreset(createState(), {}, 'pi-cam-v1');
    app.state.luxAtSubject = 400;
    const result = runOptimization(app, motion, 5, 10);
    expect(result).not.toBeNull();
    expect(isValidRegionFps(result!.fps, 60)).toBe(true);
    expect([30, 60]).toContain(result!.fps);
  });

  it('Pi HQ Sports daylight picks 120 fps on 1332×990 mode', () => {
    setRegionHz(60);
    const sports: MotionParams = { linearVelocity: 5, acceleration: 4, angularVelocity: 60, subjectHalfWidth: 0.5 };
    const app = applyPreset(createState(), {}, 'pi-hq-cam');
    app.state.luxAtSubject = 10_000;
    app.state.measurementMode = 'monochrome';
    recalculate(app);

    const result = runOptimization(app, sports, 5, 10);
    expect(result).not.toBeNull();
    expect(result!.extractedWidth).toBe(1332);
    expect(result!.extractedHeight).toBe(990);
    expect(result!.fps).toBe(120);
    expect(isValidRegionFps(result!.fps, 60)).toBe(true);
  });

  it('setFrameRate must run after recalculate when applying optimize result', () => {
    setRegionHz(60);
    const sports: MotionParams = { linearVelocity: 5, acceleration: 4, angularVelocity: 60, subjectHalfWidth: 0.5 };
    const app = applyPreset(createState(), {}, 'pi-hq-cam');
    app.state.luxAtSubject = 10_000;
    recalculate(app);
    expect(getMaxFpsLimit()).toBe(40);

    const result = runOptimization(app, sports, 5, 10);
    expect(result!.fps).toBe(120);

    setFrameRate(result!.fps);
    expect(getFrameRate()).toBe(40);

    app.state.extractedWidth = result!.extractedWidth;
    app.state.extractedHeight = result!.extractedHeight;
    app.state.selectedV4l2Mode = result!.selectedV4l2Mode;
    recalculate(app);
    setFrameRate(result!.fps);
    expect(getFrameRate()).toBe(120);
    expect(getMaxFpsLimit()).toBe(120);
  });
});

describe('pickBestWorthwhileRelaxed', () => {
  it('chooses largest underperforming-target gain among qualifying relaxed candidates', () => {
    const sports: MotionParams = { linearVelocity: 5, acceleration: 4, angularVelocity: 60, subjectHalfWidth: 0.5 };
    const options = [
      { fps: 50, shutterDenom: 50, width: 2028, height: 1080, v4l2Mode: 2, pitchMult: 2, fullFoV: false, readoutMethod: 'binning' as const, minFeature: 100, maxFps: 50, maxShutter: 400, targetFreq: 1, snrDb: 15 },
      { fps: 60, shutterDenom: 60, width: 1332, height: 990, v4l2Mode: 3, pitchMult: 3.05, fullFoV: false, readoutMethod: 'subsampling' as const, minFeature: 200, maxFps: 120, maxShutter: 800, targetFreq: 1, snrDb: 14.6 },
      { fps: 120, shutterDenom: 120, width: 1332, height: 990, v4l2Mode: 3, pitchMult: 3.05, fullFoV: false, readoutMethod: 'subsampling' as const, minFeature: 300, maxFps: 120, maxShutter: 800, targetFreq: 1, snrDb: 10.4 },
    ];
    const pick = pickBestWorthwhileRelaxed(25, 100, sports, 5, options);
    expect(pick?.fps).toBe(120);
    expect(pick?.width).toBe(1332);
  });

  it('chooses spatial resolution gain when motion targets are already met', () => {
    const walking: MotionParams = { linearVelocity: 1.5, acceleration: 0.5, angularVelocity: 10, subjectHalfWidth: 0.5 };
    const options = [
      { fps: 25, shutterDenom: 50, width: 1296, height: 972, v4l2Mode: 2, pitchMult: 2, fullFoV: true, readoutMethod: 'binning' as const, minFeature: 200, maxFps: 30, maxShutter: 400, targetFreq: 1, snrDb: 19 },
      { fps: 30, shutterDenom: 60, width: 1920, height: 1080, v4l2Mode: 1, pitchMult: 1, fullFoV: false, readoutMethod: 'cropping' as const, minFeature: 80, maxFps: 30, maxShutter: 400, targetFreq: 1, snrDb: 19.5 },
    ];
    const pick = pickBestWorthwhileRelaxed(25, 200, walking, 5, options);
    expect(pick?.shutterDenom).toBe(60);
    expect(pick?.minFeature).toBe(80);
  });
});
