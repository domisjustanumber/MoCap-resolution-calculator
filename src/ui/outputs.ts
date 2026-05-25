import type { AppStateFull, BottleneckType, OutputFormat } from '../types';
import { formatLpMm, formatUm, formatFov, formatFeatureMm, formatSensorSize } from '../engine';
import { MJPG_BLOCK_SIZE_PX, H264_MB_SIZE_PX, RAW_FORMATS } from '../constants';
import { getFrameRate, getShutterTime, getMotionParams, getErrorBudget } from './temporalChart';
import { SENSOR_RADIOMETRY } from '../../presets';
import { DEFAULT_RADIOMETRY } from '../constants';

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

  // Max acceleration / rotation detection limits
  const fps = getFrameRate();
  const motion = getMotionParams();
  const epsilon = getErrorBudget() / 1000;
  const maxAccel = epsilon * fps * fps;
  const maxTurn = (epsilon * fps / motion.subjectHalfWidth) * (180 / Math.PI);

  const accelExceeded = motion.acceleration > maxAccel;
  const accelText = maxAccel.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' m/s²';
  setText('card-max-accel', accelExceeded ? '⚠ ' + accelText : accelText);
  setText('card-max-turn', maxTurn.toLocaleString() + ' °/s');

  const accelEl = document.getElementById('card-max-accel');
  if (accelEl) {
    accelEl.className = `mt-0.5 text-lg font-bold font-mono ${accelExceeded ? 'text-red-400' : 'text-slate-100'}`;
  }
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

  let mbps: number;
  if (app.state.outputFormat === 'h264') {
    mbps = app.state.h264BitrateMbps;
  } else {
    const fps = getFrameRate();
    const w = app.state.extractedWidth;
    const h = app.state.extractedHeight;
    const fmt = app.state.outputFormat;
    const quality = app.state.mjpgQuality;
    const bpp = BITS_PER_PIXEL[fmt](quality);
    mbps = (w * h * fps * bpp) / 1_000_000;
  }
  el.textContent = Math.round(mbps).toLocaleString('en-US') + ' Mbps';
}

function updateExposurePanel(app: AppStateFull): void {
  updateSnrBar(app);
  updateAccelBar();
  updateRotBar();
}

const SNR_BAR_MAX_DB = 50;

function updateSnrBar(app: AppStateFull): void {
  const bar = document.getElementById('exp-snr-bar');
  const label = document.getElementById('exp-snr-label');
  const marker = document.getElementById('exp-snr-target-marker');
  if (!bar || !label) return;

  const e = app.results.exposure;
  const shutterTime = getShutterTime();
  const actualElectrons = e.electronsPerPxPerSec * Math.max(0.00001, shutterTime);
  const radiometry = SENSOR_RADIOMETRY[app.activeSensorPreset] || DEFAULT_RADIOMETRY;
  const RN2 = radiometry.readNoiseE * radiometry.readNoiseE;
  const DC = radiometry.darkCurrentE * shutterTime;
  const totalNoise = Math.sqrt(actualElectrons + RN2 + DC);
  const snr = totalNoise > 0 ? 20 * Math.log10(actualElectrons / totalNoise) : 0;
  const target = app.state.desiredSnrDb;
  const snrRounded = Math.round(snr * 10) / 10;

  label.textContent = snr.toFixed(1) + ' dB';

  let barColor: string;
  if (snrRounded >= target) {
    barColor = '#10b981';
  } else if (snrRounded >= target * 0.5) {
    barColor = '#eab308';
  } else {
    barColor = '#ef4444';
  }

  const pct = Math.max(0, Math.min(100, (snrRounded / SNR_BAR_MAX_DB) * 100));
  bar.style.width = pct + '%';
  bar.style.backgroundColor = barColor;

  if (marker) {
    const markerPct = Math.min(100, (target / SNR_BAR_MAX_DB) * 100);
    marker.style.left = markerPct + '%';
    marker.style.display = 'block';
  }
}

const ACCEL_BAR_MAX = 50;
const ROT_BAR_MAX = 120;

function updateAccelBar(): void {
  const bar = document.getElementById('exp-accel-bar');
  const label = document.getElementById('exp-accel-label');
  const marker = document.getElementById('exp-accel-target-marker');
  if (!bar || !label) return;

  const fps = getFrameRate();
  const motion = getMotionParams();
  const epsilon = getErrorBudget() / 1000;
  const maxAccel = epsilon * fps * fps;
  const target = motion.acceleration;

  label.textContent = maxAccel.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' m/s²';

  let barColor: string;
  if (target < 1e-6 || maxAccel >= target) {
    barColor = '#10b981';
  } else if (maxAccel >= target * 0.5) {
    barColor = '#eab308';
  } else {
    barColor = '#ef4444';
  }

  const pct = Math.max(0, Math.min(100, (maxAccel / ACCEL_BAR_MAX) * 100));
  bar.style.width = pct + '%';
  bar.style.backgroundColor = barColor;

  if (marker) {
    const markerPct = Math.min(100, (target / ACCEL_BAR_MAX) * 100);
    marker.style.left = markerPct + '%';
    marker.style.display = 'block';
  }
}

function updateRotBar(): void {
  const bar = document.getElementById('exp-rot-bar');
  const label = document.getElementById('exp-rot-label');
  const marker = document.getElementById('exp-rot-target-marker');
  if (!bar || !label) return;

  const fps = getFrameRate();
  const motion = getMotionParams();
  const epsilon = getErrorBudget() / 1000;
  const maxTurn = (epsilon * fps / motion.subjectHalfWidth) * (180 / Math.PI);
  const target = motion.angularVelocity;

  label.textContent = maxTurn.toLocaleString() + ' °/s';

  let barColor: string;
  if (target < 1e-6 || maxTurn >= target) {
    barColor = '#10b981';
  } else if (maxTurn >= target * 0.5) {
    barColor = '#eab308';
  } else {
    barColor = '#ef4444';
  }

  const pct = Math.max(0, Math.min(100, (maxTurn / ROT_BAR_MAX) * 100));
  bar.style.width = pct + '%';
  bar.style.backgroundColor = barColor;

  if (marker) {
    const markerPct = Math.min(100, (target / ROT_BAR_MAX) * 100);
    marker.style.left = markerPct + '%';
    marker.style.display = 'block';
  }
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
  const procContainer = document.getElementById('processing-notes');
  const compContainer = document.getElementById('compression-notes');
  const wavelengthContainer = document.getElementById('wavelength-notes');
  const procNotes: string[] = [];
  const compNotes: string[] = [];
  const wavelengthNotes: string[] = [];

  const state = app.state;

  if (state.outputFormat === 'mjpg') {
    compNotes.push(
      `CV features should span \u2265 ${MJPG_BLOCK_SIZE_PX} px to avoid 8\u00d78 macroblock distortion.`,
    );
  }

  if (state.outputFormat === 'h264') {
    compNotes.push(
      `Features should span \u2265 ${H264_MB_SIZE_PX} px for 16\u00d716 macroblock alignment. P-frames have lower quality than I-frames at the same QP.`,
    );
  }

  if (state.measurementMode === 'colour') {
    if (state.outputFormat === 'uyuv') {
      compNotes.push('Colour mode: UYVY halves horizontal color resolution (4:2:2).');
    } else if (state.outputFormat === 'h264') {
      compNotes.push('Colour mode: H.264 quarters color resolution (4:2:0 \u2014 half H \u00d7 half V).');
    } else if (!(RAW_FORMATS as readonly string[]).includes(state.outputFormat)) {
      compNotes.push(
        'Colour mode: ' +
          (state.outputFormat === 'mjpg' ? 'MJPG' : 'NV12') +
          ' quarters color resolution (4:2:0 \u2014 half H \u00d7 half V).',
      );
    }
  }

  if (state.selectedV4l2Mode >= 0) {
    if (state.readoutMethod === 'subsampling') {
      procNotes.push(
        'Subsampling (line-skip / average) preserves field of view but reduces spatial resolution via pixel decimation.',
      );
    }
  } else {
    if (state.readoutMethod === 'subsampling') {
      procNotes.push(
        'Subsampling (line-skip / averaging) introduces aliasing from unsampled rows/columns.',
      );
    }
    if (state.readoutMethod === 'cropping') {
      procNotes.push(
        'Cropping uses a smaller region of the sensor — field of view is reduced but pixel pitch is unchanged.',
      );
    }
    if (state.readoutMethod === 'binning') {
      procNotes.push(
        'Binning averages adjacent pixels — field of view is preserved, effective pixel pitch increases.',
      );
    }
  }

  if (state.wavelength > 780) {
    wavelengthNotes.push(
      `IR wavelength (${state.wavelength} nm): longer \u03bb means more diffraction blur — lower diffraction cutoff.`,
    );
  }

  if (state.wavelength < 400) {
    wavelengthNotes.push(
      `UV wavelength (${state.wavelength} nm): near the edge of the visible spectrum. Ensure your optics transmit at this \u03bb.`,
    );
  }

  const noteHtml = (n: string) =>
    `<p class="rounded border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-[11px] leading-relaxed text-slate-400">${n}</p>`;

  if (procContainer) procContainer.innerHTML = procNotes.map(noteHtml).join('');
  if (compContainer) compContainer.innerHTML = compNotes.map(noteHtml).join('');
  if (wavelengthContainer) wavelengthContainer.innerHTML = wavelengthNotes.map(noteHtml).join('');
}
