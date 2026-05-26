import { getMotionParams, setMotionParams, setLinearVelocity, setAcceleration, setAngularVelocity, setTemporalVelocity, getFrameRate } from '../temporalState';
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
  const customInput = document.getElementById('velocity-custom') as HTMLInputElement | null;
  if (customInput) {
    customInput.classList.toggle('vel-input-active', activeMotionPreset === 'custom');
  }
}

export function syncQcInputsFromParams(p?: MotionParams): void {
  const m = p ?? getMotionParams();
  setInputIfNotFocused('velocity-custom', String(m.linearVelocity));
  setInputIfNotFocused('accel-custom', m.acceleration.toFixed(1));
  setInputIfNotFocused('angular-custom', String(Math.round(m.angularVelocity)));
  setInputIfNotFocused('exp-accel-target', m.acceleration.toFixed(1));
  setInputIfNotFocused('exp-rot-target', String(Math.round(m.angularVelocity)));
  const setSliderAndInput = (sliderId: string, inputId: string, value: number, decimals: number) => {
    const slider = document.getElementById(sliderId) as HTMLInputElement | null;
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (slider) slider.value = value.toFixed(decimals);
    if (input && input !== document.activeElement) input.value = value.toFixed(decimals);
  };
  setSliderAndInput('velocity-slider', 'velocity-custom', m.linearVelocity, 1);
  setSliderAndInput('accel-slider', 'accel-custom', m.acceleration, 1);
  setSliderAndInput('angular-slider', 'angular-custom', m.angularVelocity, 0);
  setSliderAndInput('temporal-motion-accel', 'temporal-motion-accel-input', m.acceleration, 1);
  setSliderAndInput('temporal-motion-angular', 'temporal-motion-angular-input', m.angularVelocity, 0);
}

function detectMotionPreset(v: number): string {
  if (Math.abs(v - 0) < 0.05) return 'static';
  if (Math.abs(v - 1.5) < 0.05) return 'walking';
  if (Math.abs(v - 5) < 0.05) return 'sports';
  return 'custom';
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

function bindQcMotionInput(id: string, setter: (v: number) => void): void {
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

  const initCustomVel = document.getElementById('velocity-custom') as HTMLInputElement | null;
  if (initCustomVel) initCustomVel.value = String(MOTION_PRESETS.walking.linearVelocity);
  syncQcInputsFromParams();

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

  bindQcMotionInput('velocity-custom', (v) => { setLinearVelocity(v); setTemporalVelocity(v); });
  bindQcMotionInput('accel-custom', setAcceleration);
  bindQcMotionInput('angular-custom', setAngularVelocity);

  bindMotionSlider('velocity-slider', 'velocity-custom', (v) => { setLinearVelocity(v); setTemporalVelocity(v); });
  bindMotionSlider('accel-slider', 'accel-custom', setAcceleration);
  bindMotionSlider('angular-slider', 'angular-custom', setAngularVelocity);
  bindMotionSlider('temporal-motion-accel', 'temporal-motion-accel-input', setAcceleration);
  bindMotionSlider('temporal-motion-angular', 'temporal-motion-angular-input', setAngularVelocity);

  updateMotionPresetStyles();
}
