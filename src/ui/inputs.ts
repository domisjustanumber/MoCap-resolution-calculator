import type { AppStateFull, AppState, Preset } from '../types';
import { setField, applyPreset, recalculate } from '../state';
import { PRESETS } from '../presets';
import { WAVELENGTH_PRESETS, wavelengthLabel, wavelengthColor } from '../constants';
import { updateOutputs } from './outputs';
import { drawChart } from './chart';
import { drawDistanceChart, setMaxDistance } from './distanceChart';
import { drawTemporalChart } from './temporalChart';

let app: AppStateFull;

const RES_PRESETS: Record<string, { w: number; h: number; fmt: string }> = {
  'sd-mjpg': { w: 640, h: 480, fmt: 'mjpg' },
  'sd-nv12': { w: 640, h: 480, fmt: 'nv12' },
  '720p-mjpg': { w: 1280, h: 720, fmt: 'mjpg' },
  '720p-nv12': { w: 1280, h: 720, fmt: 'nv12' },
  '1080p-mjpg': { w: 1920, h: 1080, fmt: 'mjpg' },
  '1080p-nv12': { w: 1920, h: 1080, fmt: 'nv12' },
};

export function initInputs(state: AppStateFull): void {
  app = state;

  bindNumberInput('focalLength', 'focalLength');
  bindFovInput();
  bindNumberInput('aperture', 'aperture');
  bindNumberInput('wavelength', 'wavelength');
  bindNumberInput('pixelPitch', 'pixelPitch');
  bindNumberInput('nativeWidth', 'nativeWidth');
  bindNumberInput('nativeHeight', 'nativeHeight');
  bindCheckboxInput('olpfPresent', 'olpfPresent');
  bindNumberInput('extractedWidth', 'extractedWidth');
  bindNumberInput('extractedHeight', 'extractedHeight');
  bindSelectInput('subsamplingMethod', 'subsamplingMethod');
  bindSelectInput('outputFormat', 'outputFormat');
  bindRangeInput('mjpgQuality', 'mjpgQuality');
  bindRadioGroup('measurementMode', 'measurementMode');
  bindDistanceRange();
  bindLensTierChips();
  bindProcessingChips();
  bindPresetChips();
  buildWavelengthChips();

  syncInputsFromState();
  updateLensTierChipStyles();
  updateMjpgQualityState();
}

function bindNumberInput(id: string, key: keyof AppState): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  el.addEventListener('input', () => {
    setField(app, key, parseFloat(el.value) || 0);
    handleExtractedClamp();
    syncInputsFromState();
    updateMjpgQualityState();
    refresh();
  });
  el.addEventListener('blur', () => {
    syncInputsFromState();
  });
}

function bindSelectInput(id: string, key: keyof AppState): void {
  const el = document.getElementById(id) as HTMLSelectElement | null;
  if (!el) return;
  el.addEventListener('change', () => {
    setField(app, key, el.value as AppState[typeof key]);
    syncInputsFromState();
    updateMjpgQualityState();
    refresh();
  });
}

function bindCheckboxInput(id: string, key: keyof AppState): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  el.addEventListener('change', () => {
    setField(app, key, el.checked as AppState[typeof key]);
    refresh();
  });
}

function bindRangeInput(id: string, key: keyof AppState): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  const valueSpan = document.getElementById('mjpg-quality-value');
  el.addEventListener('input', () => {
    const v = parseInt(el.value, 10);
    setField(app, key, v);
    if (valueSpan) valueSpan.textContent = String(v);
    refresh();
  });
}

function bindRadioGroup(_name: string, key: keyof AppState): void {
  const luma = document.getElementById('mode-luma') as HTMLInputElement | null;
  const chroma = document.getElementById('mode-chroma') as HTMLInputElement | null;
  if (luma) {
    luma.addEventListener('change', () => {
      if (luma.checked) {
        setField(app, key, 'luma');
        refresh();
      }
    });
  }
  if (chroma) {
    chroma.addEventListener('change', () => {
      if (chroma.checked) {
        setField(app, key, 'chroma');
        refresh();
      }
    });
  }
}

function bindFovInput(): void {
  const el = document.getElementById('diagonalFov') as HTMLInputElement | null;
  if (!el) return;
  el.addEventListener('input', () => {
    const fov = parseFloat(el.value) || 0;
    if (fov > 0) {
      setField(app, 'diagonalFov', fov);
    }
    syncInputsFromState();
    updateMjpgQualityState();
    refresh();
  });
  el.addEventListener('blur', () => {
    syncInputsFromState();
  });
}

function bindLensTierChips(): void {
  const map: Record<string, string> = { 'lens-cheap': 'cheap-plastic', 'lens-mid': 'mid-glass', 'lens-premium': 'premium-stack' };
  Object.entries(map).forEach(([preset, tier]) => {
    const chip = document.querySelector(`[data-preset="${preset}"]`) as HTMLButtonElement | null;
    if (!chip) return;
    chip.addEventListener('click', () => {
      setField(app, 'lensTier', tier as AppState['lensTier']);
      syncInputsFromState();
      updateMjpgQualityState();
      refresh();
    });
  });
}

function bindProcessingChips(): void {
  Object.keys(RES_PRESETS).forEach((key) => {
    const chip = document.querySelector(`[data-res="${key}"]`) as HTMLButtonElement | null;
    if (!chip) return;
    chip.addEventListener('click', () => {
      const { w, h, fmt } = RES_PRESETS[key];
      app.state.extractedWidth = w;
      app.state.extractedHeight = h;
      app.state.outputFormat = fmt as AppState['outputFormat'];
      recalculate(app);
      syncInputsFromState();
      updateMjpgQualityState();
      refresh();

      document.querySelectorAll('[data-res]').forEach((el) => el.classList.remove('active'));
      chip.classList.add('active');
    });
  });
}

function updateResChipStyles(): void {
  Object.keys(RES_PRESETS).forEach((key) => {
    const chip = document.querySelector(`[data-res="${key}"]`) as HTMLButtonElement | null;
    if (!chip) return;
    const { w, h, fmt } = RES_PRESETS[key];
    if (app.state.extractedWidth === w && app.state.extractedHeight === h && app.state.outputFormat === fmt) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function bindDistanceRange(): void {
  const el = document.getElementById('dist-range') as HTMLInputElement | null;
  const label = document.getElementById('dist-range-label');
  if (!el) return;
  el.addEventListener('input', () => {
    const v = parseInt(el.value, 10);
    if (label) label.textContent = v + 'm';
    setMaxDistance(v);
    drawDistanceChart(app, true);
  });
}

function handleExtractedClamp(): void {
  const warnEl = document.getElementById('extracted-warning');
  const extractedW = app.state.extractedWidth;
  const extractedH = app.state.extractedHeight;
  const nativeW = app.state.nativeWidth;
  const nativeH = app.state.nativeHeight;
  const warnings: string[] = [];

  if (extractedW > nativeW && nativeW > 0) {
    app.state.extractedWidth = nativeW;
    warnings.push('width');
  }
  if (extractedH > nativeH && nativeH > 0) {
    app.state.extractedHeight = nativeH;
    warnings.push('height');
  }

  if (warnEl) {
    if (warnings.length > 0) {
      warnEl.textContent = 'Extracted ' + warnings.join(' & ') + ' clamped to native resolution';
      warnEl.classList.remove('hidden');
    } else {
      warnEl.classList.add('hidden');
    }
  }
}

function bindPresetChips(): void {
  const chips = document.querySelectorAll('.preset-chip[data-preset]') as NodeListOf<HTMLButtonElement>;
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const name = chip.dataset.preset;
      if (!name || name === 'custom') return;
      const preset: Preset | undefined = PRESETS.find((p) => p.name === name);
      if (!preset) return;
      applyPreset(app, preset.values, preset.name);
      syncInputsFromState();
      updateMjpgQualityState();
      refresh();
    });
  });
}

export function updatePresetChipStyles(): void {
  const chips = document.querySelectorAll('.preset-chip[data-preset]') as NodeListOf<HTMLButtonElement>;
  chips.forEach((chip) => {
    if (chip.dataset.preset === app.activePreset) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function updateLensTierChipStyles(): void {
  const map: Record<string, string> = { 'lens-cheap': 'cheap-plastic', 'lens-mid': 'mid-glass', 'lens-premium': 'premium-stack' };
  Object.entries(map).forEach(([preset, tier]) => {
    const chip = document.querySelector(`[data-preset="${preset}"]`) as HTMLButtonElement | null;
    if (!chip) return;
    if (app.state.lensTier === tier) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function buildWavelengthChips(): void {
  const container = document.getElementById('wavelength-chips');
  if (!container) return;

  container.innerHTML = '';
  WAVELENGTH_PRESETS.forEach((p) => {
    const btn = document.createElement('button');
    btn.className =
      'wl-chip rounded border px-2 py-0.5 text-[11px] transition hover:border-slate-500 hover:text-slate-300';
    btn.dataset.nm = String(p.nm);
    btn.textContent = p.label;
    btn.style.borderColor = p.color;
    btn.style.color = p.textColor;
    btn.addEventListener('click', () => {
      setField(app, 'wavelength', p.nm);
      syncInputsFromState();
      updateWavelengthChipStyles();
      updateWavelengthColorIndicator();
      updateIrBadge();
      refresh();
    });
    container.appendChild(btn);
  });
  updateWavelengthChipStyles();
}

export function updateWavelengthChipStyles(): void {
  const chips = document.querySelectorAll('.wl-chip') as NodeListOf<HTMLButtonElement>;
  const currentNm = app.state.wavelength;
  chips.forEach((chip) => {
    const nm = parseInt(chip.dataset.nm || '0', 10);
    if (nm === currentNm) {
      chip.style.opacity = '1';
      chip.style.borderWidth = '2px';
    } else {
      chip.style.opacity = '0.5';
      chip.style.borderWidth = '1px';
    }
  });
}

export function updateWavelengthColorIndicator(): void {
  const dot = document.getElementById('wavelength-color-dot');
  const label = document.getElementById('wavelength-color-label');
  const nm = app.state.wavelength;
  if (dot) dot.style.background = wavelengthColor(nm);
  if (label) {
    label.textContent = wavelengthLabel(nm);
    label.style.color = wavelengthColor(nm);
  }
}

export function updateIrBadge(): void {
  const badge = document.getElementById('ir-badge');
  if (badge) {
    badge.classList.toggle('hidden', app.state.wavelength <= 780);
  }
}

export function updateMjpgQualityState(): void {
  const group = document.getElementById('mjpg-quality-group');
  const slider = document.getElementById('mjpgQuality') as HTMLInputElement | null;
  const valueSpan = document.getElementById('mjpg-quality-value');
  const isMjpg = app.state.outputFormat === 'mjpg';

  if (group) group.style.opacity = isMjpg ? '1' : '0.4';
  if (slider) {
    slider.disabled = !isMjpg;
    slider.value = String(app.state.mjpgQuality);
  }
  if (valueSpan) {
    valueSpan.textContent = isMjpg ? String(app.state.mjpgQuality) : 'N/A';
    valueSpan.style.opacity = isMjpg ? '1' : '0.4';
  }
}

export function syncInputsFromState(): void {
  const numberFields: Array<keyof AppState> = [
    'focalLength',
    'aperture',
    'pixelPitch',
    'nativeWidth',
    'nativeHeight',
    'extractedWidth',
    'extractedHeight',
  ];
  numberFields.forEach((key) => {
    const el = document.getElementById(key) as HTMLInputElement | null;
    if (el && el !== document.activeElement) {
      if (key === 'aperture') el.value = app.state.aperture.toFixed(1);
      else if (key === 'pixelPitch') el.value = app.state.pixelPitch.toFixed(1);
      else if (key === 'focalLength') el.value = app.state.focalLength.toFixed(1);
      else el.value = String(app.state[key]);
    }
  });

  const selectFields: Array<[string, keyof AppState]> = [
    ['subsamplingMethod', 'subsamplingMethod'],
    ['outputFormat', 'outputFormat'],
  ];
  selectFields.forEach(([id, key]) => {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = String(app.state[key]);
  });

  const olpfEl = document.getElementById('olpfPresent') as HTMLInputElement | null;
  if (olpfEl) olpfEl.checked = app.state.olpfPresent;

  const mjpgSlider = document.getElementById('mjpgQuality') as HTMLInputElement | null;
  if (mjpgSlider && mjpgSlider !== document.activeElement) {
    mjpgSlider.value = String(app.state.mjpgQuality);
  }
  const mjpgValueSpan = document.getElementById('mjpg-quality-value');
  if (mjpgValueSpan && app.state.outputFormat === 'mjpg') {
    mjpgValueSpan.textContent = String(app.state.mjpgQuality);
  }

  const lumaEl = document.getElementById('mode-luma') as HTMLInputElement | null;
  const chromaEl = document.getElementById('mode-chroma') as HTMLInputElement | null;
  if (lumaEl) lumaEl.checked = app.state.measurementMode === 'luma';
  if (chromaEl) chromaEl.checked = app.state.measurementMode === 'chroma';

  const fovEl = document.getElementById('diagonalFov') as HTMLInputElement | null;
  if (fovEl && fovEl !== document.activeElement) {
    fovEl.value = app.derived.diagonalFov.toFixed(1);
  }

  updatePresetChipStyles();
  updateResChipStyles();
  updateWavelengthChipStyles();
  updateWavelengthColorIndicator();
  updateIrBadge();
  updateLensTierChipStyles();

  handleExtractedClamp();
}

function refresh(): void {
  recalculate(app);
  updateOutputs(app);
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
}
