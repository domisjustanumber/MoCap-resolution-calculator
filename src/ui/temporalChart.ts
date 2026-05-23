// Multi-Camera Kinematic Sync Error Distribution
// Monte Carlo simulation + KDE, based on temporal_chart_example.html

const SAMPLE_SIZE = 2500;
const MIN_SCALE_MM = 0;
const CANVAS_Y_MIN = 0.0;
const CANVAS_Y_MAX = 1.0;

let lastHash = '';
let simHash = '';
let mouseX = -1;
let mouseInCanvas = false;
let appRef: AppStateFull | null = null;

// Cached simulation results — only regenerate when inputs change
let cachedMaxErrors: Float32Array | null = null;
let cachedRmseErrors: Float32Array | null = null;
let cachedMaxDensity: Float32Array | null = null;
let cachedRmseDensity: Float32Array | null = null;
let cachedMaxStats: { avg: number; median: number; p95: number } | null = null;

// Chart inputs
let zoomMax = 200;
let targetVelocity = 0;   // m/s — used for temporal Monte Carlo simulation
let spatialVelocity = 1.5; // m/s — used for spatial chart motion curves
let frameRate = 30;        // fps
let shutterDenom = 60;     // 1/N seconds
let phaseOffset = 16.6;   // ms
let jitterMs = 10.0;      // ms

let syncToggle = false;
export function isSyncToggleOn(): boolean { return syncToggle; }
export function setSyncToggle(on: boolean): void { syncToggle = on; }

function makeSimHash(): string {
  return String(targetVelocity) + String(frameRate) + String(phaseOffset) + String(jitterMs);
}

function runAndCacheSimulation(): void {
  const inputHash = makeSimHash();
  if (inputHash === simHash && cachedMaxErrors && cachedRmseErrors) return;
  simHash = inputHash;
  const { maxErrors, rmseErrors } = runSimulation();
  cachedMaxErrors = maxErrors;
  cachedRmseErrors = rmseErrors;
  cachedMaxDensity = calculateDensityCurve(maxErrors, zoomMax);
  cachedRmseDensity = calculateDensityCurve(rmseErrors, zoomMax);
  cachedMaxStats = computeStats(maxErrors);
}

export function getSyncErrorP95(): number {
  runAndCacheSimulation();
  return cachedMaxStats!.p95;
}
export function getSyncInputsHash(): string {
  return makeSimHash();
}

export function getTemporalVelocity(): number { return targetVelocity; }
export function getSpatialVelocity(): number { return spatialVelocity; }
export function setSpatialVelocity(v: number): void { spatialVelocity = Math.max(0, Math.min(20, v)); }
export function getFrameRate(): number { return frameRate; }
export function getShutterTime(): number { return 1 / shutterDenom; }
export function getShutterDenom(): number { return shutterDenom; }

export function setTemporalZoom(max: number): void {
  zoomMax = Math.max(10, Math.min(500, Math.round(max)));
  if (appRef) drawTemporalChart(appRef, true);
}
export function setTemporalVelocity(v: number): void {
  targetVelocity = Math.max(0, Math.min(20, v));
  if (appRef) drawTemporalChart(appRef, true);
}
export function setTemporalPhase(ms: number): void {
  phaseOffset = Math.max(0, Math.min(300, ms));
  if (appRef) drawTemporalChart(appRef, true);
}
let maxFps = 240;
export function setMaxFpsLimit(max: number): void { maxFps = max; }
export function getMaxFpsLimit(): number { return maxFps; }

let maxShutterDenom = 8000;
export function setMaxShutterLimit(max: number): void { maxShutterDenom = max; }
export function getMaxShutterLimit(): number { return maxShutterDenom; }

const SHUTTER_PRESETS = [30, 60, 120, 250, 500, 1000];
export function setFrameRate(fps: number): void {
  frameRate = Math.max(1, Math.min(maxFps, Math.round(fps)));
  if (shutterDenom < frameRate) {
    const valid = SHUTTER_PRESETS.filter(p => p >= frameRate);
    shutterDenom = valid.length > 0 ? valid[0] : frameRate;
  }
  if (appRef) drawTemporalChart(appRef, true);
}

export function setShutterDenom(d: number): void {
  const minDenom = frameRate;
  shutterDenom = Math.max(minDenom, Math.min(maxShutterDenom, Math.round(d)));
  if (appRef) drawTemporalChart(appRef, true);
}
export function setTemporalJitter(ms: number): void {
  jitterMs = Math.max(0, Math.min(300, ms));
  if (appRef) drawTemporalChart(appRef, true);
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

interface SimResult {
  maxErrors: Float32Array;
  rmseErrors: Float32Array;
}

function runSimulation(): SimResult {
  const v = targetVelocity;       // m/s = mm/ms
  const fps = frameRate;
  const phaseMs = phaseOffset;
  const jitMs = jitterMs;

  const frameTimeMs = 1000 / fps;
  const v_mm_ms = v;

  const maxErrors = new Float32Array(SAMPLE_SIZE);
  const rmseErrors = new Float32Array(SAMPLE_SIZE);

  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const basePhase = Math.random() * frameTimeMs;

    // Box-Muller Gaussian jitter
    const u1 = 1.0 - Math.random();
    const u2 = 1.0 - Math.random();
    const randGen = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    const cam1Time = basePhase;
    const cam2Time = basePhase + phaseMs + randGen * jitMs;

    const deltaT = Math.abs(cam1Time - cam2Time);
    const spatialError = deltaT * v_mm_ms;

    maxErrors[i] = spatialError;
    rmseErrors[i] = spatialError / Math.sqrt(2);
  }

  return { maxErrors, rmseErrors };
}

function calculateDensityCurve(data: Float32Array, maxZoomMM: number): Float32Array {
  const binCount = 300;
  const densities = new Float32Array(binCount);
  const step = maxZoomMM / binCount;
  const bandwidth = Math.max(1.2, maxZoomMM * 0.02);

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

function computeStats(data: Float32Array): { avg: number; median: number; p95: number } {
  const sorted = [...data].sort((a, b) => a - b);
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { avg, median, p95 };
}

import type { AppStateFull } from '../types';
import { getCssWidth, sizeCanvas, getCanvasContext, drawBackground, drawGrid, drawAxes } from './canvasUtils';

export function drawTemporalChart(app: AppStateFull, force = false): void {
  const canvas = document.getElementById('temporal-chart') as HTMLCanvasElement | null;
  if (!canvas) return;
  appRef = app;

  const hash =
    String(zoomMax) +
    String(targetVelocity) +
    String(frameRate) +
    String(phaseOffset) +
    String(jitterMs);
  if (hash === lastHash && !force) return;
  lastHash = hash;

  // Only re-run the Monte Carlo simulation when input values change
  runAndCacheSimulation();

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

  // Use cached simulation results (stable across mouse moves)
  const maxDensity = cachedMaxDensity ?? new Float32Array(300);
  const rmseDensity = cachedRmseDensity ?? new Float32Array(300);
  const maxStats = cachedMaxStats ?? { avg: 0, median: 0, p95: 0 };

  // Grid lines
  const xStep = niceStep(zoomMax, 8);
  const px = (mm: number) =>
    mapZoomedMetricsToPixels(mm, 0, zoomMax, yFloorPixel, plotH, pad.left, plotW).x;
  const py = (density: number) =>
    mapZoomedMetricsToPixels(0, density, zoomMax, yFloorPixel, plotH, pad.left, plotW).y;

  drawGrid(ctx, pad, cssW, cssH, zoomMax, xStep, 1.0, 0.1, px, py);

  // Axes
  drawAxes(ctx, pad, cssW, cssH);

  // Y-axis labels
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

  // X-axis labels
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

  // Draw filled curves
  drawEnvelope(ctx, maxDensity, yFloorPixel, plotH, pad, plotW, zoomMax, '#ef4444');
  drawEnvelope(ctx, rmseDensity, yFloorPixel, plotH, pad, plotW, zoomMax, '#3b82f6');

  // Statistical markers for max error distribution
  drawMarkers(ctx, maxStats, yFloorPixel, plotH, pad, plotW, zoomMax);

  // Legend
  const lx = pad.left + 10;
  const ly = pad.top + 16;
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';

  ctx.fillStyle = '#ef4444';
  ctx.fillText('── Max Error', lx, ly);
  ctx.fillStyle = '#3b82f6';
  ctx.fillText('── RMSE', lx, ly + 16);

  // Hover cursor + tooltip
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

    // Tooltip
    const binCount = 300;
    const binStep = zoomMax / binCount;
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor(hoverMm / binStep)));
    const maxD = bin < maxDensity.length ? maxDensity[bin] : 0;
    const rmseD = bin < rmseDensity.length ? rmseDensity[bin] : 0;

    const lines = [
      `${hoverMm.toFixed(1)} mm`,
      `Max: ${maxD.toFixed(3)}`,
      `RMSE: ${rmseD.toFixed(3)}`,
      `Max μ=${maxStats.avg.toFixed(1)} σ₉₅=${maxStats.p95.toFixed(1)}`,
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
