import { createState } from './state';
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
} from './ui/temporalChart';

const app = createState();

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

bindSlider('temporal-velocity', setTemporalVelocity, 'temporal-velocity-label', ' m/s');
bindSlider('temporal-phase', setTemporalPhase, 'temporal-phase-label', ' ms');
bindSlider('temporal-jitter', setTemporalJitter, 'temporal-jitter-label', ' ms');
bindSlider('temporal-zoom', setTemporalZoom, 'temporal-zoom-label', ' mm');

window.addEventListener('resize', () => {
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
});
