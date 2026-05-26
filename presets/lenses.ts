import type { LensPreset } from './types';

import cheapPlasticRaw from './lenses/cheap-plastic.json';
import midGlassRaw from './lenses/mid-glass.json';
import premiumStackRaw from './lenses/premium-stack.json';

const lenses: Record<string, LensPreset> = {
  'cheap-plastic': cheapPlasticRaw as LensPreset,
  'mid-glass': midGlassRaw as LensPreset,
  'premium-stack': premiumStackRaw as LensPreset,
};

export const LENS_PRESETS = lenses;

export function lensTierScalar(tier: string): number {
  return lenses[tier]?.qualityScalar ?? 0.6;
}
