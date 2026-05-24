import type { AppStateFull, AppState, DerivedState, SensorRadiometry, ExposureOptimization } from './types';
import { calculateDerived, calculateResults } from './engine';
import { calculateExposureOptimizer } from './exposure';
import { SENSOR_RADIOMETRY, SENSOR_GEOMETRY } from '../presets';
import type { SensorGeometry, V4l2Mode } from '../presets';
import { DEFAULT_RADIOMETRY, RAW_FORMATS, CHROMA_UYVY_SNR_DB, CHROMA_OTHER_SNR_DB } from './constants';

export interface OptimizationResult {
  fps: number;
  shutterDenom: number;
  extractedWidth: number;
  extractedHeight: number;
  selectedV4l2Mode: number;
  readoutPitchMultiplier: number;
  readoutFullFoV: boolean;
  minFeatureSize: number;
}

interface CandidateSpec {
  statePatch: Partial<AppState>;
  maxFps: number;
  maxShutterDenom: number;
}

export function runOptimization(app: AppStateFull): OptimizationResult | null {
  const radiometry = SENSOR_RADIOMETRY[app.activeSensorPreset] || DEFAULT_RADIOMETRY;
  const sensorGeom = SENSOR_GEOMETRY[app.activeSensorPreset];
  const velocity = 0;

  const candidates = buildCandidates(app, radiometry, sensorGeom);
  if (candidates.length === 0) return null;

  let bestFps = 0;
  let bestShutterDenom = 0;
  let bestWidth = 0;
  let bestHeight = 0;
  let bestV4l2Mode = -1;
  let bestPitchMult = 1;
  let bestFullFoV = true;
  let bestMinFeature = Infinity;

  for (const c of candidates) {
    const tempState: AppState = { ...app.state, ...c.statePatch };
    const tempDerived = calculateDerived(tempState);

    // Pass 1 — baseline fEffective with no motion blur penalty, no sync
    const baseline = calculateResults(tempState, tempDerived, velocity, 0.000001, 999999, 0, false);

    // Pass 2 — exposure optimizer
    const exposure = calculateExposureOptimizer(tempState, tempDerived, radiometry, velocity, baseline.fEffective);

    // Constraint checks — clamp to hardware limits
    const idealShutterDenom = Math.round(1 / Math.max(0.000001, exposure.tOptimal));
    const shutterDenom = Math.min(idealShutterDenom, c.maxShutterDenom);
    const fps = Math.min(shutterDenom, c.maxFps);

    // Only skip if a slower shutter would have met SNR — otherwise accept best-effort
    let snrCheck = exposure.snrAtOptimalDb;
    if (tempState.measurementMode === 'colour' && !(RAW_FORMATS as readonly string[]).includes(tempState.outputFormat)) {
      snrCheck -= tempState.outputFormat === 'uyuv' ? CHROMA_UYVY_SNR_DB : CHROMA_OTHER_SNR_DB;
    }
    if (!exposure.photonStarved && snrCheck < tempState.desiredSnrDb) {
      const slowElectrons = exposure.electronsPerPxPerSec / Math.max(1, fps);
      const slowNoise = Math.sqrt(slowElectrons + radiometry.readNoiseE * radiometry.readNoiseE);
      let slowSnrDb = slowNoise > 0 ? 20 * Math.log10(slowElectrons / slowNoise) : 0;
      if (tempState.measurementMode === 'colour' && !(RAW_FORMATS as readonly string[]).includes(tempState.outputFormat)) {
        slowSnrDb -= tempState.outputFormat === 'uyuv' ? CHROMA_UYVY_SNR_DB : CHROMA_OTHER_SNR_DB;
      }
      if (slowSnrDb >= tempState.desiredSnrDb - 0.5) continue;
    }

    // Pass 3 — final results with sync disabled
    const shutterTime = 1 / Math.max(1, shutterDenom);
    const results = calculateResults(tempState, tempDerived, velocity, shutterTime, fps, 0, false, exposure);

    if (results.minFeatureSize < bestMinFeature) {
      bestMinFeature = results.minFeatureSize;
      bestFps = fps;
      bestShutterDenom = shutterDenom;
      bestWidth = c.statePatch.extractedWidth ?? tempState.extractedWidth;
      bestHeight = c.statePatch.extractedHeight ?? tempState.extractedHeight;
      bestV4l2Mode = c.statePatch.selectedV4l2Mode ?? -1;
      bestPitchMult = c.statePatch.readoutPitchMultiplier ?? 1;
      bestFullFoV = c.statePatch.readoutFullFoV ?? true;
    }
  }

  if (!isFinite(bestMinFeature)) return null;

  return {
    fps: bestFps,
    shutterDenom: bestShutterDenom,
    extractedWidth: bestWidth,
    extractedHeight: bestHeight,
    selectedV4l2Mode: bestV4l2Mode,
    readoutPitchMultiplier: bestPitchMult,
    readoutFullFoV: bestFullFoV,
    minFeatureSize: bestMinFeature,
  };
}

function buildCandidates(
  app: AppStateFull,
  radiometry: SensorRadiometry,
  sensorGeom: SensorGeometry | undefined,
): CandidateSpec[] {
  const isGlobal = sensorGeom?.shutterType === 'global';
  const v4l2Modes = sensorGeom?.v4l2?.modes;

  if (v4l2Modes && v4l2Modes.length > 0) {
    return buildV4l2Candidates(app, radiometry, v4l2Modes, isGlobal);
  }
  return buildFallbackCandidates(app, radiometry, isGlobal);
}

function buildV4l2Candidates(
  app: AppStateFull,
  radiometry: SensorRadiometry,
  modes: V4l2Mode[],
  isGlobal: boolean,
): CandidateSpec[] {
  const sensorGeom = SENSOR_GEOMETRY[app.activeSensorPreset];
  const v4l2 = sensorGeom?.v4l2;
  const pixelRates = v4l2?.pixelRates ?? [];

  const rollingBound = isGlobal ? Infinity : Math.round(1_000_000 / (radiometry.readoutTimeUs * 2));

  return modes.map((mode, i) => {
    const pixelRate = pixelRates[mode.pixelRateIndex] ?? pixelRates[0] ?? 1;
    const v4l2MaxShutter = Math.floor(pixelRate / (v4l2!.exposure.min * mode.hts));
    const maxShutter = Math.min(v4l2MaxShutter, rollingBound);

    return {
      statePatch: {
        extractedWidth: mode.width,
        extractedHeight: mode.height,
        selectedV4l2Mode: i,
        readoutPitchMultiplier: mode.pitchMultiplier ?? 1,
        readoutFullFoV: mode.fullFoV ?? true,
      },
      maxFps: mode.maxFps,
      maxShutterDenom: maxShutter,
    };
  });
}

function buildFallbackCandidates(
  app: AppStateFull,
  radiometry: SensorRadiometry,
  isGlobal: boolean,
): CandidateSpec[] {
  const readoutTimeS = (radiometry.readoutTimeUs * app.state.nativeHeight) / 1_000_000;
  const maxFps = readoutTimeS > 0 ? Math.round(1 / readoutTimeS) : 240;
  const rollingBound = isGlobal ? Infinity : Math.round(1_000_000 / (radiometry.readoutTimeUs * 2));
  const maxShutter = Math.min(8000, rollingBound);

  const resolutions = [
    { w: 640, h: 480 },
    { w: 1280, h: 720 },
    { w: 1920, h: 1080 },
    { w: app.state.nativeWidth, h: app.state.nativeHeight },
  ];

  return resolutions.map(({ w, h }) => ({
    statePatch: {
      extractedWidth: Math.min(w, app.state.nativeWidth),
      extractedHeight: Math.min(h, app.state.nativeHeight),
      selectedV4l2Mode: -1,
      readoutPitchMultiplier: 1,
      readoutFullFoV: true,
    },
    maxFps,
    maxShutterDenom: maxShutter,
  }));
}
