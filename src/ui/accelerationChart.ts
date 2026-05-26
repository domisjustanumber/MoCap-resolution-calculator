// Kinematic Motion Resolution Limits — based on temporal_acceleration_chart.html
import { getFrameRate, setFrameRate, getMotionParams, getErrorBudget, setErrorBudget } from '../temporalState';
import { setText } from './outputs';
import type { MotionParams } from '../types';

export function updateAccelOutputs(): void {
  const fps = getFrameRate();
  const epsilon = getErrorBudget() / 1000;
  const motion = getMotionParams();

  const maxAccel = epsilon * fps * fps;
  const gForce = maxAccel / 9.80665;
  const maxTurn = (epsilon * fps / motion.subjectHalfWidth) * (180 / Math.PI);
  const latency = (1000 / fps) * 2;

  setText('accel-m-s2', maxAccel.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' m/s²');
  setText('accel-g', '≈ ' + gForce.toFixed(1) + ' G');
  setText('accel-turn', maxTurn.toLocaleString() + '°/s');
  setText('accel-latency', latency.toFixed(1) + ' ms');

  const subjectAccelEl = document.getElementById('accel-subject-accel');
  if (subjectAccelEl) {
    subjectAccelEl.textContent = motion.acceleration.toFixed(1) + ' m/s²';
    if (motion.acceleration > 0 && motion.acceleration > maxAccel) {
      subjectAccelEl.classList.add('text-red-400');
    } else {
      subjectAccelEl.classList.remove('text-red-400');
    }
  }

  const subjectRotEl = document.getElementById('accel-subject-rot');
  if (subjectRotEl) {
    subjectRotEl.textContent = Math.round(motion.angularVelocity) + ' °/s';
  }
}

export function initAcceleration(): void {
  const fpsSlider = document.getElementById('accel-fps') as HTMLInputElement | null;
  const budgetSlider = document.getElementById('accel-budget') as HTMLInputElement | null;
  const fpsLabel = document.getElementById('accel-fps-label');
  const budgetLabel = document.getElementById('accel-budget-label');

  if (fpsSlider) {
    fpsSlider.value = String(getFrameRate());
    if (fpsLabel) fpsLabel.textContent = String(getFrameRate());
    fpsSlider.addEventListener('input', () => {
      const fps = parseInt(fpsSlider.value, 10);
      if (fpsLabel) fpsLabel.textContent = String(fps);
      setFrameRate(fps);
      updateAccelOutputs();
    });
  }

  if (budgetSlider) {
    budgetSlider.value = String(getErrorBudget());
    if (budgetLabel) budgetLabel.textContent = getErrorBudget().toFixed(1);
    budgetSlider.addEventListener('input', () => {
      setErrorBudget(parseFloat(budgetSlider.value));
      if (budgetLabel) budgetLabel.textContent = getErrorBudget().toFixed(1);
      updateAccelOutputs();
    });
  }

  updateAccelOutputs();
}
