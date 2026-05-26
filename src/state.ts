import type { AppState, PresetName, AppStateFull } from './types';
import { calculateDerived, calculateResults } from './engine';
import { calculateExposureOptimizer } from './exposure';
import { SENSOR_RADIOMETRY, SENSOR_GEOMETRY, CAMERA_PRESETS, findCameraPreset, LENS_PRESETS, PRESETS } from '../presets';
import {
  APERTURE_MIN,
  APERTURE_MAX,
  WAVELENGTH_MIN,
  WAVELENGTH_MAX,
  H264_QP_MIN,
  H264_QP_MAX,
  H264_BITRATE_MIN_MBPS,
  H264_BITRATE_MAX_MBPS,
  DEFAULT_LENS_TRANSMISSION,
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
  DEFAULT_RADIOMETRY,
} from './constants';
import { getMotionParams, getShutterTime, getFrameRate, getSyncErrorP95, isSyncToggleOn, setFrameRate, setShutterDenom, setMaxFpsLimit, setMaxShutterLimit } from './ui/temporalChart';

let h264InterlockWarning: string | null = null;

export function getH264InterlockWarning(): string | null {
  return h264InterlockWarning;
}

export const DEFAULT_STATE: AppState = {
  focalLength: 3.60,
  diagonalFov: 0,
  aperture: 2.0,
  wavelength: 550,
  pixelPitch: 1.4,
  nativeWidth: 2592,
  nativeHeight: 1944,
  olpfPresent: true,
  extractedWidth: 640,
  extractedHeight: 480,
  outputFormat: 'mjpg',
  mjpgQuality: 60,
  h264Qp: 23,
  h264BitrateMbps: 4,
  readoutMethod: 'native',
  selectedV4l2Mode: -1,
  readoutPitchMultiplier: 1,
  readoutFullFoV: true,
  measurementMode: 'monochrome',
  lensTier: 'cheap-plastic',
  shutterType: 'rolling' as const,
  distanceToSubject: 1,
  dynamicRangeDb: 66,
  luxAtSubject: DEFAULT_LUX_SUBJECT,
  subjectReflectance: DEFAULT_REFLECTANCE,
  desiredSnrDb: DEFAULT_SNR_TARGET_DB,
  temperatureC: DEFAULT_TEMPERATURE_C,
  lensTransmission: DEFAULT_LENS_TRANSMISSION,
  gain: 0,
};

export function createState(): AppStateFull {
  const state = { ...DEFAULT_STATE };
  const derived = calculateDerived(state);
  const results = calculateResults(state, derived, getMotionParams(), getShutterTime(), getFrameRate(), getSyncErrorP95(), isSyncToggleOn());
  const app: AppStateFull = { state, activePreset: 'pi-cam-v1', activeSensorPreset: 'ov5647', activeLensPreset: 'cheap-plastic', derived, results };
  return applyPreset(app, {}, 'pi-cam-v1');
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

  state.luxAtSubject = clamped(state.luxAtSubject, LUX_MIN, LUX_MAX);
  state.subjectReflectance = clamped(state.subjectReflectance, 0.01, 1);
  state.desiredSnrDb = clamped(state.desiredSnrDb, SNR_DB_MIN, SNR_DB_MAX);
  state.temperatureC = clamped(state.temperatureC, TEMP_MIN_C, TEMP_MAX_C);
  state.lensTransmission = clamped(state.lensTransmission, 0.01, 1);

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

  const motion = getMotionParams();
  const manualShutter = getShutterTime();
  const manualFps = getFrameRate();
  const syncErr = getSyncErrorP95();
  const syncOn = isSyncToggleOn();

  const radiometry = SENSOR_RADIOMETRY[app.activeSensorPreset] || DEFAULT_RADIOMETRY;
  let sensorMaxFps: number;
  if (state.selectedV4l2Mode >= 0) {
    const geom = SENSOR_GEOMETRY[app.activeSensorPreset];
    const mode = geom?.v4l2?.modes?.[state.selectedV4l2Mode];
    sensorMaxFps = mode?.maxFps ?? 240;
  } else {
    const readoutTimeS = (radiometry.readoutTimeUs * state.nativeHeight) / 1_000_000;
    sensorMaxFps = readoutTimeS > 0 ? Math.round(1 / readoutTimeS) : 240;
  }
  const sensorGeom = SENSOR_GEOMETRY[app.activeSensorPreset];
  const isGlobal = state.shutterType === 'global';
  const readoutShutterBound = isGlobal ? Infinity : Math.round(1_000_000 / (radiometry.readoutTimeUs * 2));
  const sensorMaxShutterDenom = Math.min(8000, readoutShutterBound);
  setMaxFpsLimit(sensorMaxFps);
  setMaxShutterLimit(sensorMaxShutterDenom);

  const firstPass = calculateResults(state, app.derived, motion, manualShutter, manualFps, syncErr, syncOn);
  const exposure = calculateExposureOptimizer(state, app.derived, radiometry, motion, firstPass.fEffective, manualShutter);
  app.results = calculateResults(state, app.derived, motion, manualShutter, manualFps, syncErr, syncOn, exposure);


  return app;
}

export function applyPreset(app: AppStateFull, _presetValues: Partial<AppState>, name: PresetName): AppStateFull {
  app.state.lensTier = 'cheap-plastic';
  app.state.diagonalFov = 0;
  const cameraPreset = findCameraPreset(name);
  if (cameraPreset) {
    const sensorPreset = SENSOR_GEOMETRY[cameraPreset.sensorName];
    if (sensorPreset) {
      app.state.pixelPitch = sensorPreset.pixelPitch;
      app.state.nativeWidth = sensorPreset.nativeWidth;
      app.state.nativeHeight = sensorPreset.nativeHeight;
      app.state.olpfPresent = sensorPreset.olpfPresent;
      app.state.dynamicRangeDb = sensorPreset.dynamicRangeDb;
      app.state.shutterType = sensorPreset.shutterType;
      if (sensorPreset.colourVariant !== 'both') {
        app.state.measurementMode = sensorPreset.colourVariant;
      }
    }
    const lensPreset = LENS_PRESETS[cameraPreset.lensName];
    if (lensPreset) {
      app.state.lensTier = lensPreset.name as AppState['lensTier'];
      app.state.focalLength = lensPreset.focalLength;
      app.state.aperture = lensPreset.aperture;
      app.state.lensTransmission = lensPreset.lensTransmission;
    }
  }
  app.activePreset = name;
  app.activeSensorPreset = cameraPreset ? cameraPreset.sensorName : name;
  app.activeLensPreset = cameraPreset ? cameraPreset.lensName : 'custom';
  applyDefaultV4l2Mode(app, app.activeSensorPreset);
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
  if (key === 'lensTier') {
    const lens = LENS_PRESETS[value as string];
    if (lens) {
      app.state.lensTransmission = lens.lensTransmission;
    }
  }
  if (key === 'h264Qp') {
    enforceH264QpConsistency(app);
  }
  if (key === 'h264BitrateMbps') {
    enforceH264BitrateConsistency(app);
  }
  if (key === 'outputFormat') {
    if (value === 'h264') {
      enforceH264QpConsistency(app);
    } else {
      h264InterlockWarning = null;
    }
  }
  app.activeSensorPreset = detectSensorPreset(app);
  app.activeLensPreset = detectLensPreset(app);
  app.activePreset = detectCameraPreset(app);
  invalidateV4l2ModeIfNeeded(app, key);
  return recalculate(app);
}

function enforceH264QpConsistency(app: AppStateFull): void {
  h264InterlockWarning = null;
  if (app.state.outputFormat !== 'h264') return;
  const fps = getFrameRate();
  const pixelsPerFrame = app.state.extractedWidth * app.state.extractedHeight;
  if (pixelsPerFrame <= 0 || fps <= 0) return;

  const bpp = 0.25 * Math.pow(2, -(app.state.h264Qp - 23) / 6);
  const minBitrate = (bpp * pixelsPerFrame * fps) / 1_000_000;
  const needed = Math.max(H264_BITRATE_MIN_MBPS, Math.ceil(minBitrate * 2) / 2);

  if (app.state.h264BitrateMbps < needed) {
    app.state.h264BitrateMbps = Math.min(needed, H264_BITRATE_MAX_MBPS);
    h264InterlockWarning = `Bitrate raised to ${app.state.h264BitrateMbps.toFixed(1)} Mbps to support QP=${app.state.h264Qp}`;
  }
}

function enforceH264BitrateConsistency(app: AppStateFull): void {
  h264InterlockWarning = null;
  if (app.state.outputFormat !== 'h264') return;
  const fps = getFrameRate();
  const pixelsPerFrame = app.state.extractedWidth * app.state.extractedHeight;
  if (pixelsPerFrame <= 0 || fps <= 0) return;

  const bpp = app.state.h264BitrateMbps * 1_000_000 / (pixelsPerFrame * fps);
  const minQp = Math.round(23 - 6 * Math.log2(bpp / 0.25));
  const neededQp = clamped(minQp, H264_QP_MIN, H264_QP_MAX);

  if (app.state.h264Qp < neededQp) {
    app.state.h264Qp = neededQp;
    h264InterlockWarning = `QP raised to ${app.state.h264Qp} to match available bitrate of ${app.state.h264BitrateMbps.toFixed(1)} Mbps`;
  }
}

export function setSensorPreset(app: AppStateFull, name: string): AppStateFull {
  app.activeSensorPreset = name;
  app.activeLensPreset = detectLensPreset(app);
  app.activePreset = detectCameraPreset(app);
  const geom = SENSOR_GEOMETRY[name];
  if (geom) {
    app.state.pixelPitch = geom.pixelPitch;
    app.state.nativeWidth = geom.nativeWidth;
    app.state.nativeHeight = geom.nativeHeight;
    app.state.olpfPresent = geom.olpfPresent;
    app.state.dynamicRangeDb = geom.dynamicRangeDb;
    app.state.shutterType = geom.shutterType;
    if (geom.colourVariant !== 'both') {
      app.state.measurementMode = geom.colourVariant;
    }
  }
  app.state.selectedV4l2Mode = -1;
  applyDefaultV4l2Mode(app, name);
  return recalculate(app);
}

function detectSensorPreset(app: AppStateFull): string {
  for (const [name, geom] of Object.entries(SENSOR_GEOMETRY)) {
    if (geom.pixelPitch === app.state.pixelPitch &&
        geom.nativeWidth === app.state.nativeWidth &&
        geom.nativeHeight === app.state.nativeHeight &&
        geom.olpfPresent === app.state.olpfPresent &&
        geom.dynamicRangeDb === app.state.dynamicRangeDb &&
        geom.shutterType === app.state.shutterType &&
        (geom.colourVariant === app.state.measurementMode || geom.colourVariant === 'both')) {
      return name;
    }
  }
  return 'custom';
}

function detectLensPreset(app: AppStateFull): string {
  for (const [name, lens] of Object.entries(LENS_PRESETS)) {
    if (lens.focalLength === app.state.focalLength &&
        lens.aperture === app.state.aperture &&
        lens.lensTransmission === app.state.lensTransmission &&
        lens.name === app.state.lensTier) {
      return name;
    }
  }
  return 'custom';
}

function detectCameraPreset(app: AppStateFull): PresetName {
  for (const camera of CAMERA_PRESETS) {
    if (camera.sensorName === app.activeSensorPreset && camera.lensName === app.activeLensPreset) {
      return camera.name as PresetName;
    }
  }
  return 'custom';
}

function invalidateV4l2ModeIfNeeded(app: AppStateFull, key: keyof AppState): void {
  if (app.state.selectedV4l2Mode < 0) return;
  if (key !== 'extractedWidth' && key !== 'extractedHeight') return;
  const geom = SENSOR_GEOMETRY[app.activeSensorPreset];
  const mode = geom?.v4l2?.modes?.[app.state.selectedV4l2Mode];
  if (!mode) { app.state.selectedV4l2Mode = -1; return; }
  if (app.state.extractedWidth !== mode.width || app.state.extractedHeight !== mode.height) {
    app.state.selectedV4l2Mode = -1;
  }
}

function applyDefaultV4l2Mode(app: AppStateFull, sensorName: string): void {
  const geom = SENSOR_GEOMETRY[sensorName];
  const modes = geom?.v4l2?.modes;
  if (!modes || modes.length === 0) {
    app.state.selectedV4l2Mode = -1;
    app.state.readoutPitchMultiplier = 1;
    app.state.readoutFullFoV = true;
    return;
  }

  const fastModes = modes
    .map((mode, i) => ({ ...mode, index: i }))
    .filter(m => m.maxFps >= 25);

  let chosen = fastModes.length > 0
    ? fastModes.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]
    : modes.map((mode, i) => ({ ...mode, index: i }))
        .reduce((best, curr) =>
          curr.maxFps > best.maxFps ? curr :
          curr.maxFps === best.maxFps && curr.width * curr.height > best.width * best.height ? curr : best
        );

  app.state.selectedV4l2Mode = chosen.index;
  app.state.extractedWidth = chosen.width;
  app.state.extractedHeight = chosen.height;
  app.state.readoutPitchMultiplier = chosen.pitchMultiplier ?? 1;
  app.state.readoutFullFoV = chosen.fullFoV ?? true;
  app.state.readoutMethod = !chosen.readoutType ? 'native' :
    chosen.readoutType.includes('binning') ? 'binning' :
    chosen.readoutType.includes('subsampling') ? 'subsampling' :
    chosen.readoutType.includes('cropping') ? 'cropping' : 'native';
}
