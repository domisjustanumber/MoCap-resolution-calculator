export interface TimingValues {
  fps: number;
  shutterDenom: number;
}

/** Shutter denominators on the ½× / 1× / 2× / … regional grid. */
export function enumerateRegionShutterDenoms(regionHz: number, maxDenom = 8000): number[] {
  if (regionHz <= 0) return [];
  const denoms: number[] = [regionHz / 2, regionHz];
  for (let v = regionHz * 2; v <= maxDenom; v += regionHz) denoms.push(v);
  return denoms;
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

  const half = regionHz / 2;

  if (mode === 'nearest') {
    const nearestMultiple = Math.round(fps / regionHz) * regionHz;
    const useHalf = Math.abs(fps - half) < Math.abs(fps - nearestMultiple);
    const candidate = useHalf ? half : nearestMultiple;
    return Math.max(1, Math.min(maxFps, candidate));
  }

  if (mode === 'ceil') {
    if (fps <= half) return Math.min(maxFps, half);
    return Math.min(maxFps, Math.ceil(fps / regionHz) * regionHz);
  }

  // floor — lower fps for longer exposure; pick largest valid fps still ≤ fps
  const candidates = enumerateRegionFpsValues(maxFps, regionHz).filter((v) => v <= fps);
  if (candidates.length > 0) return Math.max(...candidates);
  return Math.min(maxFps, half);
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

  if (mode === 'ceil') {
    return Math.max(minDenom, Math.min(maxDenom, Math.ceil(clamped / regionHz) * regionHz));
  }

  if (mode === 'floor') {
    const floored = Math.floor(clamped / regionHz) * regionHz;
  // floor: longest exposure on grid — smallest denom ≥ minDenom that is ≤ clamped
    const candidates = enumerateRegionShutterDenoms(regionHz, maxDenom)
      .filter((d) => d >= minDenom && d <= clamped);
    if (candidates.length > 0) return Math.min(...candidates);
    if (floored >= minDenom && floored <= maxDenom) return floored;
    return Math.max(minDenom, regionHz / 2);
  }

  return Math.max(minDenom, Math.min(maxDenom, Math.round(clamped / regionHz) * regionHz));
}

/** Shutter denominators to evaluate at fps: continuous cap plus on-grid values in range. */
export function shuttersForFpsSearch(
  fps: number,
  idealShutterDenom: number,
  maxShutterDenom: number,
  regionHz: number,
): number[] {
  const cap = Math.min(idealShutterDenom, maxShutterDenom);
  if (fps > cap) return [];

  const shutters = new Set<number>();
  shutters.add(Math.max(fps, cap));

  if (regionHz > 0) {
    for (const d of enumerateRegionShutterDenoms(regionHz, maxShutterDenom)) {
      if (d >= fps && d <= cap) shutters.add(d);
    }
  }

  return [...shutters].sort((a, b) => a - b);
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
    const shutterDenom = Math.max(fps, Math.min(maxShutterDenom, Math.round(timing.shutterDenom)));
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

  for (const fps of enumerateRegionFpsValues(maxFps, regionHz)) {
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
