import type { AppStateFull } from '../types';
import { clamped } from '../constants';

export function updateGainDisplay(app: AppStateFull): void {
  const slider = document.getElementById('gain-slider') as HTMLInputElement | null;
  const input = document.getElementById('gain-value') as HTMLInputElement | null;
  if (!slider || !input) return;
  const gain = app.state.gain > 0 ? app.state.gain : app.results.exposure.optimalGain;
  const v = clamped(gain, 1.0, 8.0).toFixed(1);
  if (slider !== document.activeElement) slider.value = v;
  if (input !== document.activeElement) input.value = v;
}
