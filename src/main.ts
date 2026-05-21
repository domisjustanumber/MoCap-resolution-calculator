import { createState, recalculate } from './state';
import { initInputs } from './ui/inputs';
import { updateOutputs } from './ui/outputs';
import { drawChart } from './ui/chart';
import { drawDistanceChart } from './ui/distanceChart';
import {
  drawTemporalChart,
  setTemporalZoom,
  setTemporalVelocity,
  setTemporalPhase,
  setTemporalJitter,
  setFrameRate,
  getFrameRate,
  setShutterDenom,
  getShutterDenom,
} from './ui/temporalChart';

const app = createState();

function refreshAll(): void {
  recalculate(app);
  updateOutputs(app);
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
}

initInputs(app, () => {});

updateOutputs(app);
drawChart(app);
drawDistanceChart(app);
drawTemporalChart(app);

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

const VELOCITY_PRESETS: Record<string, number> = {
  static: 0,
  walking: 5,
  sports: 15,
};

let activeVelocityPreset = 'static';

function detectVelocityPreset(v: number): string {
  if (Math.abs(v - 0) < 0.05) return 'static';
  if (Math.abs(v - 5) < 0.05) return 'walking';
  if (Math.abs(v - 15) < 0.05) return 'sports';
  return 'custom';
}

function updateVelocityPresetStyles(): void {
  document.querySelectorAll('.vel-preset').forEach((el) => {
    const btn = el as HTMLButtonElement;
    if (btn.dataset.velocity === activeVelocityPreset) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  const customInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
  if (customInput) {
    if (activeVelocityPreset === 'custom') {
      customInput.classList.add('vel-input-active');
    } else {
      customInput.classList.remove('vel-input-active');
    }
  }
}

function updateFpsPresetStyles(): void {
  const fps = getFrameRate();
  document.querySelectorAll('.fps-preset').forEach((el) => {
    const btn = el as HTMLButtonElement;
    const btnFps = parseInt(btn.dataset.fps || '0', 10);
    if (btnFps === fps) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function updateFpsLabel(): void {
  const label = document.getElementById('temporal-fps-label');
  if (label) label.textContent = `Multi-camera kinematic @ ${getFrameRate()} fps`;
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
  const denom = getShutterDenom();
  document.querySelectorAll('.shutter-preset').forEach((el) => {
    const btn = el as HTMLButtonElement;
    const btnDenom = parseInt(btn.dataset.shutter || '0', 10);
    if (btnDenom === denom) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
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
bindSlider('temporal-phase', (v) => { setTemporalPhase(v); drawChart(app); }, 'temporal-phase-label', ' ms');
bindSlider('temporal-jitter', (v) => { setTemporalJitter(v); drawChart(app); }, 'temporal-jitter-label', ' ms');
bindSlider('temporal-zoom', (v) => { setTemporalZoom(v); drawChart(app); }, 'temporal-zoom-label', ' mm');

updateVelocityPresetStyles();

window.addEventListener('resize', () => {
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
});
