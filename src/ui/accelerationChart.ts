// Kinematic Motion Resolution Limits — based on temporal_acceleration_chart.html
import { getFrameRate, setFrameRate } from './temporalChart';
import { setText } from './outputs';

let errorBudgetMm = 5;

export function setErrorBudget(mm: number): void {
  errorBudgetMm = Math.max(0.5, Math.min(25, mm));
  updateAccelOutputs();
}

export function getErrorBudget(): number { return errorBudgetMm; }

export function updateAccelOutputs(): void {
  const fps = getFrameRate();
  const epsilon = errorBudgetMm / 1000;

  const maxAccel = 8 * epsilon * fps * fps;
  const gForce = maxAccel / 9.80665;
  const maxTurn = fps * 180;
  const latency = (1000 / fps) * 2;

  setText('accel-m-s2', maxAccel.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' m/s²');
  setText('accel-g', '≈ ' + gForce.toFixed(1) + ' G');
  setText('accel-turn', maxTurn.toLocaleString() + '°/s');
  setText('accel-latency', latency.toFixed(1) + ' ms');
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
    budgetSlider.value = String(errorBudgetMm);
    if (budgetLabel) budgetLabel.textContent = errorBudgetMm.toFixed(1);
    budgetSlider.addEventListener('input', () => {
      errorBudgetMm = parseFloat(budgetSlider.value);
      if (budgetLabel) budgetLabel.textContent = errorBudgetMm.toFixed(1);
      updateAccelOutputs();
    });
  }

  updateAccelOutputs();
}
