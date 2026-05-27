import type { AppStateFull } from '../types';
import { SENSOR_RADIOMETRY } from '../../presets';
import { DEFAULT_RADIOMETRY } from '../constants';
import { setText } from './outputs';

export function updateAdvancedSensorSpecs(app: AppStateFull): void {
  const radiometry = SENSOR_RADIOMETRY[app.activeSensorPreset] || DEFAULT_RADIOMETRY;
  setText('as-qe', radiometry.qePercent + '%');
  setText('as-fwc', radiometry.fullWellCapacity.toLocaleString() + ' e\u207b');
  setText('as-rn', radiometry.readNoiseE.toFixed(1) + ' e\u207b RMS');
  setText('as-dc', radiometry.darkCurrentE.toFixed(0) + ' e\u207b/s');
  setText('as-cg', radiometry.conversionGainUvPerE.toFixed(0) + ' \u00b5V/e\u207b');
  setText('as-adc', radiometry.adcBits + '-bit');
  setText('as-readout', radiometry.readoutTimeUs + ' \u00b5s/row');
  setText('as-cfa', radiometry.cfaFactor.toFixed(2));

  const globalEl = document.getElementById('shutter-global') as HTMLInputElement | null;
  const rollingEl = document.getElementById('shutter-rolling') as HTMLInputElement | null;
  if (globalEl) globalEl.checked = app.state.shutterType === 'global';
  if (rollingEl) rollingEl.checked = app.state.shutterType !== 'global';
}
