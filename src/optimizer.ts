import type { AppStateFull, AppState, DerivedState, SensorRadiometry, ExposureOptimization, MotionParams, ReadoutMethod } from './types';
import { calculateDerived, calculateResults } from './engine';
import { calculateExposureOptimizer } from './exposure';
import { SENSOR_RADIOMETRY, SENSOR_GEOMETRY } from '../presets';
import type { SensorGeometry, V4l2Mode } from '../presets';
import { DEFAULT_RADIOMETRY, RAW_FORMATS, CHROMA_UYVY_SNR_DB, CHROMA_OTHER_SNR_DB, DEFAULT_SNR_UNDERSHOOT_PCT, MOTION_UNDERSHOOT_IMPROVEMENT_PCT } from './constants';
import { getRegionHz } from './ui/temporalChart';
import { shuttersForFpsSearch, snapTimingPreservingSnr, enumerateRegionFpsValues } from './temporalQuantize';

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
  snrMet: boolean;
}

interface CandidateSpec {
  statePatch: Partial<AppState>;
  maxFps: number;
  maxShutterDenom: number;
}

interface TimingPair {
  fps: number;
  shutterDenom: number;
  snrDb: number;
  exposure: ExposureOptimization;
  targetFreq: number;
}

interface ResolvedCandidate {
  fps: number;
  shutterDenom: number;
  width: number;
  height: number;
  v4l2Mode: number;
  pitchMult: number;
  fullFoV: boolean;
  readoutMethod: ReadoutMethod;
  minFeature: number;
  maxFps: number;
  maxShutter: number;
  targetFreq: number;
  snrDb: number;
}

export function minAcceptableSnrDb(desiredSnrDb: number, undershootPct: number): number {
  const pct = Math.max(0, Math.min(100, undershootPct));
  return desiredSnrDb * (1 - pct / 100);
}

export interface MotionHeadroom {
  maxAccel: number;
  maxTurn: number;
  accelUnderperforming: boolean;
  turnUnderperforming: boolean;
}

export function motionHeadroom(motion: MotionParams, fps: number, errorBudgetMm: number): MotionHeadroom {
  const epsilon = errorBudgetMm / 1000;
  const maxAccel = epsilon * fps * fps;
  const maxTurn = motion.subjectHalfWidth > 0
    ? (epsilon * fps / motion.subjectHalfWidth) * (180 / Math.PI)
    : Infinity;
  return {
    maxAccel,
    maxTurn,
    accelUnderperforming: motion.acceleration >= 1e-6 && maxAccel < motion.acceleration,
    turnUnderperforming: motion.angularVelocity >= 1e-6 && maxTurn < motion.angularVelocity,
  };
}

/** True when SNR undershoot is justified by 20%+ gain on an under-performing motion target. */
export function snrUndershootWorthwhile(
  baseline: MotionHeadroom,
  candidate: MotionHeadroom,
  minImprovementRatio: number = MOTION_UNDERSHOOT_IMPROVEMENT_PCT / 100,
): boolean {
  let underperforming = false;
  let worthwhile = false;

  if (baseline.accelUnderperforming) {
    underperforming = true;
    if (candidate.maxAccel >= baseline.maxAccel * (1 + minImprovementRatio)) {
      worthwhile = true;
    }
  }
  if (baseline.turnUnderperforming) {
    underperforming = true;
    if (candidate.maxTurn >= baseline.maxTurn * (1 + minImprovementRatio)) {
      worthwhile = true;
    }
  }

  return underperforming && worthwhile;
}

/** True when SNR undershoot is justified by ≥20% smaller min resolvable feature (better spatial resolution). */
export function spatialUndershootWorthwhile(
  baselineMinFeature: number,
  candidateMinFeature: number,
  minImprovementRatio: number = MOTION_UNDERSHOOT_IMPROVEMENT_PCT / 100,
): boolean {
  if (baselineMinFeature <= 0 || candidateMinFeature <= 0) return false;
  return baselineMinFeature / candidateMinFeature >= 1 + minImprovementRatio;
}

/** True when SNR undershoot is justified by motion headroom or spatial resolution gain. */
export function candidateWorthwhileSnrUndershoot(
  baseline: MotionHeadroom,
  candidate: MotionHeadroom,
  baselineMinFeature: number,
  candidateMinFeature: number,
  minImprovementRatio: number = MOTION_UNDERSHOOT_IMPROVEMENT_PCT / 100,
): boolean {
  return snrUndershootWorthwhile(baseline, candidate, minImprovementRatio) ||
    spatialUndershootWorthwhile(baselineMinFeature, candidateMinFeature, minImprovementRatio);
}

/** Pick the relaxed option with the best motion or spatial gain among those worth SNR undershoot. */
export function pickBestWorthwhileRelaxed(
  baselineFps: number,
  baselineMinFeature: number,
  motion: MotionParams,
  errorBudgetMm: number,
  relaxedOptions: ResolvedCandidate[],
  motionOnly = false,
): ResolvedCandidate | null {
  if (relaxedOptions.length === 0) return null;

  const baseline = motionHeadroom(motion, baselineFps, errorBudgetMm);
  const qualifying = relaxedOptions.filter((opt) =>
    motionOnly
      ? snrUndershootWorthwhile(baseline, motionHeadroom(motion, opt.fps, errorBudgetMm))
      : candidateWorthwhileSnrUndershoot(
          baseline,
          motionHeadroom(motion, opt.fps, errorBudgetMm),
          baselineMinFeature,
          opt.minFeature,
        ),
  );
  if (qualifying.length === 0) return null;

  const improvementScore = (opt: ResolvedCandidate): number => {
    const candidate = motionHeadroom(motion, opt.fps, errorBudgetMm);
    let score = 0;
    if (spatialUndershootWorthwhile(baselineMinFeature, opt.minFeature) && !motionOnly) {
      score = Math.max(score, baselineMinFeature / opt.minFeature);
    }
    if (baseline.accelUnderperforming && baseline.maxAccel > 0) {
      score = Math.max(score, candidate.maxAccel / baseline.maxAccel);
    }
    if (baseline.turnUnderperforming && baseline.maxTurn > 0) {
      score = Math.max(score, candidate.maxTurn / baseline.maxTurn);
    }
    return score;
  };

  const undershootGain = (opt: ResolvedCandidate): number => {
    const candidate = motionHeadroom(motion, opt.fps, errorBudgetMm);
    let gain = 0;
    if (spatialUndershootWorthwhile(baselineMinFeature, opt.minFeature) && !motionOnly) {
      gain = Math.max(gain, baselineMinFeature - opt.minFeature);
    }
    if (baseline.accelUnderperforming) {
      gain = Math.max(gain, candidate.maxAccel - baseline.maxAccel);
    }
    if (baseline.turnUnderperforming) {
      gain = Math.max(gain, candidate.maxTurn - baseline.maxTurn);
    }
    return gain;
  };

  qualifying.sort((a, b) => {
    const gainDiff = undershootGain(b) - undershootGain(a);
    if (gainDiff !== 0) return gainDiff;
    const scoreDiff = improvementScore(b) - improvementScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    if (a.minFeature !== b.minFeature) return a.minFeature - b.minFeature;
    if (b.snrDb !== a.snrDb) return b.snrDb - a.snrDb;
    return b.fps - a.fps;
  });
  return qualifying[0];
}

function pickBestRelaxedOverall(relaxedOptions: ResolvedCandidate[]): ResolvedCandidate {
  return [...relaxedOptions].sort((a, b) => {
    if (b.snrDb !== a.snrDb) return b.snrDb - a.snrDb;
    return b.fps - a.fps;
  })[0];
}

export function runOptimization(
  app: AppStateFull,
  motion: MotionParams,
  errorBudgetMm: number = 5,
  snrUndershootPct: number = DEFAULT_SNR_UNDERSHOOT_PCT,
): OptimizationResult | null {
  const minSnrDb = minAcceptableSnrDb(app.state.desiredSnrDb, snrUndershootPct);
  const radiometry = SENSOR_RADIOMETRY[app.activeSensorPreset] || DEFAULT_RADIOMETRY;
  const sensorGeom = SENSOR_GEOMETRY[app.activeSensorPreset];

  const candidates = buildCandidates(app, radiometry, sensorGeom);
  if (candidates.length === 0) return null;

  const regionHz = getRegionHz();
  const initialWidth = app.state.extractedWidth;
  const initialHeight = app.state.extractedHeight;

  let bestMetFps = 0;
  let bestMetShutterDenom = 0;
  let bestMetWidth = 0;
  let bestMetHeight = 0;
  let bestMetV4l2Mode = -1;
  let bestMetPitchMult = 1;
  let bestMetFullFoV = true;
  let bestMetMinFeature = Infinity;
  let bestMetReadoutMethod: ReadoutMethod = 'native';
  let bestMetMaxFps = 0;
  let bestMetMaxShutter = 0;
  let bestMetTargetFreq = 0;

  const relaxedOptions: ResolvedCandidate[] = [];

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
  let bestFallbackMaxFps = 0;
  let bestFallbackMaxShutter = 0;
  let bestFallbackTargetFreq = 0;

  let initialModeStrict: ResolvedCandidate | null = null;

  for (const c of candidates) {
    const tempState: AppState = { ...app.state, ...c.statePatch };
    const tempDerived = calculateDerived(tempState);

  // Pass 1 — baseline fEffective with minimal motion blur penalty, no sync
    const baseline = calculateResults(tempState, tempDerived, motion, 0.000001, 999999, 0, false);

    const timings = findCandidateTimings(
      tempState,
      tempDerived,
      radiometry,
      motion,
      baseline.fEffective,
      c.maxFps,
      c.maxShutterDenom,
      regionHz,
      minSnrDb,
    );

    const candWidth = c.statePatch.extractedWidth ?? tempState.extractedWidth;
    const candHeight = c.statePatch.extractedHeight ?? tempState.extractedHeight;
    if (candWidth === initialWidth && candHeight === initialHeight) {
      const baselineStrict = searchTimingAtFreq(
        tempState, tempDerived, radiometry, motion, baseline.fEffective,
        c.maxFps, c.maxShutterDenom, regionHz, minSnrDb, 'strict',
      );
      if (baselineStrict) {
        const shutterTime = 1 / Math.max(1, baselineStrict.shutterDenom);
        const results = calculateResults(
          tempState, tempDerived, motion, shutterTime, baselineStrict.fps, 0, false, baselineStrict.exposure,
        );
        initialModeStrict = {
          fps: baselineStrict.fps,
          shutterDenom: baselineStrict.shutterDenom,
          width: candWidth,
          height: candHeight,
          v4l2Mode: c.statePatch.selectedV4l2Mode ?? -1,
          pitchMult: c.statePatch.readoutPitchMultiplier ?? 1,
          fullFoV: c.statePatch.readoutFullFoV ?? true,
          readoutMethod: (c.statePatch.readoutMethod as ReadoutMethod) ?? tempState.readoutMethod,
          minFeature: results.minFeatureSize,
          maxFps: c.maxFps,
          maxShutter: c.maxShutterDenom,
          targetFreq: baseline.fEffective,
          snrDb: baselineStrict.snrDb,
        };
      }
    }

    for (const timing of [timings.strict, timings.fallback]) {
      if (!timing) continue;

      const { fps, shutterDenom, snrDb, exposure, targetFreq } = timing;
      const shutterTime = 1 / Math.max(1, shutterDenom);
      const results = calculateResults(tempState, tempDerived, motion, shutterTime, fps, 0, false, exposure);

      if (snrDb >= tempState.desiredSnrDb) {
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
          bestMetMaxFps = c.maxFps;
          bestMetMaxShutter = c.maxShutterDenom;
          bestMetTargetFreq = targetFreq;
        }
      } else if (snrDb > bestFallbackSnr) {
        bestFallbackSnr = snrDb;
        bestFallbackMinFeature = results.minFeatureSize;
        bestFallbackFps = fps;
        bestFallbackShutterDenom = shutterDenom;
        bestFallbackWidth = c.statePatch.extractedWidth ?? tempState.extractedWidth;
        bestFallbackHeight = c.statePatch.extractedHeight ?? tempState.extractedHeight;
        bestFallbackV4l2Mode = c.statePatch.selectedV4l2Mode ?? -1;
        bestFallbackPitchMult = c.statePatch.readoutPitchMultiplier ?? 1;
        bestFallbackFullFoV = c.statePatch.readoutFullFoV ?? true;
        bestFallbackReadoutMethod = (c.statePatch.readoutMethod as ReadoutMethod) ?? tempState.readoutMethod;
        bestFallbackMaxFps = c.maxFps;
        bestFallbackMaxShutter = c.maxShutterDenom;
        bestFallbackTargetFreq = targetFreq;
      }
    }

    if (minSnrDb < tempState.desiredSnrDb) {
      const relaxedTimings = enumerateRelaxedTimings(
        tempState,
        tempDerived,
        radiometry,
        motion,
        baseline.fEffective,
        c.maxFps,
        c.maxShutterDenom,
        regionHz,
        minSnrDb,
      );
      for (const timing of relaxedTimings) {
        const shutterTime = 1 / Math.max(1, timing.shutterDenom);
        const results = calculateResults(tempState, tempDerived, motion, shutterTime, timing.fps, 0, false, timing.exposure);
        relaxedOptions.push({
          fps: timing.fps,
          shutterDenom: timing.shutterDenom,
          width: c.statePatch.extractedWidth ?? tempState.extractedWidth,
          height: c.statePatch.extractedHeight ?? tempState.extractedHeight,
          v4l2Mode: c.statePatch.selectedV4l2Mode ?? -1,
          pitchMult: c.statePatch.readoutPitchMultiplier ?? 1,
          fullFoV: c.statePatch.readoutFullFoV ?? true,
          readoutMethod: (c.statePatch.readoutMethod as ReadoutMethod) ?? tempState.readoutMethod,
          minFeature: results.minFeatureSize,
          maxFps: c.maxFps,
          maxShutter: c.maxShutterDenom,
          targetFreq: timing.targetFreq,
          snrDb: timing.snrDb,
        });
      }
    }
  }

  const hasValidMet = isFinite(bestMetMinFeature);
  const hasValidFallback = isFinite(bestFallbackMinFeature);
  const hasRelaxed = relaxedOptions.length > 0;

  if (!hasValidMet && !hasRelaxed && !hasValidFallback) return null;

  let winner: ResolvedCandidate | null = null;
  let useStrict = false;

  if (hasValidMet) {
    const strictWinner: ResolvedCandidate = {
      fps: bestMetFps,
      shutterDenom: bestMetShutterDenom,
      width: bestMetWidth,
      height: bestMetHeight,
      v4l2Mode: bestMetV4l2Mode,
      pitchMult: bestMetPitchMult,
      fullFoV: bestMetFullFoV,
      readoutMethod: bestMetReadoutMethod,
      minFeature: bestMetMinFeature,
      maxFps: bestMetMaxFps,
      maxShutter: bestMetMaxShutter,
      targetFreq: bestMetTargetFreq,
      snrDb: app.state.desiredSnrDb,
    };

    if (hasRelaxed && minSnrDb < app.state.desiredSnrDb) {
      const strictMotion = motionHeadroom(motion, bestMetFps, errorBudgetMm);
      const motionQualifying = relaxedOptions.filter((opt) =>
        snrUndershootWorthwhile(strictMotion, motionHeadroom(motion, opt.fps, errorBudgetMm)),
      );
      const motionPick = motionQualifying.length > 0
        ? pickBestWorthwhileRelaxed(bestMetFps, bestMetMinFeature, motion, errorBudgetMm, motionQualifying, true)
        : null;

      let relaxedPick = motionPick ?? pickBestWorthwhileRelaxed(
        bestMetFps, bestMetMinFeature, motion, errorBudgetMm, relaxedOptions,
      );

      if (!motionPick && initialModeStrict) {
        const atInitialRes = relaxedOptions.filter(
          (o) => o.width === initialWidth && o.height === initialHeight,
        );
        const initialRelaxedPick = pickBestWorthwhileRelaxed(
          initialModeStrict.fps,
          initialModeStrict.minFeature,
          motion,
          errorBudgetMm,
          atInitialRes,
        );
        if (initialRelaxedPick &&
            spatialUndershootWorthwhile(initialModeStrict.minFeature, initialRelaxedPick.minFeature)) {
          relaxedPick = initialRelaxedPick;
        }
      }

      if (relaxedPick) {
        winner = relaxedPick;
      } else {
        winner = strictWinner;
        useStrict = true;
      }
    } else {
      winner = strictWinner;
      useStrict = true;
    }
  } else if (hasRelaxed) {
    if (hasValidFallback) {
      const relaxedPick = pickBestWorthwhileRelaxed(bestFallbackFps, bestFallbackMinFeature, motion, errorBudgetMm, relaxedOptions);
      winner = relaxedPick ?? {
        fps: bestFallbackFps,
        shutterDenom: bestFallbackShutterDenom,
        width: bestFallbackWidth,
        height: bestFallbackHeight,
        v4l2Mode: bestFallbackV4l2Mode,
        pitchMult: bestFallbackPitchMult,
        fullFoV: bestFallbackFullFoV,
        readoutMethod: bestFallbackReadoutMethod,
        minFeature: bestFallbackMinFeature,
        maxFps: bestFallbackMaxFps,
        maxShutter: bestFallbackMaxShutter,
        targetFreq: bestFallbackTargetFreq,
        snrDb: bestFallbackSnr,
      };
    } else {
      winner = pickBestRelaxedOverall(relaxedOptions);
    }
  } else {
    winner = {
      fps: bestFallbackFps,
      shutterDenom: bestFallbackShutterDenom,
      width: bestFallbackWidth,
      height: bestFallbackHeight,
      v4l2Mode: bestFallbackV4l2Mode,
      pitchMult: bestFallbackPitchMult,
      fullFoV: bestFallbackFullFoV,
      readoutMethod: bestFallbackReadoutMethod,
      minFeature: bestFallbackMinFeature,
      maxFps: bestFallbackMaxFps,
      maxShutter: bestFallbackMaxShutter,
      targetFreq: bestFallbackTargetFreq,
      snrDb: bestFallbackSnr,
    };
  }

  if (!winner) return null;

  const bestFps = winner.fps;
  const bestShutterDenom = winner.shutterDenom;
  const bestWidth = winner.width;
  const bestHeight = winner.height;
  const bestV4l2Mode = winner.v4l2Mode;
  const bestPitchMult = winner.pitchMult;
  const bestFullFoV = winner.fullFoV;
  const bestMinFeature = winner.minFeature;
  const bestReadoutMethod = winner.readoutMethod;
  const bestMaxFps = winner.maxFps;
  const bestMaxShutter = winner.maxShutter;
  const bestTargetFreq = winner.targetFreq;

  const winnerState: AppState = {
    ...app.state,
    extractedWidth: bestWidth,
    extractedHeight: bestHeight,
    selectedV4l2Mode: bestV4l2Mode,
    readoutPitchMultiplier: bestPitchMult,
    readoutFullFoV: bestFullFoV,
    readoutMethod: bestReadoutMethod,
  };
  const winnerDerived = calculateDerived(winnerState);

  const snrSnapThreshold = useStrict ? app.state.desiredSnrDb : minSnrDb;
  const meetsSnr = (fps: number, shutterDenom: number) =>
    snrAtShutter(winnerState, winnerDerived, radiometry, motion, bestTargetFreq, 1 / shutterDenom) >= snrSnapThreshold;

  const snapped = snapTimingPreservingSnr(
    { fps: bestFps, shutterDenom: bestShutterDenom },
    regionHz,
    bestMaxFps,
    bestMaxShutter,
    meetsSnr,
  );

  const finalSnrMet = snrAtShutter(
    winnerState,
    winnerDerived,
    radiometry,
    motion,
    bestTargetFreq,
    1 / snapped.shutterDenom,
  ) >= app.state.desiredSnrDb;

  return {
    fps: snapped.fps,
    shutterDenom: snapped.shutterDenom,
    extractedWidth: bestWidth,
    extractedHeight: bestHeight,
    selectedV4l2Mode: bestV4l2Mode,
    readoutPitchMultiplier: bestPitchMult,
    readoutFullFoV: bestFullFoV,
    readoutMethod: bestReadoutMethod,
    minFeatureSize: bestMinFeature,
    snrMet: finalSnrMet,
  };
}

interface CandidateTimings {
  strict: TimingPair | null;
  fallback: TimingPair | null;
}

function findCandidateTimings(
  state: AppState,
  derived: DerivedState,
  radiometry: SensorRadiometry,
  motion: MotionParams,
  baselineFreq: number,
  maxFps: number,
  maxShutterDenom: number,
  regionHz: number,
  minSnrDb: number,
): CandidateTimings {
  const minFreq = Math.max(baselineFreq * 0.005, 1e-6);
  const maxFreq = Math.max(minFreq, baselineFreq);

  const strict = binarySearchTiming(
    state, derived, radiometry, motion, minFreq, maxFreq, maxFps, maxShutterDenom, regionHz, minSnrDb,
    state.desiredSnrDb,
  );

  const fallback = !strict
    ? searchTimingAtFreq(state, derived, radiometry, motion, minFreq, maxFps, maxShutterDenom, regionHz, minSnrDb, 'fallback')
    : null;

  return { strict, fallback };
}

function enumerateRelaxedTimings(
  state: AppState,
  derived: DerivedState,
  radiometry: SensorRadiometry,
  motion: MotionParams,
  targetFreq: number,
  maxFps: number,
  maxShutterDenom: number,
  regionHz: number,
  minSnrDb: number,
): TimingPair[] {
  const seen = new Set<string>();
  const results: TimingPair[] = [];

  for (const fps of enumerateSearchFps(maxFps, regionHz)) {
    if (fps > maxShutterDenom) continue;
    const regionCap = regionHz > 0 ? regionHz * 2 : fps * 2;
    const relaxedCap = Math.min(maxShutterDenom, Math.max(fps * 4, regionCap));
    const shutters = shuttersForFpsSearch(fps, relaxedCap, maxShutterDenom, regionHz);
    for (const shutterDenom of shutters) {
      const snrDb = snrAtShutter(state, derived, radiometry, motion, targetFreq, 1 / shutterDenom);
      if (snrDb < minSnrDb || snrDb >= state.desiredSnrDb) continue;

      const key = `${fps}:${shutterDenom}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const timedExposure = calculateExposureOptimizer(state, derived, radiometry, motion, targetFreq, 1 / shutterDenom);
      results.push({ fps, shutterDenom, snrDb, exposure: timedExposure, targetFreq });
    }
  }

  return results;
}

function binarySearchTiming(
  state: AppState,
  derived: DerivedState,
  radiometry: SensorRadiometry,
  motion: MotionParams,
  minFreq: number,
  maxFreq: number,
  maxFps: number,
  maxShutterDenom: number,
  regionHz: number,
  minSnrDb: number,
  snrThresholdDb: number,
): TimingPair | null {
  let lo = minFreq;
  let hi = maxFreq;
  let bestMet: TimingPair | null = null;
  let bestMetFreq = minFreq;

  while (hi - lo > maxFreq * 1e-6) {
    const mid = (lo + hi) / 2;
    const timing = searchTimingAtFreq(state, derived, radiometry, motion, mid, maxFps, maxShutterDenom, regionHz, minSnrDb, 'strict');
    if (timing && timing.snrDb >= snrThresholdDb) {
      bestMet = timing;
      bestMetFreq = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  if (bestMet) {
    return searchTimingAtFreq(state, derived, radiometry, motion, bestMetFreq, maxFps, maxShutterDenom, regionHz, minSnrDb, 'strict') ?? bestMet;
  }

  return null;
}

function searchTimingAtFreq(
  state: AppState,
  derived: DerivedState,
  radiometry: SensorRadiometry,
  motion: MotionParams,
  targetFreq: number,
  maxFps: number,
  maxShutterDenom: number,
  regionHz: number,
  minSnrDb: number,
  tier: 'strict' | 'relaxed' | 'fallback' | 'any' = 'any',
): TimingPair | null {
  const exposure = calculateExposureOptimizer(state, derived, radiometry, motion, targetFreq);

  const idealShutterDenom = Math.min(
    maxShutterDenom,
    Math.max(1, Math.round(1 / Math.max(0.000001, exposure.tOptimal))),
  );

  let bestStrict: TimingPair | null = null;
  let bestRelaxed: TimingPair | null = null;
  let bestFallback: TimingPair | null = null;

  for (const fps of enumerateSearchFps(maxFps, regionHz)) {
    if (fps > idealShutterDenom) continue;

    const shutters = shuttersForFpsSearch(fps, idealShutterDenom, maxShutterDenom, regionHz);
    for (const shutterDenom of shutters) {
      const snrDb = snrAtShutter(state, derived, radiometry, motion, targetFreq, 1 / shutterDenom);
      const timedExposure = calculateExposureOptimizer(state, derived, radiometry, motion, targetFreq, 1 / shutterDenom);

      const pair: TimingPair = { fps, shutterDenom, snrDb, exposure: timedExposure, targetFreq };

      if (snrDb >= state.desiredSnrDb) {
        if (!bestStrict || shutterDenom > bestStrict.shutterDenom) {
          bestStrict = pair;
        }
      } else if (snrDb >= minSnrDb) {
        if (!bestRelaxed || shutterDenom > bestRelaxed.shutterDenom) {
          bestRelaxed = pair;
        }
      } else if (!bestFallback || snrDb > bestFallback.snrDb) {
        bestFallback = pair;
      }
    }
  }

  switch (tier) {
    case 'strict':
      return bestStrict;
    case 'relaxed':
      return bestRelaxed;
    case 'fallback':
      return bestFallback;
    default:
      return bestStrict ?? bestRelaxed ?? bestFallback;
  }
}

function snrAtShutter(
  state: AppState,
  derived: DerivedState,
  radiometry: SensorRadiometry,
  motion: MotionParams,
  targetFreq: number,
  shutterTime: number,
): number {
  const exposure = calculateExposureOptimizer(state, derived, radiometry, motion, targetFreq, shutterTime);
  return applyChromaSnrPenalty(exposure.snrAtOptimalDb, state);
}

function applyChromaSnrPenalty(snrDb: number, state: AppState): number {
  if (state.measurementMode === 'colour' && !(RAW_FORMATS as readonly string[]).includes(state.outputFormat)) {
    return snrDb - (state.outputFormat === 'uyuv' ? CHROMA_UYVY_SNR_DB : CHROMA_OTHER_SNR_DB);
  }
  return snrDb;
}

function enumerateSearchFps(maxFps: number, regionHz: number): number[] {
  if (maxFps < 1) return [];
  if (regionHz > 0) {
    return [...enumerateRegionFpsValues(maxFps, regionHz)].sort((a, b) => b - a);
  }
  return Array.from({ length: maxFps }, (_, i) => maxFps - i);
}

function buildCandidates(
  app: AppStateFull,
  radiometry: SensorRadiometry,
  sensorGeom: SensorGeometry | undefined,
): CandidateSpec[] {
  const isGlobal = app.state.shutterType === 'global';
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
