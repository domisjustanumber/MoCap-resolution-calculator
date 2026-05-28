import { SENSOR_PRESETS } from '../../presets';
import type { ProvenanceValue } from '../../presets/types';

export function getFieldProvenance(sensorName: string, fieldDotPath: string): string | null {
  const preset = SENSOR_PRESETS[sensorName];
  if (!preset?._provenance) return null;
  const entry: ProvenanceValue | undefined = preset._provenance[fieldDotPath];
  if (!entry) return null;
  return typeof entry === 'string' ? entry : entry.source;
}

export function isFieldEstimated(sensorName: string, fieldDotPath: string): boolean {
  return getFieldProvenance(sensorName, fieldDotPath) === 'estimate';
}

export function hasAnyEstimated(sensorName: string): boolean {
  const preset = SENSOR_PRESETS[sensorName];
  if (!preset?._provenance) return false;
  return Object.values(preset._provenance).some(v => {
    const source = typeof v === 'string' ? v : v.source;
    return source === 'estimate';
  });
}

export function stripAsterisk(text: string): string {
  return text.replace(/\s*\*$/, '');
}
