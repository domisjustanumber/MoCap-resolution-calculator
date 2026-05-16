import { createState } from './state';
import { initInputs } from './ui/inputs';
import { updateOutputs } from './ui/outputs';
import { drawChart } from './ui/chart';
import { drawDistanceChart } from './ui/distanceChart';

const app = createState();

initInputs(app, () => {});

updateOutputs(app);
drawChart(app);
drawDistanceChart(app);

window.addEventListener('resize', () => {
  drawChart(app);
  drawDistanceChart(app);
});
