import { createState, recalculate, setField } from './state';
import { initInputs, syncInputsFromState } from './ui/inputs';
import { updateOutputs, initExposurePanel } from './ui/outputs';
import { drawChart } from './ui/chart';
import { drawDistanceChart, setYMax } from './ui/distanceChart';
import { drawTemporalChart } from './ui/temporalChart';
import { initMotionControls, updateMotionPresetStyles, syncQcInputsFromParams, setActiveMotionPreset } from './ui/motionControls';
import { initLuxControls } from './ui/luxControls';
import { initFpsShutterControls, updateFpsPresetStyles, updateShutterPresetStyles } from './ui/fpsShutterPresets';
import { initOptimizerPanel } from './ui/optimizerPanel';
import { updateAdvancedSensorSpecs } from './ui/sensorSpecs';
import { updateGainDisplay } from './ui/gainDisplay';
import { initAcceleration, updateAccelOutputs } from './ui/accelerationChart';
import { setTemporalPhase, setTemporalJitter, setTemporalZoom } from './temporalState';

const app = createState();

let refreshAll = function(): void {
  recalculate(app);
  syncInputsFromState();
  updateOutputs(app);
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
  updateAccelOutputs();
  updateAdvancedSensorSpecs(app);
  updateGainDisplay(app);
  updateShutterPresetStyles();
  updateFpsPresetStyles();
};

initInputs(app, refreshAll);
updateOutputs(app);
drawChart(app);
drawDistanceChart(app);
drawTemporalChart(app);
initAcceleration();

initExposurePanel(app, refreshAll, () => {
  setActiveMotionPreset('custom');
  updateMotionPresetStyles();
  syncQcInputsFromParams();
});

updateAdvancedSensorSpecs(app);
updateGainDisplay(app);

initMotionControls(refreshAll);
initLuxControls(app, refreshAll);
initFpsShutterControls(refreshAll);
initOptimizerPanel(app, refreshAll);

refreshAll();

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

// --- Temporal chart sliders ---
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

bindSlider('temporal-distance', (v) => {
  setField(app, 'distanceToSubject', v);
  refreshAll();
}, 'temporal-distance-label', ' m');
bindSlider('temporal-phase', (v) => { setTemporalPhase(v); drawTemporalChart(app, true); }, 'temporal-phase-label', ' ms');
bindSlider('temporal-jitter', (v) => { setTemporalJitter(v); drawTemporalChart(app, true); }, 'temporal-jitter-label', ' ms');
bindSlider('temporal-zoom', (v) => { setTemporalZoom(v); drawTemporalChart(app, true); }, 'temporal-zoom-label', ' mm');

window.addEventListener('resize', () => {
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
});
