import type { LensPreset } from './types';

import cheapPlasticRaw from './lenses/cheap-plastic.json';
import midGlassRaw from './lenses/mid-glass.json';
import premiumStackRaw from './lenses/premium-stack.json';

function loadLens(raw: unknown): LensPreset {
  return raw as LensPreset;
}

const lenses: Record<string, LensPreset> = {
  'cheap-plastic': loadLens(cheapPlasticRaw),
  'mid-glass': loadLens(midGlassRaw),
  'premium-stack': loadLens(premiumStackRaw),
};

export const LENS_PRESETS = lenses;

export function lensTierScalar(tier: string): number {
  return lenses[tier]?.qualityScalar ?? 0.6;
}
