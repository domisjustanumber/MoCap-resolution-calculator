import type { ExposureOptimization } from './types';
import { EXPOSURE_HEADROOM_FACTOR } from './constants';

export interface TimingValues {
  fps: number;
  shutterDenom: number;
}

/**
 * Max shutter denominator (shortest exposure) to search for SNR, from exposure pass 1.
 * Uses floor — never round — so off-grid rounding cannot drop valid longer exposures.
 * When SNR needs more time than motion allows (tMinusSnr > tCeiling), caps at motion.
 */
export function idealMaxShutterDenomFromExposure(
  exposure: Pick<ExposureOptimization, 'tMinusSnr' | 'tMotionMax' | 'tSaturation'>,
  maxShutterDenom: number,
  headroomFactor = EXPOSURE_HEADROOM_FACTOR,
): number {
  const tSatCap =
    exposure.tSaturation > 0 && isFinite(exposure.tSaturation)
      ? headroomFactor * exposure.tSaturation
      : Infinity;
  const tMotion =
    exposure.tMotionMax > 0 && isFinite(exposure.tMotionMax) ? exposure.tMotionMax : Infinity;
  const tCeiling = Math.min(tSatCap, tMotion);
  const tSnrMin =
    exposure.tMinusSnr > 0 && isFinite(exposure.tMinusSnr) ? exposure.tMinusSnr : 0;

  let tForUpper: number;
  if (tSnrMin > 0 && tSnrMin <= tCeiling) {
    tForUpper = tSnrMin;
  } else if (isFinite(tCeiling) && tCeiling > 0) {
    tForUpper = tCeiling;
  } else {
    return maxShutterDenom;
  }

  return Math.min(maxShutterDenom, Math.max(1, Math.floor(1 / tForUpper)));
}

/** Shutter denominators on the ½× / 1× / 2× / … regional grid. */
export function enumerateRegionShutterDenoms(regionHz: number, maxDenom = 8000): number[] {
  if (regionHz <= 0) return [];
  const denoms: number[] = [regionHz / 2, regionHz];
  for (let v = regionHz * 2; v <= maxDenom; v += regionHz) denoms.push(v);
  return denoms;
}

/** On-grid shutter denominators ≥ minDenom, capped by maxDenom. Empty when region is free. */
export function validShutterDenomsForRegion(
  regionHz: number,
  minDenom: number,
  maxDenom: number,
): number[] {
  if (regionHz <= 0) return [];
  return enumerateRegionShutterDenoms(regionHz, maxDenom).filter((d) => d >= minDenom);
}

/** Index into valid[] whose denom is nearest to denom (exact match preferred). */
export function nearestValidShutterIndex(valid: readonly number[], denom: number): number {
  if (valid.length === 0) return 0;
  const exact = valid.indexOf(denom);
  if (exact >= 0) return exact;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < valid.length; i++) {
    const dist = Math.abs(valid[i] - denom);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Valid region fps values up to maxFps (half-step and multiples). */
export function enumerateRegionFpsValues(maxFps: number, regionHz: number): number[] {
  if (regionHz <= 0 || maxFps < 1) return [];
  const values: number[] = [];
  const half = regionHz / 2;
  if (half >= 1 && half <= maxFps) values.push(half);
  for (let v = regionHz; v <= maxFps; v += regionHz) values.push(v);
  return values;
}

export function isValidRegionFps(fps: number, regionHz: number): boolean {
  if (regionHz <= 0) return Number.isInteger(fps) && fps >= 1;
  return fps === regionHz / 2 || fps % regionHz === 0;
}

export function isValidRegionShutterDenom(denom: number, regionHz: number): boolean {
  if (regionHz <= 0) return Number.isInteger(denom) && denom >= 1;
  return denom === regionHz / 2 || denom % regionHz === 0;
}

export function snapFpsToRegion(
  fps: number,
  regionHz: number,
  maxFps: number,
  mode: 'nearest' | 'ceil' | 'floor' = 'nearest',
): number {
  const rounded = Math.round(fps);
  if (regionHz <= 0) return Math.max(1, Math.min(maxFps, rounded));

  const valid = enumerateRegionFpsValues(maxFps, regionHz);
  if (valid.length === 0) return Math.max(1, Math.min(maxFps, rounded));

  if (mode === 'nearest') {
    return valid.reduce((prev, curr) =>
      Math.abs(curr - fps) < Math.abs(prev - fps) ? curr : prev
    );
  }

  if (mode === 'ceil') {
    const candidates = valid.filter((v) => v >= fps);
    if (candidates.length > 0) return Math.min(...candidates);
    return Math.max(...valid);
  }

  // floor
  const candidates = valid.filter((v) => v <= fps);
  if (candidates.length > 0) return Math.max(...candidates);
  return Math.min(...valid);
}

export function snapShutterToRegion(
  denom: number,
  regionHz: number,
  minDenom: number,
  maxDenom: number,
  mode: 'floor' | 'nearest' | 'ceil' = 'nearest',
): number {
  const clamped = Math.max(minDenom, Math.min(maxDenom, denom));
  if (regionHz <= 0) return Math.round(clamped);

  const valid = enumerateRegionShutterDenoms(regionHz, maxDenom).filter(d => d >= minDenom);
  if (valid.length === 0) return Math.round(clamped);

  if (mode === 'nearest') {
    return valid.reduce((prev, curr) =>
      Math.abs(curr - clamped) < Math.abs(prev - clamped) ? curr : prev
    );
  }

  if (mode === 'ceil') {
    const candidates = valid.filter((d) => d >= clamped);
    if (candidates.length > 0) return Math.min(...candidates);
    return Math.max(...valid);
  }

  // floor
  const candidates = valid.filter((d) => d <= clamped);
  if (candidates.length > 0) return Math.max(...candidates);
  return Math.min(...valid);
}

/** Shutter denominators to evaluate at fps: all region-valid values in [fps, upperBound]. */
export function shuttersForFpsSearch(
  fps: number,
  idealShutterDenom: number,
  maxShutterDenom: number,
  regionHz: number,
): number[] {
  const rawUpper = Math.min(idealShutterDenom, maxShutterDenom);
  if (fps > rawUpper) return [];

  if (regionHz > 0) {
    const upper = snapShutterToRegion(rawUpper, regionHz, fps, maxShutterDenom, 'floor');
    return enumerateRegionShutterDenoms(regionHz, maxShutterDenom)
      .filter((d) => d >= fps && d <= upper);
  }

  // Free region: any integer ≥ fps; evaluate the exposure-optimal cap only (avoid O(n) scan).
  return [Math.max(fps, Math.floor(rawUpper))];
}

/**
 * Snap to on-grid fps/shutter when SNR still passes; prefer on-grid over off-grid.
 * Among valid pairs, pick the shortest exposure (highest shutterDenom).
 */
export function snapTimingPreservingSnr(
  timing: TimingValues,
  regionHz: number,
  maxFps: number,
  maxShutterDenom: number,
  meetsSnr: (fps: number, shutterDenom: number) => boolean,
): TimingValues & { onRegionGrid: boolean } {
  if (regionHz <= 0) {
    const fps = Math.max(1, Math.min(maxFps, Math.round(timing.fps)));
    const shutterDenom = Math.max(
      fps,
      Math.min(maxShutterDenom, Math.floor(timing.shutterDenom)),
    );
    return { fps, shutterDenom, onRegionGrid: true };
  }

  const onGrid =
    isValidRegionFps(timing.fps, regionHz) &&
    isValidRegionShutterDenom(timing.shutterDenom, regionHz) &&
    timing.shutterDenom >= timing.fps;

  if (onGrid && meetsSnr(timing.fps, timing.shutterDenom)) {
    return { ...timing, onRegionGrid: true };
  }

  let best: (TimingValues & { onRegionGrid: boolean }) | null = null;

  const minFps = Math.max(1, Math.round(timing.fps));
  for (const fps of enumerateRegionFpsValues(maxFps, regionHz)) {
    if (fps < minFps) continue;
    for (const shutterDenom of enumerateRegionShutterDenoms(regionHz, maxShutterDenom)) {
      if (shutterDenom < fps || shutterDenom > maxShutterDenom) continue;
      if (!meetsSnr(fps, shutterDenom)) continue;

      const candidate = { fps, shutterDenom, onRegionGrid: true };
      if (!best || shutterDenom > best.shutterDenom ||
          (shutterDenom === best.shutterDenom && Math.abs(fps - timing.fps) < Math.abs(best.fps - timing.fps))) {
        best = candidate;
      }
    }
  }

  if (best) return best;

  const fps = snapFpsToRegion(timing.fps, regionHz, maxFps, 'nearest');
  const shutterDenom = Math.max(
    fps,
    snapShutterToRegion(timing.shutterDenom, regionHz, fps, maxShutterDenom, 'nearest'),
  );
  return {
    fps,
    shutterDenom,
    onRegionGrid: isValidRegionFps(fps, regionHz) && isValidRegionShutterDenom(shutterDenom, regionHz),
  };
}
