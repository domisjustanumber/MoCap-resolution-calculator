# Show max acceleration/rotation detection values on min resolvable distance chart

## Summary

Replace the Lens Cutoff and Nyquist stat cards under the distance chart with Max Accel Detection and Max Rotation Detection values. Move the displaced info (Lens Cutoff, Effective Nyquist, Effective Diagonal FoV) into the detailed controls panels below. Also update the quick controls bar: rename "Motion" to "Target Motion", extract Gain to its own panel, and replace the shutter speed input with 10 hardcoded preset buttons in two rows.

---

## Files to edit (5 files)

### 1. `src/ui/temporalChart.ts` — Move error budget state here

After `let jitterMs = 10.0;` (line 38):
```typescript
let errorBudgetMm = 5;
```

Add accessors near the other getter/setter block (after `getShutterDenom` around line 86):
```typescript
export function getErrorBudget(): number { return errorBudgetMm; }
export function setErrorBudget(mm: number): void {
  errorBudgetMm = Math.max(0.5, Math.min(25, mm));
}
```

---

### 2. `src/ui/accelerationChart.ts` — Import error budget from temporalChart

**Remove:**
- Line 6: `let errorBudgetMm = 5;`
- Lines 8-13: the `setErrorBudget` and `getErrorBudget` functions

**Update import** (line 2):
```diff
- import { getFrameRate, setFrameRate, getMotionParams } from './temporalChart';
+ import { getFrameRate, setFrameRate, getMotionParams, getErrorBudget, setErrorBudget } from './temporalChart';
```

**In `updateAccelOutputs`** (line 17):
```diff
-  const epsilon = errorBudgetMm / 1000;
+  const epsilon = getErrorBudget() / 1000;
```

**In slider handler** (lines 67-68):
```diff
- errorBudgetMm = parseFloat(budgetSlider.value);
+ setErrorBudget(parseFloat(budgetSlider.value));
- if (budgetLabel) budgetLabel.textContent = errorBudgetMm.toFixed(1);
+ if (budgetLabel) budgetLabel.textContent = getErrorBudget().toFixed(1);
```

**In `initAcceleration`** (line 64):
```diff
- budgetSlider.value = String(errorBudgetMm);
+ budgetSlider.value = String(getErrorBudget());
```

---

### 3. `index.html` — Multiple changes

#### 3a. Metric cards (lines 333-358)

Replace the entire `#metric-cards` grid. Old 6 cards:
1. Lens Cutoff (`card-fc`) → **Max Accel** (`card-max-accel`, rose-400)
2. Nyquist (`card-nyquist`) → **Max Rotation** (`card-max-turn`, rose-400)
3. Diagonal FoV (`card-fov`) → **removed**
4. Skip (`card-skip`) → **kept**
5. Eff. Res. (`card-effective`) → **kept**
6. Feature @ Dist (`card-feature-distance`) → **kept**

New 5-card grid:
```html
<div id="metric-cards" class="mb-3 grid grid-cols-5 gap-3">
  <!-- Max Accel -->
  <div class="metric-card rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
    <p class="text-[10px] font-semibold uppercase tracking-wider text-rose-400">Max Accel</p>
    <p id="card-max-accel" class="mt-0.5 text-lg font-bold font-mono text-slate-100">—</p>
  </div>
  <!-- Max Rotation -->
  <div class="metric-card rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
    <p class="text-[10px] font-semibold uppercase tracking-wider text-rose-400">Max Rotation</p>
    <p id="card-max-turn" class="mt-0.5 text-lg font-bold font-mono text-slate-100">—</p>
  </div>
  <!-- Skip -->
  <div class="metric-card rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
    <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Skip</p>
    <p id="card-skip" class="mt-0.5 text-lg font-bold font-mono text-slate-100">—</p>
  </div>
  <!-- Eff. Res. -->
  <div class="metric-card rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
    <p class="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Eff. Res.</p>
    <p id="card-effective" class="mt-0.5 text-lg font-bold font-mono text-slate-100">—</p>
  </div>
  <!-- Feature @ Dist -->
  <div class="metric-card rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
    <p class="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">Feature @ Dist</p>
    <p id="card-feature-distance" class="mt-0.5 text-sm font-mono text-slate-500">Hover chart</p>
  </div>
</div>
```

#### 3b. Lens fieldset — add Lens Cutoff detail panel

Inside the Lens `<fieldset>`, at the end (before `</fieldset>` at line 424), add:
```html
<div class="rounded border border-slate-800 bg-slate-950/50 p-2.5">
  <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
    <span class="text-slate-500">Lens Cutoff</span>
    <span id="card-fc" class="font-mono text-slate-300">—</span>
  </div>
</div>
```

#### 3c. Sensor Output fieldset — add Effective Nyquist + Effective Diagonal FoV

Inside the Sensor Output `<fieldset>`, after the `readout-method-group` div and before `extracted-warning`, add:
```html
<div class="rounded border border-slate-800 bg-slate-950/50 p-2.5">
  <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
    <span class="text-slate-500">Effective Nyquist</span>
    <span id="card-nyquist" class="font-mono text-slate-300">—</span>
    <span class="text-slate-500">Effective Diagonal FoV</span>
    <span id="card-fov" class="font-mono text-slate-300">—</span>
  </div>
</div>
```

#### 3d. Quick controls — rename "Motion" to "Target Motion"

Line 212:
```diff
- <p class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Motion</p>
+ <p class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Target Motion</p>
```

#### 3e. Quick controls — extract Gain to its own panel

Remove the Gain block from the shutter box (lines 256-269: `<div class="mt-1 flex items-center gap-1">` through the closing `</div>` before the shutter box's `</div>`).

Insert a new Gain panel after the Shutter speed box (between shutter speed and Exposure Optimizer):
```html
<!-- Gain -->
<div class="shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50 p-1.5 max-w-40">
  <p class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Gain</p>
  <div class="flex items-center gap-1">
    <div class="flex-1 min-w-0">
      <input id="gain-slider" class="w-full" type="range" min="1.0" max="8.0" step="0.1" value="1.0" />
      <div class="mt-0.5 flex justify-between text-[9px] text-slate-600">
        <span>1× Unity</span>
        <span>2×</span>
        <span>4×</span>
        <span>8× Max</span>
      </div>
    </div>
    <input id="gain-value" class="calc-input input-field no-spinner w-10" type="number" step="0.1" min="1.0" max="8.0" value="1.0" style="font-size:11px;height:24px;padding-top:0;padding-bottom:0" />
    <span class="text-[10px] text-slate-600">×</span>
  </div>
</div>
```

#### 3f. Quick controls — replace shutter speed input with 10 preset buttons

Replace the shutter speed box (currently lines 250-269) with:
```html
<!-- Shutter speed -->
<div class="shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50 p-1.5">
  <p class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Shutter speed</p>
  <div class="flex flex-wrap gap-0.5" id="shutter-presets">
    <button class="shutter-preset rounded px-1 py-1 text-[11px] font-medium leading-none" data-shutter="8000">1/8000</button>
    <button class="shutter-preset rounded px-1 py-1 text-[11px] font-medium leading-none" data-shutter="4000">1/4000</button>
    <button class="shutter-preset rounded px-1 py-1 text-[11px] font-medium leading-none" data-shutter="2000">1/2000</button>
    <button class="shutter-preset rounded px-1 py-1 text-[11px] font-medium leading-none" data-shutter="1000">1/1000</button>
    <button class="shutter-preset rounded px-1 py-1 text-[11px] font-medium leading-none" data-shutter="500">1/500</button>
    <button class="shutter-preset rounded px-1 py-1 text-[11px] font-medium leading-none" data-shutter="250">1/250</button>
    <button class="shutter-preset rounded px-1 py-1 text-[11px] font-medium leading-none" data-shutter="125">1/125</button>
    <button class="shutter-preset rounded px-1 py-1 text-[11px] font-medium leading-none" data-shutter="60">1/60</button>
    <button class="shutter-preset rounded px-1 py-1 text-[11px] font-medium leading-none" data-shutter="30">1/30</button>
    <button class="shutter-preset rounded px-1 py-1 text-[11px] font-medium leading-none" data-shutter="15">1/15</button>
    <input id="shutter-custom" class="calc-input input-field no-spinner w-10" type="number" step="1" min="1" max="8000" placeholder="1/N" style="font-size:11px;height:24px;padding-top:0;padding-bottom:0" />
  </div>
</div>
```

---

### 4. `src/ui/outputs.ts` — Add new card values

**Update import** (line 4):
```diff
- import { getFrameRate, getShutterTime } from './temporalChart';
+ import { getFrameRate, getShutterTime, getMotionParams, getErrorBudget } from './temporalChart';
```

**Keep** existing lines 12-17 (setText for card-fc, card-nyquist, card-fov, card-skip, card-effective, card-feature) — these still work because the IDs exist in their new DOM locations.

**At the end of `updateOutputs`**, after `updateConditionalNotes(app);` (line 28), add:
```typescript
  // Max acceleration / rotation detection limits
  const fps = getFrameRate();
  const motion = getMotionParams();
  const epsilon = getErrorBudget() / 1000;
  const maxAccel = 8 * epsilon * fps * fps;
  const maxTurn = fps * 180;

  const accelExceeded = motion.acceleration > maxAccel;
  const accelText = maxAccel.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' m/s²';
  setText('card-max-accel', accelExceeded ? '⚠ ' + accelText : accelText);
  setText('card-max-turn', maxTurn.toLocaleString() + ' °/s');

  const accelEl = document.getElementById('card-max-accel');
  if (accelEl) {
    accelEl.className = `mt-0.5 text-lg font-bold font-mono ${accelExceeded ? 'text-red-400' : 'text-slate-100'}`;
  }
```

---

### 5. `src/main.ts` — Simplify rebuild shutter presets

Replace the `rebuildShutterPresets` function (lines 100-118):
```typescript
function rebuildShutterPresets(): void {
  updateShutterPresetStyles();
}
```

All call sites remain unchanged (they call `rebuildShutterPresets()` followed by `updateShutterPresetStyles()` — the latter is now called inside the function, so the redundant external calls still work fine).

---

## No circular dependencies

- `outputs.ts` only imports from `temporalChart.ts` (no import from `accelerationChart.ts`)
- `accelerationChart.ts` imports from `temporalChart.ts` (not from `outputs.ts`)
- All error budget state lives in `temporalChart.ts`
