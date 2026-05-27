import type { AppState, DerivedState, SensorRadiometry, ExposureOptimization, MotionParams } from './types';
import {
  PHOTONS_PER_UM2_PER_LUX_SEC,
  EXPOSURE_HEADROOM_FACTOR,
  FWC_TARGET_FILL,
  GAIN_MIN,
  GAIN_MAX,
  MOTION_MTF50_CONST,
  chromaSnrPenaltyDb,
  darkCurrentAtTemp,
} from './constants';

export function calculateExposureOptimizer(
  state: Readonly<AppState>,
  derived: Readonly<DerivedState>,
  radiometry: Readonly<SensorRadiometry>,
  motion: MotionParams,
  targetFEffectiveLpMm: number,
  shutterTime?: number,
  enableTwoPassGain?: boolean,
): ExposureOptimization {
  const N = state.aperture;
  const lux = state.luxAtSubject;
  const R = state.subjectReflectance;
  const T = state.lensTransmission;

  const E_sensor = lux * R * T / (4 * N * N);
  const pixelPitch = state.readoutMethod === 'binning' ? derived.effectivePixelPitch : derived.pixelPitch;
  const pixelAreaUm2 = pixelPitch * pixelPitch;
  const photonsPerPxPerSec = E_sensor * pixelAreaUm2 * PHOTONS_PER_UM2_PER_LUX_SEC * radiometry.cfaFactor;
  const electronsPerPxPerSec = photonsPerPxPerSec * (radiometry.qePercent / 100);

  const DC = darkCurrentAtTemp(radiometry.darkCurrentE, state.temperatureC);
  const S = electronsPerPxPerSec;

  let effectiveGain = state.gain > 0 ? state.gain : 1.0;
  let effectiveReadNoiseE = radiometry.readNoiseE / effectiveGain;
  let effectiveFwc = radiometry.fullWellCapacity / effectiveGain;
  let RN2 = effectiveReadNoiseE * effectiveReadNoiseE;

  // Inflate SNR target to compensate for chroma subsampling penalty
  let effectiveSnrTargetDb = state.desiredSnrDb + chromaSnrPenaltyDb(state);
  const snrTargetLinear = Math.pow(10, effectiveSnrTargetDb / 20);

  const a = S * S;
  const b = -snrTargetLinear * snrTargetLinear * (S + DC);
  const c = -snrTargetLinear * snrTargetLinear * RN2;
  const discriminant = b * b - 4 * a * c;

  let tMinusSnr: number;
  const tMaxPractical = 1.0;
  if (discriminant >= 0 && a > 1e-12) {
    tMinusSnr = (-b + Math.sqrt(discriminant)) / (2 * a);
    if (tMinusSnr > tMaxPractical) tMinusSnr = Infinity;
  } else {
    tMinusSnr = Infinity;
  }

  // Motion ceiling — uses full vTotal (linear, acceleration, angular) with two-pass for acceleration's time dependency
  const vRot = (motion.angularVelocity * Math.PI / 180) * motion.subjectHalfWidth;
  const computeTMotionMax = (vEff: number): number => {
    const vTotal = Math.sqrt(vEff * vEff + vRot * vRot);
    if (vTotal < 1e-6 || targetFEffectiveLpMm < 1e-6) return Infinity;
    const vImg = vTotal * state.focalLength / Math.max(0.1, state.distanceToSubject);
    if (vImg < 1e-6) return Infinity;
    return MOTION_MTF50_CONST / (vImg * targetFEffectiveLpMm);
  };

  // Pass 1: estimate motion ceiling from linearVelocity (no acceleration time term)
  let tMotionMax = computeTMotionMax(motion.linearVelocity);

  let tSaturation = Infinity;
  if (S > 0) {
    tSaturation = effectiveFwc / S;
  }

  // Pass 1 interim tOptimal to estimate the acceleration contribution
  const tCeilingPass1 = Math.min(EXPOSURE_HEADROOM_FACTOR * tSaturation, tMotionMax);
  const tEstimate = !isFinite(tMinusSnr) || tMinusSnr > tCeilingPass1 ? tCeilingPass1 : tMinusSnr;

  // Pass 2: refine motion ceiling with acceleration × estimated shutter time
  if (isFinite(tEstimate) && motion.acceleration > 1e-6) {
    const vEff2 = motion.linearVelocity + 0.5 * motion.acceleration * tEstimate;
    tMotionMax = computeTMotionMax(vEff2);
  }

  const saturationCap = EXPOSURE_HEADROOM_FACTOR * tSaturation;
  let tCeiling = Math.min(saturationCap, tMotionMax);

  let tOptimal: number;
  if (shutterTime !== undefined) {
    tOptimal = Math.max(0.00001, isFinite(saturationCap) ? Math.min(shutterTime, saturationCap) : shutterTime);
  } else {
    tOptimal = Math.max(0.00001, tCeiling);
  }

  let actualElectrons = S * tOptimal;
  const targetElectrons = FWC_TARGET_FILL * radiometry.fullWellCapacity;
  let optimalGain = GAIN_MIN;
  if (actualElectrons > 0) {
    optimalGain = Math.max(GAIN_MIN, Math.min(GAIN_MAX, targetElectrons / actualElectrons));
  }

  // Second pass: recompute with optimal gain.  Only fires when the caller explicitly
  // enables it (shutterTime must be provided and enableTwoPassGain must be true).
  if (enableTwoPassGain && shutterTime !== undefined && state.gain === 0 && Math.abs(optimalGain - 1.0) > 1e-6) {
    effectiveGain = optimalGain;
    effectiveReadNoiseE = radiometry.readNoiseE / effectiveGain;
    effectiveFwc = radiometry.fullWellCapacity / effectiveGain;
    RN2 = effectiveReadNoiseE * effectiveReadNoiseE;

    tSaturation = S > 0 ? effectiveFwc / S : Infinity;
    const cap2 = EXPOSURE_HEADROOM_FACTOR * tSaturation;
    tCeiling = Math.min(cap2, tMotionMax);

    tOptimal = Math.max(0.00001, isFinite(cap2) ? Math.min(shutterTime, cap2) : shutterTime);

    actualElectrons = S * tOptimal;
    if (actualElectrons > 0) {
      optimalGain = Math.max(GAIN_MIN, Math.min(GAIN_MAX, targetElectrons / actualElectrons));
    }
  }

  // photonStarved: unconditional from the final envelope
  const photonStarved = !isFinite(tMinusSnr) || tMinusSnr > tCeiling;

  const signalPercentFwc = effectiveFwc > 0
    ? (actualElectrons / effectiveFwc) * 100
    : 0;
  const headroomStops = effectiveFwc > 0 && actualElectrons > 1
    ? Math.log2(effectiveFwc / actualElectrons)
    : 99;

  const shotNoise = Math.sqrt(actualElectrons);
  const darkNoise = Math.sqrt(DC * tOptimal);
  const totalNoise = Math.sqrt(shotNoise * shotNoise + RN2 + darkNoise * darkNoise);
  const snrAtOptimalDb = totalNoise > 0 ? 20 * Math.log10(actualElectrons / totalNoise) : 0;

  const readoutTimeS = (radiometry.readoutTimeUs * state.nativeHeight) / 1_000_000;
  const frameTime = Math.max(tOptimal, readoutTimeS);
  const optimalFps = frameTime > 0 ? 1 / frameTime : 120;

  return {
    illuminanceSensorLux: E_sensor,
    photonsPerPxPerSec,
    electronsPerPxPerSec,
    tMinusSnr: isFinite(tMinusSnr) ? tMinusSnr : 0,
    tMotionMax: isFinite(tMotionMax) ? tMotionMax : 0,
    tSaturation: isFinite(tSaturation) ? tSaturation : 0,
    tOptimal,
    optimalGain,
    optimalFps,
    snrAtOptimalDb,
    photonStarved,
    signalPercentFwc,
    headroomStops,
  };
}
