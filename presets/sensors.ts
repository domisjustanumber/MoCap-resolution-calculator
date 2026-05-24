import type { SensorRadiometry } from '../src/types';
import type { SensorPreset, V4l2Config } from './types';

import ov5647Raw from './sensors/ov5647.json';
import imx219Raw from './sensors/imx219.json';
import imx477Raw from './sensors/imx477.json';
import ov9281Raw from './sensors/ov9281.json';

function loadSensor(raw: unknown): SensorPreset {
  const d = raw as SensorPreset;
  return d;
}

const sensors: Record<string, SensorPreset> = {
  ov5647: loadSensor(ov5647Raw),
  imx219: loadSensor(imx219Raw),
  imx477: loadSensor(imx477Raw),
  ov9281: loadSensor(ov9281Raw),
};

export const SENSOR_PRESETS = sensors;

export const SENSOR_RADIOMETRY: Record<string, SensorRadiometry> = Object.fromEntries(
  Object.entries(sensors).map(([k, v]) => [k, v.radiometry]),
);

export interface SensorGeometry {
  pixelPitch: number;
  nativeWidth: number;
  nativeHeight: number;
  olpfPresent: boolean;
  dynamicRangeDb: number;
  v4l2?: V4l2Config;
  shutterType: 'rolling' | 'global';
}

export const SENSOR_GEOMETRY: Record<string, SensorGeometry> = Object.fromEntries(
  Object.entries(sensors).map(([k, v]) => [k, {
    pixelPitch: v.pixelPitch,
    nativeWidth: v.nativeWidth,
    nativeHeight: v.nativeHeight,
    olpfPresent: v.olpfPresent,
    dynamicRangeDb: v.dynamicRangeDb,
    v4l2: v.v4l2,
    shutterType: v.shutterType,
  }]),
);
