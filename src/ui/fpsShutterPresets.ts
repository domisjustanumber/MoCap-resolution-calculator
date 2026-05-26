import { getFrameRate, getMaxFpsLimit, getShutterDenom, getMaxShutterLimit, getRegionHz, setRegionHz, setFrameRate, setShutterDenom, setTemporalPhase, setTemporalJitter, setTemporalZoom, isSyncToggleOn, setSyncToggle } from '../temporalState';

let refreshAll: () => void;

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

export function updateFpsLabel(): void {
  const label = document.getElementById('temporal-fps-label');
  if (label) label.textContent = 'Kinematic @ ' + getFrameRate() + ' fps';
}

function detectDefaultRegion(): number {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const is60Hz = tz.startsWith('America/') ||
      ['Asia/Seoul', 'Asia/Tokyo', 'Asia/Manila', 'Asia/Taipei'].includes(tz);
    return is60Hz ? 60 : 50;
  } catch {
    return 50;
  }
}

export function detectRegionForValue(value: number): number {
  if (value === 30 || (value > 0 && value % 60 === 0)) return 60;
  if (value === 25 || (value > 0 && value % 50 === 0)) return 50;
  return getRegionHz();
}

function rebuildFpsPresets(): void {
  const container = document.getElementById('fps-presets');
  if (!container) return;
  container.querySelectorAll('.fps-preset').forEach(el => el.remove());
  const regionHz = getRegionHz();
  let count = 0;
  if (regionHz > 0) {
    const half = regionHz / 2;
    if (count < 5) {
      const btn = document.createElement('button');
      btn.dataset.fps = String(half);
      btn.className = 'fps-preset text-center';
      btn.textContent = String(half);
      container.appendChild(btn);
      count++;
    }
  }
  const step = regionHz > 0 ? regionHz : 25;
  for (let v = step; count < 5; v += step) {
    if (v > 300) break;
    const btn = document.createElement('button');
    btn.dataset.fps = String(v);
    btn.className = 'fps-preset text-center';
    btn.textContent = String(v);
    container.appendChild(btn);
    count++;
  }
  updateFpsPresetStyles();
}

function rebuildShutterPresets(): void {
  const container = document.getElementById('shutter-presets');
  if (!container) return;
  container.querySelectorAll('.shutter-preset').forEach(el => el.remove());
  const reference = container.lastElementChild;
  const regionHz = getRegionHz();
  const MAX_BUTTONS = 9;
  const MAX_DENOM = 8000;
  let count = 0;

  const baseDenom = regionHz > 0 ? regionHz : 60;
  if (regionHz > 0) {
    const half = regionHz / 2;
    const btn = document.createElement('button');
    btn.dataset.shutter = String(half);
    btn.className = 'shutter-preset';
    btn.textContent = '1/' + half;
    container.insertBefore(btn, reference);
    count++;
  }

  let denom = baseDenom;
  while (count < MAX_BUTTONS) {
    if (denom > MAX_DENOM) denom = MAX_DENOM;
    const btn = document.createElement('button');
    btn.dataset.shutter = String(denom);
    btn.className = 'shutter-preset';
    btn.textContent = '1/' + denom;
    container.insertBefore(btn, reference);
    count++;
    if (denom < MAX_DENOM) denom *= 2;
  }
  updateShutterPresetStyles();
}

function updateRegionPresetStyles(): void {
  updatePresetStyles('.region-preset', () => getRegionHz(), 'region');
}

export function initFpsShutterControls(rf: () => void): void {
  refreshAll = rf;

  const defaultHz = detectDefaultRegion();
  setRegionHz(defaultHz);

  rebuildFpsPresets();
  rebuildShutterPresets();
  updateRegionPresetStyles();

  document.getElementById('fps-presets')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.fps-preset') as HTMLButtonElement;
    if (!btn) return;
    const fps = parseInt(btn.dataset.fps || '0', 10);
    if (fps > getMaxFpsLimit()) return;
    setFrameRate(fps);
    updateFpsPresetStyles();
    updateFpsLabel();
    updateShutterPresetStyles();
    refreshAll();
  });

  document.getElementById('shutter-presets')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.shutter-preset') as HTMLButtonElement;
    if (!btn) return;
    const d = parseInt(btn.dataset.shutter || '0', 10);
    if (d < getFrameRate()) return;
    setShutterDenom(d);
    updateShutterPresetStyles();
    refreshAll();
  });

  document.getElementById('region-presets')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.region-preset') as HTMLButtonElement;
    if (!btn) return;
    const hz = parseInt(btn.dataset.region || '0', 10);
    if (hz === getRegionHz()) return;
    setRegionHz(hz);
    rebuildFpsPresets();
    rebuildShutterPresets();
    updateRegionPresetStyles();
    updateFpsPresetStyles();
    updateShutterPresetStyles();
    refreshAll();
  });

  const customFpsInput = document.getElementById('fps-custom') as HTMLInputElement | null;
  if (customFpsInput) {
    customFpsInput.addEventListener('input', () => {
      const fps = parseInt(customFpsInput.value, 10);
      if (isNaN(fps) || fps < 1) return;
      setFrameRate(fps);
      updateFpsPresetStyles();
      updateFpsLabel();
      updateShutterPresetStyles();
      refreshAll();
    });
    customFpsInput.addEventListener('change', () => {
      const parsed = parseInt(customFpsInput.value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        const detected = detectRegionForValue(parsed);
        if (detected !== getRegionHz()) {
          setRegionHz(detected);
          rebuildFpsPresets();
          rebuildShutterPresets();
          updateRegionPresetStyles();
        }
      }
    });
  }

  const customShutterInput = document.getElementById('shutter-custom') as HTMLInputElement | null;
  if (customShutterInput) {
    customShutterInput.addEventListener('input', () => {
      const d = parseInt(customShutterInput.value, 10);
      if (isNaN(d) || d < 1) return;
      setShutterDenom(d);
      updateShutterPresetStyles();
      refreshAll();
    });
    customShutterInput.addEventListener('change', () => {
      const parsed = parseInt(customShutterInput.value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        const detected = detectRegionForValue(parsed);
        if (detected !== getRegionHz()) {
          setRegionHz(detected);
          rebuildFpsPresets();
          rebuildShutterPresets();
          updateRegionPresetStyles();
        }
      }
    });
  }

  const syncToggleBtn = document.getElementById('sync-toggle');
  if (syncToggleBtn) {
    syncToggleBtn.addEventListener('click', () => {
      const on = !isSyncToggleOn();
      setSyncToggle(on);
      syncToggleBtn.textContent = on ? 'On' : 'Off';
      syncToggleBtn.classList.toggle('active', on);
      refreshAll();
    });
  }
}
