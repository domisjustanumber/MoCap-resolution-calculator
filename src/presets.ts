import type { Preset } from './types';

export const PRESETS: Preset[] = [
  {
    name: 'cheap-webcam',
    label: 'Cheap Webcam',
    values: {
      focalLength: 3.6,
      aperture: 2.4,
      wavelength: 550,
      pixelPitch: 2.4,
      nativeWidth: 1920,
      nativeHeight: 1080,
      olpfPresent: true,
      pixelBinning: 1,
      extractedWidth: 640,
      extractedHeight: 480,
      outputFormat: 'mjpg',
      mjpgQuality: 60,
      subsamplingMethod: 'line-skip',
      measurementMode: 'luma',
      lensTier: 'cheap-plastic',

    },
  },
  {
    name: 'flagship-smartphone',
    label: 'Flagship Smartphone',
    values: {
      focalLength: 6.0,
      aperture: 1.8,
      wavelength: 550,
      pixelPitch: 2.5,
      nativeWidth: 4080,
      nativeHeight: 3060,
      olpfPresent: false,
      pixelBinning: 4,
      extractedWidth: 4080,
      extractedHeight: 3060,
      outputFormat: 'nv12',
      mjpgQuality: 60,
      subsamplingMethod: 'binning-average',
      measurementMode: 'luma',
      lensTier: 'premium-stack',
    },
  },
  {
    name: 'machine-vision',
    label: 'Machine Vision',
    values: {
      focalLength: 8.0,
      aperture: 4.0,
      wavelength: 550,
      pixelPitch: 2.9,
      nativeWidth: 2448,
      nativeHeight: 1836,
      olpfPresent: false,
      pixelBinning: 1,
      extractedWidth: 2448,
      extractedHeight: 1836,
      outputFormat: 'uyuv',
      mjpgQuality: 60,
      subsamplingMethod: 'binning-average',
      measurementMode: 'luma',
      lensTier: 'premium-stack',
    },
  },
];

export function findPreset(name: string): Preset | undefined {
  return PRESETS.find((p) => p.name === name);
}
