import type { Preset } from './types';

export const PRESETS: Preset[] = [
  {
    name: 'ov5647',
    label: 'Pi Cam v1 (OV5647)',
    values: {
      pixelPitch: 1.4,
      nativeWidth: 2592,
      nativeHeight: 1944,
      focalLength: 3.60,
      aperture: 2.0,
      olpfPresent: true,
      lensTier: 'cheap-plastic',
    },
  },
  {
    name: 'imx219',
    label: 'Pi Cam v2 (IMX219)',
    values: {
      pixelPitch: 1.12,
      nativeWidth: 3280,
      nativeHeight: 2464,
      focalLength: 3.04,
      aperture: 2.0,
      olpfPresent: true,
      lensTier: 'cheap-plastic',
    },
  },
  {
    name: 'imx477',
    label: 'Pi HQ Cam (IMX477)',
    values: {
      pixelPitch: 1.55,
      nativeWidth: 4056,
      nativeHeight: 3040,
      focalLength: 6.0,
      aperture: 2.8,
      olpfPresent: false,
      pixelBinning: 1,
      extractedWidth: 4056,
      extractedHeight: 3040,
      outputFormat: 'nv12',
      measurementMode: 'luma',
      lensTier: 'mid-glass',
    },
  },
  {
    name: 'ov9281',
    label: 'OV9281 Module',
    values: {
      pixelPitch: 3.0,
      nativeWidth: 1280,
      nativeHeight: 800,
      focalLength: 2.8,
      diagonalFov: 82,
      aperture: 2.8,
      olpfPresent: true,
      pixelBinning: 1,
      extractedWidth: 1280,
      extractedHeight: 800,
      outputFormat: 'mjpg',
      mjpgQuality: 60,
      measurementMode: 'luma',
      lensTier: 'cheap-plastic',
    },
  },
];

export function findPreset(name: string): Preset | undefined {
  return PRESETS.find((p) => p.name === name);
}
