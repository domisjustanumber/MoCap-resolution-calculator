import type { CameraPreset } from './types';

import ov5647Raw from './cameras/pi-cam-v1.json';
import imx219Raw from './cameras/pi-cam-v2.json';
import imx477Raw from './cameras/pi-hq-cam.json';
import ov9281Raw from './cameras/ov9281-module.json';

function loadCamera(raw: unknown): CameraPreset {
  return raw as CameraPreset;
}

const cameras: CameraPreset[] = [
  loadCamera(ov5647Raw),
  loadCamera(imx219Raw),
  loadCamera(imx477Raw),
  loadCamera(ov9281Raw),
];

export const CAMERA_PRESETS: CameraPreset[] = cameras;

export const CAMERA_PRESET_MAP: Record<string, CameraPreset> = Object.fromEntries(
  cameras.map((c) => [c.name, c]),
);

export function findCameraPreset(name: string): CameraPreset | undefined {
  return CAMERA_PRESET_MAP[name];
}

/** Backward-compatible array for code that references PRESETS directly. */
export const PRESETS = cameras.map((c) => ({
  name: c.name,
  label: c.label,
  values: {} as Partial<import('../src/types').AppState>,
}));

export function findPreset(name: string): (typeof PRESETS)[number] | undefined {
  return PRESETS.find((p) => p.name === name);
}
