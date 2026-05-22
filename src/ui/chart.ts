import type { AppStateFull } from '../types';
import { getTemporalVelocity, getShutterTime } from './temporalChart';

let lastHash = '';

export function drawChart(app: AppStateFull): void {
  const canvas = document.getElementById('mtf-chart') as HTMLCanvasElement | null;
  if (!canvas) return;

  const v = getTemporalVelocity();
  const shutterTime = getShutterTime();
  const hash = JSON.stringify(app.results) + String(v) + String(shutterTime);
  if (hash === lastHash) return;
  lastHash = hash;

  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;
  if (!parent) return;
  const parentStyle = getComputedStyle(parent);
  const cssW = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
  const cssH = cssW * (400 / 600);
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

  const { results, state } = app;
  const { fc, fcAberrated, fNyquistNative, fNyquistSkipped, fEffective, formatEfficiency, fDRLimited } = results;

  const xMax = Math.max(fc, fcAberrated, fNyquistNative, fNyquistSkipped, fDRLimited, fEffective, 200) * 1.15;

  const vImg = v * state.focalLength / Math.max(0.1, state.distanceToSubject);
  const fMotionNull = vImg > 1e-6 && shutterTime > 0 ? 1 / (vImg * shutterTime) : Infinity;
  const fMotionMTF50 = vImg > 1e-6 && shutterTime > 0 ? 0.603 / (vImg * shutterTime) : Infinity;

  const pad = { top: 36, right: 40, bottom: 54, left: 60 };
  const plotW = cssW - pad.left - pad.right;
  const plotH = cssH - pad.top - pad.bottom;
  const px = (x: number) => pad.left + (x / xMax) * plotW;
  const py = (y: number) => pad.top + (1 - y) * plotH;

  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, cssW, cssH);

  // Grid lines
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 0.5;
  for (let y = 0; y <= 1.0; y += 0.1) {
    const yp = py(y);
    ctx.beginPath();
    ctx.moveTo(pad.left, yp);
    ctx.lineTo(cssW - pad.right, yp);
    ctx.stroke();
  }
  const xStep = Math.max(10, Math.ceil(xMax / 8 / 50) * 50);
  for (let x = 0; x <= xMax; x += xStep) {
    const xp = px(x);
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
  for (let y = 0; y <= 1.0; y += 0.2) {
    ctx.fillText(y.toFixed(1), pad.left - 8, py(y) + 4);
  }
  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Contrast (MTF)', 0, 0);
  ctx.restore();

  // X-axis labels
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  for (let x = 0; x <= xMax; x += xStep) {
    ctx.fillText(String(x), px(x), cssH - pad.bottom + 14);
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Spatial Frequency (lp/mm)', pad.left + plotW / 2, cssH - 6);

  // MTF50 dashed line
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(pad.left, py(0.5));
  ctx.lineTo(cssW - pad.right, py(0.5));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#64748b';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('MTF50', cssW - pad.right + 4, py(0.5) + 3);

  // Lens MTF curve (blue)
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  let firstPoint = true;
  for (let f = 0; f <= xMax; f += 1) {
    const mtf = lensMtf(f, fcAberrated);
    if (firstPoint) { ctx.moveTo(px(f), py(mtf)); firstPoint = false; } else { ctx.lineTo(px(f), py(mtf)); }
  }
  ctx.stroke();

  // Temporal MTF curve (amber — motion blur low-pass)
  if (vImg > 1e-6 && fMotionNull < xMax * 4) {
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let firstPoint = true;
    for (let f = 0; f <= xMax; f += 0.5) {
      const mtf = temporalMtf(f, vImg, shutterTime);
      if (firstPoint) { ctx.moveTo(px(f), py(mtf)); firstPoint = false; } else { ctx.lineTo(px(f), py(mtf)); }
    }
    ctx.stroke();
  }

  // Collect marker labels for collision avoidance
  const topLabels: Array<{ x: number; text: string; color: string; font: string }> = [];

  // Native Nyquist marker (thin grey)
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(px(fNyquistNative), pad.top);
  ctx.lineTo(px(fNyquistNative), cssH - pad.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  topLabels.push({ x: px(fNyquistNative), text: 'Native Nyquist', color: '#94a3b8', font: '11px monospace' });

  // Effective Nyquist marker (orange bold)
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.beginPath();
  ctx.moveTo(px(fNyquistSkipped), pad.top);
  ctx.lineTo(px(fNyquistSkipped), cssH - pad.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  topLabels.push({ x: px(fNyquistSkipped), text: 'Sensor Limit', color: '#fb923c', font: 'bold 11px monospace' });

  // System effective curve (white)
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  firstPoint = true;
  for (let f = 0; f <= fNyquistSkipped; f += 1) {
    const mtf = lensMtf(f, fcAberrated) * formatEfficiency;
    if (firstPoint) { ctx.moveTo(px(f), py(mtf)); firstPoint = false; } else { ctx.lineTo(px(f), py(mtf)); }
  }
  ctx.stroke();

  // Total system curve (cyan — lens × sensor × temporal)
  if (vImg > 1e-6 && fMotionNull < xMax * 4) {
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    let firstSys = true;
    for (let f = 0; f <= fNyquistSkipped; f += 0.5) {
      const mtf = lensMtf(f, fcAberrated) * formatEfficiency * temporalMtf(f, vImg, shutterTime);
      if (firstSys) { ctx.moveTo(px(f), py(mtf)); firstSys = false; } else { ctx.lineTo(px(f), py(mtf)); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Motion MTF50 marker (amber dashed)
  if (vImg > 1e-6 && fMotionMTF50 > 0 && fMotionMTF50 <= xMax) {
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(px(fMotionMTF50), pad.top);
    ctx.lineTo(px(fMotionMTF50), cssH - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    topLabels.push({ x: px(fMotionMTF50), text: 'Motion MTF50', color: '#fbbf24', font: '11px monospace' });
  }

  // DR-limited marker (purple dotted)
  if (fDRLimited < fcAberrated * 0.99) {
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(px(fDRLimited), pad.top);
    ctx.lineTo(px(fDRLimited), cssH - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    topLabels.push({ x: px(fDRLimited), text: 'DR Limit', color: '#a855f7', font: '11px monospace' });
  }

  // Effective cutoff marker (red dotted)
  ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(px(fEffective), pad.top);
  ctx.lineTo(px(fEffective), cssH - pad.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  topLabels.push({ x: px(fEffective), text: 'Effective', color: '#fca5a5', font: 'bold 11px monospace' });

  // Draw top labels with collision avoidance
  ctx.textAlign = 'center';
  const placedBounds: Array<{ x1: number; x2: number; y: number }> = [];
  for (const lbl of topLabels) {
    ctx.font = lbl.font;
    const tw = ctx.measureText(lbl.text).width;
    let ly = pad.top - 8;
    const lx1 = lbl.x - tw / 2 - 4;
    const lx2 = lbl.x + tw / 2 + 4;
    while (placedBounds.some((b) => lx1 < b.x2 && lx2 > b.x1 && Math.abs(ly - b.y) < 16)) {
      ly -= 16;
    }
    placedBounds.push({ x1: lx1, x2: lx2, y: ly });
    ctx.fillStyle = lbl.color;
    ctx.fillText(lbl.text, lbl.x, ly);
  }

  // Legend
  const lx = cssW - pad.right - 180;
  const ly = pad.top + 8;
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(59, 130, 246, 0.9)';
  ctx.fillText('\u2500\u2500 Lens MTF', lx, ly);
  ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
  ctx.fillText('\u2500\u2500 Temporal MTF', lx, ly + 15);
  ctx.fillStyle = 'rgba(251, 146, 60, 0.9)';
  ctx.fillText('- - Sensor Limit', lx, ly + 30);
  ctx.fillStyle = 'rgba(248, 250, 252, 0.9)';
  ctx.fillText('\u2500\u2500 System', lx, ly + 45);
  ctx.fillStyle = 'rgba(34, 211, 238, 0.9)';
  ctx.fillText('- - System + Motion', lx, ly + 60);
  ctx.fillStyle = 'rgba(248, 113, 113, 0.9)';
  ctx.fillText('\u00b7\u00b7 Effective', lx, ly + 75);
}

function lensMtf(f: number, fcAberrated: number): number {
  if (f >= fcAberrated) return 0;
  const ratio = f / fcAberrated;
  return Math.max(0, 1 - ratio * ratio);
}

function sinc(x: number): number {
  if (Math.abs(x) < 1e-10) return 1;
  return Math.sin(Math.PI * x) / (Math.PI * x);
}

function temporalMtf(f: number, vImg: number, shutterS: number): number {
  if (vImg < 1e-9 || shutterS < 1e-9) return 1;
  return Math.abs(sinc(f * vImg * shutterS));
}
