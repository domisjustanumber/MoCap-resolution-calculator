export type OutputFormat = 'uyuv' | 'nv12' | 'mjpg';
export type BottleneckType = 'lens-limited' | 'sensor-limited' | 'compression-throttled' | 'balanced';
export type LensTier = 'cheap-plastic' | 'mid-glass' | 'premium-stack';
export type MeasurementMode = 'luma' | 'chroma';
export type SubsamplingMethod = 'line-skip' | 'binning-average';
export type PresetName = 'cheap-webcam' | 'flagship-smartphone' | 'machine-vision' | 'custom';

export interface AppState {
  focalLength: number;
  diagonalFov: number;
  aperture: number;
  wavelength: number;
  pixelPitch: number;
  nativeWidth: number;
  nativeHeight: number;
  olpfPresent: boolean;
  pixelBinning: number;
  extractedWidth: number;
  extractedHeight: number;
  outputFormat: OutputFormat;
  mjpgQuality: number;
  subsamplingMethod: SubsamplingMethod;
  measurementMode: MeasurementMode;
  lensTier: LensTier;
  distanceToSubject: number;
}

export interface DerivedState {
  sensorDiagonal: number;
  sensorWidth: number;
  sensorHeight: number;
  pixelPitch: number;
  effectivePixelPitch: number;
  diagonalFov: number;
  horizontalFov: number;
  verticalFov: number;
}

export interface Results {
  fc: number;
  fNyquistNative: number;
  fNyquistSkipped: number;
  skippingFactor: number;
  olpfPenalty: number;
  formatEfficiency: number;
  fEffective: number;
  bottleneckType: BottleneckType;
  minFeatureSize: number;
  featureSizeAtDistance: number;
}

export interface AppStateFull {
  state: AppState;
  activePreset: PresetName;
  derived: DerivedState;
  results: Results;
}

export interface Preset {
  name: PresetName;
  label: string;
  values: Partial<AppState>;
}
