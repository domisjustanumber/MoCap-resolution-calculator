import { getMotionParams, setMotionParams, setAcceleration, setAngularVelocity, setTemporalVelocity } from '../temporalState';
import { updatePresetStyles } from './fpsShutterPresets';
import type { MotionParams } from '../types';
import { setInputIfNotFocused } from './domUtils';

const MOTION_PRESETS: Record<string, MotionParams> = {
  static:  { linearVelocity: 0,   acceleration: 0,   angularVelocity: 0,   subjectHalfWidth: 0.5 },
  walking: { linearVelocity: 1.5, acceleration: 0.5, angularVelocity: 10,  subjectHalfWidth: 0.5 },
  sports:  { linearVelocity: 5,   acceleration: 4,   angularVelocity: 60,  subjectHalfWidth: 0.5 },
};

let activeMotionPreset = 'walking';
let refreshAll: () => void;

export function setActiveMotionPreset(name: string): void {
  activeMotionPreset = name;
}

export function updateMotionPresetStyles(): void {
  updatePresetStyles('.vel-preset', () => activeMotionPreset, 'velocity');
}

export function syncQcInputsFromParams(p?: MotionParams): void {
  const m = p ?? getMotionParams();
  setInputIfNotFocused('exp-accel-target', m.acceleration.toFixed(1));
  setInputIfNotFocused('exp-rot-target', String(Math.round(m.angularVelocity)));
  const setSliderAndInput = (sliderId: string, inputId: string, value: number, decimals: number) => {
    const slider = document.getElementById(sliderId) as HTMLInputElement | null;
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (slider) slider.value = value.toFixed(decimals);
    if (input && input !== document.activeElement) input.value = value.toFixed(decimals);
  };
  setSliderAndInput('temporal-motion-accel', 'temporal-motion-accel-input', m.acceleration, 1);
  setSliderAndInput('temporal-motion-angular', 'temporal-motion-angular-input', m.angularVelocity, 0);
}

function applyMotionPreset(preset: string): void {
  activeMotionPreset = preset;
  const p = MOTION_PRESETS[preset];
  if (!p) return;
  setMotionParams(p);
  setTemporalVelocity(p.linearVelocity);
  syncQcInputsFromParams(p);
  refreshAll();
  updateMotionPresetStyles();
}

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

export function initMotionControls(rf: () => void): void {
  refreshAll = rf;

  setMotionParams(MOTION_PRESETS.walking);
  setTemporalVelocity(MOTION_PRESETS.walking.linearVelocity);
  syncQcInputsFromParams();

  document.querySelectorAll('.vel-preset').forEach((el) => {
    el.addEventListener('click', () => {
      const preset = (el as HTMLButtonElement).dataset.velocity;
      if (!preset) return;
      applyMotionPreset(preset);
    });
  });

  bindMotionSlider('temporal-motion-accel', 'temporal-motion-accel-input', setAcceleration);
  bindMotionSlider('temporal-motion-angular', 'temporal-motion-angular-input', setAngularVelocity);

  updateMotionPresetStyles();
}
