# Plan: Move `lensTransmission` from Sensor Presets → Lens Presets + UI input

## Summary

Currently `lensTransmission` is stored in sensor preset JSON (`SensorRadiometry`) and displayed as a read-only value in the Sensor advanced specs panel. It is always `0.85` across all sensors and does not vary with lens quality tier.

**Goal:** Move `lensTransmission` into the lens preset files with tier-appropriate values, add a user-editable number input in the Lens section, wire it through `AppState` so the exposure optimizer reads it from state directly.

---

## File-by-file changes

### 1. `src/types.ts`

| Line | Action | Detail |
|------|--------|--------|
| 17 | **Remove** | `lensTransmission: number;` from `SensorRadiometry` |
| ~67 | **Add** | `lensTransmission: number;` to `AppState` (inside the interface, before closing brace) |

### 2. `presets/types.ts`

| Line | Action | Detail |
|------|--------|--------|
| ~91 | **Add** | `lensTransmission: number;` to `LensPreset` interface (after `aperture`) |

### 3. `src/constants.ts`

| Line | Action | Detail |
|------|--------|--------|
| 102 | **Remove** | `lensTransmission: 0.85,` from `DEFAULT_RADIOMETRY` |
| 77 | **Keep** | `DEFAULT_LENS_TRANSMISSION = 0.85` — now used as the default |

### 4. Lens preset JSONs — add `lensTransmission`

**`presets/lenses/cheap-plastic.json`** — add:
```json
"lensTransmission": 0.60
```
(uncoated plastic singlet, ~60% throughput)

**`presets/lenses/mid-glass.json`** — add:
```json
"lensTransmission": 0.85
```
(single AR coating, ~85% throughput)

**`presets/lenses/premium-stack.json`** — add:
```json
"lensTransmission": 0.95
```
(multi-coated stack, ~95% throughput)

### 5. Sensor preset JSONs — remove `lensTransmission`

Remove the `"lensTransmission": 0.85` line from each:
- `presets/sensors/ov5647.json`
- `presets/sensors/imx219.json`
- `presets/sensors/imx477.json`
- `presets/sensors/ov9281.json`

### 6. `src/state.ts`

**6a. Import `DEFAULT_LENS_TRANSMISSION`**

Add to line 24 import from `./constants`:
```typescript
DEFAULT_LENS_TRANSMISSION,
```

**6b. `DEFAULT_STATE`** — add field (after line 54):
```typescript
lensTransmission: DEFAULT_LENS_TRANSMISSION,
```

**6c. `applyPreset()`** — after setting aperture (line 167), add:
```typescript
app.state.lensTransmission = lensPreset.lensTransmission;
```

**6d. `setField()`** — add special-case for `lensTier` (after the existing `key !== 'lensTier'` block, before `detectSensorPreset`):
```typescript
if (key === 'lensTier') {
  const lens = LENS_PRESETS[value as string];
  if (lens) {
    app.state.lensTransmission = lens.lensTransmission;
  }
}
```

**6e. `validateState()`** — **FIX A: clamp lensTransmission** (after line 103, with the other clamp calls):
```typescript
state.lensTransmission = clamped(state.lensTransmission, 0.01, 1);
```

### 7. `src/exposure.ts`

| Line | Action | Detail |
|------|--------|--------|
| 26 | **Change** | `const T = radiometry.lensTransmission;` → `const T = state.lensTransmission;` |

`SensorRadiometry` import stays for the remaining fields. The function signature doesn't change — it still receives `state`, `derived`, `radiometry`, etc.

### 8. `src/optimizer.ts`

No changes needed. `runOptimization()` spreads `{ ...app.state, ...c.statePatch }` into `tempState`, so `tempState.lensTransmission` carries forward correctly into `calculateExposureOptimizer`.

### 9. `src/main.ts`

**9a. `updateAdvancedSensorSpecs()`** — remove line 414:
```typescript
setText('as-lens-t', (radiometry.lensTransmission * 100).toFixed(0) + '%');
```

This function no longer displays lens transmission; it's now in the Lens section.

### 10. `index.html`

**10a. Sensor details panel** — remove lines 436–437:
```html
<span class="text-slate-500">Lens transmission</span>
<span id="as-lens-t" class="font-mono text-slate-300">—</span>
```

**10b. Lens fieldset** — add new input group after the Lens Quality chips (after line 327, before the `</div>` that closes `space-y-3`):
```html
<div>
  <label class="mb-1 block text-xs font-medium text-slate-400" for="lensTransmission">Lens light transmission</label>
  <div class="flex items-center gap-2">
    <input id="lensTransmission" class="calc-input input-field w-20" type="number" step="0.01" min="0.01" max="1" value="0.85" />
    <span class="text-xs text-slate-500">(0–1)</span>
  </div>
</div>
```

### 11. `src/ui/inputs.ts`

**11a. `initInputs()`** — add binding (after the other `bindNumberInput` calls, e.g. after line 23):
```typescript
bindNumberInput('lensTransmission', 'lensTransmission');
```

**11b. `syncInputsFromState()`** — **FIX B: add to number fields with float precision**

Add `'lensTransmission'` to the `numberFields` array (line 469 range):
```typescript
'lensTransmission',
```

Add a `.toFixed(2)` special-case near the aperture/pixelPitch/focalLength block (after line 489):
```typescript
else if (key === 'lensTransmission') el.value = app.state.lensTransmission.toFixed(2);
```

### 12. `presets/sensors.ts`

No changes needed. `SENSOR_RADIOMETRY` is built from the sensor JSONs' `radiometry` fields — removing `lensTransmission` from those JSONs means the computed objects simply won't have it, which is correct since the field is removed from `SensorRadiometry`.

---

## Verification checklist

- [ ] Cheap plastic lens shows 0.60 transmission in UI input
- [ ] Mid glass lens shows 0.85 transmission
- [ ] Premium lens shows 0.95 transmission
- [ ] Changing lens tier chip updates the transmission input
- [ ] Manually editing transmission input updates exposure results
- [ ] Typing a value > 1 clamps to 1
- [ ] Typing a value < 0.01 clamps to 0.01
- [ ] Sensor advanced specs panel no longer shows "Lens transmission"
- [ ] Lens section shows "Lens light transmission" input
- [ ] Camera preset switch (e.g. Pi Cam v1 → Pi Cam v2) applies correct lens transmission
- [ ] Exposure optimizer uses the transmission value from state
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
