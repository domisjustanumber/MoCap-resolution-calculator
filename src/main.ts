import { createState, recalculate, setField } from './state';
import { initInputs, syncInputsFromState, updateCompressionControlsState } from './ui/inputs';
import { updateOutputs } from './ui/outputs';
import { drawChart } from './ui/chart';
import { drawDistanceChart, setYMax } from './ui/distanceChart';
import {
  drawTemporalChart,
  setTemporalZoom,
  setTemporalVelocity,
  getSpatialVelocity,
  setSpatialVelocity,
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
} from './ui/temporalChart';
import { initAcceleration, updateAccelOutputs } from './ui/accelerationChart';
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

updateOutputs(app);
drawChart(app);
drawDistanceChart(app);
drawTemporalChart(app);
initAcceleration();
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
    if (tab === 'spatial') { drawChart(app); drawDistanceChart(app); }
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

// --- Velocity presets ---
const VELOCITY_PRESETS: Record<string, number> = {
  static: 0,
  walking: 1.5,
  sports: 5,
};

let activeVelocityPreset = 'walking';

setSpatialVelocity(VELOCITY_PRESETS.walking);
setTemporalVelocity(VELOCITY_PRESETS.walking);
const initVelSlider = document.getElementById('temporal-velocity') as HTMLInputElement | null;
const initVelLabel = document.getElementById('temporal-velocity-label');
const initCustomVel = document.getElementById('velocity-custom') as HTMLInputElement | null;
if (initVelSlider) initVelSlider.value = String(VELOCITY_PRESETS.walking);
if (initVelLabel) initVelLabel.textContent = VELOCITY_PRESETS.walking + ' m/s';
if (initCustomVel) initCustomVel.value = String(VELOCITY_PRESETS.walking);
refreshAll();
updateVelocityPresetStyles();

function detectVelocityPreset(v: number): string {
  if (Math.abs(v - 0) < 0.05) return 'static';
  if (Math.abs(v - 1.5) < 0.05) return 'walking';
  if (Math.abs(v - 5) < 0.05) return 'sports';
  return 'custom';
}

function updateVelocityPresetStyles(): void {
  updatePresetStyles('.vel-preset', () => activeVelocityPreset, 'velocity');
  const customInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
  if (customInput) {
    customInput.classList.toggle('vel-input-active', activeVelocityPreset === 'custom');
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

function applyVelocityPreset(preset: string): void {
  activeVelocityPreset = preset;
  const v = VELOCITY_PRESETS[preset] ?? parseFloat((document.getElementById('velocity-custom') as HTMLInputElement)?.value || '0');
  setSpatialVelocity(v);
  setTemporalVelocity(v);

  const slider = document.getElementById('temporal-velocity') as HTMLInputElement | null;
  const label = document.getElementById('temporal-velocity-label');
  if (slider) slider.value = String(v);
  if (label) label.textContent = v + ' m/s';

  const customInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
  if (customInput) customInput.value = String(v);

  refreshAll();
  updateVelocityPresetStyles();
}

// Velocity preset buttons
document.querySelectorAll('.vel-preset').forEach((el) => {
  el.addEventListener('click', () => {
    const preset = (el as HTMLButtonElement).dataset.velocity;
    if (!preset) return;
    if (preset === 'custom') {
      activeVelocityPreset = 'custom';
      updateVelocityPresetStyles();
      const customInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
      if (customInput) customInput.focus();
      return;
    }
    applyVelocityPreset(preset);
  });
});

// Custom velocity number input
const customVelInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
if (customVelInput) {
  customVelInput.addEventListener('input', () => {
    const v = parseFloat(customVelInput.value);
    if (isNaN(v) || v < 0) return;
    activeVelocityPreset = 'custom';
    setSpatialVelocity(v);
    setTemporalVelocity(v);
    const slider = document.getElementById('temporal-velocity') as HTMLInputElement | null;
    const label = document.getElementById('temporal-velocity-label');
    if (slider) slider.value = String(v);
    if (label) label.textContent = v + ' m/s';
    refreshAll();
    updateVelocityPresetStyles();
  });
}

// FPS preset buttons
  document.querySelectorAll('.fps-preset').forEach((el) => {
  el.addEventListener('click', () => {
    const fps = parseInt((el as HTMLButtonElement).dataset.fps || '30', 10);
    if (fps > getMaxFpsLimit()) return;
    setFrameRate(fps);
    updateFpsPresetStyles();
    updateFpsLabel();
    updateShutterPresetStyles();
    refreshAll();
  });
});

updateFpsPresetStyles();

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
}

// Shutter speed preset buttons
document.querySelectorAll('.shutter-preset').forEach((el) => {
  el.addEventListener('click', () => {
    const d = parseInt((el as HTMLButtonElement).dataset.shutter || '60', 10);
    setShutterDenom(d);
    updateShutterPresetStyles();
    refreshAll();
  });
});

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
}

export function updateShutterPresetStyles(): void {
  const minDenom = getFrameRate();
  updatePresetStyles('.shutter-preset', () => getShutterDenom(), 'shutter');
  document.querySelectorAll('.shutter-preset').forEach((el) => {
    const btn = el as HTMLButtonElement;
    const denom = parseInt(btn.dataset.shutter || '0', 10);
    if (denom < minDenom) {
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

updateShutterPresetStyles();

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

bindSlider('temporal-velocity', (v) => {
  setTemporalVelocity(v);
  const canvas = document.getElementById('temporal-chart') as HTMLCanvasElement | null;
  if (canvas) drawTemporalChart(app, true);
}, 'temporal-velocity-label', ' m/s');
bindSlider('temporal-distance', (v) => {
  setField(app, 'distanceToSubject', v);
  refreshAll();
}, 'temporal-distance-label', ' m');
bindSlider('temporal-phase', (v) => { setTemporalPhase(v); drawTemporalChart(app, true); }, 'temporal-phase-label', ' ms');
bindSlider('temporal-jitter', (v) => { setTemporalJitter(v); drawTemporalChart(app, true); }, 'temporal-jitter-label', ' ms');
bindSlider('temporal-zoom', (v) => { setTemporalZoom(v); drawTemporalChart(app, true); }, 'temporal-zoom-label', ' mm');

updateVelocityPresetStyles();

// Exposure mode toggle
const optimizeBtn = document.getElementById('optimize-btn');
if (optimizeBtn) {
  optimizeBtn.addEventListener('click', () => {
    const result = runOptimization(app);
    if (result) {
      app.state.extractedWidth        = result.extractedWidth;
      app.state.extractedHeight       = result.extractedHeight;
      app.state.selectedV4l2Mode      = result.selectedV4l2Mode;
      app.state.readoutPitchMultiplier = result.readoutPitchMultiplier;
      app.state.readoutFullFoV        = result.readoutFullFoV;
      setFrameRate(result.fps);
      setShutterDenom(result.shutterDenom);
      syncInputsFromState();
      refreshAll();
    } else {
      showOptimizerWarning();
    }
  });
}

function showOptimizerWarning(): void {
  const banner = document.getElementById('bottleneck-banner');
  if (!banner) return;
  banner.textContent = '\u26a0 Optimizer: no valid exposure \u2014 increase lux or lower SNR target';
  banner.classList.add('text-red-400');
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

// Update advanced sensor specs display on every refresh
const prevRefreshAll = refreshAll;
refreshAll = function(): void {
  prevRefreshAll();
  updateAdvancedSensorSpecs();
  updateGainDisplay();
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

  const sensorGeom = SENSOR_GEOMETRY[app.activeSensorPreset];
  const skewMs = sensorGeom
    ? ((radiometry.readoutTimeUs * sensorGeom.nativeHeight) / 1000).toFixed(1)
    : '—';
  if (sensorGeom?.shutterType === 'global') {
    setText('as-shutter', 'Global — no rolling skew');
  } else if (sensorGeom?.shutterType === 'rolling') {
    setText('as-shutter', 'Rolling — ~' + skewMs + 'ms full-frame skew');
  } else {
    setText('as-shutter', '—');
  }
};

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateGainDisplay(): void {
  const slider = document.getElementById('gain-slider') as HTMLInputElement | null;
  const input = document.getElementById('gain-value') as HTMLInputElement | null;
  if (!slider || !input) return;
  const gain = app.results.exposure.optimalGain;
  const clamped = Math.max(1.0, Math.min(8.0, gain));
  if (slider !== document.activeElement) slider.value = clamped.toFixed(1);
  if (input !== document.activeElement) input.value = clamped.toFixed(1);
}

window.addEventListener('resize', () => {
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
});
