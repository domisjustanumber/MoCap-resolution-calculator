import { createState, recalculate, setField } from './state';
import { initInputs } from './ui/inputs';
import { updateOutputs } from './ui/outputs';
import { drawChart } from './ui/chart';
import { drawDistanceChart, setYMax } from './ui/distanceChart';
import {
  drawTemporalChart,
  setTemporalZoom,
  setTemporalVelocity,
  getTemporalVelocity,
  setTemporalPhase,
  setTemporalJitter,
  setFrameRate,
  getFrameRate,
  setShutterDenom,
  getShutterDenom,
} from './ui/temporalChart';
import { initAcceleration, updateAccelOutputs } from './ui/accelerationChart';

const app = createState();

function refreshAll(): void {
  recalculate(app);
  updateOutputs(app);
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
  updateAccelOutputs();
}

initInputs(app);

updateOutputs(app);
drawChart(app);
drawDistanceChart(app);
drawTemporalChart(app);
initAcceleration();

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

function updatePresetStyles(selector: string, getValue: () => number, dataAttr: string): void {
  const current = getValue();
  document.querySelectorAll(selector).forEach((el) => {
    const btn = el as HTMLButtonElement;
    const btnVal = parseInt(btn.dataset[dataAttr] || '0', 10);
    btn.classList.toggle('active', btnVal === current);
  });
}

function updateDrPresetStyles(): void {
  updatePresetStyles('.dr-preset', () => app.state.dynamicRangeDb, 'dr');
}

document.querySelectorAll('.dr-preset').forEach((el) => {
  el.addEventListener('click', () => {
    const db = parseInt((el as HTMLButtonElement).dataset.dr || '66', 10);
    setField(app, 'dynamicRangeDb', db);
    refreshAll();
  });
});
updateDrPresetStyles();

// --- Velocity presets ---
const VELOCITY_PRESETS: Record<string, number> = {
  static: 0,
  walking: 1.5,
  sports: 5,
};

let activeVelocityPreset = 'walking';

// Initialize velocity to walking
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
  updatePresetStyles('.vel-preset', () => {
    const v = getTemporalVelocity();
    const preset = VELOCITY_PRESETS[activeVelocityPreset];
    return preset !== undefined ? preset : v;
  }, 'velocity');
  const customInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
  if (customInput) {
    customInput.classList.toggle('vel-input-active', activeVelocityPreset === 'custom');
  }
}

function updateFpsPresetStyles(): void {
  updatePresetStyles('.fps-preset', () => getFrameRate(), 'fps');
}

function updateFpsLabel(): void {
  const label = document.getElementById('temporal-fps-label');
  if (label) label.textContent = 'Kinematic @ ' + getFrameRate() + ' fps';
}

function applyVelocityPreset(preset: string): void {
  activeVelocityPreset = preset;
  const v = VELOCITY_PRESETS[preset] ?? parseFloat((document.getElementById('velocity-custom') as HTMLInputElement)?.value || '0');
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
    setFrameRate(fps);
    updateFpsPresetStyles();
    updateFpsLabel();
    refreshAll();
  });
});

updateFpsPresetStyles();

// Shutter speed preset buttons
document.querySelectorAll('.shutter-preset').forEach((el) => {
  el.addEventListener('click', () => {
    const d = parseInt((el as HTMLButtonElement).dataset.shutter || '60', 10);
    setShutterDenom(d);
    updateShutterPresetStyles();
    refreshAll();
  });
});

function updateShutterPresetStyles(): void {
  updatePresetStyles('.shutter-preset', () => getShutterDenom(), 'shutter');
}

updateShutterPresetStyles();

bindSlider('temporal-velocity', (v) => {
  setTemporalVelocity(v);
  activeVelocityPreset = 'custom';
  const customInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
  if (customInput) {
    customInput.value = String(v);
  }
  updateVelocityPresetStyles();
  refreshAll();
}, 'temporal-velocity-label', ' m/s');
bindSlider('temporal-phase', (v) => { setTemporalPhase(v); refreshAll(); }, 'temporal-phase-label', ' ms');
bindSlider('temporal-jitter', (v) => { setTemporalJitter(v); refreshAll(); }, 'temporal-jitter-label', ' ms');
bindSlider('temporal-zoom', (v) => { setTemporalZoom(v); refreshAll(); }, 'temporal-zoom-label', ' mm');

updateVelocityPresetStyles();

window.addEventListener('resize', () => {
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
});
