import type { AppState, DerivedState, Results, BottleneckType, LensTier } from './types';
import {
  OLPF_PENALTY,
  MOTION_MTF50_CONST,
  FORMAT_EFFICIENCY_MJPG_BASE,
  FORMAT_EFFICIENCY_MJPG_RANGE,
  CHROMA_UYVY_PENALTY,
  CHROMA_OTHER_PENALTY,
  BOTTLENECK_RATIO,
  RAW_FORMATS,
} from './constants';

export function calculateDerived(state: Readonly<AppState>): DerivedState {
  const pixelPitch = state.pixelPitch;
  const sensorWidth = (pixelPitch * state.nativeWidth) / 1000;
  const sensorHeight = (pixelPitch * state.nativeHeight) / 1000;
  const sensorDiagonal = Math.sqrt(sensorWidth ** 2 + sensorHeight ** 2);

  const skipH = Math.max(1, state.nativeWidth / state.extractedWidth);
  const skipV = Math.max(1, state.nativeHeight / state.extractedHeight);
  const skippingFactor = Math.max(skipH, skipV);
  const binnedPitch = pixelPitch * state.pixelBinning;
  const effectivePixelPitch = binnedPitch * skippingFactor;

  const diagonalFov = 2 * Math.atan(sensorDiagonal / (2 * state.focalLength)) * (180 / Math.PI);
  const horizontalFov = 2 * Math.atan(sensorWidth / (2 * state.focalLength)) * (180 / Math.PI);
  const verticalFov = 2 * Math.atan(sensorHeight / (2 * state.focalLength)) * (180 / Math.PI);

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

export function calculateDiffractionCutoff(aperture: number, wavelengthNm: number): number {
  const wavelengthMm = wavelengthNm / 1_000_000;
  return 1 / (wavelengthMm * aperture);
}

function lensTierScalar(tier: LensTier): number {
  return tier === 'cheap-plastic' ? 0.6 : tier === 'mid-glass' ? 0.8 : 0.95;
}

export function calculateResults(
  state: Readonly<AppState>,
  derived: Readonly<DerivedState>,
  velocity: number,
  shutterTime: number,
): Results {
  const fc = calculateDiffractionCutoff(state.aperture, state.wavelength);
  const fcAberrated = fc * lensTierScalar(state.lensTier);

  const olpfPenalty = state.olpfPresent ? OLPF_PENALTY : 1.0;

  const nativePitchMm = (derived.pixelPitch * state.pixelBinning) / 1000;
  const fNyquistNative = (1 / (2 * nativePitchMm)) * olpfPenalty;

  const skippedPitchMm = derived.effectivePixelPitch / 1000;
  const fNyquistSkipped = (1 / (2 * skippedPitchMm)) * olpfPenalty;

  let formatEfficiency = 1.0;
  if (state.outputFormat === 'mjpg') {
    formatEfficiency = FORMAT_EFFICIENCY_MJPG_BASE + FORMAT_EFFICIENCY_MJPG_RANGE * (state.mjpgQuality / 100);
  }
  if (state.measurementMode === 'chroma' && !(RAW_FORMATS as readonly string[]).includes(state.outputFormat)) {
    formatEfficiency *= state.outputFormat === 'uyuv' ? CHROMA_UYVY_PENALTY : CHROMA_OTHER_PENALTY;
  }

  const vImg = velocity * state.focalLength / Math.max(0.1, state.distanceToSubject);
  const fTemporal50 = vImg > 1e-6 ? MOTION_MTF50_CONST / (vImg * shutterTime) : Infinity;

  // Dynamic Range: minimum detectable contrast from noise floor
  const contrastFloor = 1 / Math.pow(10, state.dynamicRangeDb / 20);
  const fDRLimited = fcAberrated * Math.sqrt(Math.max(0, 1 - contrastFloor / Math.max(0.01, formatEfficiency)));

  const limitingFrequency = Math.min(fcAberrated, fNyquistSkipped, fTemporal50, fDRLimited);
  const fEffective = limitingFrequency * formatEfficiency;
  const minFeatureSize = (1 / (2 * fEffective)) * 1000;

  const featureSizeAtDistance =
    (1 / (2 * fEffective) / state.focalLength) * (state.distanceToSubject * 1000);

  let bottleneckType: BottleneckType = 'balanced';
  if (formatEfficiency < BOTTLENECK_RATIO && state.outputFormat === 'mjpg') {
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
  };
}

export function formatLpMm(value: number): string {
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(1);
}

export function formatUm(value: number): string {
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function formatFov(value: number): string {
  return value.toFixed(1) + '\u00b0';
}

export function formatAperture(value: number): string {
  return value.toFixed(1);
}

export function formatFeatureMm(value: number): string {
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(3);
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
