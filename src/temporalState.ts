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
let phaseOffset = 16.6;
let jitterMs = 10.0;
let errorBudgetMm = 5;
let snrUndershootPct = DEFAULT_SNR_UNDERSHOOT_PCT;
let syncToggle = false;
let maxFps = 240;
let maxShutterDenom = 8000;
let regionHz = 50;

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

let temporalDistance = 2;

export function getTemporalDistance(): number { return temporalDistance; }
export function setTemporalDistance(m: number): void {
  temporalDistance = clamped(m, 0.5, 20);
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
}

export function setTemporalPhase(ms: number): void {
  phaseOffset = clamped(ms, 0, 300);
}

export function setTemporalJitter(ms: number): void {
  jitterMs = clamped(ms, 0, 300);
}

export function setTemporalZoom(max: number): void {
  zoomMax = clamped(Math.round(max), 10, 500);
}

export function setFrameRate(fps: number): void {
  frameRate = clamped(Math.round(fps), 1, maxFps);
  if (shutterDenom < frameRate) {
    shutterDenom = snapShutterToRegion(frameRate, regionHz, frameRate, maxShutterDenom, 'ceil');
  }
}

export function setShutterDenom(d: number): void {
  shutterDenom = clamped(Math.round(d), frameRate, maxShutterDenom);
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
}

export function setMaxFpsLimit(max: number): void { maxFps = max; }
export function setMaxShutterLimit(max: number): void { maxShutterDenom = max; }

let temporalCameraCount = 3;

export function getTemporalObjectRadius(): number { return 0.5; }
export function getTemporalCameraCount(): number { return temporalCameraCount; }
export function setTemporalCameraCount(n: number): void {
  temporalCameraCount = clamped(Math.round(n), 1, 6);
}
export function getTemporalVelocity(): number { return targetVelocity; }

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

// Velocity direction in XZ plane (unit vector)
let velocityDirX = 1;
let velocityDirZ = 0;

export function getVelocityDirXZ(): { x: number; z: number } {
  return { x: velocityDirX, z: velocityDirZ };
}

export function setVelocityDirXZ(x: number, z: number): void {
  const len = Math.sqrt(x * x + z * z);
  if (len < 1e-6) { velocityDirX = 1; velocityDirZ = 0; }
  else { velocityDirX = x / len; velocityDirZ = z / len; }
}

const SAMPLE_SIZE = 2500;

interface SimResult {
  maxErrors: Float32Array;
  rmseErrors: Float32Array;
}

function gaussRandom(): number {
  const u1 = 1.0 - Math.random();
  const u2 = 1.0 - Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function makeSimHash(): string {
  return [
    targetVelocity, frameRate, phaseOffset, jitterMs, temporalCameraCount,
    velocityDirX.toFixed(3), velocityDirZ.toFixed(3), temporalDistance,
  ].join('|');
}

function runSimulation(): SimResult {
  const fps = frameRate;
  const phaseMs = phaseOffset;
  const jitMs = jitterMs;
  const frameTimeMs = 1000 / fps;
  const v_mm_ms = targetVelocity;
  const count = temporalCameraCount;
  const angles = getCameraAngles(count);

  // Precompute tangential sensitivity factor for each camera angle
  // Camera at angle θ has view direction toward origin; its tangential
  // (image-plane) direction in XZ is (cos θ, sin θ). The component of
  // subject velocity visible as lateral motion is |vel_dir · tang_dir|.
  const tangFactors = angles.map(deg => {
    const rad = (deg * Math.PI) / 180;
    return Math.abs(velocityDirX * Math.cos(rad) + velocityDirZ * Math.sin(rad));
  });

  // phaseMs = total spread between first and last camera
  const stepMs = count > 1 ? phaseMs / (count - 1) : 0;

  const maxErrors = new Float32Array(SAMPLE_SIZE);
  const rmseErrors = new Float32Array(SAMPLE_SIZE);

  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const basePhase = Math.random() * frameTimeMs;
    // Generate independent timing signal for each camera
    const times: number[] = [];
    for (let c = 0; c < count; c++) {
      times.push(basePhase + c * stepMs + gaussRandom() * jitMs);
    }

    // Max spatial error across all camera pairs, weighted by angular sensitivity
    // and inversely proportional to camera distance
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
  }

  return { maxErrors, rmseErrors };
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
let cachedMaxStats: { avg: number; median: number; p95: number } | null = null;

export function getCachedMaxErrors(): Float32Array | null { return cachedMaxErrors; }
export function getCachedRmseErrors(): Float32Array | null { return cachedRmseErrors; }

export function runAndCacheSimulation(): void {
  const inputHash = makeSimHash();
  if (inputHash === simHash && cachedMaxErrors) return;
  simHash = inputHash;
  const { maxErrors, rmseErrors } = runSimulation();
  cachedMaxErrors = maxErrors;
  cachedRmseErrors = rmseErrors;
  cachedMaxStats = computeStats(maxErrors);
}

export function getSyncErrorP95(): number {
  runAndCacheSimulation();
  return cachedMaxStats!.p95;
}

export function getSyncInputsHash(): string {
  return makeSimHash();
}
