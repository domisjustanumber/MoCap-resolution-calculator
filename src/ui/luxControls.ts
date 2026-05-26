import type { AppStateFull } from '../types';
import { setField } from '../state';

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
      const v = parseFloat(luxSlider.value);
      setField(app, 'luxAtSubject', v);
      if (luxInput !== document.activeElement) luxInput.value = String(v);
      updateLuxPresetStyles();
      refreshAll();
    });
    luxInput.addEventListener('change', () => {
      const v = parseFloat(luxInput.value);
      if (isNaN(v)) return;
      setField(app, 'luxAtSubject', v);
      if (luxSlider !== document.activeElement) luxSlider.value = String(v);
      updateLuxPresetStyles();
      refreshAll();
    });
  }
}
