import type { AppStateFull } from '../types';
import { pins } from './distanceChart';

const FRAME_RATES = [24, 25, 30, 50, 60, 90, 120];
const MAX_FPS = 120;

let lastHash = '';
let mouseX = -1;
let mouseY = -1;
let mouseInCanvas = false;
let appRef: AppStateFull | null = null;

function niceCeil(val: number): number {
  if (val <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(val)));
  const normalized = val / magnitude;
  if (normalized <= 1) return 1 * magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function featureMm(d: number, app: AppStateFull): number {
  return (app.results.minFeatureSize * d) / app.state.focalLength;
}

function speedAtFps(d: number, fps: number, app: AppStateFull): number {
  return featureMm(d, app) * fps;
}

function roundSpeed(v: number): string {
  return v >= 10 ? v.toFixed(0) : v < 1 ? v.toFixed(2) : v.toFixed(1);
}

export function drawTemporalChart(app: AppStateFull, force = false): void {
  const canvas = document.getElementById('temporal-chart') as HTMLCanvasElement | null;
  if (!canvas) return;
  appRef = app;

  const hash =
    String(app.results.minFeatureSize) +
    String(app.state.focalLength) +
    pins.map((p) => p.distance.toFixed(2) + p.color).join('|');
  if (hash === lastHash && !force) return;
  lastHash = hash;

  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;
  if (!parent) return;
  const parentStyle = getComputedStyle(parent);
  const cssW = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
  const cssH = cssW * (300 / 600);
  const bufW = Math.round(cssW * dpr);
  const bufH = Math.round(cssH * dpr);
  canvas.width = bufW;
  canvas.height = bufH;
  canvas.style.width = `${bufW / dpr}px`;
  canvas.style.height = `${bufH / dpr}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, cssW, cssH);

  const visiblePins = pins.filter((p) => p.distance > 0);

  const maxSpeed = visiblePins.length > 0
    ? Math.max(...visiblePins.map((p) => speedAtFps(p.distance, MAX_FPS, app)))
    : 0;
  const yMax = maxSpeed > 0 ? niceCeil(maxSpeed * 1.1) : 100;
  const yStep = niceCeil(yMax / 5);
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);

  const pad = { top: 36, right: 40, bottom: 52, left: 60 };
  const plotW = cssW - pad.left - pad.right;
  const plotH = cssH - pad.top - pad.bottom;
  const px = (fps: number) => pad.left + (fps / MAX_FPS) * plotW;
  const py = (val: number) => pad.top + (1 - val / yMax) * plotH;

  // Grid lines
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 0.5;
  for (const v of yTicks) {
    const yp = py(v);
    ctx.beginPath();
    ctx.moveTo(pad.left, yp);
    ctx.lineTo(cssW - pad.right, yp);
    ctx.stroke();
  }
  for (const fps of FRAME_RATES) {
    const xp = px(fps);
    ctx.beginPath();
    ctx.moveTo(xp, pad.top);
    ctx.lineTo(xp, cssH - pad.bottom);
    ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, cssH - pad.bottom);
  ctx.lineTo(cssW - pad.right, cssH - pad.bottom);
  ctx.stroke();

  // Y-axis labels
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  for (const v of yTicks) {
    ctx.fillText(String(v), pad.left - 8, py(v) + 4);
  }
  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Motion Speed (mm/s)', 0, 0);
  ctx.restore();

  // X-axis labels
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  for (const fps of FRAME_RATES) {
    ctx.fillText(String(fps), px(fps), cssH - pad.bottom + 14);
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Frame Rate (fps)', pad.left + plotW / 2, cssH - 6);

  // Empty state
  if (visiblePins.length === 0) {
    ctx.fillStyle = '#475569';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Pin a distance on the chart above to see temporal limits', pad.left + plotW / 2, pad.top + plotH / 2 + 4);
    setupEvents(canvas);
    return;
  }

  // Lines per pin
  for (const p of visiblePins) {
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let first = true;
    for (let fi = 0; fi <= MAX_FPS; fi++) {
      const s = speedAtFps(p.distance, fi, app);
      if (first) { ctx.moveTo(px(fi), py(s)); first = false; } else { ctx.lineTo(px(fi), py(s)); }
    }
    ctx.stroke();

    // Dots at standard frame rates
    for (const fps of FRAME_RATES) {
      const s = speedAtFps(p.distance, fps, app);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px(fps), py(s), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Legend
  ctx.font = '11px monospace';
  let lx = pad.left + 10;
  let ly = pad.top + 16;
  for (const p of visiblePins) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(lx + 5, ly - 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'left';
    ctx.fillText(p.distance.toFixed(1) + ' m', lx + 14, ly + 2);
    ly += 16;
  }

  // Hover cursor + tooltip
  if (mouseInCanvas && mouseX >= pad.left && mouseX <= cssW - pad.right) {
    const hoverFps = ((mouseX - pad.left) / plotW) * MAX_FPS;
    const hoverX = px(hoverFps);

    ctx.strokeStyle = 'rgba(244, 114, 182, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(hoverX, pad.top);
    ctx.lineTo(hoverX, cssH - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    const tooltipLines = [
      hoverFps.toFixed(0) + ' fps',
      ...visiblePins.map(
        (p) => p.distance.toFixed(1) + 'm: ' + roundSpeed(speedAtFps(p.distance, hoverFps, app)) + ' mm/s'
      ),
    ];

    ctx.font = 'bold 11px monospace';
    const maxTW = Math.max(...tooltipLines.map((l) => ctx.measureText(l).width));
    const boxW = maxTW + 12;
    const boxH = tooltipLines.length * 16 + 8;

    let tipX = hoverX + 12;
    if (tipX + boxW > cssW - pad.right) tipX = hoverX - boxW - 12;
    let tipY = mouseY - 8;
    if (tipY + boxH > cssH - pad.bottom) tipY = cssH - pad.bottom - boxH - 4;
    if (tipY < pad.top) tipY = pad.top + 4;

    ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tipX, tipY, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();

    // Header row
    ctx.fillStyle = '#f9a8d4';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(tooltipLines[0], tipX + 6, tipY + 13);

    // Pin rows
    for (let i = 1; i < tooltipLines.length; i++) {
      ctx.fillStyle = visiblePins[i - 1].color;
      ctx.font = '11px monospace';
      ctx.fillText(tooltipLines[i], tipX + 6, tipY + 13 + i * 16);
    }
  }

  setupEvents(canvas);
}

function setupEvents(canvas: HTMLCanvasElement): void {
  if (canvas.dataset.interactive) return;
  canvas.dataset.interactive = '1';

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
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
