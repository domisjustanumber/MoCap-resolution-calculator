import { getMotionParams, setMotionParams, setTemporalVelocity, setAcceleration, setAngularVelocity } from '../temporalState';
import { updatePresetStyles } from './fpsShutterPresets';
import type { MotionParams } from '../types';
import { setInputIfNotFocused } from './domUtils';
import { setText } from './outputs';

const MOTION_PRESETS: Record<string, MotionParams> = {
  static:   { linearVelocity: 0,   acceleration: 0,   angularVelocity: 0,   subjectHalfWidth: 0.5 },
  walking:  { linearVelocity: 1.5, acceleration: 0.5, angularVelocity: 10,  subjectHalfWidth: 0.5 },
  running: { linearVelocity: 8,   acceleration: 3,   angularVelocity: 15,  subjectHalfWidth: 0.5 },
  agility:  { linearVelocity: 1,   acceleration: 2,   angularVelocity: 150, subjectHalfWidth: 0.5 },
};

const PRESET_DESCRIPTIONS: Record<string, string> = {
  static:  'Do not factor in motion blur from movement.',
  walking: 'Gentle motion and direction changes',
  running: 'Fast linear motion at 8 m/s (29 km/h) - sprinters, straight-line athletes.',
  agility: 'Rapid rotation with low linear speed - bat/raquet swings, combat, quick direction changes.',
  custom:  'Manually tuned acceleration and rotation values.',
};

let activeMotionPreset = 'walking';
let refreshAll: () => void;

export function setActiveMotionPreset(name: string): void {
  activeMotionPreset = name;
}

export function updateMotionPresetStyles(): void {
  updatePresetStyles('.vel-preset', () => activeMotionPreset, 'velocity');
}

function updateMotionPresetDescription(preset: string): void {
  setText('motion-preset-desc', PRESET_DESCRIPTIONS[preset] ?? '');
}

export function syncQcInputsFromParams(p?: MotionParams): void {
  const m = p ?? getMotionParams();
  setInputIfNotFocused('accel-custom', m.acceleration.toFixed(1));
  setInputIfNotFocused('accel-custom-input', m.acceleration.toFixed(1));
  setInputIfNotFocused('angular-custom', String(Math.round(m.angularVelocity)));
  setInputIfNotFocused('angular-custom-input', String(Math.round(m.angularVelocity)));
}

function applyMotionPreset(preset: string): void {
  activeMotionPreset = preset;
  const p = MOTION_PRESETS[preset];
  if (!p) return;
  setMotionParams(p);
  setTemporalVelocity(p.linearVelocity);
  syncQcInputsFromParams(p);
  updateMotionPresetDescription(preset);
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
    updateMotionPresetDescription('custom');
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
    updateMotionPresetDescription('custom');
    refreshAll();
    syncQcInputsFromParams();
  });
}

export function initMotionControls(rf: () => void): void {
  refreshAll = rf;

  setMotionParams(MOTION_PRESETS.walking);
  setTemporalVelocity(MOTION_PRESETS.walking.linearVelocity);
  syncQcInputsFromParams();
  updateMotionPresetDescription('walking');

  document.querySelectorAll('.vel-preset').forEach((el) => {
    const btn = el as HTMLButtonElement;
    const preset = btn.dataset.velocity;
    if (preset) btn.title = PRESET_DESCRIPTIONS[preset] ?? '';
    btn.addEventListener('click', () => {
      if (!preset) return;
      applyMotionPreset(preset);
    });
  });

  bindMotionSlider('accel-custom', 'accel-custom-input', (v) => setAcceleration(v));
  bindMotionSlider('angular-custom', 'angular-custom-input', (v) => setAngularVelocity(v));

  updateMotionPresetStyles();
}
