export type OutputFormat = 'uyuv' | 'nv12' | 'mjpg' | 'h264' | 'raw8' | 'raw10';
export type BottleneckType = 'lens-limited' | 'sensor-limited' | 'compression-throttled' | 'motion-limited' | 'dr-limited' | 'sync-limited' | 'photon-starved' | 'balanced';
export type LensTier = 'cheap-plastic' | 'mid-glass' | 'premium-stack';
export type MeasurementMode = 'monochrome' | 'colour';
export type ShutterType = 'rolling' | 'global';
export type ReadoutMethod = 'native' | 'cropping' | 'binning' | 'subsampling';
export type PresetName = 'pi-cam-v1' | 'pi-cam-v2' | 'pi-hq-cam' | 'ov9281-module' | 'custom';

export interface SensorRadiometry {
  qePercent: number;
  fullWellCapacity: number;
  readNoiseE: number;
  darkCurrentE: number;
  conversionGainUvPerE: number;
  adcBits: number;
  readoutTimeUs: number;
  cfaFactor: number;
  hasDualCG: boolean;
  hcgReadNoiseE?: number;
}

export interface ExposureOptimization {
  illuminanceSensorLux: number;
  photonsPerPxPerSec: number;
  electronsPerPxPerSec: number;
  tMinusSnr: number;
  tMotionMax: number;
  tSaturation: number;
  tOptimal: number;
  optimalGain: number;
  optimalFps: number;
  snrAtOptimalDb: number;
  photonStarved: boolean;
  signalPercentFwc: number;
  headroomStops: number;
}

export interface AppState {
  focalLength: number;
  diagonalFov: number;
  aperture: number;
  wavelength: number;
  pixelPitch: number;
  nativeWidth: number;
  nativeHeight: number;
  olpfPresent: boolean;
  extractedWidth: number;
  extractedHeight: number;
  outputFormat: OutputFormat;
  mjpgQuality: number;
  h264Qp: number;
  h264BitrateMbps: number;
  measurementMode: MeasurementMode;
  selectedV4l2Mode: number;
  readoutMethod: ReadoutMethod;
  readoutPitchMultiplier: number;
  readoutFullFoV: boolean;
  lensTier: LensTier;
  shutterType: ShutterType;
  distanceToSubject: number;
  dynamicRangeDb: number;
  luxAtSubject: number;
  subjectReflectance: number;
  desiredSnrDb: number;
  temperatureC: number;
  lensTransmission: number;
  gain: number;
}

export interface DerivedState {
  sensorDiagonal: number;
  sensorWidth: number;
  sensorHeight: number;
  pixelPitch: number;
  effectivePixelPitch: number;
  skippingFactor: number;
  diagonalFov: number;
  horizontalFov: number;
  verticalFov: number;
}

export interface Results {
  fc: number;
  fcAberrated: number;
  fNyquistNative: number;
  fNyquistSkipped: number;
  skippingFactor: number;
  olpfPenalty: number;
  formatEfficiency: number;
  fEffective: number;
  fTemporal50: number;
  bottleneckType: BottleneckType;
  minFeatureSize: number;
  featureSizeAtDistance: number;
  fDRLimited: number;
  contrastFloor: number;
  fSyncMTF50: number;
  syncErrorP95: number;
  exposure: ExposureOptimization;
}

export interface AppStateFull {
  state: AppState;
  activePreset: PresetName;
  activeSensorPreset: string;
  activeLensPreset: string;
  derived: DerivedState;
  results: Results;
}

export interface MotionParams {
  linearVelocity: number;
  acceleration: number;
  angularVelocity: number;
  subjectHalfWidth: number;
}

export interface Preset {
  name: PresetName;
  label: string;
  values: Partial<AppState>;
}
