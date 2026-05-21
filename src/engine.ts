import type { AppState, DerivedState, Results, BottleneckType, LensTier } from './types';
import { getTemporalVelocity, getShutterTime } from './ui/temporalChart';

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

export function calculateResults(state: Readonly<AppState>, derived: Readonly<DerivedState>): Results {
  const fc = calculateDiffractionCutoff(state.aperture, state.wavelength);
  const fcAberrated = fc * lensTierScalar(state.lensTier);

  const skipH = Math.max(1, state.nativeWidth / state.extractedWidth);
  const skipV = Math.max(1, state.nativeHeight / state.extractedHeight);
  const skippingFactor = Math.max(skipH, skipV);

  const olpfPenalty = state.olpfPresent ? 0.85 : 1.0;

  const nativePitchMm = (derived.pixelPitch * state.pixelBinning) / 1000;
  const fNyquistNative = (1 / (2 * nativePitchMm)) * olpfPenalty;

  const skippedPitchMm = derived.effectivePixelPitch / 1000;
  const fNyquistSkipped = (1 / (2 * skippedPitchMm)) * olpfPenalty;

  let formatEfficiency = 1.0;
  if (state.outputFormat === 'mjpg') {
    formatEfficiency = 0.4 + 0.6 * (state.mjpgQuality / 100);
  }
  if (state.measurementMode === 'chroma') {
    if (state.outputFormat === 'uyuv') {
      formatEfficiency *= 0.5;
    } else {
      formatEfficiency *= 0.25;
    }
  }

  const v = getTemporalVelocity();
  const shutterTime = getShutterTime();
  const vImg = v * state.focalLength / Math.max(0.1, state.distanceToSubject);
  const fTemporal50 = vImg > 1e-6 ? 0.603 / (vImg * shutterTime) : Infinity;

  const limitingFrequency = Math.min(fcAberrated, fNyquistSkipped, fTemporal50);
  const fEffective = limitingFrequency * formatEfficiency;
  const minFeatureSize = (1 / (2 * fEffective)) * 1000;

  const featureSizeAtDistance =
    (1 / (2 * fEffective) / state.focalLength) * (state.distanceToSubject * 1000);

  let bottleneckType: BottleneckType = 'balanced';
  if (formatEfficiency < 0.85 && state.outputFormat === 'mjpg') {
    bottleneckType = 'compression-throttled';
  }
  if (fNyquistSkipped < fcAberrated * 0.85) {
    bottleneckType = 'sensor-limited';
  } else if (fcAberrated < fNyquistSkipped * 0.85) {
    bottleneckType = 'lens-limited';
  }
  if (fTemporal50 < fcAberrated * 0.85 && fTemporal50 < fNyquistSkipped * 0.85) {
    bottleneckType = 'motion-limited';
  }

  return {
    fc,
    fcAberrated,
    fNyquistNative,
    fNyquistSkipped,
    skippingFactor,
    olpfPenalty,
    formatEfficiency,
    fEffective,
    fTemporal50,
    bottleneckType,
    minFeatureSize,
    featureSizeAtDistance,
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
