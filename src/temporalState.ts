import type { MotionParams } from './types';
import { snapFpsToRegion, snapShutterToRegion } from './temporalQuantize';
import { DEFAULT_SNR_UNDERSHOOT_PCT, clamped } from './constants';

let motionParams: MotionParams = {
  linearVelocity: 1.5,
  acceleration: 0,
  angularVelocity: 0,
  subjectHalfWidth: 0.5,
};

let zoomMax = 200;
let targetVelocity = 0;
let frameRate = 30;
let shutterDenom = 60;
let phaseOffset = 33.3;       // 1 frame at 30fps = 33.3ms
let jitterValueMs = 33.3;    // 1 frame at 30fps = 33.3ms
let phaseFrames = 0;         // display value when in frames mode
let jitterFrames = 0;
let errorBudgetMm = 5;
let snrUndershootPct = DEFAULT_SNR_UNDERSHOOT_PCT;
let syncToggle = false;
let maxFps = 240;
let maxShutterDenom = 8000;
let regionHz = 50;
let temporalDistance = 2; // meters
let cameraHeight = 0;
let objectSizeMm = 10;
let timingInFrames = true; // true → sliders display in frames; canonical storage is always ms

// Independent temporal copies for unlinked mode
let temporalFrameRate = 30;
let temporalShutterDenom = 60;
let temporalVelocity = 1.5;
let temporalRegionHz = 50;
let linkMode = false;

export function getMotionParams(): MotionParams { return { ...motionParams }; }
export function getFrameRate(): number { return frameRate; }
export function getShutterTime(): number { return 1 / shutterDenom; }
export function getShutterDenom(): number { return shutterDenom; }
export function getErrorBudget(): number { return errorBudgetMm; }
export function getSnrUndershootPct(): number { return snrUndershootPct; }
export function getRegionHz(): number { return regionHz; }
export function getMaxFpsLimit(): number { return maxFps; }
export function getMaxShutterLimit(): number { return maxShutterDenom; }
export function isSyncToggleOn(): boolean { return syncToggle; }
export function getTemporalZoom(): number { return zoomMax; }
export function getTemporalDistance(): number { return temporalDistance; }
export function setTemporalDistance(m: number): void {
  temporalDistance = clamped(m, 0.5, 20);
}

export function getCameraHeight(): number { return cameraHeight; }
export function setCameraHeight(h: number): void {
  cameraHeight = clamped(h, 0, 5);
}

export function getObjectSizeMm(): number { return objectSizeMm; }
export function setObjectSizeMm(mm: number): void {
  objectSizeMm = clamped(Math.round(mm), 1, 100);
  motionParams.subjectHalfWidth = objectSizeMm / 1000;
}

export function isTimingInFrames(): boolean { return timingInFrames; }
export function setTimingInFrames(on: boolean): void { timingInFrames = on; }

// Link mode
export function isLinkMode(): boolean { return linkMode; }
export function setLinkMode(on: boolean): void {
  linkMode = on;
  syncToggle = on;
  if (on) {
    temporalFrameRate = frameRate;
    temporalShutterDenom = shutterDenom;
    temporalVelocity = targetVelocity;
    temporalRegionHz = regionHz;
  }
}

// Effective getters for sync simulation — use temporal copies when unlinked
export function getEffectiveFrameRate(): number {
  return linkMode ? frameRate : temporalFrameRate;
}
export function getEffectiveShutterDenom(): number {
  return linkMode ? shutterDenom : temporalShutterDenom;
}
export function getEffectiveVelocity(): number {
  return linkMode ? targetVelocity : temporalVelocity;
}
export function getEffectiveRegionHz(): number {
  return linkMode ? regionHz : temporalRegionHz;
}

// Temporal-only setters (for sync tab controls in unlinked mode)
export function setTemporalFrameRate(fps: number): void {
  temporalFrameRate = clamped(Math.round(fps), 1, maxFps);
  if (temporalShutterDenom < temporalFrameRate) {
    temporalShutterDenom = snapShutterToRegion(temporalFrameRate, temporalRegionHz, temporalFrameRate, maxShutterDenom, 'ceil');
  }
}
export function setTemporalShutterDenom(d: number): void {
  temporalShutterDenom = snapShutterToRegion(
    Math.round(d),
    temporalRegionHz,
    temporalFrameRate,
    maxShutterDenom,
    'nearest',
  );
}
export function setTemporalRegionHz(hz: number): void {
  temporalRegionHz = hz;
  temporalFrameRate = snapFpsToRegion(temporalFrameRate, hz, maxFps, 'nearest');
  if (temporalShutterDenom < temporalFrameRate) {
    temporalShutterDenom = snapShutterToRegion(temporalFrameRate, hz, temporalFrameRate, maxShutterDenom, 'ceil');
  } else {
    temporalShutterDenom = Math.max(temporalFrameRate, snapShutterToRegion(temporalShutterDenom, hz, temporalFrameRate, maxShutterDenom, 'nearest'));
  }
}
export function setTemporalVelocityOnly(v: number): void {
  temporalVelocity = clamped(v, 0, 20);
}

export function setMotionParams(p: Partial<MotionParams>): void {
  if (p.linearVelocity !== undefined) motionParams.linearVelocity = clamped(p.linearVelocity, 0, 20);
  if (p.acceleration !== undefined) motionParams.acceleration = clamped(p.acceleration, 0, 20);
  if (p.angularVelocity !== undefined) motionParams.angularVelocity = clamped(p.angularVelocity, 0, 360);
  motionParams.subjectHalfWidth = 0.5;
}

export function setLinearVelocity(v: number): void {
  motionParams.linearVelocity = clamped(v, 0, 20);
}

export function setAcceleration(v: number): void {
  motionParams.acceleration = clamped(v, 0, 20);
}

export function setAngularVelocity(v: number): void {
  motionParams.angularVelocity = clamped(v, 0, 360);
}

export function setSubjectHalfWidth(_v: number): void {
  motionParams.subjectHalfWidth = 0.5;
}

export function setSpatialVelocity(v: number): void {
  motionParams.linearVelocity = clamped(v, 0, 20);
}

export function setTemporalVelocity(v: number): void {
  targetVelocity = clamped(v, 0, 20);
  if (linkMode) temporalVelocity = targetVelocity;
}

export function getTemporalPhase(): number { return phaseOffset; }
export function setTemporalPhase(ms: number): void {
  phaseOffset = clamped(ms, 0, 300);
}

export function getTemporalJitter(): number { return jitterValueMs; }
export function setTemporalJitter(ms: number): void {
  jitterValueMs = clamped(ms, 0, 300);
}

export function getPhaseFrames(): number { return phaseFrames; }
export function getJitterFrames(): number { return jitterFrames; }
export function setPhaseFrames(f: number): void {
  phaseFrames = clamped(f, 0, 3);
}
export function setJitterFrames(f: number): void {
  jitterFrames = clamped(f, 0, 3);
}

export function setTemporalZoom(max: number): void {
  zoomMax = clamped(Math.round(max), 10, 500);
}

export function setFrameRate(fps: number): void {
  frameRate = clamped(Math.round(fps), 1, maxFps);
  if (shutterDenom < frameRate) {
    shutterDenom = snapShutterToRegion(frameRate, regionHz, frameRate, maxShutterDenom, 'ceil');
    if (linkMode) temporalShutterDenom = shutterDenom;
  }
  if (linkMode) temporalFrameRate = frameRate;
}

export function setShutterDenom(d: number): void {
  shutterDenom = snapShutterToRegion(
    Math.round(d),
    regionHz,
    frameRate,
    maxShutterDenom,
    'nearest',
  );
  if (linkMode) temporalShutterDenom = shutterDenom;
}

export function setErrorBudget(mm: number): void {
  errorBudgetMm = clamped(mm, 0.5, 25);
}

export function setSnrUndershootPct(pct: number): void {
  snrUndershootPct = clamped(pct, 0, 50);
}

export function setSyncToggle(on: boolean): void {
  syncToggle = on;
}

export function setRegionHz(hz: number): void {
  regionHz = hz;
  frameRate = snapFpsToRegion(frameRate, hz, maxFps, 'nearest');
  if (shutterDenom < frameRate) {
    shutterDenom = snapShutterToRegion(frameRate, hz, frameRate, maxShutterDenom, 'ceil');
  } else {
    shutterDenom = Math.max(frameRate, snapShutterToRegion(shutterDenom, hz, frameRate, maxShutterDenom, 'nearest'));
  }
  if (linkMode) {
    temporalRegionHz = hz;
    temporalFrameRate = frameRate;
    temporalShutterDenom = shutterDenom;
  }
}

export function setMaxFpsLimit(max: number): void { maxFps = max; }
export function setMaxShutterLimit(max: number): void { maxShutterDenom = max; }

let temporalCameraCount = 3;

export function getTemporalObjectRadius(): number { return 0.5; }
export function getTemporalCameraCount(): number { return temporalCameraCount; }
export function setTemporalCameraCount(n: number): void {
  temporalCameraCount = clamped(Math.round(n), 1, 6);
}
export function getTemporalVelocity(): number { return getEffectiveVelocity(); }

// Camera placement angles (degrees in XZ plane) for each count
const CAMERA_ANGLES: Record<number, number[]> = {
  1: [0],
  2: [-45, 45],
  3: [-45, 0, 45],
  4: [45, 135, 225, 315],
  5: [0, 45, 135, 225, 315],
  6: [0, 60, 120, 180, 240, 300],
};

export function getCameraAngles(count: number): number[] {
  return CAMERA_ANGLES[count] || [0];
}

// Velocity direction (unit vector)
let velocityDirX = 1;
let velocityDirY = 0;
let velocityDirZ = 0;

export function getVelocityDirXZ(): { x: number; z: number } {
  return { x: velocityDirX, z: velocityDirZ };
}

export function setVelocityDirXZ(x: number, z: number): void {
  const len = Math.sqrt(x * x + z * z);
  if (len < 1e-6) { velocityDirX = 1; velocityDirY = 0; velocityDirZ = 0; }
  else { velocityDirX = x / len; velocityDirY = 0; velocityDirZ = z / len; }
}

export function getVelocityDir3D(): { x: number; y: number; z: number } {
  return { x: velocityDirX, y: velocityDirY, z: velocityDirZ };
}

export function setVelocityDir3D(x: number, y: number, z: number): void {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < 1e-6) { velocityDirX = 1; velocityDirY = 0; velocityDirZ = 0; }
  else { velocityDirX = x / len; velocityDirY = y / len; velocityDirZ = z / len; }
}

const SAMPLE_SIZE = 2500;

interface SimResult {
  maxErrors: Float32Array;
  rmseErrors: Float32Array;
  maxBlurs: Float32Array;
  totalErrors: Float32Array;
}

function gaussRandom(): number {
  const u1 = 1.0 - Math.random();
  const u2 = 1.0 - Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function makeSimHash(): string {
  return [
    getEffectiveVelocity(), getEffectiveFrameRate(), getEffectiveShutterDenom(),
    phaseOffset, jitterValueMs, temporalCameraCount,
    velocityDirX.toFixed(3), velocityDirY.toFixed(3), velocityDirZ.toFixed(3),
    temporalDistance, cameraHeight, objectSizeMm,
  ].join('|');
}

function runSimulation(): SimResult {
  const fps = getEffectiveFrameRate();
  const phaseMs = phaseOffset;
  const jitMs = jitterValueMs;
  const frameTimeMs = 1000 / fps;
  const v_mm_ms = getEffectiveVelocity();
  const count = temporalCameraCount;
  const angles = getCameraAngles(count);
  const shutterTimeMs = 1000 / getEffectiveShutterDenom();

  // Precompute tangential sensitivity factor for each camera angle in 3D.
  // Camera at (D·sinθ, h, -D·cosθ) looks at origin. View elevation reduces
  // the component of horizontal velocity visible as lateral image motion.
  const D = temporalDistance;
  const h = cameraHeight;
  const tangFactors = angles.map(deg => {
    const rad = (deg * Math.PI) / 180;
    const d = Math.sqrt(D * D + h * h);
    const viewX = -Math.sin(rad) * D / d;
    const viewY = -h / d;
    const viewZ = Math.cos(rad) * D / d;
    const dot = velocityDirX * viewX + velocityDirY * viewY + velocityDirZ * viewZ;
    return Math.sqrt(Math.max(0, 1 - dot * dot));
  });

  // phaseMs = total spread between first and last camera
  const stepMs = count > 1 ? phaseMs / (count - 1) : 0;

  const maxErrors = new Float32Array(SAMPLE_SIZE);
  const rmseErrors = new Float32Array(SAMPLE_SIZE);
  const maxBlurs = new Float32Array(SAMPLE_SIZE);
  const totalErrors = new Float32Array(SAMPLE_SIZE);

  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const basePhase = Math.random() * frameTimeMs;
    const times: number[] = [];
    for (let c = 0; c < count; c++) {
      times.push(basePhase + (c - (count - 1) / 2) * stepMs + gaussRandom() * jitMs);
    }

    let maxError = 0;
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        const deltaT = Math.abs(times[a] - times[b]);
        const af = Math.max(tangFactors[a], tangFactors[b]);
        const error = deltaT * v_mm_ms * af / temporalDistance;
        if (error > maxError) maxError = error;
      }
    }
    maxErrors[i] = maxError;
    rmseErrors[i] = maxError / Math.sqrt(2);

    // Motion blur: subject displacement during the exposure window.
    // Each camera sees smear scaled by its tangFactor; worst camera dominates.
    let maxBlur = 0;
    for (let c = 0; c < count; c++) {
      const blur = v_mm_ms * shutterTimeMs * tangFactors[c];
      if (blur > maxBlur) maxBlur = blur;
    }
    maxBlurs[i] = maxBlur;
    // Object physical size is inherent uncertainty — can't locate centroid
    // more precisely than the object's own radius. Added in quadrature.
    totalErrors[i] = Math.sqrt((maxError + maxBlur) ** 2 + objectSizeMm ** 2);
  }

  return { maxErrors, rmseErrors, maxBlurs, totalErrors };
}

export function computeStats(data: Float32Array): { avg: number; median: number; p95: number } {
  const sorted = [...data].sort((a, b) => a - b);
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { avg, median, p95 };
}

let simHash = '';
let cachedMaxErrors: Float32Array | null = null;
let cachedRmseErrors: Float32Array | null = null;
let cachedMaxBlurs: Float32Array | null = null;
let cachedTotalErrors: Float32Array | null = null;
let cachedMaxStats: { avg: number; median: number; p95: number } | null = null;
let cachedTotalStats: { avg: number; median: number; p95: number } | null = null;

export function getCachedMaxErrors(): Float32Array | null { return cachedMaxErrors; }
export function getCachedRmseErrors(): Float32Array | null { return cachedRmseErrors; }
export function getCachedMaxBlurs(): Float32Array | null { return cachedMaxBlurs; }
export function getCachedTotalErrors(): Float32Array | null { return cachedTotalErrors; }

export function runAndCacheSimulation(): void {
  const inputHash = makeSimHash();
  if (inputHash === simHash && cachedMaxErrors) return;
  simHash = inputHash;
  const { maxErrors, rmseErrors, maxBlurs, totalErrors } = runSimulation();
  cachedMaxErrors = maxErrors;
  cachedRmseErrors = rmseErrors;
  cachedMaxBlurs = maxBlurs;
  cachedTotalErrors = totalErrors;
  cachedMaxStats = computeStats(maxErrors);
  cachedTotalStats = computeStats(totalErrors);
}

export function getSyncErrorP95(): number {
  runAndCacheSimulation();
  return cachedMaxStats!.p95;
}

export function getTotalErrorP95(): number {
  runAndCacheSimulation();
  return cachedTotalStats!.p95;
}

export function getSyncInputsHash(): string {
  return makeSimHash();
}
