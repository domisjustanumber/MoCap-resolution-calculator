import { createState, recalculate, setField } from './state';
import { initInputs, syncInputsFromState, updateCompressionControlsState } from './ui/inputs';
import { updateOutputs, initExposurePanel } from './ui/outputs';
import { drawChart } from './ui/chart';
import { drawDistanceChart, setYMax } from './ui/distanceChart';
import {
  drawTemporalChart,
  setTemporalZoom,
  setTemporalVelocity,
  getMotionParams,
  setMotionParams,
  setLinearVelocity,
  setAcceleration,
  setAngularVelocity,
  setTemporalPhase,
  setTemporalJitter,
  setFrameRate,
  getFrameRate,
  setShutterDenom,
  getShutterDenom,
  isSyncToggleOn,
  setSyncToggle,
  getMaxFpsLimit,
  getMaxShutterLimit,
  getRegionHz,
  setRegionHz,
  getErrorBudget,
  getSnrUndershootPct,
  setSnrUndershootPct,
} from './ui/temporalChart';
import { initAcceleration, updateAccelOutputs } from './ui/accelerationChart';
import type { MotionParams } from './types';
import { SENSOR_RADIOMETRY, SENSOR_GEOMETRY } from '../presets';
import { DEFAULT_RADIOMETRY } from './constants';
import { runOptimization } from './optimizer';

const app = createState();

let refreshAll = function(): void {
  recalculate(app);
  syncInputsFromState();
  updateOutputs(app);
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
  updateAccelOutputs();
};

initInputs(app);

// ---- Region setup + event delegation ----

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
const defaultHz = detectDefaultRegion();
setRegionHz(defaultHz);

function detectRegionForValue(value: number): number {
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

// Event delegation: FPS presets
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

// Event delegation: Shutter presets
document.getElementById('shutter-presets')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.shutter-preset') as HTMLButtonElement;
  if (!btn) return;
  const d = parseInt(btn.dataset.shutter || '0', 10);
  if (d < getFrameRate()) return;
  setShutterDenom(d);
  updateShutterPresetStyles();
  refreshAll();
});

// Event delegation: Region presets
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

rebuildFpsPresets();
rebuildShutterPresets();
updateRegionPresetStyles();

updateOutputs(app);
drawChart(app);
drawDistanceChart(app);
drawTemporalChart(app);
initAcceleration();
initExposurePanel(app, refreshAll, () => {
  activeMotionPreset = 'custom';
  updateMotionPresetStyles();
  syncQcInputsFromParams();
});
updateAdvancedSensorSpecs();

function bindSlider(id: string, setter: (v: number) => void, labelId: string, suffix: string): void {
  const slider = document.getElementById(id) as HTMLInputElement | null;
  const label = document.getElementById(labelId);
  if (!slider) return;
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    setter(val);
    if (label) label.textContent = slider.value + suffix;
  });
}

// --- Chart tab switching ---
let activeTab = 'spatial';

function switchTab(tab: string): void {
  activeTab = tab;
  const spatialPanel = document.getElementById('panel-spatial');
  const temporalPanel = document.getElementById('panel-temporal');
  const accelPanel = document.getElementById('panel-acceleration');
  const spatialTab = document.getElementById('tab-spatial');
  const temporalTab = document.getElementById('tab-temporal');
  const accelTab = document.getElementById('tab-acceleration');
  const presetBar = document.getElementById('preset-bar');
  const quickControls = document.getElementById('quick-controls');
  const bottleneckBanner = document.getElementById('bottleneck-banner');
  const metricCards = document.getElementById('metric-cards');
  const detailedControls = document.getElementById('detailed-controls');
  const conditionalNotes = document.getElementById('conditional-notes');

  document.querySelectorAll('.chart-tab').forEach((t) => t.classList.remove('active'));

  if (spatialPanel) spatialPanel.classList.toggle('hidden', tab !== 'spatial');
  if (temporalPanel) temporalPanel.classList.toggle('hidden', tab !== 'temporal');
  if (accelPanel) accelPanel.classList.toggle('hidden', tab !== 'acceleration');

  // Hide sidebar, quick controls, bottleneck, metric cards, and detailed controls on non-spatial tabs
  if (presetBar) presetBar.classList.toggle('hidden', tab !== 'spatial');
  if (quickControls) quickControls.classList.toggle('hidden', tab !== 'spatial');
  if (bottleneckBanner) bottleneckBanner.classList.toggle('hidden', tab !== 'spatial');
  if (metricCards) metricCards.classList.toggle('hidden', tab !== 'spatial');
  if (detailedControls) detailedControls.classList.toggle('hidden', tab !== 'spatial');
  if (conditionalNotes) conditionalNotes.classList.toggle('hidden', tab !== 'spatial');

  if (tab === 'spatial' && spatialTab) spatialTab.classList.add('active');
  if (tab === 'temporal' && temporalTab) temporalTab.classList.add('active');
  if (tab === 'acceleration' && accelTab) accelTab.classList.add('active');

  setTimeout(() => {
    if (tab === 'spatial') { drawChart(app, true); drawDistanceChart(app, true); }
    if (tab === 'temporal') drawTemporalChart(app, true);
  }, 50);
}

document.getElementById('tab-spatial')?.addEventListener('click', () => switchTab('spatial'));
document.getElementById('tab-temporal')?.addEventListener('click', () => switchTab('temporal'));
document.getElementById('tab-acceleration')?.addEventListener('click', () => switchTab('acceleration'));

// --- Y-axis scale for distance chart ---
function bindDistYRange(): void {
  const slider = document.getElementById('dist-y-range') as HTMLInputElement | null;
  const label = document.getElementById('dist-y-range-label');
  if (!slider) return;
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    if (label) label.textContent = String(v);
    setYMax(v);
    drawDistanceChart(app, true);
  });
}
bindDistYRange();

function updatePresetStyles(selector: string, getValue: () => string | number, dataAttr: string): void {
  const current = String(getValue());
  document.querySelectorAll(selector).forEach((el) => {
    const btn = el as HTMLButtonElement;
    const btnVal = String(btn.dataset[dataAttr] ?? '');
    btn.classList.toggle('active', btnVal === current);
  });
}

// --- Motion presets ---
const MOTION_PRESETS: Record<string, MotionParams> = {
  static:  { linearVelocity: 0,   acceleration: 0,   angularVelocity: 0,   subjectHalfWidth: 0.5 },
  walking: { linearVelocity: 1.5, acceleration: 0.5, angularVelocity: 10,  subjectHalfWidth: 0.5 },
  sports:  { linearVelocity: 5,   acceleration: 4,   angularVelocity: 60,  subjectHalfWidth: 0.5 },
};

let activeMotionPreset = 'walking';

setMotionParams(MOTION_PRESETS.walking);
setTemporalVelocity(MOTION_PRESETS.walking.linearVelocity);
const initCustomVel = document.getElementById('velocity-custom') as HTMLInputElement | null;
if (initCustomVel) initCustomVel.value = String(MOTION_PRESETS.walking.linearVelocity);
syncQcInputsFromParams();
refreshAll();
updateMotionPresetStyles();

function detectMotionPreset(v: number): string {
  if (Math.abs(v - 0) < 0.05) return 'static';
  if (Math.abs(v - 1.5) < 0.05) return 'walking';
  if (Math.abs(v - 5) < 0.05) return 'sports';
  return 'custom';
}

function updateMotionPresetStyles(): void {
  updatePresetStyles('.vel-preset', () => activeMotionPreset, 'velocity');
  const customInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
  if (customInput) {
    customInput.classList.toggle('vel-input-active', activeMotionPreset === 'custom');
  }
}

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

function updateFpsLabel(): void {
  const label = document.getElementById('temporal-fps-label');
  if (label) label.textContent = 'Kinematic @ ' + getFrameRate() + ' fps';
}

function applyMotionPreset(preset: string): void {
  activeMotionPreset = preset;
  const p = MOTION_PRESETS[preset] ?? {
    linearVelocity: parseFloat((document.getElementById('velocity-custom') as HTMLInputElement)?.value || '0'),
    acceleration: parseFloat((document.getElementById('accel-custom') as HTMLInputElement)?.value || '0'),
    angularVelocity: parseFloat((document.getElementById('angular-custom') as HTMLInputElement)?.value || '0'),
  };
  setMotionParams(p);
  setTemporalVelocity(p.linearVelocity);

  syncQcInputsFromParams(p);
  refreshAll();
  updateMotionPresetStyles();
}

// Velocity preset buttons
document.querySelectorAll('.vel-preset').forEach((el) => {
  el.addEventListener('click', () => {
    const preset = (el as HTMLButtonElement).dataset.velocity;
    if (!preset) return;
    if (preset === 'custom') {
      activeMotionPreset = 'custom';
      updateMotionPresetStyles();
      const customInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
      if (customInput) customInput.focus();
      return;
    }
    applyMotionPreset(preset);
  });
});

// Custom velocity number input
const customVelInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
if (customVelInput) {
  customVelInput.addEventListener('input', () => {
    const v = parseFloat(customVelInput.value);
    if (isNaN(v) || v < 0) return;
    activeMotionPreset = 'custom';
    setLinearVelocity(v);
    setTemporalVelocity(v);
    refreshAll();
    updateMotionPresetStyles();
  });
}

function syncQcInputsFromParams(p?: MotionParams): void {
  const m = p ?? getMotionParams();
  const setIfNotFocused = (id: string, value: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el && el !== document.activeElement) el.value = value;
  };
  setIfNotFocused('velocity-custom', String(m.linearVelocity));
  setIfNotFocused('accel-custom', m.acceleration.toFixed(1));
  setIfNotFocused('angular-custom', String(Math.round(m.angularVelocity)));
  setIfNotFocused('exp-accel-target', m.acceleration.toFixed(1));
  setIfNotFocused('exp-rot-target', String(Math.round(m.angularVelocity)));
  const setSliderAndInput = (sliderId: string, inputId: string, value: number, decimals: number) => {
    const slider = document.getElementById(sliderId) as HTMLInputElement | null;
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (slider) slider.value = value.toFixed(decimals);
    if (input && input !== document.activeElement) input.value = value.toFixed(decimals);
  };
  setSliderAndInput('velocity-slider', 'velocity-custom', m.linearVelocity, 1);
  setSliderAndInput('accel-slider', 'accel-custom', m.acceleration, 1);
  setSliderAndInput('angular-slider', 'angular-custom', m.angularVelocity, 0);
  setSliderAndInput('motion-accel', 'motion-accel-input', m.acceleration, 1);
  setSliderAndInput('motion-angular', 'motion-angular-input', m.angularVelocity, 0);
  setSliderAndInput('temporal-motion-accel', 'temporal-motion-accel-input', m.acceleration, 1);
  setSliderAndInput('temporal-motion-angular', 'temporal-motion-angular-input', m.angularVelocity, 0);
}

function bindQcMotionInput(id: string, setter: (v: number) => void, decimals: number): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    if (isNaN(v)) return;
    setter(v);
    activeMotionPreset = 'custom';
    updateMotionPresetStyles();
    refreshAll();
    syncQcInputsFromParams();
  });
}
bindQcMotionInput('velocity-custom', (v) => { setLinearVelocity(v); setTemporalVelocity(v); }, 1);
bindQcMotionInput('accel-custom', setAcceleration, 1);
bindQcMotionInput('angular-custom', setAngularVelocity, 0);

// Motion slider bindings
function bindMotionSlider(sliderId: string, inputId: string, setter: (v: number) => void): void {
  const slider = document.getElementById(sliderId) as HTMLInputElement | null;
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  if (!slider || !input) return;
  const handler = () => {
    const v = parseFloat(slider.value);
    setter(v);
    if (input !== document.activeElement) input.value = String(v);
    activeMotionPreset = 'custom';
    updateMotionPresetStyles();
    refreshAll();
    syncQcInputsFromParams();
  };
  slider.addEventListener('input', handler);
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (isNaN(v)) return;
    setter(v);
    if (slider !== document.activeElement) slider.value = String(v);
    activeMotionPreset = 'custom';
    updateMotionPresetStyles();
    refreshAll();
    syncQcInputsFromParams();
  });
}
bindMotionSlider('velocity-slider', 'velocity-custom', (v) => { setLinearVelocity(v); setTemporalVelocity(v); });
bindMotionSlider('accel-slider', 'accel-custom', setAcceleration);
bindMotionSlider('angular-slider', 'angular-custom', setAngularVelocity);
bindMotionSlider('motion-accel', 'motion-accel-input', setAcceleration);
bindMotionSlider('motion-angular', 'motion-angular-input', setAngularVelocity);
bindMotionSlider('temporal-motion-accel', 'temporal-motion-accel-input', setAcceleration);
bindMotionSlider('temporal-motion-angular', 'temporal-motion-angular-input', setAngularVelocity);

// Custom FPS number input
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

// Custom shutter speed number input
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

// Sync error toggle
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

bindSlider('temporal-distance', (v) => {
  setField(app, 'distanceToSubject', v);
  refreshAll();
}, 'temporal-distance-label', ' m');
bindSlider('temporal-phase', (v) => { setTemporalPhase(v); drawTemporalChart(app, true); }, 'temporal-phase-label', ' ms');
bindSlider('temporal-jitter', (v) => { setTemporalJitter(v); drawTemporalChart(app, true); }, 'temporal-jitter-label', ' ms');
bindSlider('temporal-zoom', (v) => { setTemporalZoom(v); drawTemporalChart(app, true); }, 'temporal-zoom-label', ' mm');

updateMotionPresetStyles();

// Exposure mode toggle
const snrUndershootInput = document.getElementById('snr-undershoot-pct') as HTMLInputElement | null;
if (snrUndershootInput) {
  snrUndershootInput.addEventListener('input', () => {
    const pct = parseFloat(snrUndershootInput.value);
    if (Number.isFinite(pct)) {
      setSnrUndershootPct(pct);
      snrUndershootInput.value = String(getSnrUndershootPct());
    }
  });
}

const optimizeBtn = document.getElementById('optimize-btn');
if (optimizeBtn) {
  optimizeBtn.addEventListener('click', () => {
    const result = runOptimization(app, getMotionParams(), getErrorBudget(), getSnrUndershootPct());
    if (result) {
      app.state.extractedWidth        = result.extractedWidth;
      app.state.extractedHeight       = result.extractedHeight;
      app.state.selectedV4l2Mode      = result.selectedV4l2Mode;
      app.state.readoutPitchMultiplier = result.readoutPitchMultiplier;
      app.state.readoutFullFoV        = result.readoutFullFoV;
      app.state.readoutMethod         = result.readoutMethod;
      // Update max fps/shutter for the new V4L2 mode before applying timing — otherwise
      // setFrameRate clamps to the previous mode's limit (e.g. 40 fps on 2028×1520).
      recalculate(app);
      setFrameRate(result.fps);
      setShutterDenom(result.shutterDenom);
      syncInputsFromState();
      updateFpsLabel();
      updateFpsPresetStyles();
      updateShutterPresetStyles();
      refreshAll();
      updateGainDisplay();
      if (!result.snrMet) {
        showOptimizerBestEffortWarning();
      }
    } else {
      showOptimizerWarning();
    }
  });
}

function showOptimizerWarning(): void {
  const banner = document.getElementById('bottleneck-banner');
  if (!banner) return;
  banner.textContent = '\u26a0 Optimizer: no valid exposure \u2014 increase lux or lower SNR target';
  banner.className = 'mt-3 mb-3 rounded-lg border border-red-800 bg-red-950/30 p-3 text-xs text-red-300';
}

function showOptimizerBestEffortWarning(): void {
  const banner = document.getElementById('bottleneck-banner');
  if (!banner) return;
  banner.textContent = '\u26a0 Optimizer: best effort \u2014 SNR target not met; increase lux or lower SNR target';
  banner.className = 'mt-3 mb-3 rounded-lg border border-red-800 bg-red-950/30 p-3 text-xs text-red-300';
}

// Lux presets
const LUX_PRESETS: Record<string, number> = {
  '0.2': 0.2,
  '100': 100,
  '1000': 1000,
  '10000': 10000,
  '100000': 100000,
};
document.querySelectorAll('.lux-preset').forEach((el) => {
  el.addEventListener('click', () => {
    const lux = LUX_PRESETS[(el as HTMLButtonElement).dataset.lux || '1000'];
    setField(app, 'luxAtSubject', lux);
    syncInputsFromState();
    updateLuxPresetStyles();
    refreshAll();
  });
});
function updateLuxPresetStyles(): void {
  document.querySelectorAll('.lux-preset').forEach((el) => {
    const lux = LUX_PRESETS[(el as HTMLButtonElement).dataset.lux || ''];
    const btn = el as HTMLButtonElement;
    btn.classList.toggle('active', lux === app.state.luxAtSubject);
  });
}
updateLuxPresetStyles();

// Lux slider + input binding
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

// Update advanced sensor specs display on every refresh
const prevRefreshAll = refreshAll;
refreshAll = function(): void {
  prevRefreshAll();
  updateAdvancedSensorSpecs();
};

export function updateAdvancedSensorSpecs(): void {
  const radiometry = SENSOR_RADIOMETRY[app.activeSensorPreset] || DEFAULT_RADIOMETRY;
  setText('as-qe', radiometry.qePercent + '%');
  setText('as-fwc', radiometry.fullWellCapacity.toLocaleString() + ' e\u207b');
  setText('as-rn', radiometry.readNoiseE.toFixed(1) + ' e\u207b RMS');
  setText('as-dc', radiometry.darkCurrentE.toFixed(0) + ' e\u207b/s');
  setText('as-cg', radiometry.conversionGainUvPerE.toFixed(0) + ' \u00b5V/e\u207b');
  setText('as-adc', radiometry.adcBits + '-bit');
  setText('as-readout', radiometry.readoutTimeUs + ' \u00b5s/row');
  setText('as-cfa', radiometry.cfaFactor.toFixed(2));

  const globalEl = document.getElementById('shutter-global') as HTMLInputElement | null;
  const rollingEl = document.getElementById('shutter-rolling') as HTMLInputElement | null;
  if (globalEl) globalEl.checked = app.state.shutterType === 'global';
  if (rollingEl) rollingEl.checked = app.state.shutterType !== 'global';
};

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateGainDisplay(): void {
  const slider = document.getElementById('gain-slider') as HTMLInputElement | null;
  const input = document.getElementById('gain-value') as HTMLInputElement | null;
  if (!slider || !input) return;
  const gain = app.state.gain > 0 ? app.state.gain : app.results.exposure.optimalGain;
  const clamped = Math.max(1.0, Math.min(8.0, gain));
  if (slider !== document.activeElement) slider.value = clamped.toFixed(1);
  if (input !== document.activeElement) input.value = clamped.toFixed(1);
}

window.addEventListener('resize', () => {
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
});
