import type { LensTier, SensorRadiometry } from '../src/types';

/** How a V4L2 mode achieves its output resolution. */
export type ReadoutType =
  | 'native'
  | 'binning'
  | 'subsampling'
  | 'cropping'
  | 'binning+cropping'
  | 'subsampling+cropping'
  | 'subsampling+binning';

/** A single V4L2 output mode with readout metadata. */
export interface V4l2Mode {
  width: number;
  height: number;
  maxFps: number;
  pixelRateIndex: number;
  hts: number;
  vts: number;
  readoutType?: ReadoutType;
  pitchMultiplier?: number;
  fullFoV?: boolean;
}

/** V4L2 driver configuration for a sensor, extracted from the Linux kernel driver. */
export interface V4l2Config {
  /** Chip identifier from the driver (e.g. 0x0219) */
  chipId: number;
  /** Full sensor die size including border/optical-black pixels */
  nativeSize: { width: number; height: number };
  /** Active pixel array (usable area) */
  activeArray: { left: number; top: number; width: number; height: number };
  /** Pixel clock rates in Hz (one per supported mode) */
  pixelRates: number[];
  /** MIPI CSI-2 link frequencies in Hz */
  linkFreqs: number[];
  /** Number of MIPI data lanes */
  mipiLanes: number;
  /** External clock frequency in Hz */
  xclk: number;
  /** Supported media bus format codes */
  busFormats: string[];
  /** Regulator supply names */
  supplies: string[];
  /** Supported output modes (resolution + max fps at default timing) */
  modes: Array<V4l2Mode>;
  /** Exposure line limits */
  exposure: { min: number; max: number; step: number; default: number };
  /** Analogue gain limits */
  analogueGain: { min: number; max: number; step: number; default: number };
  /** Digital gain limits (if supported) */
  digitalGain?: { min: number; max: number; step: number; default: number };
  /** Horizontal blanking (pixels) */
  hblank: { min: number; max: number; default: number };
  /** Vertical blanking (lines) */
  vblank: { min: number; max: number; default: number };
}

/** A camera preset selects a sensor + lens bundle. */
export interface CameraPreset {
  /** Unique identifier (e.g. "pi-cam-v2") */
  name: string;
  /** Human-readable label (e.g. "Pi Cam v2 (IMX219)") */
  label: string;
  /** Name of the sensor preset this camera uses */
  sensorName: string;
  /** Name of the lens preset this camera uses */
  lensName: string;
}

/** A lens preset defines the optical quality tier and its parameters. */
export interface LensPreset {
  /** Unique identifier (e.g. "cheap-plastic") */
  name: string;
  /** Human-readable label (e.g. "Cheap Plastic") */
  label: string;
  /** The lens tier string stored in AppState.lensTier */
  tier: LensTier;
  /**
   * MTF quality scalar from 0 to 1.
   * Applied as a multiplier to the diffraction-limited cutoff frequency.
   *   0.6  = cheap plastic
   *   0.8  = mid-range glass
   *   0.95 = premium stacked lens
   */
  qualityScalar: number;
  /** Focal length in mm */
  focalLength: number;
  /** Aperture (f-number) */
  aperture: number;
}

/** A sensor preset defines the physical sensor geometry and radiometric characteristics. */
export interface SensorPreset {
  /** Unique identifier (e.g. "imx219") */
  name: string;
  /** Human-readable label (e.g. "Sony IMX219") */
  label: string;
  /** Pixel pitch in micrometres (µm) */
  pixelPitch: number;
  /** Native pixel width (columns) */
  nativeWidth: number;
  /** Native pixel height (rows) */
  nativeHeight: number;
  /** Whether the sensor module has an Optical Low-Pass Filter (anti-aliasing) */
  olpfPresent: boolean;
  /** Sensor dynamic range in dB */
  dynamicRangeDb: number;
  /** Radiometric characteristics used by the exposure optimizer */
  radiometry: SensorRadiometry;
  /** V4L2 driver configuration from the Linux kernel */
  v4l2: V4l2Config;
}
