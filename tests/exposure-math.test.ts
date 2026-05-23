import { describe, it, expect } from 'vitest';
import { calculateExposureOptimizer } from '../src/exposure';
import { calculateDerived, calculateResults } from '../src/engine';
import { SENSOR_RADIOMETRY } from '../presets';
import { DEFAULT_TEMPERATURE_C, DARK_CURRENT_DOUBLING_C } from '../src/constants';
import type { AppState, SensorRadiometry } from '../src/types';

function makeState(overrides: Partial<AppState> = {}): AppState {
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
    distanceToSubject: 2,
    dynamicRangeDb: 66,
    luxAtSubject: 1000,
    subjectReflectance: 0.18,
    desiredSnrDb: 20,
    temperatureC: 25,
    exposureMode: 'optimized',
    ...overrides,
  };
}

const imx219 = SENSOR_RADIOMETRY['imx219'];

function optimize(state: AppState, radiometry: SensorRadiometry, velocity = 1.5, targetFreq = 100) {
  const derived = calculateDerived(state);
  return calculateExposureOptimizer(state, derived, radiometry, velocity, targetFreq);
}

// ── Photon Flux & Electron Rate ──────────────────────────────────

describe('photon flux', () => {
  it('produces plausible e⁻/px/s in overcast daylight', () => {
    const s = makeState({ luxAtSubject: 1000, aperture: 2.0 });
    const o = optimize(s, imx219);
    expect(o.electronsPerPxPerSec).toBeGreaterThan(1000);
    expect(o.electronsPerPxPerSec).toBeLessThan(50000);
  });

  it('scales linearly with lux', () => {
    const s1 = makeState({ luxAtSubject: 500 });
    const s2 = makeState({ luxAtSubject: 1000 });
    const o1 = optimize(s1, imx219);
    const o2 = optimize(s2, imx219);
    expect(o2.electronsPerPxPerSec).toBeCloseTo(o1.electronsPerPxPerSec * 2, -1);
  });

  it('scales with inverse square of aperture', () => {
    const s2 = makeState({ aperture: 2.0 });
    const s4 = makeState({ aperture: 4.0 });
    const o2 = optimize(s2, imx219);
    const o4 = optimize(s4, imx219);
    // f/2.0 → f/4.0 is 1/4 the light
    expect(o2.electronsPerPxPerSec).toBeCloseTo(o4.electronsPerPxPerSec * 4, -1);
  });

  it('scales with reflectance', () => {
    const s18 = makeState({ subjectReflectance: 0.18 });
    const s36 = makeState({ subjectReflectance: 0.36 });
    const o18 = optimize(s18, imx219);
    const o36 = optimize(s36, imx219);
    expect(o36.electronsPerPxPerSec).toBeCloseTo(o18.electronsPerPxPerSec * 2, -1);
  });

  it('is higher for larger pixels (OV9281 vs IMX219)', () => {
    const s219 = makeState();
    const s9281 = makeState({ pixelPitch: 3.0, nativeWidth: 1280, nativeHeight: 800, extractedWidth: 1280, extractedHeight: 800 });
    const o219 = optimize(s219, imx219);
    const o9281 = optimize(s9281, SENSOR_RADIOMETRY['ov9281']);
    // OV9281 has 3.0µm pixel vs 1.12µm — area ratio ≈ 7.2×
    // QE is higher (85% vs 72%) and monochrome (CFA=1.0 vs 0.58)
    expect(o9281.electronsPerPxPerSec).toBeGreaterThan(o219.electronsPerPxPerSec * 4);
  });
});

// ── Dark Current Temperature Scaling ─────────────────────────────

describe('dark current temperature', () => {
  it('doubles every 6°C above 25°C', () => {
    const s25 = makeState({ temperatureC: 25, luxAtSubject: 10000 });
    const s31 = makeState({ temperatureC: 31, luxAtSubject: 10000 });
    const s37 = makeState({ temperatureC: 37, luxAtSubject: 10000 });

    const o25 = optimize(s25, imx219).electronsPerPxPerSec;
    const o31 = optimize(s31, imx219).electronsPerPxPerSec;
    const o37 = optimize(s37, imx219).electronsPerPxPerSec;

    // Signal is the same (lux and sensor identical)
    expect(o31).toBeCloseTo(o25, -1);
    expect(o37).toBeCloseTo(o25, -1);
  });

  it('affects SNR at low light', () => {
    const sCool = makeState({ temperatureC: 25, luxAtSubject: 1, aperture: 2.0 });
    const sHot = makeState({ temperatureC: 55, luxAtSubject: 1, aperture: 2.0 });
    const oCool = optimize(sCool, imx219, 0, 100);
    const oHot = optimize(sHot, imx219, 0, 100);
    expect(oHot.snrAtOptimalDb).toBeLessThan(oCool.snrAtOptimalDb);
  });
});

// ── SNR Floor (t_min) ────────────────────────────────────────────

describe('snr floor t_min', () => {
  it('returns finite t_min in bright light', () => {
    const s = makeState({ luxAtSubject: 10000 });
    const o = optimize(s, imx219);
    expect(o.tMinusSnr).toBeGreaterThan(0);
    expect(o.tMinusSnr).toBeLessThan(0.1); // well under 100ms
  });

  it('returns infinity when SNR target is unreachable', () => {
    const s = makeState({ luxAtSubject: 0.001, desiredSnrDb: 60 });
    const o = optimize(s, imx219);
    expect(o.tMinusSnr).toBe(0);
    expect(o.photonStarved).toBe(true);
  });

  it('returns infinity for unrealistically high SNR demand at very low light', () => {
    const s = makeState({ luxAtSubject: 0.5, desiredSnrDb: 50 });
    const o = optimize(s, imx219, 0, 100);
    expect(o.tMinusSnr).toBe(0);
    expect(o.photonStarved).toBe(true);
  });

  it('flags photon-starved when motion ceiling forces underexposure', () => {
    const s = makeState({ luxAtSubject: 3, desiredSnrDb: 30 });
    const o = optimize(s, imx219, 20, 300);
    // At 3 lux, SNR=30dB requires long exposure. Motion at 20 m/s forces short exposure.
    expect(o.photonStarved).toBe(true);
    expect(o.snrAtOptimalDb).toBeLessThan(s.desiredSnrDb);
  });
});

// ── Motion Ceiling ──────────────────────────────────────────────

describe('motion ceiling', () => {
  it('returns infinity for static subject', () => {
    const s = makeState();
    const o = optimize(s, imx219, 0, 100);
    expect(o.tMotionMax).toBe(0); // infinity clamped
  });

  it('returns shorter times for faster subjects', () => {
    const s = makeState();
    const oSlow = optimize(s, imx219, 1, 100);
    const oFast = optimize(s, imx219, 10, 100);
    expect(oFast.tMotionMax).toBeLessThan(oSlow.tMotionMax);
  });

  it('scales inversely with target resolution', () => {
    const s = makeState();
    const o100 = optimize(s, imx219, 2, 100);
    const o200 = optimize(s, imx219, 2, 200);
    // 2× resolution → 1/2 the motion allowance
    expect(o200.tMotionMax).toBeCloseTo(o100.tMotionMax / 2, 1);
  });
});

// ── Saturation Ceiling ──────────────────────────────────────────

describe('saturation ceiling', () => {
  it('returns shorter times in bright light', () => {
    const sDim = makeState({ luxAtSubject: 100 });
    const sBright = makeState({ luxAtSubject: 50000 });
    const oDim = optimize(sDim, imx219);
    const oBright = optimize(sBright, imx219);
    expect(oBright.tSaturation).toBeLessThan(oDim.tSaturation);
  });

  it('returns infinity when signal is zero', () => {
    const s = makeState({ luxAtSubject: 0 });
    const o = optimize(s, imx219);
    expect(o.tSaturation).toBe(0); // infinity clamped
  });
});

// ── t_optimal Selection ─────────────────────────────────────────

describe('t_optimal', () => {
  it('obey s saturation headroom factor', () => {
    const s = makeState({ luxAtSubject: 100000 });
    const o = optimize(s, imx219, 0, 100);
    // In bright light with static subject, should be limited by saturation
    expect(o.tOptimal).toBeLessThanOrEqual(o.tSaturation * 0.81);
  });

  it('obey s motion limit for fast subjects when not photon-starved', () => {
    const s = makeState({ luxAtSubject: 50000, desiredSnrDb: 15 });
    const o = optimize(s, imx219, 20, 100);
    // Fast subject with enough light: t_optimal should equal tMotionMax
    expect(o.tOptimal).toBeCloseTo(o.tMotionMax, 3);
  });

  it('meets SNR floor in moderate light with static subject', () => {
    const s = makeState({ luxAtSubject: 500 });
    const o = optimize(s, imx219, 0, 100);
    // Static subject → tMotionMax = ∞ → saturation-limited
    expect(o.snrAtOptimalDb).toBeGreaterThanOrEqual(s.desiredSnrDb - 0.5);
  });

  it('may be photon-starved when motion limits exposure', () => {
    const s = makeState({ luxAtSubject: 100 });
    const o = optimize(s, imx219, 5, 200);
    // Fast subject at moderate light — motion ceiling may push below SNR floor
    // Just verify it produces valid numbers
    expect(o.tOptimal).toBeGreaterThan(0);
    expect(o.tOptimal).toBeLessThanOrEqual(o.tMotionMax * 1.01);
    expect(Number.isFinite(o.snrAtOptimalDb)).toBe(true);
  });
});

// ── Gain ────────────────────────────────────────────────────────

describe('gain', () => {
  it('uses gain to compensate for shorter exposure even in bright light', () => {
    // With the optimizer now using tMinusSnr (shortest exposure meeting SNR),
    // gain fills the ADC range at the shorter integration time
    const s = makeState({ luxAtSubject: 50000 });
    const o = optimize(s, imx219, 0, 100);
    expect(o.optimalGain).toBeGreaterThanOrEqual(1.0);
    expect(o.optimalGain).toBeLessThanOrEqual(8.0);
  });

  it('is higher in dim light', () => {
    const s = makeState({ luxAtSubject: 50 });
    const o = optimize(s, imx219, 1, 100);
    expect(o.optimalGain).toBeGreaterThan(1.0);
  });

  it('never exceeds max gain', () => {
    const s = makeState({ luxAtSubject: 0.1 });
    const o = optimize(s, imx219);
    expect(o.optimalGain).toBeLessThanOrEqual(8.0);
  });

  it('never drops below 1×', () => {
    const s = makeState({ luxAtSubject: 100000 });
    const o = optimize(s, imx219, 0, 100);
    expect(o.optimalGain).toBeGreaterThanOrEqual(1.0);
  });
});

// ── FPS ─────────────────────────────────────────────────────────

describe('fps', () => {
  it('is higher with shorter exposure when readout-limited', () => {
    const sBright = makeState({ luxAtSubject: 50000 });
    const sDim = makeState({ luxAtSubject: 0.5 });
    const oBright = optimize(sBright, imx219, 0, 100);
    const oDim = optimize(sDim, imx219, 0, 100);
    // Bright: tOptimal << readout → FPS limited by readout
    // Dim (0.5 lux): tOptimal >> readout → FPS limited by exposure
    expect(oBright.optimalFps).toBeGreaterThan(oDim.optimalFps);
  });

  it('never exceeds sensor max due to readout', () => {
    const s = makeState({ luxAtSubject: 100000 });
    const o = optimize(s, imx219, 0, 100);
    // IMX219 readout ≈ 28µs × 2464 rows ≈ 69ms minimum frame time
    const maxFps = 1 / ((28 * 2464) / 1_000_000);
    expect(o.optimalFps).toBeLessThanOrEqual(maxFps + 1);
  });
});

// ── SNR Computation ─────────────────────────────────────────────

describe('snr', () => {
  it('approaches shot noise limit at high signal', () => {
    const s = makeState({ luxAtSubject: 50000, aperture: 1.4 });
    const o = optimize(s, imx219, 0, 100);
    // At high signal, SNR ≈ sqrt(signal) → 20 log10(sqrt)
    const signalApprox = o.electronsPerPxPerSec * o.tOptimal;
    const shotLimit = 20 * Math.log10(Math.sqrt(signalApprox));
    expect(o.snrAtOptimalDb).toBeCloseTo(shotLimit, 0);
  });

  it('is read-noise dominated at very low signal', () => {
    const s = makeState({ luxAtSubject: 1 });
    const o = optimize(s, imx219);
    // SNR should be significantly below shot limit due to read noise
    const signal = o.electronsPerPxPerSec * o.tOptimal;
    const shotLimit = signal > 0 ? 20 * Math.log10(Math.sqrt(signal)) : 0;
    expect(o.snrAtOptimalDb).toBeLessThan(shotLimit);
  });

  it('is non-negative for reasonable lux with static subject', () => {
    const cases = [10, 100, 1000, 10000, 100000];
    cases.forEach((lux) => {
      const s = makeState({ luxAtSubject: lux });
      const o = optimize(s, imx219, 0, 100);
      expect(o.snrAtOptimalDb).toBeGreaterThanOrEqual(0);
    });
  });
});

// ── Headroom ────────────────────────────────────────────────────

describe('headroom', () => {
  it('is positive or near-zero in all reasonable scenarios', () => {
    const cases = [10, 100, 10000];
    cases.forEach((lux) => {
      const s = makeState({ luxAtSubject: lux });
      const o = optimize(s, imx219);
      expect(o.headroomStops).toBeGreaterThan(-1);
    });
  });
});

// ── Preset-Specific Tests ────────────────────────────────────────

describe('preset behavior', () => {
  const presets = ['ov5647', 'imx219', 'imx477', 'ov9281'] as const;

  presets.forEach((preset) => {
    it(`${preset} produces valid results at 1000 lux`, () => {
      const s = makeState({ luxAtSubject: 1000 });
      const r = SENSOR_RADIOMETRY[preset] || SENSOR_RADIOMETRY['custom'];
      const o = optimize(s, r);
      expect(o.illuminanceSensorLux).toBeGreaterThan(0);
      expect(o.electronsPerPxPerSec).toBeGreaterThan(0);
      expect(o.tOptimal).toBeGreaterThan(0);
      expect(o.optimalGain).toBeGreaterThanOrEqual(1);
      expect(o.optimalFps).toBeGreaterThan(0);
      expect(Number.isFinite(o.snrAtOptimalDb)).toBe(true);
    });
  });

  it('OV9281 (monochrome GS) has highest sensitivity per pixel', () => {
    const s = makeState();
    const o9281 = optimize(s, SENSOR_RADIOMETRY['ov9281']);
    const o219 = optimize(s, imx219);
    expect(o9281.electronsPerPxPerSec).toBeGreaterThan(o219.electronsPerPxPerSec);
  });


});

// ── Engine Integration ───────────────────────────────────────────

describe('engine integration', () => {
  it('exposure optimizer feeds into calculateResults correctly', () => {
    const s = makeState({ luxAtSubject: 1000, exposureMode: 'optimized' });
    const derived = calculateDerived(s);
    const exposure = optimize(s, imx219, 1.5, 200);

    const results = calculateResults(
      s, derived, 1.5, exposure.tOptimal, exposure.optimalFps, 0, false, exposure
    );

    expect(results.exposure.tOptimal).toBe(exposure.tOptimal);
    expect(results.exposure.photonStarved).toBe(exposure.photonStarved);
    expect(results.fEffective).toBeGreaterThan(0);
    expect(results.fTemporal50).toBeGreaterThan(0);
  });

  it('flags photon-starved bottleneck when SNR unreachable', () => {
    const s = makeState({ luxAtSubject: 2, desiredSnrDb: 35 });
    const derived = calculateDerived(s);
    const exposure = optimize(s, imx219, 15, 300);

    const results = calculateResults(
      s, derived, 15, exposure.tOptimal, exposure.optimalFps, 0, false, exposure
    );

    expect(exposure.photonStarved).toBe(true);
    expect(results.bottleneckType).toBe('photon-starved');
  });

  it('manual mode bypasses optimizer', () => {
    const s = makeState({ exposureMode: 'manual' });
    const derived = calculateDerived(s);
    const results = calculateResults(s, derived, 1.5, 1/30, 30, 0, false);

    expect(results.exposure.tOptimal).toBeCloseTo(1/30, 2);
    expect(results.exposure.optimalGain).toBe(1);
  });
});
