import type { AppStateFull, AppState, ReadoutMethod } from '../types';
import { setField, applyPreset, recalculate, setSensorPreset } from '../state';
import { PRESETS, SENSOR_GEOMETRY } from '../../presets';
import { WAVELENGTH_PRESETS, wavelengthLabel, wavelengthColor } from '../constants';
import { updateOutputs } from './outputs';
import { drawChart } from './chart';
import { drawDistanceChart, setMaxDistance } from './distanceChart';
import { drawTemporalChart } from './temporalChart';
import { updateAdvancedSensorSpecs } from './sensorSpecs';
import { updateGainDisplay } from './gainDisplay';
import { updateFpsPresetStyles, updateShutterPresetStyles } from './fpsShutterPresets';

let app: AppStateFull;

export function initInputs(state: AppStateFull): void {
  app = state;

  bindNumberInput('focalLength', 'focalLength');
  bindFovInput();
  bindNumberInput('aperture', 'aperture');
  bindNumberInput('lensTransmission', 'lensTransmission');
  bindNumberInput('wavelength', 'wavelength');
  bindNumberInput('pixelPitch', 'pixelPitch');
  bindNumberInput('nativeWidth', 'nativeWidth');
  bindNumberInput('nativeHeight', 'nativeHeight');
  bindCheckboxInput('olpfPresent', 'olpfPresent');
  bindNumberInput('dynamicRangeDb', 'dynamicRangeDb');
  bindDrSlider();
  bindNumberInput('extractedWidth', 'extractedWidth');
  bindNumberInput('extractedHeight', 'extractedHeight');
  bindSelectInput('readoutMethod', 'readoutMethod');
  bindSelectInput('outputFormat', 'outputFormat');
  bindV4l2ModeSelect();
  bindNumberInput('luxAtSubject', 'luxAtSubject');
  bindNumberInput('subjectReflectance', 'subjectReflectance');
  bindNumberInput('desiredSnrDb', 'desiredSnrDb');
  bindNumberInput('temperatureC', 'temperatureC');
  bindRangeInput('mjpgQuality', 'mjpgQuality');
  bindH264QpInput();
  bindH264BitrateInput();
  bindGainInput();
  bindRadioGroup('measurementMode', 'measurementMode');
  bindDistanceRange();
  bindLensTierChips();
  bindShutterRadios();
  bindPresetChips();
  bindSensorModelChips();
  buildWavelengthChips();

  syncInputsFromState();
  updateLensTierChipStyles();
  updateCompressionControlsState();
}

function bindNumberInput(id: string, key: keyof AppState): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  el.addEventListener('input', () => {
    setField(app, key, parseFloat(el.value) || 0);
    handleExtractedClamp();
    syncInputsFromState();
    updateCompressionControlsState();
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
    updateCompressionControlsState();
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

function bindGainInput(): void {
  const slider = document.getElementById('gain-slider') as HTMLInputElement | null;
  const input = document.getElementById('gain-value') as HTMLInputElement | null;
  if (!slider || !input) return;
  const onChange = () => {
    const v = parseFloat(slider!.value);
    input!.value = v.toFixed(1);
    setField(app, 'gain', v);
    refresh();
  };
  slider.addEventListener('input', onChange);
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (isNaN(v)) return;
    const clamped = Math.max(1.0, Math.min(8.0, v));
    slider.value = clamped.toFixed(1);
    onChange();
  });
}

function bindH264QpInput(): void {
  const el = document.getElementById('h264Qp') as HTMLInputElement | null;
  if (!el) return;
  const valueSpan = document.getElementById('h264-qp-value');
  el.addEventListener('input', () => {
    const v = parseInt(el.value, 10);
    setField(app, 'h264Qp', v);
    if (valueSpan) valueSpan.textContent = String(v);
    refresh();
  });
}

function bindH264BitrateInput(): void {
  const el = document.getElementById('h264BitrateMbps') as HTMLInputElement | null;
  if (!el) return;
  const valueSpan = document.getElementById('h264-bitrate-value');
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    setField(app, 'h264BitrateMbps', v);
    if (valueSpan) valueSpan.textContent = v.toFixed(1) + ' Mbps';
    refresh();
  });
}

function bindRadioGroup(_name: string, key: keyof AppState): void {
  const monochrome = document.getElementById('mode-monochrome') as HTMLInputElement | null;
  const colour = document.getElementById('mode-colour') as HTMLInputElement | null;
  if (monochrome) {
    monochrome.addEventListener('click', () => {
      if (monochrome.checked) {
        setField(app, key, 'monochrome');
        refresh();
      }
    });
  }
  if (colour) {
    colour.addEventListener('click', () => {
      if (colour.checked) {
        setField(app, key, 'colour');
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
    updateCompressionControlsState();
    refresh();
  });
  el.addEventListener('blur', () => {
    syncInputsFromState();
  });
}

function bindLensTierChips(): void {
  const map: Record<string, { tier: string; dr: number }> = {
    'lens-cheap': { tier: 'cheap-plastic', dr: 59 },
    'lens-mid': { tier: 'mid-glass', dr: 66 },
    'lens-premium': { tier: 'premium-stack', dr: 90 },
  };
  Object.entries(map).forEach(([preset, spec]) => {
    const chip = document.querySelector(`[data-preset="${preset}"]`) as HTMLButtonElement | null;
    if (!chip) return;
    chip.addEventListener('click', () => {
      setField(app, 'lensTier', spec.tier as AppState['lensTier']);
      setField(app, 'dynamicRangeDb', spec.dr);
      syncInputsFromState();
      updateCompressionControlsState();
      refresh();
    });
  });
}

function bindShutterRadios(): void {
  const globalEl = document.getElementById('shutter-global') as HTMLInputElement | null;
  const rollingEl = document.getElementById('shutter-rolling') as HTMLInputElement | null;
  [globalEl, rollingEl].forEach((el) => {
    if (!el) return;
    el.addEventListener('click', () => {
      if (!el.checked) return;
      setField(app, 'shutterType', el.value as AppState['shutterType']);
      syncInputsFromState();
      refresh();
    });
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
  const chips = document.querySelectorAll('#preset-bar .preset-chip[data-preset]') as NodeListOf<HTMLButtonElement>;
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const name = chip.dataset.preset;
      if (!name || name === 'custom') return;
      const preset = PRESETS.find((p) => p.name === name);
      if (!preset) return;
      applyPreset(app, preset.values, preset.name as import('../types').PresetName);
      syncInputsFromState();
      updateCompressionControlsState();
      refresh();
    });
  });
}

function bindSensorModelChips(): void {
  const chips = document.querySelectorAll('.sensor-model-chip[data-preset]') as NodeListOf<HTMLButtonElement>;
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const name = chip.dataset.preset;
      if (!name || name === 'custom') return;
      setSensorPreset(app, name);
      syncInputsFromState();
      refresh();
    });
  });
}

function populateV4l2Modes(): void {
  const select = document.getElementById('v4l2Mode') as HTMLSelectElement | null;
  const group = document.getElementById('v4l2-mode-group');
  if (!select || !group) return;

  const sensor = SENSOR_GEOMETRY[app.activeSensorPreset];
  const hasModes = sensor?.v4l2?.modes && sensor.v4l2.modes.length > 0;

  if (!hasModes) {
    group.classList.add('hidden');
    return;
  }

  group.classList.remove('hidden');
  const modes = sensor.v4l2!.modes;
  select.innerHTML = '';
  modes.forEach((mode, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${mode.width}x${mode.height} — ${mode.readoutType || `mode ${i}`}`;
    select.appendChild(opt);
  });
  select.value = String(Math.max(0, app.state.selectedV4l2Mode));

  if (app.state.selectedV4l2Mode < 0 && modes.length > 0) {
    onV4l2ModeChange();
  }
}

function onV4l2ModeChange(): void {
  const select = document.getElementById('v4l2Mode') as HTMLSelectElement | null;
  if (!select) return;
  const index = parseInt(select.value, 10);
  if (isNaN(index) || index < 0) return;

  const sensor = SENSOR_GEOMETRY[app.activeSensorPreset];
  if (!sensor?.v4l2?.modes) return;
  const mode = sensor.v4l2.modes[index];
  if (!mode) return;

  app.state.selectedV4l2Mode = index;
  app.state.readoutPitchMultiplier = mode.pitchMultiplier ?? 1;
  app.state.readoutFullFoV = mode.fullFoV ?? true;
  app.state.extractedWidth = mode.width;
  app.state.extractedHeight = mode.height;
  app.state.readoutMethod = readoutTypeToMethod(mode.readoutType);
  recalculate(app);
  syncInputsFromState();
  refresh();
}

function bindV4l2ModeSelect(): void {
  const select = document.getElementById('v4l2Mode') as HTMLSelectElement | null;
  if (!select) return;
  select.addEventListener('change', onV4l2ModeChange);
}

function readoutTypeToMethod(readoutType?: string): ReadoutMethod {
  if (!readoutType) return 'native';
  if (readoutType.includes('native')) return 'native';
  if (readoutType.includes('subsampling')) return 'subsampling';
  if (readoutType.includes('binning')) return 'binning';
  if (readoutType.includes('cropping')) return 'cropping';
  return 'native';
}

function bindDrSlider(): void {
  const slider = document.getElementById('dr-slider') as HTMLInputElement | null;
  if (!slider) return;
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    setField(app, 'dynamicRangeDb', v);
    syncInputsFromState();
    refresh();
  });
}

function updateDrBar(): void {
  const slider = document.getElementById('dr-slider') as HTMLInputElement | null;
  if (slider) slider.value = String(app.state.dynamicRangeDb);
}

export function updatePresetChipStyles(): void {
  const chips = document.querySelectorAll('#preset-bar .preset-chip[data-preset]') as NodeListOf<HTMLButtonElement>;
  chips.forEach((chip) => {
    if (chip.dataset.preset === app.activePreset) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
  const sensorChips = document.querySelectorAll('.sensor-model-chip[data-preset]') as NodeListOf<HTMLButtonElement>;
  sensorChips.forEach((chip) => {
    if (chip.dataset.preset === app.activeSensorPreset) {
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
    badge.classList.toggle('invisible', app.state.wavelength <= 780);
  }
}

export function updateCompressionControlsState(): void {
  const mjpqGroup = document.getElementById('mjpg-quality-group');
  const mjpqSlider = document.getElementById('mjpgQuality') as HTMLInputElement | null;
  const mjpqValueSpan = document.getElementById('mjpg-quality-value');
  const isMjpg = app.state.outputFormat === 'mjpg';

  if (mjpqGroup) mjpqGroup.style.opacity = isMjpg ? '1' : '0.4';
  if (mjpqSlider) {
    mjpqSlider.disabled = !isMjpg;
    mjpqSlider.value = String(app.state.mjpgQuality);
  }
  if (mjpqValueSpan) {
    mjpqValueSpan.textContent = isMjpg ? String(app.state.mjpgQuality) : 'N/A';
    mjpqValueSpan.style.opacity = isMjpg ? '1' : '0.4';
  }

  const h264Group = document.getElementById('h264-qp-group');
  const h264Slider = document.getElementById('h264Qp') as HTMLInputElement | null;
  const h264ValueSpan = document.getElementById('h264-qp-value');
  const isH264 = app.state.outputFormat === 'h264';

  if (h264Group) h264Group.style.opacity = isH264 ? '1' : '0.4';
  if (h264Slider) {
    h264Slider.disabled = !isH264;
    h264Slider.value = String(app.state.h264Qp);
  }
  if (h264ValueSpan) {
    h264ValueSpan.textContent = isH264 ? String(app.state.h264Qp) : 'N/A';
    h264ValueSpan.style.opacity = isH264 ? '1' : '0.4';
  }
  const h264BrSlider = document.getElementById('h264BitrateMbps') as HTMLInputElement | null;
  const h264BrValueSpan = document.getElementById('h264-bitrate-value');
  if (h264BrSlider) {
    h264BrSlider.disabled = !isH264;
    h264BrSlider.value = String(app.state.h264BitrateMbps);
  }
  if (h264BrValueSpan) {
    h264BrValueSpan.textContent = isH264 ? app.state.h264BitrateMbps.toFixed(1) + ' Mbps' : 'N/A';
    h264BrValueSpan.style.opacity = isH264 ? '1' : '0.4';
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
    'dynamicRangeDb',
    'luxAtSubject',
    'subjectReflectance',
    'desiredSnrDb',
    'temperatureC',
    'lensTransmission',
  ];
  numberFields.forEach((key) => {
    const el = document.getElementById(key) as HTMLInputElement | null;
    if (el && el !== document.activeElement) {
      if (key === 'aperture') el.value = app.state.aperture.toFixed(1);
      else if (key === 'pixelPitch') el.value = app.state.pixelPitch.toFixed(1);
      else if (key === 'focalLength') el.value = app.state.focalLength.toFixed(1);
      else if (key === 'lensTransmission') el.value = app.state.lensTransmission.toFixed(2);
      else el.value = String(app.state[key]);
    }
  });

  const selectFields: Array<[string, keyof AppState]> = [
    ['readoutMethod', 'readoutMethod'],
    ['outputFormat', 'outputFormat'],
  ];
  selectFields.forEach(([id, key]) => {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = String(app.state[key]);
  });

  populateV4l2Modes();

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

  const h264Slider = document.getElementById('h264Qp') as HTMLInputElement | null;
  if (h264Slider && h264Slider !== document.activeElement) {
    h264Slider.value = String(app.state.h264Qp);
  }
  const h264ValueSpan = document.getElementById('h264-qp-value');
  if (h264ValueSpan && app.state.outputFormat === 'h264') {
    h264ValueSpan.textContent = String(app.state.h264Qp);
  }

  const h264BrSlider = document.getElementById('h264BitrateMbps') as HTMLInputElement | null;
  if (h264BrSlider && h264BrSlider !== document.activeElement) {
    h264BrSlider.value = String(app.state.h264BitrateMbps);
  }
  const h264BrValueSpan = document.getElementById('h264-bitrate-value');
  if (h264BrValueSpan && app.state.outputFormat === 'h264') {
    h264BrValueSpan.textContent = app.state.h264BitrateMbps.toFixed(1) + ' Mbps';
  }

  const luxSlider = document.getElementById('lux-slider') as HTMLInputElement | null;
  if (luxSlider && luxSlider !== document.activeElement) {
    luxSlider.value = String(app.state.luxAtSubject);
  }

  const monochromeEl = document.getElementById('mode-monochrome') as HTMLInputElement | null;
  const colourEl = document.getElementById('mode-colour') as HTMLInputElement | null;
  if (monochromeEl) monochromeEl.checked = app.state.measurementMode === 'monochrome';
  if (colourEl) colourEl.checked = app.state.measurementMode === 'colour';

  const fovEl = document.getElementById('diagonalFov') as HTMLInputElement | null;
  if (fovEl && fovEl !== document.activeElement) {
    fovEl.value = app.derived.diagonalFov.toFixed(1);
  }

  updatePresetChipStyles();
  updateWavelengthChipStyles();
  updateWavelengthColorIndicator();
  updateIrBadge();
  updateLensTierChipStyles();

  handleExtractedClamp();

  updateFpsPresetStyles();
  updateShutterPresetStyles();

  updateDrBar();
}

function refresh(): void {
  recalculate(app);
  syncInputsFromState();
  updateOutputs(app);
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
  updateAdvancedSensorSpecs(app);
  updateGainDisplay(app);
  updateShutterPresetStyles();
  updateFpsPresetStyles();
}
