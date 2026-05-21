import type { AppStateFull, BottleneckType } from '../types';
import { formatLpMm, formatUm, formatFov, formatFeatureMm, formatSensorSize } from '../engine';
import { MJPG_BLOCK_SIZE_PX } from '../constants';

export function updateOutputs(app: AppStateFull): void {
  const r = app.results;
  const d = app.derived;

  setText('card-fc', formatLpMm(r.fcAberrated) + ' lp/mm');
  setText('card-nyquist', formatLpMm(r.fNyquistSkipped) + ' lp/mm');
  setText('card-fov', formatFov(d.diagonalFov));
  setText('card-skip', r.skippingFactor.toFixed(1) + '\u00d7');
  setText('card-effective', formatLpMm(r.fEffective) + ' lp/mm');
  setText('card-feature', formatUm(r.minFeatureSize) + ' \u03bcm');

  setText('derived-width', d.sensorWidth.toFixed(2) + ' mm');
  setText('derived-height', d.sensorHeight.toFixed(2) + ' mm');
  setText('derived-diagonal', d.sensorDiagonal.toFixed(2) + ' mm');
  setText('derived-size', formatSensorSize(d.sensorDiagonal));
  setText('derived-nyquist', formatLpMm(r.fNyquistNative) + ' lp/mm');

  updateBottleneckBanner(r.bottleneckType, app);
  updateConditionalNotes(app);
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateBottleneckBanner(type: BottleneckType, app: AppStateFull): void {
  const banner = document.getElementById('bottleneck-banner');
  if (!banner) return;

  const state = app.state;

  const config: Record<
    BottleneckType,
    { color: string; icon: string; text: string }
  > = {
    'lens-limited': {
      color: 'border-amber-700 bg-amber-950/30 text-amber-300',
      icon: '\u25cf',
      text: `Lens-limited: diffraction at f/${state.aperture.toFixed(1)} cuts detail before other limits. Software: open aperture (lower f-stop), use shorter wavelength. Hardware: upgrade lens tier, then sensor with larger pixels.`,
    },
    'sensor-limited': {
      color: 'border-orange-800 bg-orange-950/30 text-orange-300',
      icon: '\u25a0',
      text: 'Sensor-limited: pixel pitch caps resolution before the lens. Software: increase capture resolution, reduce binning/skipping. Hardware: sensor with smaller pixel pitch, then sharper lens.',
    },
    'compression-throttled': {
      color: 'border-red-800 bg-red-950/30 text-red-300',
      icon: '\u25a7',
      text: `Compression-throttled: MJPG Q=${state.mjpgQuality} + chroma subsampling erase fine detail. Software: switch to NV12/UYVY, raise JPEG quality, increase resolution. Hardware: camera with better codec or lower-compression pipeline.`,
    },
    'motion-limited': {
      color: 'border-yellow-800 bg-yellow-950/30 text-yellow-300',
      icon: '\u27f3',
      text: `Motion-limited: subject velocity blurs detail (MTF50 at ${app.results.fTemporal50.toFixed(1)} lp/mm). Software: faster shutter speed, increase frame rate, reduce resolution to raise FPS. Hardware: wider-aperture lens for shorter exposures, then higher-sensitivity sensor.`,
    },
    balanced: {
      color: 'border-emerald-800 bg-emerald-950/30 text-emerald-300',
      icon: '\u2713',
      text: 'Balanced: no single component dominates. Software: maintain current settings. Hardware: upgrade lens first, then sensor for overall gains.',
    },
  };

  const c = config[type];
  banner.className = `rounded-lg border ${c.color} p-3 text-xs`;
  banner.textContent = `${c.icon} ${c.text}`;
}

function updateConditionalNotes(app: AppStateFull): void {
  const container = document.getElementById('conditional-notes');
  if (!container) return;
  const notes: string[] = [];

  const state = app.state;

  if (state.outputFormat === 'mjpg') {
    notes.push(
      `CV features should span \u2265 ${MJPG_BLOCK_SIZE_PX} px to avoid 8\u00d78 macroblock distortion.`,
    );
  }

  if (state.measurementMode === 'chroma') {
    if (state.outputFormat === 'uyuv') {
      notes.push('Chroma mode: UYVY halves horizontal color resolution (4:2:2).');
    } else {
      notes.push(
        'Chroma mode: ' +
          (state.outputFormat === 'mjpg' ? 'MJPG' : 'NV12') +
          ' quarters color resolution (4:2:0 — half H \u00d7 half V).',
      );
    }
  }

  if (state.subsamplingMethod === 'line-skip') {
    notes.push(
      'Line skip subsampling introduces severe aliasing & moir\u00e9 from unsampled rows/columns.',
    );
  }

  if (state.wavelength > 780) {
    notes.push(
      `IR wavelength (${state.wavelength} nm): longer \u03bb means more diffraction blur — lower diffraction cutoff.`,
    );
  }

  if (state.wavelength < 400) {
    notes.push(
      `UV wavelength (${state.wavelength} nm): near the edge of the visible spectrum. Ensure your optics transmit at this \u03bb.`,
    );
  }

  if (state.extractedWidth < state.nativeWidth || state.extractedHeight < state.nativeHeight) {
    if (state.subsamplingMethod === 'binning-average') {
      notes.push(
        'Binning / averaging preserves field of view but reduces spatial resolution.',
      );
    }
  }

  container.innerHTML = notes
    .map(
      (n) =>
        `<p class="rounded border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-[11px] leading-relaxed text-slate-400">${n}</p>`,
    )
    .join('');
}
