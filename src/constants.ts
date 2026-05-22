import type { OutputFormat } from './types';

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

export const FORMAT_LABELS: Record<OutputFormat, string> = {
  uyuv: 'UYVY (YUV 4:2:2)',
  nv12: 'NV12 (YUV 4:2:0)',
  mjpg: 'MJPG (Motion JPEG)',
  raw8: 'RAW8 (Bayer 8-bit)',
  raw10: 'RAW10 (Bayer 10-bit)',
};

export const SUBSAMPLING_LABELS: Record<string, string> = {
  'line-skip': 'Line Skip',
  'binning-average': 'Binning / Averaging',
};

export const VISIBLE_MAX_NM = 780;
export const WAVELENGTH_MIN = 380;
export const WAVELENGTH_MAX = 2500;
export const APERTURE_MIN = 1.0;
export const APERTURE_MAX = 32;
export const SENSOR_DENOMINATOR_MIN = 0.1;
export const MJPG_BLOCK_SIZE_PX = 8;

export const RAW_FORMATS: readonly OutputFormat[] = ['raw8', 'raw10'];

// Engine computation constants
export const OLPF_PENALTY = 0.85;
export const MOTION_MTF50_CONST = 0.603;
export const FORMAT_EFFICIENCY_MJPG_BASE = 0.4;
export const FORMAT_EFFICIENCY_MJPG_RANGE = 0.6;
export const CHROMA_UYVY_PENALTY = 0.5;
export const CHROMA_OTHER_PENALTY = 0.25;
export const BOTTLENECK_RATIO = 0.85;
export const BINNING_VALUES = [1, 2, 4] as const;
