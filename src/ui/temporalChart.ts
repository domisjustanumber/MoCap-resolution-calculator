import type { AppStateFull } from '../types';
import { getCssWidth, sizeCanvas, getCanvasContext, drawBackground, drawGrid, drawAxes } from './canvasUtils';
import { getCachedMaxErrors, getCachedRmseErrors, runAndCacheSimulation, getTemporalZoom, computeStats, getSyncInputsHash } from '../temporalState';

const CANVAS_Y_MIN = 0.0;
const CANVAS_Y_MAX = 1.0;

let lastHash = '';
let simHash = '';
let mouseX = -1;
let mouseInCanvas = false;
let appRef: AppStateFull | null = null;

let cachedMaxDensity: Float32Array | null = null;
let cachedRmseDensity: Float32Array | null = null;

function calculateDensityCurve(data: Float32Array, maxZoomMM: number): Float32Array {
  const binCount = 300;
  const densities = new Float32Array(binCount);
  const step = maxZoomMM / binCount;

  const n = data.length;
  const sorted = [...data].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  const iqr = sorted[Math.floor(n * 0.75)] - sorted[Math.floor(n * 0.25)];
  const h = 0.9 * Math.min(std, iqr / 1.34) * Math.pow(n, -0.2);
  const bandwidth = Math.max(h, 0.1);

  for (let i = 0; i < data.length; i++) {
    const val = data[i];
    if (val > maxZoomMM) continue;

    const startBin = Math.max(0, Math.floor((val - 3 * bandwidth) / step));
    const endBin = Math.min(binCount - 1, Math.floor((val + 3 * bandwidth) / step));

    for (let b = startBin; b <= endBin; b++) {
      const binX = b * step;
      const dist = (binX - val) / bandwidth;
      densities[b] += Math.exp(-0.5 * dist * dist) / (Math.sqrt(2 * Math.PI) * bandwidth);
    }
  }

  let maxDensity = 0;
  for (let b = 0; b < binCount; b++) {
    if (densities[b] > maxDensity) maxDensity = densities[b];
  }
  if (maxDensity > 0) {
    for (let b = 0; b < binCount; b++) {
      densities[b] = (densities[b] / maxDensity) * 0.85;
    }
  }

  return densities;
}

function ensureDensityCurves(): void {
  const zoomMax = getTemporalZoom();
  runAndCacheSimulation();
  const rawMax = getCachedMaxErrors();
  const rawRmse = getCachedRmseErrors();
  if (!rawMax || !rawRmse) return;

  const h = String(zoomMax) + String(rawMax.length) + getSyncInputsHash();
  if (h === simHash && cachedMaxDensity) return;
  simHash = h;

  cachedMaxDensity = calculateDensityCurve(rawMax, zoomMax);
  cachedRmseDensity = calculateDensityCurve(rawRmse, zoomMax);
}

export function drawTemporalChart(app: AppStateFull, force = false): void {
  const canvas = document.getElementById('temporal-chart') as HTMLCanvasElement | null;
  if (!canvas) return;
  appRef = app;

  const zoomMax = getTemporalZoom();
  const hash = String(zoomMax);
  if (hash === lastHash && !force) return;
  lastHash = hash;

  ensureDensityCurves();

  const parent = canvas.parentElement;
  if (!parent) return;
  const cssW = getCssWidth(parent);
  const cssH = cssW * (180 / 600);
  sizeCanvas(canvas, cssW, cssH);

  const ctx = getCanvasContext(canvas, cssW, cssH);
  if (!ctx) return;

  const pad = { top: 36, right: 40, bottom: 52, left: 60 };
  const plotW = cssW - pad.left - pad.right;
  const plotH = cssH - pad.top - pad.bottom;
  const yFloorPixel = cssH - pad.bottom;

  drawBackground(ctx, cssW, cssH);

  const maxDensity = cachedMaxDensity ?? new Float32Array(300);
  const rmseDensity = cachedRmseDensity ?? new Float32Array(300);
  const rawMax = getCachedMaxErrors();
  const maxStats = rawMax ? computeStats(rawMax) : { avg: 0, median: 0, p95: 0 };

  const xStep = niceStep(zoomMax, 8);
  const px = (mm: number) =>
    mapZoomedMetricsToPixels(mm, 0, zoomMax, yFloorPixel, plotH, pad.left, plotW).x;
  const py = (density: number) =>
    mapZoomedMetricsToPixels(0, density, zoomMax, yFloorPixel, plotH, pad.left, plotW).y;

  drawGrid(ctx, pad, cssW, cssH, zoomMax, xStep, 1.0, 0.1, px, py);

  drawAxes(ctx, pad, cssW, cssH);

  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  for (let y = 0; y <= 1.0; y += 0.5) {
    ctx.fillText(y.toFixed(1), pad.left - 8, py(y) + 4);
  }
  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Probability Density', 0, 0);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  for (let x = 0; x <= zoomMax; x += xStep) {
    ctx.fillText(x + 'mm', px(x), cssH - pad.bottom + 14);
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Spatial Error (mm)', pad.left + plotW / 2, cssH - 6);

  drawEnvelope(ctx, maxDensity, yFloorPixel, plotH, pad, plotW, zoomMax, '#ef4444');
  drawEnvelope(ctx, rmseDensity, yFloorPixel, plotH, pad, plotW, zoomMax, '#3b82f6');

  drawMarkers(ctx, maxStats, yFloorPixel, plotH, pad, plotW, zoomMax);

  const lx = pad.left + 10;
  const ly = pad.top + 16;
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';

  ctx.fillStyle = '#ef4444';
  ctx.fillText('\u2500\u2500 Max Error', lx, ly);
  ctx.fillStyle = '#3b82f6';
  ctx.fillText('\u2500\u2500 RMSE', lx, ly + 16);

  if (mouseInCanvas && mouseX >= pad.left && mouseX <= cssW - pad.right) {
    const hoverMm = ((mouseX - pad.left) / plotW) * zoomMax;
    const hoverX = px(hoverMm);

    ctx.strokeStyle = 'rgba(244, 114, 182, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(hoverX, pad.top);
    ctx.lineTo(hoverX, cssH - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    const binCount = 300;
    const binStep = zoomMax / binCount;
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor(hoverMm / binStep)));
    const maxD = bin < maxDensity.length ? maxDensity[bin] : 0;
    const rmseD = bin < rmseDensity.length ? rmseDensity[bin] : 0;

    const lines = [
      `${hoverMm.toFixed(1)} mm`,
      `Max: ${maxD.toFixed(3)}`,
      `RMSE: ${rmseD.toFixed(3)}`,
      `Max \u03bc=${maxStats.avg.toFixed(1)} \u03c3\u2089\u2085=${maxStats.p95.toFixed(1)}`,
    ];

    ctx.font = 'bold 11px monospace';
    const maxTW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const boxW = maxTW + 12;
    const boxH = lines.length * 15 + 8;

    let tipX = hoverX + 12;
    if (tipX + boxW > cssW - pad.right) tipX = hoverX - boxW - 12;
    let tipY = pad.top + 4;

    ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tipX, tipY, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f9a8d4';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(lines[0], tipX + 6, tipY + 13);
    ctx.fillStyle = '#ef4444';
    ctx.font = '10px monospace';
    ctx.fillText(lines[1], tipX + 6, tipY + 27);
    ctx.fillStyle = '#3b82f6';
    ctx.fillText(lines[2], tipX + 6, tipY + 41);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(lines[3], tipX + 6, tipY + 55);
  }

  setupEvents(canvas);
}

function drawEnvelope(
  ctx: CanvasRenderingContext2D,
  densities: Float32Array,
  yFloor: number,
  plotH: number,
  pad: { left: number; right: number },
  plotW: number,
  zMax: number,
  color: string,
): void {
  if (densities.length === 0) return;
  const n = densities.length;

  ctx.beginPath();
  const startX = pad.left;
  ctx.moveTo(startX, yFloor);

  for (let i = 0; i < n; i++) {
    const x = pad.left + (i / (n - 1)) * plotW;
    const pt = mapZoomedMetricsToPixels(0, densities[i], zMax, yFloor, plotH, pad.left, plotW);
    ctx.lineTo(x, pt.y);
  }

  ctx.lineTo(pad.left + plotW, yFloor);
  ctx.closePath();

  ctx.fillStyle = color + '22';
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  stats: { avg: number; median: number; p95: number },
  yFloor: number,
  plotH: number,
  pad: { left: number; right: number; top: number },
  plotW: number,
  zMax: number,
): void {
  const markers = [
    { val: stats.avg, label: 'Avg', clr: '#10b981' },
    { val: stats.median, label: 'Med', clr: '#a855f7' },
    { val: stats.p95, label: '95%', clr: '#f59e0b' },
  ];

  ctx.font = '12px monospace';
  ctx.textAlign = 'left';

  let labelY = pad.top + 8;
  for (const m of markers) {
    if (m.val > zMax) continue;
    const xPixel = pad.left + (m.val / zMax) * plotW;

    ctx.strokeStyle = m.clr;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xPixel, yFloor);
    ctx.lineTo(xPixel, yFloor - plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = m.clr;
    ctx.fillText(`${m.label}:${m.val.toFixed(1)}mm`, xPixel + 4, labelY);
    labelY += 16;
  }
}

function mapZoomedMetricsToPixels(
  mmValue: number,
  densityValue: number,
  activeZoomMax: number,
  yFloorPixel: number,
  chartMaxHeightPixels: number,
  paddingLeft: number,
  chartWidth: number,
): { x: number; y: number } {
  const MIN_SCALE_MM = 0;
  const clampedMm = Math.max(MIN_SCALE_MM, Math.min(mmValue, activeZoomMax));
  const pixelX = paddingLeft + (clampedMm / activeZoomMax) * chartWidth;

  const clampedDensity = Math.max(CANVAS_Y_MIN, Math.min(densityValue, CANVAS_Y_MAX));
  const pixelY = yFloorPixel - (clampedDensity / CANVAS_Y_MAX) * chartMaxHeightPixels;

  return { x: pixelX, y: pixelY };
}

function niceStep(range: number, divisions: number): number {
  const raw = range / divisions;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  if (normalized <= 1.5) return magnitude;
  if (normalized <= 3) return 2 * magnitude;
  if (normalized <= 7) return 5 * magnitude;
  return 10 * magnitude;
}

function setupEvents(canvas: HTMLCanvasElement): void {
  if (canvas.dataset.interactive) return;
  canvas.dataset.interactive = '1';

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseInCanvas = true;
    if (appRef) drawTemporalChart(appRef, true);
  };

  const onLeave = () => {
    mouseInCanvas = false;
    if (appRef) drawTemporalChart(appRef, true);
  };

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
}
