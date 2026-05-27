import type { AppState, DerivedState, Results, ExposureOptimization, BottleneckType, MotionParams } from './types';
import { lensTierScalar } from '../presets';
import {
  OLPF_PENALTY,
  MOTION_MTF50_CONST,
  FORMAT_EFFICIENCY_MJPG_BASE,
  FORMAT_EFFICIENCY_MJPG_RANGE,
  FORMAT_EFFICIENCY_H264_BASE,
  FORMAT_EFFICIENCY_H264_RANGE,
  H264_QP_MAX,
  H264_BITRATE_REF_BPP,
  BOTTLENECK_RATIO,
  chromaFormatEfficiencyPenalty,
  chromaSnrPenaltyDb,
} from './constants';
import { calculateExposureOptimizer } from './exposure';

export function calculateDerived(state: Readonly<AppState>): DerivedState {
  const pixelPitch = state.pixelPitch;
  const sensorWidth = (pixelPitch * state.nativeWidth) / 1000;
  const sensorHeight = (pixelPitch * state.nativeHeight) / 1000;
  const sensorDiagonal = Math.sqrt(sensorWidth ** 2 + sensorHeight ** 2);

  let effectivePixelPitch: number;
  let fovWidth: number;
  let fovHeight: number;

  if (state.selectedV4l2Mode >= 0) {
    const pitchMult = state.readoutPitchMultiplier;
    effectivePixelPitch = pixelPitch * pitchMult;
    fovWidth = state.readoutFullFoV
      ? sensorWidth
      : (pixelPitch * state.extractedWidth) / 1000;
    fovHeight = state.readoutFullFoV
      ? sensorHeight
      : (pixelPitch * state.extractedHeight) / 1000;
  } else {
    const skipH = Math.max(1, state.nativeWidth / state.extractedWidth);
    const skipV = Math.max(1, state.nativeHeight / state.extractedHeight);
    const skippingFactor = Math.max(skipH, skipV);

    if (state.readoutMethod === 'cropping') {
      effectivePixelPitch = pixelPitch;
      fovWidth = (pixelPitch * state.extractedWidth) / 1000;
      fovHeight = (pixelPitch * state.extractedHeight) / 1000;
    } else if (state.readoutMethod === 'native') {
      effectivePixelPitch = pixelPitch;
      fovWidth = sensorWidth;
      fovHeight = sensorHeight;
    } else {
      effectivePixelPitch = pixelPitch * skippingFactor;
      fovWidth = sensorWidth;
      fovHeight = sensorHeight;
    }
  }

  const fovDiagonal = Math.sqrt(fovWidth ** 2 + fovHeight ** 2);
  const diagonalFov = 2 * Math.atan(fovDiagonal / (2 * state.focalLength)) * (180 / Math.PI);
  const horizontalFov = 2 * Math.atan(fovWidth / (2 * state.focalLength)) * (180 / Math.PI);
  const verticalFov = 2 * Math.atan(fovHeight / (2 * state.focalLength)) * (180 / Math.PI);

  const skipH = Math.max(1, state.nativeWidth / state.extractedWidth);
  const skipV = Math.max(1, state.nativeHeight / state.extractedHeight);
  const skippingFactor = Math.max(skipH, skipV);

  return {
    sensorDiagonal,
    sensorWidth,
    sensorHeight,
    pixelPitch,
    effectivePixelPitch,
    skippingFactor,
    diagonalFov,
    horizontalFov,
    verticalFov,
  };
}

export interface ImageVelocity {
  vEff: number;
  vRot: number;
  vTotal: number;
  vImg: number;
}

export function computeImageVelocity(
  motion: MotionParams,
  shutterTime: number,
  focalLength: number,
  distance: number,
): ImageVelocity {
  const vEff = motion.linearVelocity + 0.5 * motion.acceleration * shutterTime;
  const vRot = (motion.angularVelocity * Math.PI / 180) * motion.subjectHalfWidth;
  const vTotal = Math.sqrt(vEff * vEff + vRot * vRot);
  const vImg = vTotal * focalLength / Math.max(0.1, distance);
  return { vEff, vRot, vTotal, vImg };
}

export function calculateDiffractionCutoff(aperture: number, wavelengthNm: number): number {
  const wavelengthMm = wavelengthNm / 1_000_000;
  return 1 / (wavelengthMm * aperture);
}

export function calculateResults(
  state: Readonly<AppState>,
  derived: Readonly<DerivedState>,
  motion: MotionParams,
  shutterTime: number,
  fps: number,
  syncErrorP95: number,
  syncEnabled: boolean,
  exposure?: ExposureOptimization,
): Results {
  const fc = calculateDiffractionCutoff(state.aperture, state.wavelength);
  const fcAberrated = fc * lensTierScalar(state.lensTier);

  const olpfPenalty = state.olpfPresent ? OLPF_PENALTY : 1.0;

  const nativePitchMm = derived.pixelPitch / 1000;
  const fNyquistNative = (1 / (2 * nativePitchMm)) * olpfPenalty;

  const skippedPitchMm = derived.effectivePixelPitch / 1000;
  const fNyquistSkipped = (1 / (2 * skippedPitchMm)) * olpfPenalty;

  let formatEfficiency = 1.0;
  if (state.outputFormat === 'mjpg') {
    formatEfficiency = FORMAT_EFFICIENCY_MJPG_BASE + FORMAT_EFFICIENCY_MJPG_RANGE * (state.mjpgQuality / 100);
  }
  if (state.outputFormat === 'h264') {
    const qpEfficiency = FORMAT_EFFICIENCY_H264_BASE + FORMAT_EFFICIENCY_H264_RANGE * (1 - state.h264Qp / H264_QP_MAX);
    const pixelsPerFrame = state.extractedWidth * state.extractedHeight;
    const bpp = pixelsPerFrame > 0 ? (state.h264BitrateMbps * 1_000_000) / (pixelsPerFrame * Math.max(1, fps)) : 0;
    const bitrateEfficiency = Math.min(1, bpp / H264_BITRATE_REF_BPP);
    formatEfficiency = Math.min(qpEfficiency, bitrateEfficiency);
  }
  formatEfficiency *= chromaFormatEfficiencyPenalty(state);

  const { vImg } = computeImageVelocity(motion, shutterTime, state.focalLength, state.distanceToSubject);
  const fTemporal50 = vImg > 1e-6 ? MOTION_MTF50_CONST / (vImg * shutterTime) : Infinity;

  // Dynamic Range: minimum detectable contrast from noise floor
  const effectiveDR = exposure?.photonStarved
    ? Math.min(state.dynamicRangeDb, exposure.snrAtOptimalDb)
    : state.dynamicRangeDb;
  const contrastFloor = 1 / Math.pow(10, effectiveDR / 20);
  const fDRLimited = fcAberrated * Math.sqrt(Math.max(0, 1 - contrastFloor / Math.max(0.01, formatEfficiency)));

  const fSyncMTF50 = syncErrorP95 > 0.001 ? 0.1874 / syncErrorP95 : Infinity;

  const limitingFrequency = Math.min(fcAberrated, fNyquistSkipped, fTemporal50, fDRLimited);
  const fEffective = limitingFrequency * formatEfficiency;
  const minFeatureSize = (1 / (2 * fEffective)) * 1000;

  const featureBase =
    (1 / (2 * fEffective) / state.focalLength) * (state.distanceToSubject * 1000);

  const featureSizeAtDistance = syncEnabled && syncErrorP95 > 0
    ? Math.hypot(featureBase, syncErrorP95)
    : featureBase;

  let bottleneckType: BottleneckType = 'balanced';
  if (formatEfficiency < BOTTLENECK_RATIO && (state.outputFormat === 'mjpg' || state.outputFormat === 'h264')) {
    bottleneckType = 'compression-throttled';
  }
  if (fDRLimited < fcAberrated * BOTTLENECK_RATIO && fDRLimited < fNyquistSkipped * BOTTLENECK_RATIO) {
    bottleneckType = 'dr-limited';
  }
  if (fNyquistSkipped < fcAberrated * BOTTLENECK_RATIO && fNyquistSkipped < fDRLimited * BOTTLENECK_RATIO) {
    bottleneckType = 'sensor-limited';
  } else if (fcAberrated < fNyquistSkipped * BOTTLENECK_RATIO && fcAberrated < fDRLimited * BOTTLENECK_RATIO) {
    bottleneckType = 'lens-limited';
  }
  if (fTemporal50 < fcAberrated * BOTTLENECK_RATIO && fTemporal50 < fNyquistSkipped * BOTTLENECK_RATIO && fTemporal50 < fDRLimited * BOTTLENECK_RATIO) {
    bottleneckType = 'motion-limited';
  }
  if (syncEnabled && fSyncMTF50 < fcAberrated * BOTTLENECK_RATIO && fSyncMTF50 < fNyquistSkipped * BOTTLENECK_RATIO && fSyncMTF50 < fDRLimited * BOTTLENECK_RATIO && fSyncMTF50 < fTemporal50 * BOTTLENECK_RATIO) {
    bottleneckType = 'sync-limited';
  }
  if (exposure?.photonStarved) {
    bottleneckType = 'photon-starved';
  }

  let finalExposure = exposure ?? {
    illuminanceSensorLux: 0,
    photonsPerPxPerSec: 0,
    electronsPerPxPerSec: 0,
    tMinusSnr: 0,
    tMotionMax: 0,
    tSaturation: 0,
    tOptimal: shutterTime,
    optimalGain: 1,
    optimalFps: fps,
    snrAtOptimalDb: 0,
    photonStarved: false,
    signalPercentFwc: 0,
    headroomStops: 0,
  };

  const snrPenaltyDb = chromaSnrPenaltyDb(state);
  if (snrPenaltyDb > 0) {
    finalExposure = { ...finalExposure, snrAtOptimalDb: Math.max(0, finalExposure.snrAtOptimalDb - snrPenaltyDb) };
  }

  return {
    fc,
    fcAberrated,
    fNyquistNative,
    fNyquistSkipped,
    skippingFactor: derived.skippingFactor,
    olpfPenalty,
    formatEfficiency,
    fEffective,
    fTemporal50,
    bottleneckType,
    minFeatureSize,
    featureSizeAtDistance,
    fDRLimited,
    contrastFloor,
    fSyncMTF50,
    syncErrorP95,
    exposure: finalExposure,
  };
}

export function formatLpMm(value: number): string {
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(1);
}

export function formatFov(value: number): string {
  return value.toFixed(1) + '\u00b0';
}

const COMMON_SENSOR_DENOMS = [1.0, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.0, 3.2, 3.4, 3.6, 4.0, 5.0];
export function formatSensorSize(sensorDiagonalMm: number): string {
  const val = sensorDiagonalMm / 16;
  if (val <= 0) return '\u2014';
  const closest = COMMON_SENSOR_DENOMS.reduce((a, b) =>
    Math.abs(1 / a - val) < Math.abs(1 / b - val) ? a : b
  );
  return `1/${closest.toFixed(1)}"`;
}
