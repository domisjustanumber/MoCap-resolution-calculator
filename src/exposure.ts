import type { AppState, DerivedState, SensorRadiometry, ExposureOptimization, MotionParams } from './types';
import {
  PHOTONS_PER_UM2_PER_LUX_SEC,
  DARK_CURRENT_DOUBLING_C,
  EXPOSURE_HEADROOM_FACTOR,
  FWC_TARGET_FILL,
  GAIN_MIN,
  GAIN_MAX,
  MOTION_MTF50_CONST,
  RAW_FORMATS,
  CHROMA_UYVY_SNR_DB,
  CHROMA_OTHER_SNR_DB,
} from './constants';

function darkCurrentAtTemp(dc25: number, tempC: number): number {
  return dc25 * Math.pow(2, (tempC - 25) / DARK_CURRENT_DOUBLING_C);
}

export function calculateExposureOptimizer(
  state: Readonly<AppState>,
  derived: Readonly<DerivedState>,
  radiometry: Readonly<SensorRadiometry>,
  motion: MotionParams,
  targetFEffectiveLpMm: number,
  manualShutterOverride?: number,
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
  const RN2 = radiometry.readNoiseE * radiometry.readNoiseE;

  // Inflate SNR target to compensate for chroma subsampling penalty
  let effectiveSnrTargetDb = state.desiredSnrDb;
  if (state.measurementMode === 'colour' && !(RAW_FORMATS as readonly string[]).includes(state.outputFormat)) {
    effectiveSnrTargetDb += state.outputFormat === 'uyuv' ? CHROMA_UYVY_SNR_DB : CHROMA_OTHER_SNR_DB;
  }
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
    tSaturation = radiometry.fullWellCapacity / S;
  }

  // Pass 1 interim tOptimal to estimate the acceleration contribution
  const tCeilingPass1 = Math.min(EXPOSURE_HEADROOM_FACTOR * tSaturation, tMotionMax);
  const tEstimate = !isFinite(tMinusSnr) || tMinusSnr > tCeilingPass1 ? tCeilingPass1 : tMinusSnr;

  // Pass 2: refine motion ceiling with acceleration × estimated shutter time
  if (isFinite(tEstimate) && motion.acceleration > 1e-6) {
    const vEff2 = motion.linearVelocity + 0.5 * motion.acceleration * tEstimate;
    tMotionMax = computeTMotionMax(vEff2);
  }

  let photonStarved: boolean;
  let tOptimal: number;

  if (manualShutterOverride !== undefined) {
    // Manual mode: use the user's shutter time, capped at saturation ceiling
    const saturationCap = EXPOSURE_HEADROOM_FACTOR * tSaturation;
    tOptimal = Math.max(0.00001, isFinite(saturationCap) ? Math.min(manualShutterOverride, saturationCap) : manualShutterOverride);
    photonStarved = false;
  } else {
    // Optimizer mode: find best exposure within motion + saturation bounds
    const tCeiling = Math.min(EXPOSURE_HEADROOM_FACTOR * tSaturation, tMotionMax);
    photonStarved = !isFinite(tMinusSnr) || tMinusSnr > tCeiling;
    tOptimal = Math.max(0.00001, tCeiling);
  }

  const actualElectrons = S * tOptimal;
  const targetElectrons = FWC_TARGET_FILL * radiometry.fullWellCapacity;
  let optimalGain = GAIN_MIN;
  if (actualElectrons > 0) {
    optimalGain = Math.max(GAIN_MIN, Math.min(GAIN_MAX, targetElectrons / actualElectrons));
  }

  const signalPercentFwc = radiometry.fullWellCapacity > 0
    ? (actualElectrons / radiometry.fullWellCapacity) * 100
    : 0;
  const headroomStops = radiometry.fullWellCapacity > 0 && actualElectrons > 1
    ? Math.log2(radiometry.fullWellCapacity / actualElectrons)
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
