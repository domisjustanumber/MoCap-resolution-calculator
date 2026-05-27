import type { SensorRadiometry } from '../src/types';
import type { SensorPreset, V4l2Config, SensorColourVariant } from './types';

import ov5647Raw from './sensors/ov5647.json';
import imx219Raw from './sensors/imx219.json';
import imx477Raw from './sensors/imx477.json';
import ov9281Raw from './sensors/ov9281.json';

const sensors: Record<string, SensorPreset> = {
  ov5647: ov5647Raw as SensorPreset,
  imx219: imx219Raw as SensorPreset,
  imx477: imx477Raw as SensorPreset,
  ov9281: ov9281Raw as SensorPreset,
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
  colourVariant: SensorColourVariant;
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
    colourVariant: v.colourVariant,
    v4l2: v.v4l2,
    shutterType: v.shutterType,
  }]),
);
