import type { AppStateFull } from '../types';
import { runOptimization } from '../optimizer';
import { recalculate } from '../state';
import { getMotionParams, getErrorBudget, getSnrUndershootPct, setSnrUndershootPct, setFrameRate, setShutterDenom } from '../temporalState';
import { updateFpsLabel, updateFpsPresetStyles } from './fpsShutterPresets';
import { updateGainDisplay } from './gainDisplay';
import { showOptimizerWarning } from './outputs';

const OPT_WARN_CLASS = 'border-red-800 bg-red-950/30 text-red-300';

let app: AppStateFull;
let refreshAll: () => void;

export function initOptimizerPanel(a: AppStateFull, rf: () => void): void {
  app = a;
  refreshAll = rf;

  const snrUndershootInput = document.getElementById('snr-undershoot-pct') as HTMLInputElement | null;
  if (snrUndershootInput) {
    snrUndershootInput.addEventListener('input', () => {
      const pct = parseFloat(snrUndershootInput.value);
      if (Number.isFinite(pct)) {
        setSnrUndershootPct(pct);
        snrUndershootInput.value = String(getSnrUndershootPct());
      }
    });
  }

  const optimizeBtn = document.getElementById('optimize-btn');
  if (optimizeBtn) {
    optimizeBtn.addEventListener('click', () => {
      const result = runOptimization(app, getMotionParams(), getErrorBudget(), getSnrUndershootPct());
      if (result) {
        app.state.extractedWidth        = result.extractedWidth;
        app.state.extractedHeight       = result.extractedHeight;
        app.state.selectedV4l2Mode      = result.selectedV4l2Mode;
        app.state.readoutPitchMultiplier = result.readoutPitchMultiplier;
        app.state.readoutFullFoV        = result.readoutFullFoV;
        app.state.readoutMethod         = result.readoutMethod;
        app.state.gain                  = result.optimalGain;
        recalculate(app);
        setFrameRate(result.fps);
        setShutterDenom(result.shutterDenom);
        updateFpsLabel();
        updateFpsPresetStyles();
        refreshAll();
        updateGainDisplay(app);
        if (!result.snrMet) {
          showOptimizerWarning('\u26a0 Optimizer: best effort \u2014 SNR target not met; increase lux or lower SNR target', OPT_WARN_CLASS);
        }
      } else {
        showOptimizerWarning('\u26a0 Optimizer: no valid exposure \u2014 increase lux or lower SNR target', OPT_WARN_CLASS);
      }
    });
  }
}
