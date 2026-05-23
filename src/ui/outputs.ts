import type { AppStateFull, BottleneckType, OutputFormat } from '../types';
import { formatLpMm, formatUm, formatFov, formatFeatureMm, formatSensorSize } from '../engine';
import { MJPG_BLOCK_SIZE_PX, H264_MB_SIZE_PX, RAW_FORMATS } from '../constants';
import { getFrameRate } from './temporalChart';

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

  updateBitrate(app);
  updateBottleneckBanner(r.bottleneckType, app);
  updateExposurePanel(app);
  updateConditionalNotes(app);
}

export function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

const BITS_PER_PIXEL: Record<OutputFormat, (quality?: number) => number> = {
  raw8: () => 8,
  raw10: () => 10,
  uyuv: () => 16,
  nv12: () => 12,
  mjpg: (q = 50) => q / 100 * 16,
  h264: () => 2,
};

function updateBitrate(app: AppStateFull): void {
  const el = document.getElementById('bitrate-display');
  if (!el) return;

  if (app.state.outputFormat === 'h264') {
    el.textContent = app.state.h264BitrateMbps.toFixed(1) + ' Mbps';
    return;
  }

  const fps = getFrameRate();
  const w = app.state.extractedWidth;
  const h = app.state.extractedHeight;
  const fmt = app.state.outputFormat;
  const quality = app.state.mjpgQuality;
  const bpp = BITS_PER_PIXEL[fmt](quality);
  const bitrateMbps = (w * h * fps * bpp) / 1_000_000;
  el.textContent = bitrateMbps >= 100
    ? Math.round(bitrateMbps) + ' Mbps'
    : bitrateMbps.toFixed(1) + ' Mbps';
}

function updateExposurePanel(app: AppStateFull): void {
  const bar = document.getElementById('exp-snr-bar');
  const label = document.getElementById('exp-snr-label');
  if (!bar || !label) return;

  const e = app.results.exposure;
  const snr = e.snrAtOptimalDb;
  const target = app.state.desiredSnrDb;

  label.textContent = snr.toFixed(1) + ' dB';

  let barColor: string;
  let barWidth: number;

  if (snr >= target) {
    barColor = '#10b981';
  } else if (snr >= target * 0.5) {
    barColor = '#eab308';
  } else {
    barColor = '#ef4444';
  }

  const linearSnr = Math.pow(10, snr / 20);
  const linearTarget = Math.pow(10, target / 20);
  barWidth = Math.max(3, Math.min(100, (linearSnr / linearTarget) * 100));
  bar.style.width = barWidth + '%';
  bar.style.backgroundColor = barColor;
}

function updateBottleneckBanner(type: BottleneckType, app: AppStateFull): void {
  const banner = document.getElementById('bottleneck-banner');
  if (!banner) return;
  // Preserve hidden state (set by tab switching) — className assignment clears it
  const wasHidden = banner.classList.contains('hidden');

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
      text: state.outputFormat === 'h264'
        ? `Compression-throttled: H.264 QP=${state.h264Qp} + chroma subsampling erase fine detail. Software: lower QP, switch to NV12/UYVY, increase resolution. Hardware: camera with better codec or lower-compression pipeline.`
        : `Compression-throttled: MJPG Q=${state.mjpgQuality} + chroma subsampling erase fine detail. Software: switch to NV12/UYVY, raise JPEG quality, increase resolution. Hardware: camera with better codec or lower-compression pipeline.`,
    },
    'motion-limited': {
      color: 'border-yellow-800 bg-yellow-950/30 text-yellow-300',
      icon: '\u27f3',
      text: `Motion-limited: subject velocity blurs detail (MTF50 at ${app.results.fTemporal50.toFixed(1)} lp/mm). Software: faster shutter speed, increase frame rate, reduce resolution to raise FPS. Hardware: wider-aperture lens for shorter exposures, then higher-sensitivity sensor.`,
    },
    'dr-limited': {
      color: 'border-purple-800 bg-purple-950/30 text-purple-300',
      icon: '\u25d8',
      text: `DR-limited: ${state.dynamicRangeDb}\u00a0dB dynamic range sets noise floor at ${(app.results.contrastFloor * 100).toFixed(3)}% contrast. Software: raise exposure, reduce noise (lower ISO/gain). Hardware: sensor with higher dynamic range, then wider-aperture lens for more light.`,
    },
    'sync-limited': {
      color: 'border-pink-800 bg-pink-950/30 text-pink-300',
      icon: '\u27f7',
      text: `Sync-limited: camera timing errors cause ${app.results.syncErrorP95.toFixed(1)}\u00a0mm positional uncertainty (MTF50 at ${app.results.fSyncMTF50 < 1000 ? app.results.fSyncMTF50.toFixed(1) : '\u221e'} lp/mm). Software: synchronize cameras tightly, reduce timing jitter. Hardware: genlock-capable cameras, hardware trigger sync.`,
    },
    'photon-starved': {
      color: 'border-indigo-800 bg-indigo-950/30 text-indigo-300',
      icon: '\u25c6',
      text: `Photon-starved: ${state.luxAtSubject.toFixed(1)} lux scene brightness limits SNR below ${state.desiredSnrDb}\u00a0dB target. Software: reduce SNR target, lower gain, reduce frame rate. Hardware: wider-aperture lens, larger pixels, higher-QE sensor, increase scene illumination.`,
    },
    balanced: {
      color: 'border-emerald-800 bg-emerald-950/30 text-emerald-300',
      icon: '\u2713',
      text: 'Balanced: no single component dominates. Software: maintain current settings. Hardware: upgrade lens first, then sensor for overall gains.',
    },
  };

  const c = config[type];
  banner.className = `mt-3 mb-3 rounded-lg border ${c.color} p-3 text-xs`;
  if (wasHidden) banner.classList.add('hidden');
  banner.textContent = `${c.icon} ${c.text}`;
}

function updateConditionalNotes(app: AppStateFull): void {
  const container = document.getElementById('processing-notes');
  if (!container) return;
  const notes: string[] = [];

  const state = app.state;

  if (state.outputFormat === 'mjpg') {
    notes.push(
      `CV features should span \u2265 ${MJPG_BLOCK_SIZE_PX} px to avoid 8\u00d78 macroblock distortion.`,
    );
  }

  if (state.outputFormat === 'h264') {
    notes.push(
      `Features should span \u2265 ${H264_MB_SIZE_PX} px for 16\u00d716 macroblock alignment. P-frames have lower quality than I-frames at the same QP.`,
    );
  }

  if (state.measurementMode === 'chroma') {
    if (state.outputFormat === 'uyuv') {
      notes.push('Chroma mode: UYVY halves horizontal color resolution (4:2:2).');
    } else if (state.outputFormat === 'h264') {
      notes.push('Chroma mode: H.264 quartes color resolution (4:2:0 \u2014 half H \u00d7 half V).');
    } else if (!(RAW_FORMATS as readonly string[]).includes(state.outputFormat)) {
      notes.push(
        'Chroma mode: ' +
          (state.outputFormat === 'mjpg' ? 'MJPG' : 'NV12') +
          ' quarters color resolution (4:2:0 \u2014 half H \u00d7 half V).',
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
