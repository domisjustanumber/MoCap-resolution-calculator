import type { AppStateFull } from '../types';
import { getCssWidth, sizeCanvas, getCanvasContext, drawBackground, drawGrid, drawAxes } from './canvasUtils';
import { isSyncToggleOn, getSyncErrorP95, getMotionParams, getShutterTime } from '../temporalState';
import { MOTION_MTF50_CONST, BOTTLENECK_RATIO } from '../constants';
import { computeImageVelocity } from '../engine';

let lastHash = '';
let mouseX = -1;
let mouseY = -1;
let mouseInCanvas = false;
let appRef: AppStateFull | null = null;
let maxDistance = 3;
let yMaxOverride = 100;

export interface Pin {
  distance: number;
  color: string;
}

export let pins: Pin[] = [];
let hasAutoPlaced = false;

let onPinsChanged: (() => void) | null = null;
export function setOnPinsChanged(cb: () => void): void {
  onPinsChanged = cb;
}

const PIN_COLORS = [
  '#fbbf24',
  '#fb7185',
  '#22d3ee',
  '#a3e635',
  '#a78bfa',
  '#fb923c',
  '#34d399',
  '#38bdf8',
];

let nextColorIndex = 0;

export function setMaxDistance(d: number): void {
  maxDistance = Math.max(1, d);
}

export function setYMax(y: number): void {
  yMaxOverride = Math.max(20, Math.min(500, y));
}

function setupEvents(canvas: HTMLCanvasElement): void {
  if (canvas.dataset.interactive) return;
  canvas.dataset.interactive = '1';

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    mouseInCanvas = true;
    if (appRef) drawDistanceChart(appRef, true);
  };

  const onLeave = () => {
    mouseInCanvas = false;
    if (appRef) drawDistanceChart(appRef, true);
  };

  const onClick = () => {
    if (!mouseInCanvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = mouseX;
  const pad = { top: 36, right: 50, bottom: 52, left: 60 };
    const plotW = rect.width - pad.left - pad.right;
    const dClicked = ((clickX - pad.left) / plotW) * maxDistance;
    if (dClicked < 0 || dClicked > maxDistance) return;

    const clickPx = (clickX - pad.left) / plotW;
    const existingIdx = pins.findIndex((p) => {
      const pPx = p.distance / maxDistance;
      return Math.abs(pPx - clickPx) * plotW < 10;
    });

    if (existingIdx >= 0) {
      pins.splice(existingIdx, 1);
    } else {
      pins.push({ distance: dClicked, color: PIN_COLORS[nextColorIndex % PIN_COLORS.length] });
      nextColorIndex++;
    }
    if (appRef) drawDistanceChart(appRef, true);
    if (onPinsChanged) onPinsChanged();
  };

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);
}

export function drawDistanceChart(app: AppStateFull, force = false): void {
  const canvas = document.getElementById('distance-chart') as HTMLCanvasElement | null;
  if (!canvas) return;
  appRef = app;

  const hash =
    String(app.results.minFeatureSize) +
    String(app.state.focalLength) +
    String(maxDistance) +
    String(yMaxOverride) +
    pins.map((p) => p.distance.toFixed(2) + p.color).join('|') +
    String(isSyncToggleOn()) +
    String(getSyncErrorP95()) +
    String(getShutterTime()) +
    JSON.stringify(getMotionParams());
  if (hash === lastHash && !force) return;
  lastHash = hash;

  const parent = canvas.parentElement;
  if (!parent) return;
  const cssW = getCssWidth(parent);
  const refCanvas = document.getElementById('mtf-chart') as HTMLCanvasElement | null;
  const refH = refCanvas ? parseFloat(refCanvas.style.height) : cssW * (400 / 600);
  const cssH = refH;
  sizeCanvas(canvas, cssW, cssH);

  const ctx = getCanvasContext(canvas, cssW, cssH);
  if (!ctx) return;

  const { results, state } = app;
  const { minFeatureSize, fcAberrated, fNyquistSkipped, fDRLimited, formatEfficiency } = results;
  const { focalLength } = state;
  const dMax = maxDistance;

  const motion = getMotionParams();
  const shutterS = getShutterTime();

  const syncEnabled = isSyncToggleOn();
  const syncErrP95 = getSyncErrorP95();

  const yMax = yMaxOverride;

  const pad = { top: 36, right: 50, bottom: 52, left: 60 };
  const plotW = cssW - pad.left - pad.right;
  const plotH = cssH - pad.top - pad.bottom;
  const px = (d: number) => pad.left + (d / dMax) * plotW;

  // Per-pixel motion blur ceiling — vImg depends on distance
  const { vTotal } = computeImageVelocity(motion, shutterS, focalLength, 1);

  // Max trackable velocity (right y-axis)
  const fSyncMTF50_local = syncEnabled && syncErrP95 > 0.001 ? 0.1874 / syncErrP95 : Infinity;
  const nextBestLimit = Math.min(fcAberrated, fNyquistSkipped, fDRLimited, fSyncMTF50_local);
  const vTargetFreq = nextBestLimit * BOTTLENECK_RATIO;
  const vScaleStep = 2;
  const vScaleMax = 20;
  const vAtD = (d: number) => MOTION_MTF50_CONST * d / (shutterS * focalLength * vTargetFreq);
  const pyV = (v: number) => pad.top + (1 - v / vScaleMax) * plotH;

  const featureMm = (d: number) => {
    const dEff = Math.max(0.01, d);
    if (vTotal > 1e-6 && shutterS > 1e-9) {
      const vImg = vTotal * focalLength / dEff;
      if (vImg > 1e-6) {
        const fTemporal = MOTION_MTF50_CONST / (vImg * shutterS);
        const fEffective = Math.min(fcAberrated, fNyquistSkipped, fTemporal, fDRLimited) * formatEfficiency;
        if (fEffective > 1e-6) {
          const minFeat = 500 / fEffective;
          const optical = (minFeat * dEff) / focalLength;
          return syncEnabled ? Math.hypot(optical, syncErrP95) : optical;
        }
      }
    }
    // Fallback: no meaningful motion blur, use original formula
    const optical = (minFeatureSize * dEff) / focalLength;
    return syncEnabled ? Math.hypot(optical, syncErrP95) : optical;
  };

  const yStep = yMax / 5;
  const py = (f: number) => pad.top + (1 - f / yMax) * plotH;

  drawBackground(ctx, cssW, cssH);

  // Grid lines
  const xStep = Math.max(0.5, Math.ceil(dMax / 6));
  drawGrid(ctx, pad, cssW, cssH, dMax, xStep, yMax, yStep, px, py);

  // Axes
  drawAxes(ctx, pad, cssW, cssH);

  // Y-axis labels
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  for (let y = 0; y <= yMax; y += yStep) {
    const yp = py(y);
    ctx.fillText(String(y), pad.left - 8, yp + 4);
  }
  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Min Resolvable Feature (mm)', 0, 0);
  ctx.restore();

  // Right y-axis: Max Trackable Velocity (always 0–20 m/s)
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cssW - pad.right, pad.top);
  ctx.lineTo(cssW - pad.right, cssH - pad.bottom);
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  for (let v = 0; v <= vScaleMax; v += vScaleStep) {
    const yp = pyV(v);
    ctx.beginPath();
    ctx.moveTo(cssW - pad.right, yp);
    ctx.lineTo(cssW - pad.right + 6, yp);
    ctx.stroke();
    ctx.fillText(String(v), cssW - pad.right + 10, yp + 4);
  }

  ctx.save();
  ctx.translate(cssW - 12, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Max Trackable Velocity (m/s)', 0, 0);
  ctx.restore();

  // X-axis labels
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  for (let d = 0; d <= dMax; d += xStep) {
    ctx.fillText(d.toFixed(d % 1 === 0 ? 0 : 1), px(d), cssH - pad.bottom + 14);
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Distance from Camera (m)', pad.left + plotW / 2, cssH - 6);

  // Line: feature size vs distance (clipped to plot area)
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, plotH);
  ctx.clip();
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  let first = true;
  for (let d = 0; d <= dMax; d += dMax / 100) {
    const f = featureMm(d);
    if (first) { ctx.moveTo(px(d), py(f)); first = false; } else { ctx.lineTo(px(d), py(f)); }
  }
  ctx.stroke();
  ctx.restore();

  // Velocity curve (right y-axis)
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, plotH);
  ctx.clip();

  ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  let firstV = true;
  for (let d = 0; d <= dMax; d += dMax / 100) {
    const v = vAtD(d);
    if (!isFinite(v)) continue;
    if (firstV) { ctx.moveTo(px(d), pyV(v)); firstV = false; }
    else { ctx.lineTo(px(d), pyV(v)); }
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Current vTotal reference line
  if (vTotal <= vScaleMax) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, plotW, plotH);
    ctx.clip();

    ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(px(0), pyV(vTotal));
    ctx.lineTo(px(dMax), pyV(vTotal));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.fillStyle = 'rgba(34, 211, 238, 0.5)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    const vLabelX = Math.min(px(0.15), cssW - pad.right - 60);
    ctx.fillText(vTotal.toFixed(1) + ' m/s', vLabelX, pyV(vTotal) - 4);
  }

  // Auto-place first pin at 2m on initial draw
  if (pins.length === 0 && !hasAutoPlaced && maxDistance >= 2) {
    pins.push({ distance: 2, color: PIN_COLORS[0] });
    nextColorIndex = 1;
    hasAutoPlaced = true;
  }

  // Pinned markers
  const usedLabelYs: number[] = [];
  for (const pin of pins) {
    if (pin.distance < 0 || pin.distance > dMax) continue;
    const pinnedX = px(pin.distance);
    const pinnedY = py(featureMm(pin.distance));

    ctx.strokeStyle = pin.color + 'b3';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(pinnedX, pad.top);
    ctx.lineTo(pinnedX, cssH - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = pin.color;
    ctx.beginPath();
    ctx.arc(pinnedX, pinnedY, 5, 0, Math.PI * 2);
    ctx.fill();

    const fMm = featureMm(pin.distance);
    const pinLabel = fMm.toFixed(2) + ' mm @ ' + pin.distance.toFixed(1) + ' m | ChArUco ' + (fMm * 8.8).toFixed(1) + ' mm';
    ctx.font = 'bold 11px monospace';
    const textW = ctx.measureText(pinLabel).width;
    const bx = Math.min(pinnedX + 10, cssW - pad.right - textW - 12);
    let by = pinnedY - 14;
    while (usedLabelYs.some((y) => Math.abs(y - by) < 20)) {
      by += 20;
    }
    usedLabelYs.push(by);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
    ctx.strokeStyle = pin.color + '99';
    ctx.lineWidth = 1;
    const bpad = 6;
    ctx.beginPath();
    ctx.roundRect(bx - bpad, by - bpad, textW + bpad * 2, 18 + bpad * 2, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pin.color;
    ctx.textAlign = 'left';
    ctx.fillText(pinLabel, bx, by + 5);
  }

  setupEvents(canvas);

  // Mouse cursor overlay
  if (mouseInCanvas && mouseX >= pad.left && mouseX <= cssW - pad.right) {
    const dHover = ((mouseX - pad.left) / plotW) * dMax;
    const fHover = featureMm(dHover);
    const hoverX = px(dHover);
    const hoverY = py(fHover);

    // Vertical cursor line
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(hoverX, pad.top);
    ctx.lineTo(hoverX, cssH - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dot on the feature size curve
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(hoverX, hoverY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Dot on the velocity curve
    const vHover = vAtD(dHover);
    const vHoverY = pyV(vHover);
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(hoverX, vHoverY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Tooltip box
    const velText = ' | max ' + vAtD(dHover).toFixed(1) + ' m/s';
    const tooltipText = fHover.toFixed(2) + ' mm @ ' + dHover.toFixed(1) + ' m | ChArUco ' + (fHover * 8.8).toFixed(1) + ' mm' + velText;
    const tipX = hoverX + 10 < cssW - pad.right ? hoverX + 10 : hoverX - 10;
    const tipY = hoverY - 10 > pad.top ? hoverY - 10 : hoverY + 10;
    ctx.font = 'bold 11px monospace';
    const textW = ctx.measureText(tooltipText).width;
    const bx = tipX < hoverX ? tipX - textW - 16 : tipX - 4;
    const by = tipY < hoverY ? tipY - 18 : tipY + 4;

    ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.6)';
    ctx.lineWidth = 1;
    const bpad = 6;
    ctx.beginPath();
    ctx.roundRect(bx - bpad, by - bpad, textW + bpad * 2, 18 + bpad * 2, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f9a8d4';
    ctx.textAlign = 'left';
    ctx.fillText(tooltipText, bx, by + 5);

  }
}
