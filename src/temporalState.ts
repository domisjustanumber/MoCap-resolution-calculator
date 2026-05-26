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

const SAMPLE_SIZE = 2500;

interface SimResult {
  maxErrors: Float32Array;
  rmseErrors: Float32Array;
}

function makeSimHash(): string {
  return String(targetVelocity) + String(frameRate) + String(phaseOffset) + String(jitterMs);
}

function runSimulation(): SimResult {
  const fps = frameRate;
  const phaseMs = phaseOffset;
  const jitMs = jitterMs;
  const frameTimeMs = 1000 / fps;
  const v_mm_ms = targetVelocity;

  const maxErrors = new Float32Array(SAMPLE_SIZE);
  const rmseErrors = new Float32Array(SAMPLE_SIZE);

  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const basePhase = Math.random() * frameTimeMs;
    const u1 = 1.0 - Math.random();
    const u2 = 1.0 - Math.random();
    const randGen = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const cam1Time = basePhase;
    const cam2Time = basePhase + phaseMs + randGen * jitMs;
    const deltaT = Math.abs(cam1Time - cam2Time);
    const spatialError = deltaT * v_mm_ms;
    maxErrors[i] = spatialError;
    rmseErrors[i] = spatialError / Math.sqrt(2);
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
