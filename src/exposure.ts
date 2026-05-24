import type { AppState, DerivedState, SensorRadiometry, ExposureOptimization } from './types';
import {
  PHOTONS_PER_UM2_PER_LUX_SEC,
  DARK_CURRENT_DOUBLING_C,
  EXPOSURE_HEADROOM_FACTOR,
  FWC_TARGET_FILL,
  GAIN_MIN,
  GAIN_MAX,
  MOTION_MTF50_CONST,
} from './constants';

function darkCurrentAtTemp(dc25: number, tempC: number): number {
  return dc25 * Math.pow(2, (tempC - 25) / DARK_CURRENT_DOUBLING_C);
}

export function calculateExposureOptimizer(
  state: Readonly<AppState>,
  derived: Readonly<DerivedState>,
  radiometry: Readonly<SensorRadiometry>,
  velocity: number,
  targetFEffectiveLpMm: number,
): ExposureOptimization {
  const N = state.aperture;
  const lux = state.luxAtSubject;
  const R = state.subjectReflectance;
  const T = state.lensTransmission;

  const E_sensor = lux * R * T / (4 * N * N);
  const pixelAreaUm2 = derived.pixelPitch * derived.pixelPitch;
  const photonsPerPxPerSec = E_sensor * pixelAreaUm2 * PHOTONS_PER_UM2_PER_LUX_SEC * radiometry.cfaFactor;
  const electronsPerPxPerSec = photonsPerPxPerSec * (radiometry.qePercent / 100);

  const DC = darkCurrentAtTemp(radiometry.darkCurrentE, state.temperatureC);
  const S = electronsPerPxPerSec;
  const RN2 = radiometry.readNoiseE * radiometry.readNoiseE;

  const snrTargetLinear = Math.pow(10, state.desiredSnrDb / 20);

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

  let tMotionMax = Infinity;
  if (velocity > 1e-6 && targetFEffectiveLpMm > 0) {
    const vImg = velocity * state.focalLength / Math.max(0.1, state.distanceToSubject);
    if (vImg > 1e-6) {
      tMotionMax = MOTION_MTF50_CONST / (vImg * targetFEffectiveLpMm);
    }
  }

  let tSaturation = Infinity;
  if (S > 0) {
    tSaturation = radiometry.fullWellCapacity / S;
  }

  const tCeiling = Math.min(EXPOSURE_HEADROOM_FACTOR * tSaturation, tMotionMax);
  const photonStarved = !isFinite(tMinusSnr) || tMinusSnr > tCeiling;
  const tOptimal = photonStarved ? tCeiling : Math.max(0.00001, tMinusSnr);

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
