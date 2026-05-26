import { getFrameRate, getMaxFpsLimit, getShutterDenom, getMaxShutterLimit } from '../temporalState';

export function updateFpsPresetStyles(): void {
  updatePresetStyles('.fps-preset', () => getFrameRate(), 'fps');
  const max = getMaxFpsLimit();
  document.querySelectorAll('.fps-preset').forEach((el) => {
    const btn = el as HTMLButtonElement;
    const fps = parseInt(btn.dataset.fps || '0', 10);
    if (fps > max) {
      btn.classList.add('disabled-preset');
    } else {
      btn.classList.remove('disabled-preset');
    }
  });
  const fpsCustom = document.getElementById('fps-custom') as HTMLInputElement | null;
  if (fpsCustom) {
    fpsCustom.max = String(max);
    if (fpsCustom !== document.activeElement) {
      fpsCustom.value = String(getFrameRate());
    }
  }
}

export function updateShutterPresetStyles(): void {
  const minDenom = getFrameRate();
  const maxDenom = getMaxShutterLimit();
  updatePresetStyles('.shutter-preset', () => getShutterDenom(), 'shutter');
  document.querySelectorAll('.shutter-preset').forEach((el) => {
    const btn = el as HTMLButtonElement;
    const denom = parseInt(btn.dataset.shutter || '0', 10);
    if (denom < minDenom || denom > maxDenom) {
      btn.classList.add('disabled-preset');
    } else {
      btn.classList.remove('disabled-preset');
    }
  });
  const shutterMax = getMaxShutterLimit();
  const shutterCustom = document.getElementById('shutter-custom') as HTMLInputElement | null;
  if (shutterCustom) {
    shutterCustom.max = String(shutterMax);
    if (shutterCustom !== document.activeElement) {
      shutterCustom.value = String(getShutterDenom());
    }
  }
}

export function updatePresetStyles(selector: string, getValue: () => string | number, dataAttr: string): void {
  const current = String(getValue());
  document.querySelectorAll(selector).forEach((el) => {
    const btn = el as HTMLButtonElement;
    const btnVal = String(btn.dataset[dataAttr] ?? '');
    btn.classList.toggle('active', btnVal === current);
  });
}
