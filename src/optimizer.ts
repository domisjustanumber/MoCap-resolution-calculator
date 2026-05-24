import type { AppStateFull, AppState, DerivedState, SensorRadiometry, ExposureOptimization, MotionParams, ReadoutMethod } from './types';
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
  readoutMethod: ReadoutMethod;
  minFeatureSize: number;
}

interface CandidateSpec {
  statePatch: Partial<AppState>;
  maxFps: number;
  maxShutterDenom: number;
}

export function runOptimization(app: AppStateFull, motion: MotionParams, errorBudgetMm: number = 5): OptimizationResult | null {
  const radiometry = SENSOR_RADIOMETRY[app.activeSensorPreset] || DEFAULT_RADIOMETRY;
  const sensorGeom = SENSOR_GEOMETRY[app.activeSensorPreset];

  const candidates = buildCandidates(app, radiometry, sensorGeom);
  if (candidates.length === 0) return null;

  let bestMetFps = 0;
  let bestMetShutterDenom = 0;
  let bestMetWidth = 0;
  let bestMetHeight = 0;
  let bestMetV4l2Mode = -1;
  let bestMetPitchMult = 1;
  let bestMetFullFoV = true;
  let bestMetMinFeature = Infinity;
  let bestMetReadoutMethod: ReadoutMethod = 'native';

  let bestFallbackFps = 0;
  let bestFallbackShutterDenom = 0;
  let bestFallbackWidth = 0;
  let bestFallbackHeight = 0;
  let bestFallbackV4l2Mode = -1;
  let bestFallbackPitchMult = 1;
  let bestFallbackFullFoV = true;
  let bestFallbackMinFeature = Infinity;
  let bestFallbackSnr = -Infinity;
  let bestFallbackReadoutMethod: ReadoutMethod = 'native';

  for (const c of candidates) {
    const tempState: AppState = { ...app.state, ...c.statePatch };
    const tempDerived = calculateDerived(tempState);

    // Pass 1 — baseline fEffective with minimal motion blur penalty, no sync
    const baseline = calculateResults(tempState, tempDerived, motion, 0.000001, 999999, 0, false);

    // Pass 2 — exposure optimizer
    let exposure = calculateExposureOptimizer(tempState, tempDerived, radiometry, motion, baseline.fEffective);

    // If photon-starved, relax the resolution target so tMotionMax increases,
    // allowing longer exposure → more photons → better SNR
    if (exposure.photonStarved) {
      const relaxFactors = [0.75, 0.5, 0.33, 0.25, 0.2, 0.15, 0.1, 0.07, 0.05, 0.03, 0.02, 0.01, 0.005];
      for (const factor of relaxFactors) {
        const relaxedFreq = baseline.fEffective * factor;
        const testExposure = calculateExposureOptimizer(tempState, tempDerived, radiometry, motion, relaxedFreq);
        if (!testExposure.photonStarved) {
          exposure = testExposure;
          break;
        }
        exposure = testExposure;
      }
    }

    // Clamp to hardware limits
    const idealShutterDenom = Math.round(1 / Math.max(0.000001, exposure.tOptimal));
    const shutterDenom = Math.min(idealShutterDenom, c.maxShutterDenom);
    const fps = Math.min(shutterDenom, c.maxFps);

    // Compute effective SNR (with chroma penalty if colour mode)
    let snrCheck = exposure.snrAtOptimalDb;
    if (tempState.measurementMode === 'colour' && !(RAW_FORMATS as readonly string[]).includes(tempState.outputFormat)) {
      snrCheck -= tempState.outputFormat === 'uyuv' ? CHROMA_UYVY_SNR_DB : CHROMA_OTHER_SNR_DB;
    }

    // Pass 3 — final results with sync disabled
    const shutterTime = 1 / Math.max(1, shutterDenom);
    const results = calculateResults(tempState, tempDerived, motion, shutterTime, fps, 0, false, exposure);

    if (snrCheck >= tempState.desiredSnrDb) {
      // Candidate meets SNR target → track by motion handling (shorter shutter = higher shutterDenom)
      if (bestMetMinFeature === Infinity ||
          shutterDenom > bestMetShutterDenom ||
          (shutterDenom === bestMetShutterDenom && results.minFeatureSize < bestMetMinFeature)) {
        bestMetMinFeature = results.minFeatureSize;
        bestMetFps = fps;
        bestMetShutterDenom = shutterDenom;
        bestMetWidth = c.statePatch.extractedWidth ?? tempState.extractedWidth;
        bestMetHeight = c.statePatch.extractedHeight ?? tempState.extractedHeight;
        bestMetV4l2Mode = c.statePatch.selectedV4l2Mode ?? -1;
        bestMetPitchMult = c.statePatch.readoutPitchMultiplier ?? 1;
        bestMetFullFoV = c.statePatch.readoutFullFoV ?? true;
        bestMetReadoutMethod = (c.statePatch.readoutMethod as ReadoutMethod) ?? tempState.readoutMethod;
      }
    } else {
      // Candidate doesn't meet SNR target → track best fallback by closest to target
      if (snrCheck > bestFallbackSnr) {
        bestFallbackSnr = snrCheck;
        bestFallbackMinFeature = results.minFeatureSize;
        bestFallbackFps = fps;
        bestFallbackShutterDenom = shutterDenom;
        bestFallbackWidth = c.statePatch.extractedWidth ?? tempState.extractedWidth;
        bestFallbackHeight = c.statePatch.extractedHeight ?? tempState.extractedHeight;
        bestFallbackV4l2Mode = c.statePatch.selectedV4l2Mode ?? -1;
        bestFallbackPitchMult = c.statePatch.readoutPitchMultiplier ?? 1;
        bestFallbackFullFoV = c.statePatch.readoutFullFoV ?? true;
        bestFallbackReadoutMethod = (c.statePatch.readoutMethod as ReadoutMethod) ?? tempState.readoutMethod;
      }
    }
  }

  // Stage 1: pick best SNR-met candidate by motion handling
  // Stage 2: if none met SNR, pick closest to target
  const hasValidMet = isFinite(bestMetMinFeature);
  const hasValidFallback = isFinite(bestFallbackMinFeature);

  if (!hasValidMet && !hasValidFallback) return null;

  const bestFps = hasValidMet ? bestMetFps : bestFallbackFps;
  const bestShutterDenom = hasValidMet ? bestMetShutterDenom : bestFallbackShutterDenom;
  const bestWidth = hasValidMet ? bestMetWidth : bestFallbackWidth;
  const bestHeight = hasValidMet ? bestMetHeight : bestFallbackHeight;
  const bestV4l2Mode = hasValidMet ? bestMetV4l2Mode : bestFallbackV4l2Mode;
  const bestPitchMult = hasValidMet ? bestMetPitchMult : bestFallbackPitchMult;
  const bestFullFoV = hasValidMet ? bestMetFullFoV : bestFallbackFullFoV;
  const bestMinFeature = hasValidMet ? bestMetMinFeature : bestFallbackMinFeature;
  const bestReadoutMethod = hasValidMet ? bestMetReadoutMethod : bestFallbackReadoutMethod;

  return {
    fps: bestFps,
    shutterDenom: bestShutterDenom,
    extractedWidth: bestWidth,
    extractedHeight: bestHeight,
    selectedV4l2Mode: bestV4l2Mode,
    readoutPitchMultiplier: bestPitchMult,
    readoutFullFoV: bestFullFoV,
    readoutMethod: bestReadoutMethod,
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

    const modeReadoutMethod = !mode.readoutType ? 'native' :
      mode.readoutType.includes('binning') ? 'binning' :
      mode.readoutType.includes('subsampling') ? 'subsampling' :
      mode.readoutType.includes('cropping') ? 'cropping' : 'native';

    return {
      statePatch: {
        extractedWidth: mode.width,
        extractedHeight: mode.height,
        selectedV4l2Mode: i,
        readoutPitchMultiplier: mode.pitchMultiplier ?? 1,
        readoutFullFoV: mode.fullFoV ?? true,
        readoutMethod: modeReadoutMethod as ReadoutMethod,
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
      readoutMethod: app.state.readoutMethod,
    },
    maxFps,
    maxShutterDenom: maxShutter,
  }));
}
