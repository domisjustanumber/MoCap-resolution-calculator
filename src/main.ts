import { createState } from './state';
import { initInputs } from './ui/inputs';
import { updateOutputs } from './ui/outputs';
import { drawChart } from './ui/chart';
import { drawDistanceChart, setOnPinsChanged } from './ui/distanceChart';
import { drawTemporalChart } from './ui/temporalChart';

const app = createState();

initInputs(app, () => {});
setOnPinsChanged(() => drawTemporalChart(app, true));

updateOutputs(app);
drawChart(app);
drawDistanceChart(app);
drawTemporalChart(app);

window.addEventListener('resize', () => {
  drawChart(app);
  drawDistanceChart(app);
  drawTemporalChart(app);
});
