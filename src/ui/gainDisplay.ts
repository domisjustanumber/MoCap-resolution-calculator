import type { AppStateFull } from '../types';

export function updateGainDisplay(app: AppStateFull): void {
  const slider = document.getElementById('gain-slider') as HTMLInputElement | null;
  const input = document.getElementById('gain-value') as HTMLInputElement | null;
  if (!slider || !input) return;
  const gain = app.state.gain > 0 ? app.state.gain : app.results.exposure.optimalGain;
  const clamped = Math.max(1.0, Math.min(8.0, gain));
  if (slider !== document.activeElement) slider.value = clamped.toFixed(1);
  if (input !== document.activeElement) input.value = clamped.toFixed(1);
}
