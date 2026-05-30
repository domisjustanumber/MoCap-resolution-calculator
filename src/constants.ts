import type { AppState, OutputFormat, SensorRadiometry } from './types';

export const WAVELENGTH_PRESETS: Array<{
  label: string;
  nm: number;
  color: string;
  textColor: string;
}> = [
  { label: '470 nm (Blue)', nm: 470, color: '#3b82f6', textColor: '#bfdbfe' },
  { label: '550 nm (Green)', nm: 550, color: '#22c55e', textColor: '#bbf7d0' },
  { label: '650 nm (Red)', nm: 650, color: '#ef4444', textColor: '#fecaca' },
  { label: '850 nm (NIR)', nm: 850, color: '#dc2626', textColor: '#fecaca' },
  { label: '940 nm (NIR)', nm: 940, color: '#991b1b', textColor: '#fecaca' },
];

export function wavelengthLabel(nm: number): string {
  if (nm <= 450) return 'Violet';
  if (nm <= 495) return 'Blue';
  if (nm <= 570) return 'Green';
  if (nm <= 590) return 'Yellow';
  if (nm <= 620) return 'Orange';
  if (nm <= 750) return 'Red';
  if (nm <= 1400) return 'Near IR';
  if (nm <= 3000) return 'Short-Wave IR';
  return 'LWIR / MWIR';
}

export function wavelengthColor(nm: number): string {
  if (nm <= 450) return '#8b5cf6';
  if (nm <= 495) return '#3b82f6';
  if (nm <= 570) return '#22c55e';
  if (nm <= 590) return '#eab308';
  if (nm <= 620) return '#f97316';
  if (nm <= 750) return '#ef4444';
  return '#dc2626';
}

export const WAVELENGTH_MIN = 380;
export const WAVELENGTH_MAX = 2500;
export const APERTURE_MIN = 1.0;
export const APERTURE_MAX = 32;
export const MJPG_BLOCK_SIZE_PX = 8;
export const H264_MB_SIZE_PX = 16;
export const H264_QP_MIN = 0;
export const H264_QP_MAX = 51;
export const H264_BITRATE_MIN_MBPS = 0.5;
export const H264_BITRATE_MAX_MBPS = 50;
export const H264_BITRATE_REF_BPP = 0.25;

export const RAW_FORMATS: readonly OutputFormat[] = ['raw8', 'raw10'];

// Engine computation constants
export const OLPF_PENALTY = 0.85;
export const MOTION_MTF50_CONST = 0.603;
export const MOTION_SYNC_MTF50_CONST = 0.1874;
export const FORMAT_EFFICIENCY_MJPG_BASE = 0.4;
export const FORMAT_EFFICIENCY_MJPG_RANGE = 0.6;
export const FORMAT_EFFICIENCY_H264_BASE = 0.30;
export const FORMAT_EFFICIENCY_H264_RANGE = 0.70;
export const CHROMA_UYVY_PENALTY = 0.5;
export const CHROMA_OTHER_PENALTY = 0.25;
export const CHROMA_UYVY_SNR_DB = 3;
export const CHROMA_OTHER_SNR_DB = 6;
export const BOTTLENECK_RATIO = 0.85;

export const PHOTONS_PER_UM2_PER_LUX_SEC = 4130;
export const DEFAULT_LENS_TRANSMISSION = 0.85;
export const DEFAULT_REFLECTANCE = 0.18;
export const DEFAULT_SNR_TARGET_DB = 32;
export const DEFAULT_TEMPERATURE_C = 25;
export const DARK_CURRENT_DOUBLING_C = 6;
export const DEFAULT_LUX_SUBJECT = 100;
export const EXPOSURE_HEADROOM_FACTOR = 0.8;
export const FWC_TARGET_FILL = 0.5;
export const GAIN_MIN = 1.0;
export const GAIN_MAX = 8.0;
export const TEMP_MIN_C = -20;
export const TEMP_MAX_C = 70;
export const LUX_MIN = 0.01;
export const LUX_MAX = 110000;
export const SNR_DB_MIN = 5;
export const SNR_DB_MAX = 50;
export const DEFAULT_SNR_UNDERSHOOT_PCT = 10;
export const MOTION_UNDERSHOOT_IMPROVEMENT_PCT = 20;
export const MOTION_VELOCITY_MAX = 20;
export const MOTION_ACCEL_MAX = 20;
export const MOTION_ANGULAR_VELOCITY_MAX = 360;
/** ChArUco square edge length ≈ min resolvable feature × this ratio (8×8 grid marker). */
export const CHARUCO_SQUARE_TO_MIN_FEATURE = 8.8;

export function chromaFormatEfficiencyPenalty(state: Readonly<AppState>): number {
  if (state.measurementMode === 'colour' && !(RAW_FORMATS as readonly string[]).includes(state.outputFormat)) {
    return state.outputFormat === 'uyuv' ? CHROMA_UYVY_PENALTY : CHROMA_OTHER_PENALTY;
  }
  return 1;
}

export function chromaSnrPenaltyDb(state: Readonly<AppState>): number {
  if (state.measurementMode === 'colour' && !(RAW_FORMATS as readonly string[]).includes(state.outputFormat)) {
    return state.outputFormat === 'uyuv' ? CHROMA_UYVY_SNR_DB : CHROMA_OTHER_SNR_DB;
  }
  return 0;
}

export const LENS_TIER_DR: Record<string, number> = {
  'cheap-plastic': 59,
  'mid-glass': 66,
  'premium-stack': 90,
};

export function clamped(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampStep(value: number, min: number, max: number, step: number): number {
  let v = Math.max(min, Math.min(max, value));
  if (step > 0) v = Math.round(v / step) * step;
  return Math.max(min, Math.min(max, v));
}

export function darkCurrentAtTemp(dc25: number, tempC: number): number {
  return dc25 * Math.pow(2, (tempC - 25) / DARK_CURRENT_DOUBLING_C);
}

export const DEFAULT_RADIOMETRY: SensorRadiometry = {
  qePercent: 60,
  fullWellCapacity: 5000,
  readNoiseE: 4.0,
  darkCurrentE: 20,
  conversionGainUvPerE: 100,
  adcBits: 12,
  readoutTimeUs: 25,
  cfaFactor: 0.55,
  hasDualCG: false,
};
