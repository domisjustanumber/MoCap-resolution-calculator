import { getFrameRate, getMaxFpsLimit, getRegionHz, setRegionHz, setFrameRate, getEffectiveFrameRate, isLinkMode, setLinkMode } from '../temporalState';

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
  if (label) label.textContent = 'Kinematic @ ' + getEffectiveFrameRate() + ' fps';
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

function updateRegionPresetStyles(): void {
  updatePresetStyles('.region-preset', () => getRegionHz(), 'region');
}

export function initFpsShutterControls(rf: () => void): void {
  refreshAll = rf;

  const defaultHz = detectDefaultRegion();
  setRegionHz(defaultHz);

  rebuildFpsPresets();
  updateRegionPresetStyles();

  document.getElementById('fps-presets')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.fps-preset') as HTMLButtonElement;
    if (!btn) return;
    const fps = parseInt(btn.dataset.fps || '0', 10);
    if (fps > getMaxFpsLimit()) return;
    setFrameRate(fps);
    updateFpsPresetStyles();
    updateFpsLabel();
    refreshAll();
  });

  document.getElementById('region-presets')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.region-preset') as HTMLButtonElement;
    if (!btn) return;
    const hz = parseInt(btn.dataset.region || '0', 10);
    if (hz === getRegionHz()) return;
    setRegionHz(hz);
    rebuildFpsPresets();
    updateRegionPresetStyles();
    updateFpsPresetStyles();
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
      refreshAll();
    });
    customFpsInput.addEventListener('change', () => {
      const parsed = parseInt(customFpsInput.value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        const detected = detectRegionForValue(parsed);
        if (detected !== getRegionHz()) {
          setRegionHz(detected);
          rebuildFpsPresets();
          updateRegionPresetStyles();
        }
      }
    });
  }

  const syncToggleBtn = document.getElementById('sync-toggle');
  if (syncToggleBtn) {
    const updatePill = (linked: boolean) => {
      syncToggleBtn.classList.toggle('linked', linked);
      const left = syncToggleBtn.querySelector('.link-pill-opt.left') as HTMLElement;
      const right = syncToggleBtn.querySelector('.link-pill-opt.right') as HTMLElement;
      if (left) left.classList.toggle('active', !linked);
      if (right) right.classList.toggle('active', linked);
    };
    updatePill(isLinkMode());
    syncToggleBtn.addEventListener('click', () => {
      const linked = !isLinkMode();
      setLinkMode(linked);
      updatePill(linked);
      const syncPill = document.getElementById('sync-link-toggle');
      if (syncPill) {
        syncPill.classList.toggle('linked', linked);
        const sLeft = syncPill.querySelector('.link-pill-opt.left') as HTMLElement;
        const sRight = syncPill.querySelector('.link-pill-opt.right') as HTMLElement;
        if (sLeft) sLeft.classList.toggle('active', !linked);
        if (sRight) sRight.classList.toggle('active', linked);
      }
      refreshAll();
    });
  }
}
