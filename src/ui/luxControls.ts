import type { AppStateFull } from '../types';
import { setField } from '../state';

function luxDisplay(v: number): string {
  if (v < 1) return v.toFixed(3);
  if (v < 10) return v.toFixed(2);
  if (v < 100) return v.toFixed(1);
  return String(Math.round(v));
}

const LUX_PRESETS: Record<string, number> = {
  '0.2': 0.2,
  '100': 100,
  '1000': 1000,
  '10000': 10000,
  '100000': 100000,
};

let app: AppStateFull;
let refreshAll: () => void;

function updateLuxPresetStyles(): void {
  document.querySelectorAll('.lux-preset').forEach((el) => {
    const lux = LUX_PRESETS[(el as HTMLButtonElement).dataset.lux || ''];
    const btn = el as HTMLButtonElement;
    btn.classList.toggle('active', lux === app.state.luxAtSubject);
  });
}

export function initLuxControls(a: AppStateFull, rf: () => void): void {
  app = a;
  refreshAll = rf;

  document.querySelectorAll('.lux-preset').forEach((el) => {
    el.addEventListener('click', () => {
      const lux = LUX_PRESETS[(el as HTMLButtonElement).dataset.lux || '1000'];
      setField(app, 'luxAtSubject', lux);
      updateLuxPresetStyles();
      refreshAll();
    });
  });

  updateLuxPresetStyles();

  const luxSlider = document.getElementById('lux-slider') as HTMLInputElement | null;
  const luxInput = document.getElementById('luxAtSubject') as HTMLInputElement | null;
  if (luxSlider && luxInput) {
    luxSlider.addEventListener('input', () => {
      const logV = parseFloat(luxSlider.value);
      const v = Math.pow(10, logV);
      setField(app, 'luxAtSubject', v);
      if (luxInput !== document.activeElement) luxInput.value = luxDisplay(v);
      updateLuxPresetStyles();
      refreshAll();
    });
    luxInput.addEventListener('change', () => {
      const v = parseFloat(luxInput.value);
      if (isNaN(v)) return;
      setField(app, 'luxAtSubject', v);
      if (luxSlider !== document.activeElement) luxSlider.value = String(Math.log10(v).toFixed(2));
      updateLuxPresetStyles();
      refreshAll();
    });
  }
}
