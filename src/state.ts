import type { AppState, PresetName, AppStateFull, ExposureMode } from './types';
import { calculateDerived, calculateResults } from './engine';
import { calculateExposureOptimizer } from './exposure';
import { PRESETS } from './presets';
import {
  APERTURE_MIN,
  APERTURE_MAX,
  WAVELENGTH_MIN,
  WAVELENGTH_MAX,
  BINNING_VALUES,
  H264_QP_MIN,
  H264_QP_MAX,
  H264_BITRATE_MIN_MBPS,
  H264_BITRATE_MAX_MBPS,
  SENSOR_RADIOMETRY,
  DEFAULT_LUX_SUBJECT,
  DEFAULT_REFLECTANCE,
  DEFAULT_SNR_TARGET_DB,
  DEFAULT_TEMPERATURE_C,
  TEMP_MIN_C,
  TEMP_MAX_C,
  LUX_MIN,
  LUX_MAX,
  SNR_DB_MIN,
  SNR_DB_MAX,
} from './constants';
import { getSpatialVelocity, getShutterTime, getFrameRate, getSyncErrorP95, isSyncToggleOn, setFrameRate, setShutterDenom, setMaxFpsLimit, setMaxShutterLimit } from './ui/temporalChart';

export const DEFAULT_STATE: AppState = {
  focalLength: 3.60,
  diagonalFov: 0,
  aperture: 2.0,
  wavelength: 550,
  pixelPitch: 1.4,
  nativeWidth: 2592,
  nativeHeight: 1944,
  olpfPresent: true,
  pixelBinning: 1,
  extractedWidth: 640,
  extractedHeight: 480,
  outputFormat: 'mjpg',
  mjpgQuality: 60,
  h264Qp: 23,
  h264BitrateMbps: 4,
  subsamplingMethod: 'line-skip',
  measurementMode: 'luma',
  lensTier: 'cheap-plastic',
  distanceToSubject: 1,
  dynamicRangeDb: 66,
  luxAtSubject: DEFAULT_LUX_SUBJECT,
  subjectReflectance: DEFAULT_REFLECTANCE,
  desiredSnrDb: DEFAULT_SNR_TARGET_DB,
  temperatureC: DEFAULT_TEMPERATURE_C,
  exposureMode: 'optimized' as ExposureMode,
};

export function createState(): AppStateFull {
  const state = { ...DEFAULT_STATE };
  const derived = calculateDerived(state);
  const results = calculateResults(state, derived, getSpatialVelocity(), getShutterTime(), getFrameRate(), getSyncErrorP95(), isSyncToggleOn());
  return { state, activePreset: 'ov5647', activeSensorPreset: 'ov5647', derived, results };
}

export function clamped(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function validateState(state: AppState): string[] {
  const warnings: string[] = [];

  state.aperture = clamped(state.aperture, APERTURE_MIN, APERTURE_MAX);
  state.aperture = Math.round(state.aperture * 10) / 10;
  if (state.aperture > 16) warnings.push('Aperture > f/16: diffraction will dominate');

  state.wavelength = clamped(state.wavelength, WAVELENGTH_MIN, WAVELENGTH_MAX);

  if (state.focalLength <= 0) state.focalLength = 0.1;
  if (state.pixelPitch <= 0) state.pixelPitch = 0.1;

  state.nativeWidth = Math.max(1, Math.floor(state.nativeWidth));
  state.nativeHeight = Math.max(1, Math.floor(state.nativeHeight));

  if (state.extractedWidth > state.nativeWidth) {
    state.extractedWidth = state.nativeWidth;
    warnings.push('Extracted width clamped to native width');
  }
  if (state.extractedWidth < 1) state.extractedWidth = 1;

  if (state.extractedHeight > state.nativeHeight) {
    state.extractedHeight = state.nativeHeight;
    warnings.push('Extracted height clamped to native height');
  }
  if (state.extractedHeight < 1) state.extractedHeight = 1;

  state.mjpgQuality = clamped(state.mjpgQuality, 1, 100);
  state.h264Qp = clamped(state.h264Qp, H264_QP_MIN, H264_QP_MAX);
  state.h264BitrateMbps = clamped(state.h264BitrateMbps, H264_BITRATE_MIN_MBPS, H264_BITRATE_MAX_MBPS);

  if (!(BINNING_VALUES as readonly number[]).includes(state.pixelBinning)) {
    state.pixelBinning = 1;
  }

  state.luxAtSubject = clamped(state.luxAtSubject, LUX_MIN, LUX_MAX);
  state.subjectReflectance = clamped(state.subjectReflectance, 0.01, 1);
  state.desiredSnrDb = clamped(state.desiredSnrDb, SNR_DB_MIN, SNR_DB_MAX);
  state.temperatureC = clamped(state.temperatureC, TEMP_MIN_C, TEMP_MAX_C);

  return warnings;
}

export function recalculate(app: AppStateFull): AppStateFull {
  const { state } = app;
  if (state.diagonalFov > 0) {
    const sw = (state.pixelPitch * state.nativeWidth) / 1000;
    const sh = (state.pixelPitch * state.nativeHeight) / 1000;
    const sensorDiagonal = Math.sqrt(sw * sw + sh * sh);
    const halfAngle = (state.diagonalFov * Math.PI) / 180 / 2;
    state.focalLength = Math.max(0.1, sensorDiagonal / (2 * Math.tan(halfAngle)));
  }
  const warnings = validateState(state);
  app.derived = calculateDerived(state);

  const velocity = getSpatialVelocity();
  const manualShutter = getShutterTime();
  const manualFps = getFrameRate();
  const syncErr = getSyncErrorP95();
  const syncOn = isSyncToggleOn();

  const radiometry = SENSOR_RADIOMETRY[app.activeSensorPreset] || SENSOR_RADIOMETRY['custom'];
  const readoutTimeS = (radiometry.readoutTimeUs * state.nativeHeight) / 1_000_000;
  const sensorMaxFps = readoutTimeS > 0 ? Math.round(1 / readoutTimeS) : 240;
  const sensorMaxShutterDenom = Math.min(8000, Math.round(1_000_000 / (radiometry.readoutTimeUs * 2)));
  setMaxFpsLimit(sensorMaxFps);
  setMaxShutterLimit(sensorMaxShutterDenom);

  if (state.exposureMode === 'optimized') {
    const firstPass = calculateResults(state, app.derived, velocity, manualShutter, manualFps, syncErr, syncOn);
    const exposure = calculateExposureOptimizer(state, app.derived, radiometry, velocity, firstPass.fEffective);
    const cappedFps = Math.min(exposure.optimalFps, sensorMaxFps);
    const cappedShutterDenom = Math.min(Math.round(1 / Math.max(0.0001, exposure.tOptimal)), sensorMaxShutterDenom);
    const cappedShutterTime = 1 / Math.max(1, cappedShutterDenom);
    app.results = calculateResults(state, app.derived, velocity, cappedShutterTime, cappedFps, syncErr, syncOn, exposure);
    setFrameRate(Math.round(cappedFps));
    setShutterDenom(cappedShutterDenom);
  } else {
    const firstPass = calculateResults(state, app.derived, velocity, manualShutter, manualFps, syncErr, syncOn);
    const exposure = calculateExposureOptimizer(state, app.derived, radiometry, velocity, firstPass.fEffective);
    app.results = calculateResults(state, app.derived, velocity, manualShutter, manualFps, syncErr, syncOn, exposure);
  }

  return app;
}

export function applyPreset(app: AppStateFull, presetValues: Partial<AppState>, name: PresetName): AppStateFull {
  const prevLensTier = app.state.lensTier;
  Object.assign(app.state, { ...DEFAULT_STATE }, presetValues);
  if (!('lensTier' in presetValues)) {
    app.state.lensTier = prevLensTier;
  }
  app.activePreset = name;
  app.activeSensorPreset = name;
  return recalculate(app);
}

export function setField<K extends keyof AppState>(app: AppStateFull, key: K, value: AppState[K]): AppStateFull {
  app.state[key] = value;
  if (key === 'focalLength') {
    app.state.diagonalFov = 0;
  }
  if (key !== 'lensTier') {
    app.activePreset = 'custom';
  }
  app.activeSensorPreset = detectSensorPreset(app);
  return recalculate(app);
}

export function setSensorPreset(app: AppStateFull, name: string): AppStateFull {
  app.activeSensorPreset = name;
  return recalculate(app);
}

function detectSensorPreset(app: AppStateFull): string {
  for (const preset of PRESETS) {
    if (preset.name === 'custom') continue;
    const { pixelPitch, nativeWidth, nativeHeight } = preset.values;
    if (pixelPitch === app.state.pixelPitch &&
        nativeWidth === app.state.nativeWidth &&
        nativeHeight === app.state.nativeHeight) {
      return preset.name;
    }
  }
  return 'custom';
}
