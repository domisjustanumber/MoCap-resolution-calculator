import type { AppStateFull, AppState, DerivedState, SensorRadiometry, ExposureOptimization, MotionParams, ReadoutMethod } from './types';
import { calculateDerived, calculateResults } from './engine';
import { calculateExposureOptimizer } from './exposure';
import { SENSOR_RADIOMETRY, SENSOR_GEOMETRY } from '../presets';
import type { SensorGeometry, V4l2Mode } from '../presets';
import { DEFAULT_RADIOMETRY, chromaSnrPenaltyDb, DEFAULT_SNR_UNDERSHOOT_PCT, MOTION_UNDERSHOOT_IMPROVEMENT_PCT } from './constants';
import { getRegionHz } from './temporalState';
import { readoutTypeToMethod } from './state';
import {
  shuttersForFpsSearch,
  snapTimingPreservingSnr,
  enumerateRegionFpsValues,
  idealMaxShutterDenomFromExposure,
} from './temporalQuantize';

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
  optimalGain: number;
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
  exposure: ExposureOptimization;
}

export function minAcceptableSnrDb(desiredSnrDb: number, undershootPct: number): number {
  const pct = Math.max(0, Math.min(100, undershootPct));
  return desiredSnrDb * (1 - pct / 100);
}

export interface MotionHeadroom {
  maxVel: number;
  maxAccel: number;
  maxTurn: number;
  velUnderperforming: boolean;
  accelUnderperforming: boolean;
  turnUnderperforming: boolean;
}

export function motionHeadroom(motion: MotionParams, fps: number, errorBudgetMm: number, focalLength?: number, distance?: number): MotionHeadroom {
  const epsilon = errorBudgetMm / 1000;
  const maxVel = (focalLength !== undefined && distance !== undefined)
    ? epsilon * fps * distance / Math.max(0.1, focalLength)
    : epsilon * fps;
  const maxAccel = epsilon * fps * fps;
  const maxTurn = motion.subjectHalfWidth > 0
    ? (epsilon * fps / motion.subjectHalfWidth) * (180 / Math.PI)
    : Infinity;
  return {
    maxVel,
    maxAccel,
    maxTurn,
    velUnderperforming: motion.linearVelocity >= 1e-6 && maxVel < motion.linearVelocity,
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

  if (baseline.velUnderperforming) {
    underperforming = true;
    if (candidate.maxVel >= baseline.maxVel * (1 + minImprovementRatio)) {
      worthwhile = true;
    }
  }
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

/** True when SNR undershoot is justified by >=20% smaller min resolvable feature (better spatial resolution). */
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
  focalLength?: number,
  distance?: number,
): ResolvedCandidate | null {
  if (relaxedOptions.length === 0) return null;

  const mh = (m: MotionParams, f: number) => motionHeadroom(m, f, errorBudgetMm, focalLength, distance);
  const baseline = mh(motion, baselineFps);
  const qualifying = relaxedOptions.filter((opt) =>
    motionOnly
      ? snrUndershootWorthwhile(baseline, mh(motion, opt.fps))
      : candidateWorthwhileSnrUndershoot(
          baseline,
          mh(motion, opt.fps),
          baselineMinFeature,
          opt.minFeature,
        ),
  );
  if (qualifying.length === 0) return null;

  const improvementScore = (opt: ResolvedCandidate): number => {
    const candidate = mh(motion, opt.fps);
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
    const candidate = mh(motion, opt.fps);
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

  const focalLength = app.state.focalLength;
  const distance = app.state.distanceToSubject;
  const regionHz = getRegionHz();
  const initialWidth = app.state.extractedWidth;
  const initialHeight = app.state.extractedHeight;

  const strictOptions: ResolvedCandidate[] = [];
  const relaxedOptions: ResolvedCandidate[] = [];
  const fallbackOptions: ResolvedCandidate[] = [];

  let initialModeStrict: ResolvedCandidate | null = null;

  for (const c of candidates) {
    // Search always assumes auto gain — applied app.state.gain must not change SNR ranking.
    const tempState: AppState = { ...app.state, ...c.statePatch, gain: 0 };
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
          exposure: baselineStrict.exposure,
        };
      }
    }

    for (const timing of [timings.strict, timings.fallback]) {
      if (!timing) continue;

      const { fps, shutterDenom, snrDb, exposure, targetFreq } = timing;
      const shutterTime = 1 / Math.max(1, shutterDenom);
      const results = calculateResults(tempState, tempDerived, motion, shutterTime, fps, 0, false, exposure);

      const opt: ResolvedCandidate = {
        fps,
        shutterDenom,
        width: c.statePatch.extractedWidth ?? tempState.extractedWidth,
        height: c.statePatch.extractedHeight ?? tempState.extractedHeight,
        v4l2Mode: c.statePatch.selectedV4l2Mode ?? -1,
        pitchMult: c.statePatch.readoutPitchMultiplier ?? 1,
        fullFoV: c.statePatch.readoutFullFoV ?? true,
        readoutMethod: (c.statePatch.readoutMethod as ReadoutMethod) ?? tempState.readoutMethod,
        minFeature: results.minFeatureSize,
        maxFps: c.maxFps,
        maxShutter: c.maxShutterDenom,
        targetFreq,
        snrDb,
        exposure,
      };

      if (snrDb >= tempState.desiredSnrDb) {
        strictOptions.push(opt);
      } else {
        fallbackOptions.push(opt);
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
          exposure: timing.exposure,
        });
      }
    }
  }

  const hasValidMet = strictOptions.length > 0;
  const hasValidFallback = fallbackOptions.length > 0;
  const hasRelaxed = relaxedOptions.length > 0;

  if (!hasValidMet && !hasRelaxed && !hasValidFallback) return null;

  let winner: ResolvedCandidate | null = null;
  let useStrict = false;

  if (hasValidMet) {
    strictOptions.sort((a, b) => {
      if (a.shutterDenom !== b.shutterDenom) return b.shutterDenom - a.shutterDenom;
      return a.minFeature - b.minFeature;
    });
    const baselineStrict = strictOptions[0];

    const strictMotion = motionHeadroom(motion, baselineStrict.fps, errorBudgetMm, focalLength, distance);
    const motionQualifyingStrict = strictOptions.filter((opt) =>
      snrUndershootWorthwhile(strictMotion, motionHeadroom(motion, opt.fps, errorBudgetMm, focalLength, distance)),
    );
    const strictWinner = motionQualifyingStrict.length > 0
      ? pickBestWorthwhileRelaxed(baselineStrict.fps, baselineStrict.minFeature, motion, errorBudgetMm, motionQualifyingStrict, true, focalLength, distance) ?? baselineStrict
      : baselineStrict;

    if (hasRelaxed && minSnrDb < app.state.desiredSnrDb) {
      const winnerMotion = motionHeadroom(motion, strictWinner.fps, errorBudgetMm, focalLength, distance);
      const motionQualifying = relaxedOptions.filter((opt) =>
        snrUndershootWorthwhile(winnerMotion, motionHeadroom(motion, opt.fps, errorBudgetMm, focalLength, distance)),
      );
      const motionPick = motionQualifying.length > 0
        ? pickBestWorthwhileRelaxed(strictWinner.fps, strictWinner.minFeature, motion, errorBudgetMm, motionQualifying, true, focalLength, distance)
        : null;

      let relaxedPick = motionPick ?? pickBestWorthwhileRelaxed(
        strictWinner.fps, strictWinner.minFeature, motion, errorBudgetMm, relaxedOptions, false, focalLength, distance,
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
          false,
          focalLength,
          distance,
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
    fallbackOptions.sort((a, b) => b.snrDb - a.snrDb);
    const bestFallback = fallbackOptions[0];

    if (bestFallback) {
      const relaxedPick = pickBestWorthwhileRelaxed(bestFallback.fps, bestFallback.minFeature, motion, errorBudgetMm, relaxedOptions, false, focalLength, distance);
      winner = relaxedPick ?? bestFallback;
    } else {
      winner = pickBestRelaxedOverall(relaxedOptions);
    }
  } else {
    fallbackOptions.sort((a, b) => b.snrDb - a.snrDb);
    winner = fallbackOptions[0];
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
    gain: 0,
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

  const finalExposure = calculateExposureOptimizer(
    winnerState,
    winnerDerived,
    radiometry,
    motion,
    bestTargetFreq,
    1 / snapped.shutterDenom,
    true,
  );
  const finalSnrDb = finalExposure.snrAtOptimalDb - chromaSnrPenaltyDb(winnerState);
  const finalSnrMet = finalSnrDb >= app.state.desiredSnrDb;

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
    optimalGain: finalExposure.optimalGain,
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

  const idealShutterDenom = idealMaxShutterDenomFromExposure(exposure, maxShutterDenom);

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
  const autoGainState = state.gain === 0 ? state : { ...state, gain: 0 };
  const exposure = calculateExposureOptimizer(
    autoGainState,
    derived,
    radiometry,
    motion,
    targetFreq,
    shutterTime,
    true,
  );
  return applyChromaSnrPenalty(exposure.snrAtOptimalDb, autoGainState);
}

function applyChromaSnrPenalty(snrDb: number, state: AppState): number {
  return snrDb - chromaSnrPenaltyDb(state);
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

    const modeReadoutMethod = readoutTypeToMethod(mode.readoutType);

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
