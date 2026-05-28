import { createState, recalculate, setField } from './state';
import { initInputs, syncInputsFromState } from './ui/inputs';
import { updateOutputs, initExposurePanel } from './ui/outputs';
import { drawChart } from './ui/chart';
import { drawDistanceChart, setYMax } from './ui/distanceChart';
import { drawTemporalChart } from './ui/temporalChart';
import { initMotionControls, updateMotionPresetStyles, syncQcInputsFromParams, setActiveMotionPreset } from './ui/motionControls';
import { initLuxControls } from './ui/luxControls';
import { initFpsShutterControls, updateFpsPresetStyles, updateFpsLabel } from './ui/fpsShutterPresets';
import { initOptimizerPanel } from './ui/optimizerPanel';
import { updateAdvancedSensorSpecs } from './ui/sensorSpecs';
import { updateGainDisplay } from './ui/gainDisplay';
import { setTemporalPhase, setTemporalJitter, setTemporalZoom, setTemporalDistance, getTemporalDistance, setCameraHeight, getCameraHeight, setObjectSizeMm, getObjectSizeMm, setTemporalFrameRate, setTemporalRegionHz, setTemporalVelocityOnly, setSpatialVelocity, setTemporalVelocity, isLinkMode, setLinkMode, setOnLinkModeChange, getEffectiveFrameRate, getEffectiveShutterDenom, getEffectiveVelocity, getEffectiveRegionHz, getMaxFpsLimit, getShutterDenom, getTemporalPhase, getTemporalJitter, getPhaseFrames, getJitterFrames, setPhaseFrames, setJitterFrames, isTimingInFrames, setTimingInFrames, setRegionHz, setFrameRate } from './temporalState';
import { initScene3d, updateScene3d, resizeScene3d, disposeScene3d, animateToObject, toggleObjectSphere, toggleBlurCloud } from './ui/scene3d';
import { initSyncSceneControls } from './ui/syncSceneControls';
import {
  bindShutterControls,
  syncShutterPair,
} from './ui/shutterControls';

const app = createState();
setTemporalDistance(app.state.distanceToSubject);
setObjectSizeMm(100);

setOnLinkModeChange((linked) => {
  if (linked) setTemporalDistance(app.state.distanceToSubject);
});

function syncDistanceControls(): void {
  const targetDist = app.state.distanceToSubject;
  const targetSlider = document.getElementById('exposure-target-distance') as HTMLInputElement | null;
  const targetInput = document.getElementById('exposure-target-distance-input') as HTMLInputElement | null;
  if (targetSlider && targetSlider !== document.activeElement) {
    targetSlider.value = String(targetDist);
  }
  if (targetInput && targetInput !== document.activeElement) {
    targetInput.value = String(targetDist);
  }

  const cameraDist = getTemporalDistance();
  const distSlider = document.getElementById('temporal-distance') as HTMLInputElement | null;
  const distInput = document.getElementById('temporal-distance-input') as HTMLInputElement | null;
  if (distSlider && distSlider !== document.activeElement) {
    distSlider.value = String(cameraDist);
  }
  if (distInput && distInput !== document.activeElement) {
    distInput.value = String(cameraDist);
  }
}

function rebuildSyncFpsPresets(): void {
  const container = document.getElementById('sync-fps-buttons');
  if (!container) return;
  container.innerHTML = '';
  const regionHz = getEffectiveRegionHz();
  const maxFps = getMaxFpsLimit();
  const count = 6;
  let added = 0;
  if (regionHz > 0 && regionHz / 2 <= maxFps) {
    const half = regionHz / 2;
    const btn = document.createElement('button');
    btn.dataset.syncFps = String(half);
    btn.className = 'sync-fps-preset fps-preset text-center';
    btn.textContent = String(half);
    container.appendChild(btn);
    added++;
  }
  const step = regionHz > 0 ? regionHz : 25;
  for (let v = step; added < count; v += step) {
    if (v > 300 || v > maxFps * 2) break;
    const btn = document.createElement('button');
    btn.dataset.syncFps = String(v);
    btn.className = 'sync-fps-preset fps-preset text-center';
    if (v > maxFps) btn.classList.add('disabled-preset');
    btn.textContent = String(v);
    container.appendChild(btn);
    added++;
  }
}

function syncShutterInputs(): void {
  syncShutterPair(
    document.getElementById('spatial-shutter-slider') as HTMLInputElement | null,
    document.getElementById('spatial-shutter-input') as HTMLInputElement | null,
    getShutterDenom(),
    'spatial',
  );
  syncShutterPair(
    document.getElementById('sync-shutter-slider') as HTMLInputElement | null,
    document.getElementById('sync-shutter-input') as HTMLInputElement | null,
    getEffectiveShutterDenom(),
    'sync',
  );
}

function syncSyncInputs(): void {
  const fpsInput = document.getElementById('sync-fps-custom') as HTMLInputElement | null;
  const heightInput = document.getElementById('temporal-height-input') as HTMLInputElement | null;
  const velSlider = document.getElementById('sync-velocity-slider') as HTMLInputElement | null;
  const velInput = document.getElementById('sync-velocity-input') as HTMLInputElement | null;
  if (fpsInput && fpsInput !== document.activeElement) {
    fpsInput.value = String(getEffectiveFrameRate());
  }
  syncShutterInputs();
  syncDistanceControls();
  const heightSlider = document.getElementById('temporal-height') as HTMLInputElement | null;
  if (heightInput && heightInput !== document.activeElement) {
    heightInput.value = String(getCameraHeight());
  }
  if (heightSlider && heightSlider !== document.activeElement) {
    heightSlider.value = String(getCameraHeight());
  }
  const effVel = getEffectiveVelocity();
  if (velSlider && velSlider !== document.activeElement) {
    velSlider.value = String(effVel);
  }
  if (velInput && velInput !== document.activeElement) {
    velInput.value = String(effVel);
  }
  // Rebuild FPS presets for current region, then highlight matching one
  rebuildSyncFpsPresets();
  const effFps = String(getEffectiveFrameRate());
  document.querySelectorAll('.sync-fps-preset').forEach(b => {
    const btn = b as HTMLButtonElement;
    btn.classList.toggle('active', btn.dataset.syncFps === effFps);
  });
  // Highlight matching Region preset
  const effHz = String(getEffectiveRegionHz());
  document.querySelectorAll('.sync-region-preset').forEach(b => {
    const btn = b as HTMLButtonElement;
    btn.classList.toggle('active', btn.dataset.syncRegion === effHz);
  });
}

let refreshAll = function(): void {
  recalculate(app);
  syncInputsFromState();
  updateOutputs(app);
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
  updateAdvancedSensorSpecs(app);
  updateGainDisplay(app);
  updateFpsPresetStyles();
  updateFpsLabel();
  syncDistanceControls();
  updateScene3d(app);
  syncSyncInputs();
  syncTimingSliders();
};

// One-time init: seed frame values from canonical ms defaults
function initTimingFrames(): void {
  const fps = getEffectiveFrameRate();
  const frameMs = 1000 / fps;
  if (getPhaseFrames() === 0 && getTemporalPhase() > 0) {
    setPhaseFrames(getTemporalPhase() / frameMs);
  }
  if (getJitterFrames() === 0 && getTemporalJitter() > 0) {
    setJitterFrames(getTemporalJitter() / frameMs);
  }
}

function syncTimingSliders(): void {
  const spreadSlider = document.getElementById('temporal-phase') as HTMLInputElement | null;
  const spreadInput = document.getElementById('temporal-phase-input') as HTMLInputElement | null;
  const spreadEquiv = document.getElementById('temporal-phase-equiv');
  const jitterSlider = document.getElementById('temporal-jitter') as HTMLInputElement | null;
  const jitterInput = document.getElementById('temporal-jitter-input') as HTMLInputElement | null;
  const jitterEquiv = document.getElementById('temporal-jitter-equiv');
  const fps = getEffectiveFrameRate();
  const frameMs = 1000 / fps;

  if (isTimingInFrames()) {
    const sFrames = getPhaseFrames();
    const sMs = sFrames * frameMs;
    const jFrames = getJitterFrames();
    const jMs = jFrames * frameMs;
    if (spreadSlider && spreadSlider !== document.activeElement) {
      spreadSlider.min = '0'; spreadSlider.max = '3'; spreadSlider.step = '0.01';
      spreadSlider.value = sFrames.toFixed(2);
    }
    if (spreadInput && spreadInput !== document.activeElement) {
      spreadInput.min = '0'; spreadInput.max = '3'; spreadInput.step = '0.01';
      spreadInput.value = sFrames.toFixed(2);
    }
    if (jitterSlider && jitterSlider !== document.activeElement) {
      jitterSlider.min = '0'; jitterSlider.max = '3'; jitterSlider.step = '0.01';
      jitterSlider.value = jFrames.toFixed(2);
    }
    if (jitterInput && jitterInput !== document.activeElement) {
      jitterInput.min = '0'; jitterInput.max = '3'; jitterInput.step = '0.01';
      jitterInput.value = jFrames.toFixed(2);
    }
    if (spreadEquiv) spreadEquiv.textContent = sFrames.toFixed(2) + ' fr (' + sMs.toFixed(1) + ' ms)';
    if (jitterEquiv) jitterEquiv.textContent = jFrames.toFixed(2) + ' fr (' + jMs.toFixed(1) + ' ms)';
    setTemporalPhase(sMs);
    setTemporalJitter(jMs);
  } else {
    const sMs = getTemporalPhase();
    const sFrames = sMs / frameMs;
    const jMs = getTemporalJitter();
    const jFrames = jMs / frameMs;
    if (spreadSlider && spreadSlider !== document.activeElement) {
      spreadSlider.min = '0'; spreadSlider.max = '100'; spreadSlider.step = '0.1';
      spreadSlider.value = sMs.toFixed(1);
    }
    if (spreadInput && spreadInput !== document.activeElement) {
      spreadInput.min = '0'; spreadInput.max = '100'; spreadInput.step = '0.1';
      spreadInput.value = sMs.toFixed(1);
    }
    if (jitterSlider && jitterSlider !== document.activeElement) {
      jitterSlider.min = '0'; jitterSlider.max = '100'; jitterSlider.step = '0.1';
      jitterSlider.value = jMs.toFixed(1);
    }
    if (jitterInput && jitterInput !== document.activeElement) {
      jitterInput.min = '0'; jitterInput.max = '100'; jitterInput.step = '0.1';
      jitterInput.value = jMs.toFixed(1);
    }
    if (spreadEquiv) spreadEquiv.textContent = sMs.toFixed(1) + ' ms (' + sFrames.toFixed(2) + ' fr)';
    if (jitterEquiv) jitterEquiv.textContent = jMs.toFixed(1) + ' ms (' + jFrames.toFixed(2) + ' fr)';
    setPhaseFrames(sFrames);
    setJitterFrames(jFrames);
  }
}

function refreshTemporalOnly(): void {
  drawTemporalChart(app);
  updateScene3d(app);
  updateFpsLabel();
  syncSyncInputs();
  syncTimingSliders();
}

initInputs(app, refreshAll);
updateOutputs(app);
drawChart(app);
drawDistanceChart(app);
drawTemporalChart(app);

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

const canvas3d = document.getElementById('sync-3d-canvas') as HTMLCanvasElement | null;
if (canvas3d) {
  initScene3d(canvas3d, app);
  initSyncSceneControls(app, refreshAll, refreshTemporalOnly);
}

initTimingFrames();
refreshAll();

if (canvas3d) {
  animateToObject();
}

// --- Sync tab: link toggle ---
function updateLinkPill(pill: HTMLElement, linked: boolean): void {
  pill.classList.toggle('linked', linked);
  const left = pill.querySelector('.link-pill-opt.left') as HTMLElement;
  const right = pill.querySelector('.link-pill-opt.right') as HTMLElement;
  if (left) left.classList.toggle('active', !linked);
  if (right) right.classList.toggle('active', linked);
}

const linkToggle = document.getElementById('sync-link-toggle');
if (linkToggle) {
  updateLinkPill(linkToggle, isLinkMode());
  linkToggle.addEventListener('click', () => {
    const linked = !isLinkMode();
    setLinkMode(linked);
    updateLinkPill(linkToggle, linked);
    const spatialPill = document.getElementById('sync-toggle');
    if (spatialPill) updateLinkPill(spatialPill, linked);
    syncSyncInputs();
    refreshAll();
  });
}

// --- Sync tab: Velocity slider ---
const syncVelocitySlider = document.getElementById('sync-velocity-slider') as HTMLInputElement | null;
const syncVelocityInput = document.getElementById('sync-velocity-input') as HTMLInputElement | null;
if (syncVelocitySlider && syncVelocityInput) {
  syncVelocitySlider.value = String(getEffectiveVelocity());
  syncVelocityInput.value = String(getEffectiveVelocity());
  const applyVel = (v: number) => {
    setActiveMotionPreset('custom');
    updateMotionPresetStyles();
    if (isLinkMode()) {
      setTemporalVelocity(v);
      setSpatialVelocity(v);
      refreshAll();
    } else {
      setTemporalVelocityOnly(v);
      refreshTemporalOnly();
    }
  };
  syncVelocitySlider.addEventListener('input', () => {
    const v = parseFloat(syncVelocitySlider.value);
    if (syncVelocityInput !== document.activeElement) syncVelocityInput.value = String(v);
    applyVel(v);
  });
  syncVelocityInput.addEventListener('input', () => {
    const v = parseFloat(syncVelocityInput.value);
    if (isNaN(v)) return;
    const clamped = Math.max(0, Math.min(20, v));
    if (syncVelocitySlider !== document.activeElement) syncVelocitySlider.value = String(clamped);
    applyVel(clamped);
  });
}

// --- Sync tab: Object size slider ---
const syncObjSizeSlider = document.getElementById('sync-object-size-slider') as HTMLInputElement | null;
const syncObjSizeInput = document.getElementById('sync-object-size-input') as HTMLInputElement | null;
if (syncObjSizeSlider && syncObjSizeInput) {
  syncObjSizeSlider.value = String(getObjectSizeMm());
  syncObjSizeInput.value = String(getObjectSizeMm());
  const applySize = (v: number) => { setObjectSizeMm(v); refreshAll(); };
  syncObjSizeSlider.addEventListener('input', () => {
    const v = parseInt(syncObjSizeSlider.value, 10);
    if (syncObjSizeInput !== document.activeElement) syncObjSizeInput.value = String(v);
    applySize(v);
  });
  syncObjSizeInput.addEventListener('input', () => {
    const v = parseInt(syncObjSizeInput.value, 10);
    if (isNaN(v)) return;
    const clamped = Math.max(1, Math.min(100, v));
    if (syncObjSizeSlider !== document.activeElement) syncObjSizeSlider.value = String(clamped);
    applySize(clamped);
  });
}

// --- Sync tab: FPS input ---
const syncFpsInput = document.getElementById('sync-fps-custom') as HTMLInputElement | null;
if (syncFpsInput) {
  syncFpsInput.addEventListener('input', () => {
    const fps = parseInt(syncFpsInput.value, 10);
    if (isNaN(fps) || fps < 1) return;
    if (isLinkMode()) {
      setFrameRate(fps);
      refreshAll();
    } else {
      setTemporalFrameRate(fps);
      refreshTemporalOnly();
    }
  });
}

// --- Sync tab: timing unit toggle (ms ↔ frames) ---
const timingUnitBtn = document.getElementById('sync-timing-unit');
if (timingUnitBtn) {
  const updateToggleAppearance = () => {
    const inFrames = isTimingInFrames();
    timingUnitBtn.classList.toggle('frames', inFrames);
    timingUnitBtn.classList.toggle('ms', !inFrames);
    const leftOpt = timingUnitBtn.querySelector('.timing-pill-opt.left') as HTMLElement;
    const rightOpt = timingUnitBtn.querySelector('.timing-pill-opt.right') as HTMLElement;
    if (leftOpt) leftOpt.classList.toggle('active', inFrames);
    if (rightOpt) rightOpt.classList.toggle('active', !inFrames);
  };
  updateToggleAppearance();
  timingUnitBtn.addEventListener('click', () => {
    setTimingInFrames(!isTimingInFrames());
    updateToggleAppearance();
    syncTimingSliders();
  });
}

// --- Sync tab: FPS preset buttons ---
document.getElementById('sync-fps-buttons')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-sync-fps]') as HTMLButtonElement | null;
  if (!btn) return;
  const fps = parseInt(btn.dataset.syncFps || '0', 10);
  if (!fps || fps > getMaxFpsLimit()) return;
  if (isLinkMode()) {
    setFrameRate(fps);
    refreshAll();
  } else {
    setTemporalFrameRate(fps);
    refreshTemporalOnly();
  }
  // Highlight active preset
  document.querySelectorAll('.sync-fps-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
});

// --- Sync tab: Region buttons ---
document.getElementById('sync-region-buttons')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-sync-region]') as HTMLButtonElement | null;
  if (!btn) return;
  const hz = parseInt(btn.dataset.syncRegion || '0', 10);
  if (isLinkMode()) {
    setRegionHz(hz);
    refreshAll();
  } else {
    setTemporalRegionHz(hz);
    refreshTemporalOnly();
  }
});

// --- Shutter slider + input (spatial + sync tabs) — bound after refresh fns exist ---
function initShutterControlBindings(): void {
  bindShutterControls(
    document.getElementById('sync-shutter-slider') as HTMLInputElement | null,
    document.getElementById('sync-shutter-input') as HTMLInputElement | null,
    'sync',
    refreshAll,
    refreshTemporalOnly,
  );
  bindShutterControls(
    document.getElementById('spatial-shutter-slider') as HTMLInputElement | null,
    document.getElementById('spatial-shutter-input') as HTMLInputElement | null,
    'spatial',
    refreshAll,
    refreshTemporalOnly,
  );
}
initShutterControlBindings();

// --- Sync tab: show/hide object sphere & point cloud ---
const showObjectCheckbox = document.getElementById('sync-show-object') as HTMLInputElement | null;
if (showObjectCheckbox) {
  showObjectCheckbox.addEventListener('change', () => {
    toggleObjectSphere(showObjectCheckbox.checked);
  });
}
const showCloudCheckbox = document.getElementById('sync-show-cloud') as HTMLInputElement | null;
if (showCloudCheckbox) {
  showCloudCheckbox.addEventListener('change', () => {
    toggleBlurCloud(showCloudCheckbox.checked);
  });
}

// --- Chart tab switching ---
let activeTab = 'spatial';

function switchTab(tab: string): void {
  activeTab = tab;
  const spatialPanel = document.getElementById('panel-spatial');
  const temporalPanel = document.getElementById('panel-temporal');
  const spatialTab = document.getElementById('tab-spatial');
  const temporalTab = document.getElementById('tab-temporal');
  const presetBar = document.getElementById('preset-bar');
  const quickControls = document.getElementById('quick-controls');
  const bottleneckBanner = document.getElementById('bottleneck-banner');
  const detailedControls = document.getElementById('detailed-controls');

  document.querySelectorAll('.chart-tab').forEach((t) => t.classList.remove('active'));

  if (spatialPanel) spatialPanel.classList.toggle('hidden', tab !== 'spatial');
  if (temporalPanel) temporalPanel.classList.toggle('hidden', tab !== 'temporal');

  if (presetBar) presetBar.classList.toggle('hidden', tab !== 'spatial');
  if (quickControls) quickControls.classList.toggle('hidden', tab !== 'spatial');
  if (bottleneckBanner) bottleneckBanner.classList.toggle('hidden', tab !== 'spatial');
  if (detailedControls) detailedControls.classList.toggle('hidden', tab !== 'spatial');

  if (tab === 'spatial' && spatialTab) spatialTab.classList.add('active');
  if (tab === 'temporal' && temporalTab) temporalTab.classList.add('active');

  setTimeout(() => {
    if (tab === 'spatial') { drawChart(app, true); drawDistanceChart(app, true); }
    if (tab === 'temporal') {
      syncSyncInputs();
      syncTimingSliders();
      drawTemporalChart(app, true);
      resizeScene3d();
    }
  }, 50);
}

document.getElementById('tab-spatial')?.addEventListener('click', () => {
  switchTab('spatial');
  window.history.pushState({ tab: 'spatial' }, '', '/');
});
document.getElementById('tab-temporal')?.addEventListener('click', () => {
  switchTab('temporal');
  window.history.pushState({ tab: 'temporal' }, '', '/camera-sync');
});

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
function bindSlider(
  id: string,
  setter: (v: number) => void,
  labelId: string,
  suffix: string,
  inputId?: string,
): void {
  const slider = document.getElementById(id) as HTMLInputElement | null;
  const label = document.getElementById(labelId);
  const input = inputId ? document.getElementById(inputId) as HTMLInputElement | null : null;
  if (!slider) return;

  const sync = (val: number) => {
    setter(val);
    if (label) label.textContent = val + suffix;
    if (input && input !== document.activeElement) {
      input.value = String(Math.round(val * 100) / 100);
    }
  };

  slider.addEventListener('input', () => {
    sync(parseFloat(slider.value));
  });

  if (input) {
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (isNaN(v)) return;
      const clamped = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), v));
      if (slider !== document.activeElement) slider.value = String(clamped);
      sync(clamped);
    });
  }
}

bindSlider('exposure-target-distance', (v) => {
  setField(app, 'distanceToSubject', v);
  if (isLinkMode()) setTemporalDistance(v);
  refreshAll();
}, '', '', 'exposure-target-distance-input');

bindSlider('temporal-distance', (v) => {
  setTemporalDistance(v);
  if (isLinkMode()) {
    setField(app, 'distanceToSubject', v);
    refreshAll();
  } else {
    refreshTemporalOnly();
  }
}, '', '', 'temporal-distance-input');
bindSlider('temporal-height', (v) => {
  setCameraHeight(v);
  refreshAll();
}, '', '', 'temporal-height-input');
bindSlider('temporal-phase', (v) => {
  if (isTimingInFrames()) {
    setPhaseFrames(v);
    setTemporalPhase((v * 1000) / getEffectiveFrameRate());
  } else {
    setTemporalPhase(v);
    setPhaseFrames(v / (1000 / getEffectiveFrameRate()));
  }
  refreshAll();
}, '', '', 'temporal-phase-input');
bindSlider('temporal-jitter', (v) => {
  if (isTimingInFrames()) {
    setJitterFrames(v);
    setTemporalJitter((v * 1000) / getEffectiveFrameRate());
  } else {
    setTemporalJitter(v);
    setJitterFrames(v / (1000 / getEffectiveFrameRate()));
  }
  refreshAll();
}, '', '', 'temporal-jitter-input');
bindSlider('temporal-zoom', (v) => { setTemporalZoom(v); drawTemporalChart(app, true); }, '', '');

window.addEventListener('resize', () => {
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
  resizeScene3d();
});

window.addEventListener('popstate', (e) => {
  const tab = e.state?.tab === 'temporal' ? 'temporal' : 'spatial';
  switchTab(tab);
});

const initialPath = window.location.pathname.replace(/\/+$/, '');
if (initialPath === '/camera-sync') {
  switchTab('temporal');
  window.history.replaceState({ tab: 'temporal' }, '', '/camera-sync');
}

window.addEventListener('beforeunload', () => {
  disposeScene3d();
});
