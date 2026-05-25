# One-Shot Exposure Optimizer Plan

## Summary

Replace the on/off Exposure Optimizer toggle with a one-shot "Optimize" button. When clicked, evaluates all physically-valid V4L2 modes for the active sensor and selects the combination of fps, shutter, resolution, and readout mode that minimizes `minFeatureSize`. Ignores sync errors. Excludes photon-starved candidates. Does not optimize compression settings.

---

## Current vs Target

| Aspect | Before | After |
|---|---|---|
| Trigger | On/off toggle — when ON, locks FPS/shutter constantly | Button press — one-shot |
| Controls locked? | Yes, FPS/shutter disabled while ON | No — values set as manual, user can tweak |
| What's optimized | FPS + shutter only | FPS + shutter + resolution + V4L2 readout mode |
| Sync errors | Included | Ignored (`syncEnabled = false`) |
| Compression | Not touched | Not touched (unchanged) |

---

## New file: `src/optimizer.ts`

### Exports

```ts
export interface OptimizationResult {
  fps: number;
  shutterDenom: number;
  extractedWidth: number;
  extractedHeight: number;
  selectedV4l2Mode: number;
  readoutPitchMultiplier: number;
  readoutFullFoV: boolean;
  minFeatureSize: number;
}

export function runOptimization(app: AppStateFull): OptimizationResult | null;
```

### Candidate enumeration

**When V4L2 modes available** (`SENSOR_GEOMETRY[name]?.v4l2?.modes`): one candidate per mode.

| Candidate field | Source |
|---|---|
| `extractedWidth` / `extractedHeight` | `mode.width` / `mode.height` |
| `selectedV4l2Mode` | Mode index `i` |
| `readoutPitchMultiplier` | `mode.pitchMultiplier ?? 1` |
| `readoutFullFoV` | `mode.fullFoV ?? true` |
| `maxFps` | `mode.maxFps` |
| `maxShutterDenom` | `floor(pixelRates[mode.pixelRateIndex] / (v4l2.exposure.min × mode.hts))` |
| `shutterType` | Sensor geometry (rolling vs global) |

For rolling shutter sensors, `maxShutterDenom` is additionally bounded by `floor(1_000_000 / (readoutTimeUs × 2))`.

**When no V4L2 data**: 4 resolution presets — `640×480`, `1280×720`, `1920×1080`, native. Use current `readoutMethod`, `readoutPitchMultiplier=1`, `readoutFullFoV=true`, `selectedV4l2Mode=-1`. Compute maxFps and maxShutterDenom from `readoutTimeUs` (same formulas as `recalculate()`).

### Per-candidate evaluation

All computation works on `{ ...app.state, ...candidate.statePatch }` — no mutation of live state.

```
for each candidate:
  // Pass 1 — baseline fEffective (no motion blur penalty, no sync)
  tempState  = clone(app.state) + candidate state patch
  tempDerived = calculateDerived(tempState)
  baseline   = calculateResults(tempState, tempDerived, velocity, 0.000001, 999999, 0, false)

  // Pass 2 — exposure optimizer
  exposure   = calculateExposureOptimizer(tempState, tempDerived, radiometry, velocity, baseline.fEffective)

  // Constraint checks
  if exposure.optimalFps       > candidate.maxFps        → skip
  if round(1 / exposure.tOptimal) > candidate.maxShutter   → skip
  if exposure.photonStarved                                → skip
  if exposure.snrAtOptimalDb   < tempState.desiredSnrDb    → skip

  // Pass 3 — final results
  shutterTime = 1 / max(1, round(1 / exposure.tOptimal))
  results     = calculateResults(tempState, tempDerived, velocity,
                  shutterTime, round(exposure.optimalFps), 0, false, exposure)

  if results.minFeatureSize < best.minFeatureSize: track
```

Returns `null` if no candidate passes all constraint checks.

### Imports needed

```ts
import type { AppStateFull, AppState, ExposureOptimization } from './types';
import { calculateDerived, calculateResults } from './engine';
import { calculateExposureOptimizer } from './exposure';
import { SENSOR_RADIOMETRY, SENSOR_GEOMETRY } from '../presets';
import { DEFAULT_RADIOMETRY } from './constants';
import { getSpatialVelocity } from './ui/temporalChart';
```

---

## `src/state.ts` changes

### 1. New function — invalidate V4L2 mode on manual edits

```ts
function invalidateV4l2ModeIfNeeded(app: AppStateFull, key: keyof AppState): void {
  if (app.state.selectedV4l2Mode < 0) return;
  if (key !== 'extractedWidth' && key !== 'extractedHeight') return;
  const geom = SENSOR_GEOMETRY[app.activeSensorPreset];
  const mode = geom?.v4l2?.modes?.[app.state.selectedV4l2Mode];
  if (!mode) { app.state.selectedV4l2Mode = -1; return; }
  if (app.state.extractedWidth !== mode.width || app.state.extractedHeight !== mode.height) {
    app.state.selectedV4l2Mode = -1;
  }
}
```

Called at end of `setField()`, just before `return recalculate(app)`.

### 2. Remove exposureMode branch from `recalculate()`

Replace lines 144–157 (the `if (state.exposureMode === 'optimized')` block) with just the manual branch:

```ts
const firstPass = calculateResults(state, app.derived, velocity, manualShutter, manualFps, syncErr, syncOn);
const exposure = calculateExposureOptimizer(state, app.derived, radiometry, velocity, firstPass.fEffective);
app.results = calculateResults(state, app.derived, velocity, manualShutter, manualFps, syncErr, syncOn, exposure);
```

### 3. Remove exposureMode from DEFAULT_STATE + imports

- Remove `ExposureMode` from `./types` import
- Remove `exposureMode: 'optimized' as ExposureMode,` from `DEFAULT_STATE`

---

## `src/types.ts` changes

- Delete `export type ExposureMode = 'manual' | 'optimized';`
- Delete `exposureMode: ExposureMode;` from `AppState`

---

## `src/main.ts` changes

### Remove

- `import type { ExposureMode } from './types';`
- Toggle click handler (lines 346–355)
- `updateOptimizerLockedControls()` function (lines 361–389)

### Add

```ts
import { runOptimization } from './optimizer';

const optimizeBtn = document.getElementById('optimize-btn');
if (optimizeBtn) {
  optimizeBtn.addEventListener('click', () => {
    const result = runOptimization(app);
    if (result) {
      app.state.extractedWidth        = result.extractedWidth;
      app.state.extractedHeight       = result.extractedHeight;
      app.state.selectedV4l2Mode      = result.selectedV4l2Mode;
      app.state.readoutPitchMultiplier = result.readoutPitchMultiplier;
      app.state.readoutFullFoV        = result.readoutFullFoV;
      setFrameRate(result.fps);
      setShutterDenom(result.shutterDenom);
      syncInputsFromState();
      refreshAll();
    } else {
      showOptimizerWarning();
    }
  });
}

function showOptimizerWarning(): void {
  const banner = document.getElementById('bottleneck-banner');
  if (!banner) return;
  banner.textContent = '⚠ Optimizer: no valid exposure — increase lux or lower SNR target';
  banner.classList.add('text-red-400');
}
```

---

## `src/ui/inputs.ts` changes

Delete the call at line 585:
```ts
updateOptimizerLockedControls(app.state.exposureMode === 'optimized');
```

Also remove the import of `updateOptimizerLockedControls` from `../main`.

---

## `src/ui/outputs.ts` changes

In the function that updates the bottleneck banner, add:
```ts
banner.classList.remove('text-red-400');
```

---

## `index.html` changes

Replace (line 223):
```html
<button id="exposure-mode-toggle" class="rounded border border-slate-700 bg-slate-800/50 px-1 py-1 text-[11px] font-medium text-blue-400 transition hover:border-blue-500 leading-none whitespace-nowrap active">On</button>
```
With:
```html
<button id="optimize-btn" class="rounded border border-slate-700 bg-slate-800/50 px-1 py-1 text-[11px] font-medium text-slate-400 transition hover:border-blue-500 leading-none whitespace-nowrap">Optimize</button>
```

---

## Implementation Order

1. `src/types.ts` — remove types
2. `src/state.ts` — invalidateV4l2ModeIfNeeded + remove exposureMode
3. `src/optimizer.ts` — new file
4. `src/main.ts` — UI binding
5. `src/ui/inputs.ts` — remove lock call
6. `src/ui/outputs.ts` — red-text clearing
7. `index.html` — button replacement
8. Build & test
