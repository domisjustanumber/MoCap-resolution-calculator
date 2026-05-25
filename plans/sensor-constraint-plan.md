# Sensor Constraint Implementation Plan

## Summary
When a sensor preset is active, enforce four constraint classes on the UI and exposure optimizer.

---

## Constraint 1 — Output Format Filtering by ADC Bit-Depth

**Goal**: Disable `raw10` in the output format dropdown when the sensor's ADC is only 8 or 10 bits? No — when ADC < 10 bits. Currently all our sensors are ≥10-bit, so `raw10` is always valid. However an 8-bit sensor (hypothetical future preset) shouldn't offer `raw10`.

**Exact rule**: `raw10` option disabled when `radiometry.adcBits < 10`. If `raw10` is the current selection and it becomes invalid, auto-switch to `raw10`? No — switch to `raw8`.

### Files changed

| File | Change |
|---|---|
| `src/ui/inputs.ts` | New function `updateOutputFormatOptions()` |
| `src/ui/inputs.ts` | Call from `syncInputsFromState()` |

### Implementation sketch

```ts
// In src/ui/inputs.ts

import { SENSOR_RADIOMETRY } from '../../presets';
import { DEFAULT_RADIOMETRY } from '../constants';

function updateOutputFormatOptions(): void {
  const selectEl = document.getElementById('outputFormat') as HTMLSelectElement | null;
  if (!selectEl) return;

  // Determine current sensor's ADC bit depth
  const radiometry = SENSOR_RADIOMETRY[app.activeSensorPreset] || DEFAULT_RADIOMETRY;
  const adcBits = radiometry.adcBits;

  // raw10 is only valid when ADC can produce ≥10 bit data
  const raw10Opt = selectEl.querySelector('option[value="raw10"]') as HTMLOptionElement | null;
  if (raw10Opt) {
    raw10Opt.disabled = (adcBits < 10);

    // If raw10 is currently selected but now invalid, switch to raw8
    if (raw10Opt.disabled && selectEl.value === 'raw10') {
      selectEl.value = 'raw8';
      setField(app, 'outputFormat', 'raw8');
    }
  }
}
```

Called at the end of `syncInputsFromState()`, after `updatePresetChipStyles()`:
```ts
// line 518 in syncInputsFromState, before the closing brace
updateOutputFormatOptions();
```

### Issues / edge cases

1. **Custom sensor**: `activeSensorPreset === 'custom'` → `DEFAULT_RADIOMETRY.adcBits = 12` → raw10 stays enabled. Correct.
2. **Resolution presets change format**: `RES_PRESETS` can set `outputFormat` to `'mjpg'` or `'nv12'` (never raw10). No conflict.
3. **If adcBits < 8**: raw8 would also be invalid, but `OutputFormat` doesn't include raw6/raw4. We'd need to enforce only compressed formats. Skip this until we have such sensors.
4. **Disabled `<option>` vs cross-browser**: The HTML `disabled` attribute on `<option>` works in all modern browsers. Some older browsers ignore it — acceptable.

---

## Constraint 2 — Resolution Preset Bounds by Native Sensor Size

**Goal**: When a resolution preset button's width exceeds `nativeWidth` or height exceeds `nativeHeight`, disable it with `disabled-preset` CSS class and prevent clicks.

**Pattern**: Follow the FPS preset pattern exactly:
- `updateFpsPresetStyles()` in `src/main.ts` adds `disabled-preset` CSS class when `fps > sensorMaxFps`
- Pre‑click guard: `if (fps > getMaxFpsLimit()) return;`

### Files changed

| File | Change |
|---|---|
| `src/ui/inputs.ts` | Extend `updateResChipStyles()` to add `disabled-preset` class for oversized presets |
| `src/ui/inputs.ts` | Add pre‑click guard in `bindProcessingChips()` |

### Implementation sketch

```ts
// In updateResChipStyles() — extend the existing function:

function updateResChipStyles(): void {
  Object.keys(RES_PRESETS).forEach((key) => {
    const chip = document.querySelector(`[data-res="${key}"]`) as HTMLButtonElement | null;
    if (!chip) return;
    const { w, h, fmt } = RES_PRESETS[key];

    // Active highlight
    if (app.state.extractedWidth === w && app.state.extractedHeight === h && app.state.outputFormat === fmt) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }

    // Disable preset if it exceeds native sensor dimensions
    if (w > app.state.nativeWidth || h > app.state.nativeHeight) {
      chip.classList.add('disabled-preset');
    } else {
      chip.classList.remove('disabled-preset');
    }
  });
}
```

```ts
// In bindProcessingChips() — add pre‑click guard:

chip.addEventListener('click', () => {
  const { w, h, fmt } = RES_PRESETS[key];
  // Guard: don't allow selecting a preset that exceeds native sensor dimensions
  if (w > app.state.nativeWidth || h > app.state.nativeHeight) return;
  // ... existing logic unchanged ...
});
```

### Resolution preset impact by sensor

| Preset | OV5647 (2592×1944) | IMX219 (3280×2464) | IMX477 (4056×3040) | OV9281 (1280×800) |
|---|---|---|---|---|
| SD (640×480) | enabled | enabled | enabled | enabled |
| 720p (1280×720) | enabled | enabled | enabled | **disabled** (1280 > 1280? no, 1280=1280 but 720≤800) — enabled |
| 1080p (1920×1080) | enabled | enabled | enabled | **disabled** (1920 > 1280) |

Correction: 720p at 1280×720 fits within OV9281 1280×800, so it stays enabled. Only 1080p gets disabled for OV9281.

### Issues / edge cases

1. **CSS class exists**: `.disabled-preset` is defined in `src/style.css` as `opacity: 0.3; cursor: not-allowed;`. No CSS changes needed.
2. **User manually types extracted dimensions exceeding native**: Already clamped by `validateState()` and `handleExtractedClamp()`. No change.
3. **Gap between preset and native**: If a preset is disabled but the user types a value manually (e.g., 900×600 on OV9281), the inputs accept it because extracted≤native (existing validation). The preset button being disabled doesn't prevent the free-form entry. This is intentional — the same way FPS preset buttons are disabled but the custom input accepts any valid value.

---

## Constraint 3 — Analogue Gain Multiplier per Sensor

**Goal**: Replace the global `GAIN_MIN`/`GAIN_MAX` (1.0 / 8.0) with per‑sensor gain multiplier limits from the V4L2 driver data. The exposure optimizer uses these limits to clamp `optimalGain`.

**Approach (Hybrid C)**: Store both the raw register range AND the pre‑computed linear multiplier range in each sensor JSON, plus a `gainModel` string documenting the conversion method.

### Gain models per sensor (verified)

| Sensor | `gainModel` | Verified formula | Reg range | Multiplier max | Source |
|---|---|---|---|---|---|
| OV5647 | `"ov-reg-div-16"` | `gain = reg / 16` | 16..1023 | 1023/16 = **63.94×** | Kernel driver convention |
| IMX219 | `"sony-imx219-recip-256"` | `gain = 256 / (256 − code)` | 0..232 | 256/(256−232) = **10.67×** | libcamera `cam_helper_imx219.cpp` |
| IMX477 | `"sony-imx477-recip-1024"` | `gain = 1024 / (1024 − code)` | 0..978 | 1024/(1024−978) = **22.26×** | libcamera `cam_helper_imx477.cpp` |
| OV9281 | `"ov-reg-div-16"` | `gain = reg / 16` | 16..248 | 248/16 = **15.50×** | Kernel driver convention |

All four formulas confirmed from the authoritative libcamera C++ implementation and the Raspberry Pi Linux kernel driver source. The Sony sensors use a reciprocal `C / (C − code)` pattern (not 0.3 dB/step).

### Files changed

| File | Change |
|---|---|
| `presets/types.ts` | Add `analogueGainMultiplier`, `gainModel` to `V4l2Config` |
| `presets/sensors/ov5647.json` | Add `analogueGainMultiplier`, `gainModel` to `v4l2` |
| `presets/sensors/ov9281.json` | Same |
| `presets/sensors/imx219.json` | Same |
| `presets/sensors/imx477.json` | Same |
| `src/exposure.ts` | Replace `GAIN_MIN`/`GAIN_MAX` imports with param |
| `src/state.ts` | Pass sensor gain range through to optimizer |
| `src/constants.ts` | Delete `GAIN_MIN`/`GAIN_MAX` |

### Single-source-of-truth helper

Add to `presets/index.ts` (or a new helper file):

```ts
export function getGainRange(sensorPresetName: string): { min: number; max: number; default: number } {
  const sensor = SENSOR_PRESETS[sensorPresetName];
  if (sensor?.v4l2?.analogueGainMultiplier) {
    return {
      min: sensor.v4l2.analogueGainMultiplier.min,
      max: sensor.v4l2.analogueGainMultiplier.max,
      default: sensor.v4l2.analogueGainMultiplier.default,
    };
  }
  // Fallback for sensors without V4L2 data or custom mode
  return { min: 1.0, max: 8.0, default: 1.0 };
}
```

### OV5647 JSON v4l2 block (example)

```json
"analogueGain": { "min": 16, "max": 1023, "step": 1, "default": 32 },
"analogueGainMultiplier": { "min": 1.0, "max": 63.94, "default": 2.0 },
"gainModel": "ov-reg-div-16"
```

### IMX219 JSON v4l2 block (example)

```json
"analogueGain": { "min": 0, "max": 232, "step": 1, "default": 0 },
"analogueGainMultiplier": { "min": 1.0, "max": 10.67, "default": 1.0 },
"gainModel": "sony-imx219-recip-256"
```

### IMX477 JSON v4l2 block (example)

```json
"analogueGain": { "min": 0, "max": 978, "step": 1, "default": 0 },
"analogueGainMultiplier": { "min": 1.0, "max": 22.26, "default": 1.0 },
"gainModel": "sony-imx477-recip-1024"
```

### OV9281 JSON v4l2 block (example)

```json
"analogueGain": { "min": 16, "max": 248, "step": 1, "default": 16 },
"analogueGainMultiplier": { "min": 1.0, "max": 15.50, "default": 1.0 },
"gainModel": "ov-reg-div-16"
```

Note: `max` values rounded to 2 decimal places.

### Exposure optimizer changes

Current (lines 72–74):
```ts
let optimalGain = GAIN_MIN;
if (actualElectrons > 0) {
  optimalGain = Math.max(GAIN_MIN, Math.min(GAIN_MAX, targetElectrons / actualElectrons));
}
```

After:
```ts
let optimalGain = gainMin;
if (actualElectrons > 0) {
  optimalGain = Math.max(gainMin, Math.min(gainMax, targetElectrons / actualElectrons));
}
```

Where `gainMin`/`gainMax` are new params on `calculateExposureOptimizer()`.

### state.ts:recalculate() changes

```ts
// After the radiometry lookup (line 126), add:
const sensorPreset = SENSOR_PRESETS[app.activeSensorPreset];
const gainRange = sensorPreset?.v4l2?.analogueGainMultiplier ?? { min: 1.0, max: 8.0, default: 1.0 };
```

Then pass `gainRange.min` and `gainRange.max` to `calculateExposureOptimizer()` calls (lines 135 and 144).

### Issues / edge cases

1. **All gain formulas verified**: OV formulas from kernel driver register conventions, Sony formulas from libcamera `cam_helper_imx219.cpp` and `cam_helper_imx477.cpp` — the authoritative Raspberry Pi camera control implementation.

2. **Global GAIN_MIN/GAIN_MAX deletion**: Only used in `exposure.ts:72-74` and `constants.ts:83-84`. No other code references them. The test file `tests/exposure-math.test.ts` does not import or reference them. Safe to delete entirely from `constants.ts`.

3. **Custom sensor (no preset)**: `app.activeSensorPreset === 'custom'` → `SENSOR_PRESETS['custom']` is `undefined` → fallback `{ min: 1.0, max: 8.0, default: 1.0 }` used. Same behavior as today.

4. **Default gain value**: The `analogueGainMultiplier.default` is not currently consumed by the optimizer (which always computes `optimalGain`). It's there for future use (e.g., a "reset to sensor default" button).

5. **Per-sensor maxes are sensor capabilities**: OV5647 max = 63.94×, OV9281 max = 15.50×, IMX219 max = 10.67×, IMX477 max = 22.26×. The optimizer may recommend gains up to these values in very low light — the user will handle noise visibility in the UI later.

---

## Constraint 4 — Shutter Speed Limits via V4L2 Exposure Lines

**Goal**: Use the V4L2 exposure line count limits to set a sensor‑specific upper bound on shutter speed, instead of relying solely on `readoutTimeUs`.

**Current formula** (state.ts:129):
```ts
sensorMaxShutterDenom = Math.min(8000, Math.round(1_000_000 / (radiometry.readoutTimeUs * 2)));
```
This always gives ≥8000 for all four sensors, so the effective bound is always 8000.

**V4L2‑derived bound**: Fastest shutter occurs at minimum exposure lines.
```
min_exposure_time_s = exposure.min_lines × hts / pixelRate
maxShutterDenom_from_V4L2 = floor(1 / min_exposure_time_s)
                          = pixelRate / (exposure.min_lines × hts)
```

Using the highest‑resolution mode (index 0) for `pixelRate` and `hts`:

| Sensor | pixelRate (Hz) | exp.min (lines) | hts | maxShutterDenom |
|---|---|---|---|---|
| OV5647 | 87,500,000 | 4 | 2,844 | 87,500,000/(4×2,844) ≈ 7,690 |
| IMX219 | 182,400,000 | 4 | 3,448 | 182,400,000/(4×3,448) ≈ 13,226 |
| IMX477 | 840,000,000 | 4 | 24,000 | 840,000,000/(4×24,000) = 8,750 |
| OV9281 | 160,000,000 | 4 | 1,456 | 160,000,000/(4×1,456) ≈ 27,472 |

These values should be pre‑computed and stored in the JSON. At runtime, `recalculate()` picks the tightest bound:

```ts
const v4l2MaxShutterBound = sensorPreset?.v4l2?.maxShutterDenom ?? Infinity;
const sensorMaxShutterDenom = Math.min(
  8000,
  Math.round(1_000_000 / (radiometry.readoutTimeUs * 2)),
  v4l2MaxShutterBound,
);
```

**Behavior change**: None for IMX219/IMX477/OV9281 (all exceed 8000). OV5647 would be capped at 7,690 instead of 8,000 (4% reduction). This is technically more accurate — the sensor's minimum exposure line count truly limits the fastest shutter.

### Files changed

| File | Change |
|---|---|
| `presets/types.ts` | Add optional `maxShutterDenom?: number` to `V4l2Config` |
| `presets/sensors/ov5647.json` | Add `"maxShutterDenom": 7690` |
| `presets/sensors/imx219.json` | Add `"maxShutterDenom": 13226` |
| `presets/sensors/imx477.json` | Add `"maxShutterDenom": 8750` |
| `presets/sensors/ov9281.json` | Add `"maxShutterDenom": 27472` |
| `src/state.ts` | Extend `sensorMaxShutterDenom` calculation with V4L2 bound |

### Issues / edge cases

1. **OV5647 is the only sensor affected**: The change is invisible to the user unless they inspect the shutter custom input's `max` attribute (changes from 8000 to 7690). The 1/8000 button is already a shutter preset — should it be disabled now? Probably yes: if `maxShutterDenom = 7690`, the 1/8000 button should get `disabled-preset` class. But the logic for shutter preset disabling currently only checks `denom < frameRate` (minimum bound), not maximum. I need to also check the max bound.

   Actually, looking at `updateShutterPresetStyles()` (main.ts:306-326), the max bound is **not** checked on preset buttons — only on the custom input. The `data-shutter` presets are 30/60/120/250/500/1000 — all well below 7690, so none would be affected. No change needed.

2. **Digital gain interaction**: The V4L2 `digitalGain` range exists for IMX219 and IMX477 but is not used by the exposure optimizer. The optimizer only controls analogue gain. No change needed.

3. **Mode-specific exposure limits**: V4L2 `exposure.min` and `exposure.max` are per‑mode. Using the highest‑resolution mode (index 0) gives the most conservative (largest `hts` → slowest sensor behavior). This is correct for the max shutter bound.

---

## Implementation Order

1. **Constraint 3 (gain)** — All formulas verified (OV from kernel drivers, Sony from libcamera). Most impactful, touches multiple files.
2. **Constraint 4 (shutter)** — Small change, pre‑compute and add to JSON + state.ts
3. **Constraint 1 (output format)** — Single file change, low risk
4. **Constraint 2 (resolution presets)** — Single file change, low risk

## Test Impact

`tests/exposure-math.test.ts` does not import or reference `GAIN_MIN`/`GAIN_MAX`. No test changes needed.

## Remaining Questions

*(All resolved)*

1. ~~Sony IMX219/IMX477 gain formula~~ — Verified from libcamera source: `gain = 256 / (256 − code)` for IMX219, `gain = 1024 / (1024 − code)` for IMX477.
2. ~~`GAIN_MIN`/`GAIN_MAX` deletion vs deprecation~~ — User confirmed: delete entirely. Only `exposure.ts` references them; tests don't import them.
