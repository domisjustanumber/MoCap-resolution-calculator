# V4L2 Readout Mode Integration Plan

## Problem Summary

The current engine (`engine.ts:25-29`) always multiplies pixel pitch by
`skippingFactor = max(nativeW/extractedW, nativeH/extractedH)`, conflating
**cropping** (pitch unchanged) with **binning/subsampling** (pitch increases).

This underestimates spatial resolution for cropped modes and double-counts
when `pixelBinning` is also set.

Separate controls `subsamplingMethod` (line-skip/binning-average) and
`pixelBinning` (1x/2x/4x) are cosmetic and hardcoded, with no connection to
the actual V4L2 readout modes defined in the sensor presets.

---

## Phase 1 — Schema & Types

### `presets/types.ts` — Extend V4L2 mode type

Add a `ReadoutType` union and optional metadata fields to the inline mode
type inside `V4l2Config`:

```typescript
export type ReadoutType =
  | 'native'
  | 'binning'
  | 'subsampling'
  | 'cropping'
  | 'binning+cropping'
  | 'subsampling+cropping'
  | 'subsampling+binning';

export interface V4l2Mode {
  width: number;
  height: number;
  maxFps: number;
  pixelRateIndex: number;
  hts: number;
  vts: number;
  readoutType?: ReadoutType;       // default 'native'
  pitchMultiplier?: number;        // default 1
  fullFoV?: boolean;               // default true
}
```

V4l2Config.modes changes from:
```typescript
modes: Array<{ width, height, maxFps, pixelRateIndex, hts, vts }>;
```
to:
```typescript
modes: Array<V4l2Mode>;
```

### `src/types.ts` — Update `AppState`

Remove `subsamplingMethod` and `pixelBinning`.
Add `selectedV4l2Mode` and `readoutMethod`.

```typescript
export type ReadoutMethod = 'cropping' | 'binning' | 'subsampling';

export interface AppState {
  // ... existing fields that stay ...
  extractedWidth: number;
  extractedHeight: number;
  outputFormat: OutputFormat;
  measurementMode: MeasurementMode;   // 'luma' | 'chroma' (unchanged)

  // REPLACES: subsamplingMethod + pixelBinning
  selectedV4l2Mode: number;    // -1 = custom/manual, 0+ = V4L2 mode index
  readoutMethod: ReadoutMethod; // used only when selectedV4l2Mode < 0

  // Transient fields written by state.ts when a V4L2 mode is selected
  // Read by engine.ts calculateDerived; unused when selectedV4l2Mode < 0
  readoutPitchMultiplier: number;
  readoutFullFoV: boolean;

  // REMOVED:
  // pixelBinning: number;
  // subsamplingMethod: SubsamplingMethod;
}
```

Also remove the `SubsamplingMethod` type from `types.ts`:
```typescript
// DELETE: export type SubsamplingMethod = 'line-skip' | 'binning-average';
```

### `src/constants.ts` — Remove unused constants

```typescript
// DELETE: export const BINNING_VALUES = [1, 2, 4] as const;
// DELETE: export const SUBSAMPLING_LABELS: Record<string, string> = { ... };
```

---

## Phase 2 — Populate Preset Data

Add `readoutType`, `pitchMultiplier`, `fullFoV` to every V4L2 mode entry in
all four sensor JSON files.

### IMX219 (Sony datasheet confirms each mode)

| Index | Resolution | readoutType | pitchMultiplier | fullFoV |
|-------|------------|-------------|-----------------|---------|
| 0     | 3280x2464  | `native`    | 1.0             | true    |
| 1     | 1920x1080  | `cropping`  | 1.0             | false   |
| 2     | 1640x1232  | `binning`   | 2.0             | true    |
| 3     | 640x480    | `binning+cropping` | 2.0       | false   |

### IMX477 (Flyer only — inferred from resolution ratios)

| Index | Resolution | readoutType | pitchMultiplier | fullFoV |
|-------|------------|-------------|-----------------|---------|
| 0     | 4056x3040  | `native`    | 1.0             | true    |
| 1     | 2028x1520  | `binning`   | 2.0             | true    |
| 2     | 2028x1080  | `binning+cropping` | 2.0       | false   |
| 3     | 1332x990   | `subsampling+cropping` | 3.05  | false   |

### OV5647 (Datasheet table 2-1 with scaling method column)

| Index | Resolution | readoutType | pitchMultiplier | fullFoV |
|-------|------------|-------------|-----------------|---------|
| 0     | 2592x1944  | `native`    | 1.0             | true    |
| 1     | 1920x1080  | `cropping`  | 1.0             | false   |
| 2     | 1296x972   | `binning`   | 2.0             | true    |
| 3     | 640x480    | `subsampling+cropping` | 4.0   | false   |

### OV9281 (Product brief confirms binning support)

| Index | Resolution | readoutType | pitchMultiplier | fullFoV |
|-------|------------|-------------|-----------------|---------|
| 0     | 1280x800   | `native`    | 1.0             | true    |
| 1     | 1280x720   | `cropping`  | 1.0             | false   |
| 2     | 640x400    | `binning`   | 2.0             | true    |

---

## Phase 3 — Engine Changes (`src/engine.ts`)

### `calculateDerived`

Rewrite the effective pixel pitch and FoV computation:

```typescript
export function calculateDerived(state: Readonly<AppState>): DerivedState {
  const pixelPitch = state.pixelPitch;
  const sensorWidth = (pixelPitch * state.nativeWidth) / 1000;
  const sensorHeight = (pixelPitch * state.nativeHeight) / 1000;
  const sensorDiagonal = Math.sqrt(sensorWidth ** 2 + sensorHeight ** 2);

  let effectivePixelPitch: number;
  let fovWidth: number;
  let fovHeight: number;

  if (state.selectedV4l2Mode >= 0) {
    // V4L2 mode selected — pitchMultiplier is authoritative
    const pitchMult = state.readoutPitchMultiplier ?? 1;
    effectivePixelPitch = pixelPitch * pitchMult;
    fovWidth = state.readoutFullFoV !== false
      ? sensorWidth
      : (pixelPitch * state.extractedWidth) / 1000;
    fovHeight = state.readoutFullFoV !== false
      ? sensorHeight
      : (pixelPitch * state.extractedHeight) / 1000;
  } else {
    // Custom mode: readoutMethod determines behavior
    const skipH = Math.max(1, state.nativeWidth / state.extractedWidth);
    const skipV = Math.max(1, state.nativeHeight / state.extractedHeight);
    const skippingFactor = Math.max(skipH, skipV);

    if (state.readoutMethod === 'cropping') {
      effectivePixelPitch = pixelPitch;                     // pitch unchanged
      fovWidth = (pixelPitch * state.extractedWidth) / 1000;   // cropped FoV
      fovHeight = (pixelPitch * state.extractedHeight) / 1000;
    } else {
      effectivePixelPitch = pixelPitch * skippingFactor;      // pitch × skip
      fovWidth = sensorWidth;                                  // full FoV
      fovHeight = sensorHeight;
    }
  }

  const fovDiagonal = Math.sqrt(fovWidth ** 2 + fovHeight ** 2);
  const diagonalFov = 2 * Math.atan(fovDiagonal / (2 * state.focalLength)) * (180 / Math.PI);
  const horizontalFov = 2 * Math.atan(fovWidth / (2 * state.focalLength)) * (180 / Math.PI);
  const verticalFov = 2 * Math.atan(fovHeight / (2 * state.focalLength)) * (180 / Math.PI);

  // Skipping factor for informational display only
  const skipH = Math.max(1, state.nativeWidth / state.extractedWidth);
  const skipV = Math.max(1, state.nativeHeight / state.extractedHeight);
  const skippingFactor = Math.max(skipH, skipV);

  return {
    sensorDiagonal, sensorWidth, sensorHeight,
    pixelPitch, effectivePixelPitch, skippingFactor,
    diagonalFov, horizontalFov, verticalFov,
  };
}
```

This introduces two transient fields (`readoutPitchMultiplier`,
`readoutFullFoV`) that are written by `state.ts` when a V4L2 mode is
selected and cleared when switching to custom. Alternatively, the engine
could look up the V4L2 mode itself — see Issue #3 below.

### `calculateResults`

Fix the `fNyquistNative` computation at engine.ts:68.

`state.pixelBinning` is being removed. This line:

```typescript
const nativePitchMm = (derived.pixelPitch * state.pixelBinning) / 1000;
```

Becomes:

```typescript
const nativePitchMm = derived.pixelPitch / 1000;
```

This is also a latent bugfix — `fNyquistNative` should always represent
the true native Nyquist based on physical pixel pitch alone, not modified
by a user-facing binning control. The effective pitch after readout
methods is already captured by `fNyquistSkipped` via
`derived.effectivePixelPitch`.

No other changes to `calculateResults`. It already reads:
- `derived.effectivePixelPitch` → `fNyquistSkipped`
- `derived.pixelPitch` → `fNyquistNative` (now always native)

---

## Phase 4 — State Integration (`src/state.ts`)

### `DEFAULT_STATE`

```typescript
export const DEFAULT_STATE: AppState = {
  // ... existing fields unchanged ...
  extractedWidth: 640,
  extractedHeight: 480,
  measurementMode: 'luma',

  selectedV4l2Mode: -1,
  readoutMethod: 'binning',   // default readout method for custom mode

  // REMOVED:
  // pixelBinning: 1,
  // subsamplingMethod: 'line-skip',
};
```

### `validateState`

Remove the `BINNING_VALUES` check:
```typescript
// DELETE:
// if (!(BINNING_VALUES as readonly number[]).includes(state.pixelBinning)) {
//   state.pixelBinning = 1;
// }
```

### `setField` / sensor preset application

When a V4L2 mode chip is clicked:
1. Look up `SENSOR_PRESETS[activeSensorPreset].v4l2.modes[index]`
2. Set `extractedWidth`, `extractedHeight` from the mode
3. Set `readoutMethod` from `mode.readoutType` (mapped: native/cropping → 'cropping',
   binning* → 'binning', subsampling* → 'subsampling')
4. Set transient fields `readoutPitchMultiplier` and `readoutFullFoV` for the engine
5. Set `selectedV4l2Mode = index`

When a different sensor preset is loaded, set `selectedV4l2Mode = -1` and
let extractedWidth/extractedHeight fall back to the default or current values.

`setSensorPreset` in `state.ts` must reset `selectedV4l2Mode = -1`:

```typescript
export function setSensorPreset(app: AppStateFull, name: string): AppStateFull {
  app.activeSensorPreset = name;
  app.activeLensPreset = detectLensPreset(app);
  app.state.selectedV4l2Mode = -1;  // V4L2 modes are sensor-specific
  return recalculate(app);
}
```

### Transient fields on AppState

To avoid the engine needing to import SENSOR_PRESETS, add two transient
fields to AppState:

```typescript
// Written by state.ts when selectedV4l2Mode >= 0
// Read by engine.ts calculateDerived
readoutPitchMultiplier: number;
readoutFullFoV: boolean;
```

These are not serialized or part of preset detection.

---

## Phase 5 — UI Changes

### `index.html`

**Remove** these old elements:
- Resolution preset buttons (Lines 185-196): the entire "Resolution" section with
  SD/720p/1080p MJPG and NV12 chips. These hardcode extracted dimensions and output
  format independently of the V4L2 mode selector, which creates confusion about
  which setting drives the readout method.
- `subsamplingMethod` select (Line 544)
- `pixelBinning` select (Line 563)
- The `measurementMode` radios move but are renamed (keep radios, change label)

**Add** a new `readoutMethod` select below extractedHeight/outputFormat:

```html
<div>
  <label class="mb-1 block text-xs font-medium text-slate-400" for="readoutMethod">
    Readout Method
  </label>
  <select id="readoutMethod" class="calc-input input-field w-full">
    <option value="cropping">Cropping</option>
    <option value="binning">Binning (average)</option>
    <option value="subsampling">Subsampling (line-skip)</option>
  </select>
</div>
```

**Rename** "Subsampling Method" label on measurementMode to "Resolution Axis".

Add a V4L2 mode selector section that appears only when a sensor preset
with V4L2 data is active:

```html
<div id="v4l2-mode-group">
  <label class="mb-1 block text-xs font-medium text-slate-400" for="v4l2Mode">
    Sensor Readout Mode
  </label>
  <select id="v4l2Mode" class="calc-input input-field w-full">
    <option value="-1">Custom (manual)</option>
    <!-- populated dynamically -->
  </select>
</div>
```

When `v4l2Mode > -1` is selected:
- `extractedWidth` / `extractedHeight` set from mode and disabled
- `readoutMethod` set from mode's readout type and disabled
- A badge/info line shows the effective pixel pitch change

When `v4l2Mode === -1`:
- All manual controls re-enable

### `src/ui/inputs.ts`

- **Remove** the `RES_PRESETS` constant (lines 16-23) and the
  `bindProcessingChips()` function entirely — both are dead code now
  that the resolution preset buttons are gone.
- **Remove** the `updateResChipStyles()` function that toggled active
  state on those buttons.
- **Remove** the `bindProcessingChips()` call from `initInputs()` and
  the `updateResChipStyles()` call from `syncInputsFromState()`.
- `bindSelectInput('readoutMethod', 'readoutMethod')` — new binding
- `bindSelectInput('v4l2Mode', 'selectedV4l2Mode')` — new binding, with
  custom handler that populates the dropdown options from the current
  sensor's V4L2 modes
- Remove bindings for `subsamplingMethod` and `pixelBinning`
- `syncInputsFromState()` — add sync for new elements, remove old ones

### `src/ui/outputs.ts`

See Phase 6.

---

## Phase 6 — Processing Notes (`src/ui/outputs.ts`)

### Import

```typescript
import { SENSOR_PRESETS } from '../../presets';
```

### Replace the generic binning note block

Old (lines 206-212):
```typescript
if (state.extractedWidth < state.nativeWidth || ...) {
    if (state.subsamplingMethod === 'binning-average') {
      notes.push('Binning / averaging preserves field of view...');
    }
  }
```

New V4L2-aware block:

```typescript
if (state.selectedV4l2Mode >= 0) {
  const sensor = SENSOR_PRESETS[app.activeSensorPreset];
  const mode = sensor?.v4l2?.modes[state.selectedV4l2Mode];
  const rt = mode?.readoutType;
  const pm = mode?.pitchMultiplier ?? 1;

  if (rt && rt !== 'native') {
    const effPitch = state.pixelPitch * pm;
    const pitchNote = pm !== 1
      ? `effective pixel pitch ×${pm} (${state.pixelPitch.toFixed(2)} → ${effPitch.toFixed(2)} µm). `
      : '';
    const fovNote = (mode?.fullFoV === false)
      ? `FoV reduced to ${formatFov(derived.diagonalFov)}.`
      : null;

    switch (rt) {
      case 'cropping':
        notes.push(`Cropping: FoV reduced to ${formatFov(derived.diagonalFov)}.`);
        break;

      case 'binning': {
        const label = `${pm}×${pm}`;
        notes.push(`${label} binning: ${pitchNote}`);
        break;
      }

      case 'subsampling':
        notes.push(
          `${pm}× subsampling: ${pitchNote}` +
          `Subsampling introduces severe aliasing & moiré from unsampled rows/columns.`
        );
        break;

      case 'binning+cropping': {
        const label = pm === 2 ? '2×2' : `${pm}×${pm}`;
        notes.push(`${label} binning + cropping: ${pitchNote}FoV reduced to ${formatFov(derived.diagonalFov)}.`);
        break;
      }

      case 'subsampling+cropping':
        notes.push(
          `${pm}× subsampling + cropping: ${pitchNote}` +
          `FoV reduced to ${formatFov(derived.diagonalFov)}. ` +
          `Subsampling introduces severe aliasing & moiré from unsampled rows/columns.`
        );
        break;

      case 'subsampling+binning': {
        const binFactor = pm >= 4 ? 2 : 1;
        const subFactor = pm / binFactor;
        notes.push(
          `${binFactor}×${binFactor} binning + ${subFactor}× subsampling: ${pitchNote}` +
          `Subsampling introduces severe aliasing & moiré from unsampled rows/columns.`
        );
        break;
      }
    }
  }
} else {
  // Custom/manual mode
  if (state.extractedWidth < state.nativeWidth || state.extractedHeight < state.nativeHeight) {
    const skipH = Math.max(1, state.nativeWidth / state.extractedWidth);
    const skipV = Math.max(1, state.nativeHeight / state.extractedHeight);
    const sk = Math.max(skipH, skipV);

    if (state.readoutMethod === 'cropping') {
      notes.push(`Cropping: FoV reduced to ${formatFov(derived.diagonalFov)}.`);
    } else if (state.readoutMethod === 'binning') {
      const effPitch = state.pixelPitch * sk;
      notes.push(
        `${sk}× binning: effective pixel pitch ×${sk} ` +
        `(${state.pixelPitch.toFixed(2)} → ${effPitch.toFixed(2)} µm).`
      );
    } else if (state.readoutMethod === 'subsampling') {
      const effPitch = state.pixelPitch * sk;
      notes.push(
        `${sk}× subsampling: effective pixel pitch ×${sk} ` +
        `(${state.pixelPitch.toFixed(2)} → ${effPitch.toFixed(2)} µm). ` +
        `Subsampling introduces severe aliasing & moiré from unsampled rows/columns.`
      );
    }
  }
}
```

Also suppress the existing generic line-skip note when a V4L2 mode is
active (the subsampling cases already include the aliasing warning):

```typescript
if (state.selectedV4l2Mode < 0 && state.subsamplingMethod === 'line-skip') {
  notes.push('Line skip subsampling introduces severe aliasing...');
}
```

---

## Review & Consistency Check

### Issue #1 — Transient fields vs engine look-up

`calculateDerived` reads `state.readoutPitchMultiplier` and
`state.readoutFullFoV`, which are transient fields written by
`state.ts`. Since the engine branches strictly on
`selectedV4l2Mode >= 0` and uses `??` defaults inside the branch,
stale values from a previously selected V4L2 mode cannot leak into
the custom path:

```typescript
if (state.selectedV4l2Mode >= 0) {
  const pitchMult = state.readoutPitchMultiplier ?? 1;
  const fullFov = state.readoutFullFoV ?? true;
  // ... use pitchMult and fullFov ...
} else {
  // custom path — readoutPitchMultiplier/FullFoV NOT used
}
```

This is handled correctly in Phase 1 (AppState interface) and
Phase 3 (engine branch).

### Issue #2 — Resolution preset chips removed

Addressed in Phase 5 — the entire Resolution preset button bar and its
associated code (`RES_PRESETS`, `bindProcessingChips`,
`updateResChipStyles`) are removed to avoid confusion with the V4L2 mode
selector. Users instead set resolution via the V4L2 mode dropdown or the
manual extracted-width/height inputs.

### Issue #3 — Sensor preset switch clears V4L2 mode

Addressed in Phase 4 — `setSensorPreset` now resets
`selectedV4l2Mode = -1`.

### Issue #4 — Custom sensor has no V4L2 modes

When `activeSensorPreset === 'custom'`, there is no V4L2 data available.
The V4L2 mode selector should be hidden or empty. The UI should show only
the manual `readoutMethod` / extracted / resolution controls.

### Issue #5 — Exposure optimizer uses native pixel pitch

`exposure.ts:29` reads `derived.pixelPitch` (the native pitch), NOT
`derived.effectivePixelPitch`. This is correct because photon collection
is per-physical-pixel. The SNR benefit from binning averaging is a
multi-pixel effect not currently modeled. This is scope-limited — the plan
does not change exposure behavior.

### Issue #6 — Skip card shows varying values

The "Skip" metric card (line 284 of index.html) displays
`r.skippingFactor`. In V4L2 mode, this is computed from the
native/extracted ratio and will vary by mode. For crop modes (full
resolution → smaller FoV), this factor will be > 1 even though no pixels
are being skipped or binned. This could be misleading.

**Possible fix:** In V4L2 mode, set `skippingFactor = 1` when
`readoutType` is `cropping`, since no actual pixel skipping occurs. Or add
a note clarifying what "Skip" means.

### Issue #7 — IMX477 mode 3 pitchMultiplier is approximate

The value 3.05 for 1332x990 is approximate (4056/1332 ≈ 3.045, 3040/990 ≈
3.07). No datasheet confirms whether this uses subsampling, binning, or
digital scaling. The label `subsampling+cropping` is an informed guess.
This may need revision if the kernel driver details are reverse-engineered.

### Issue #8 — Backward compatibility of JSON files

Adding optional fields to V4L2 mode entries does not break existing JSON
structure. However, if a downstream consumer iterates the mode array and
expects only the original 6 fields, the new fields are silently ignored.
No breakage expected.

### Issue #9 — Test updates needed

`tests/exposure-math.test.ts` likely references `pixelBinning` and
`subsamplingMethod` in its test state setup. All test fixtures need
updating to remove these fields and add the new ones. The engine test
coverage should verify both V4L2 mode path and custom path.

### Issue #10 — the `readoutMethod` default matters

`DEFAULT_STATE.readoutMethod = 'binning'` is chosen because the old
default `subsamplingMethod = 'line-skip'` with `pixelBinning = 1` gave
`effectivePixelPitch = pixelPitch × 1 × skippingFactor`, which happens to
be the same formula as binning. So existing custom-mode behavior is
preserved for the most common case. Users who had `subsamplingMethod =
'line-skip'` will see their notes change but the effective pitch
calculation remains identical.
