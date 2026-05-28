import type { AppStateFull } from '../types';
import { SENSOR_PRESETS, SENSOR_RADIOMETRY } from '../../presets';
import { DEFAULT_RADIOMETRY } from '../constants';
import { setText } from './outputs';
import { isFieldEstimated } from './provenance';

function setSpecValue(id: string, value: string, presetName: string, provenancePath: string): void {
  const mark = isFieldEstimated(presetName, provenancePath) ? '*' : '';
  setText(id, value + mark);
}

export function updateAdvancedSensorSpecs(app: AppStateFull): void {
  const presetName = app.activeSensorPreset;
  const radiometry = SENSOR_RADIOMETRY[presetName] || DEFAULT_RADIOMETRY;
  setSpecValue('as-qe', radiometry.qePercent + '%', presetName, 'radiometry.qePercent');
  setSpecValue('as-fwc', radiometry.fullWellCapacity.toLocaleString() + ' e\u207b', presetName, 'radiometry.fullWellCapacity');
  setSpecValue('as-rn', radiometry.readNoiseE.toFixed(1) + ' e\u207b RMS', presetName, 'radiometry.readNoiseE');
  setSpecValue('as-dc', radiometry.darkCurrentE.toFixed(0) + ' e\u207b/s', presetName, 'radiometry.darkCurrentE');
  setSpecValue('as-cg', radiometry.conversionGainUvPerE.toFixed(0) + ' \u00b5V/e\u207b', presetName, 'radiometry.conversionGainUvPerE');
  setSpecValue('as-adc', radiometry.adcBits + '-bit', presetName, 'radiometry.adcBits');
  setSpecValue('as-readout', radiometry.readoutTimeUs + ' \u00b5s/row', presetName, 'radiometry.readoutTimeUs');
  setSpecValue('as-cfa', radiometry.cfaFactor.toFixed(2), presetName, 'radiometry.cfaFactor');

  const globalEl = document.getElementById('shutter-global') as HTMLInputElement | null;
  const rollingEl = document.getElementById('shutter-rolling') as HTMLInputElement | null;
  if (globalEl) globalEl.checked = app.state.shutterType === 'global';
  if (rollingEl) rollingEl.checked = app.state.shutterType !== 'global';
}
