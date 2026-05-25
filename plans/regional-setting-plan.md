# Plan: Regional Frequency Setting (50Hz / 60Hz / Free)

## Overview

Add a "Region" selector to quick controls bar for 50Hz, 60Hz, or Free.

**Constraint rule**: 25 and 30 FPS are always permitted, but all other FPS values must be multiples of 50 (50Hz) or 60 (60Hz). All shutter speeds must be `1 / (multiple of 50 or 60)`.

| | 50Hz | 60Hz | Free |
|---|---|---|---|
| FPS | {25} ∪ {50, 100, 150, 200, 250...} | {30} ∪ {60, 120, 180, 240...} | any |
| Shutter | {50, 100, 150, 200, 250...} | {60, 120, 180, 240...} | any |
| Optimizer round | FPS → nearest valid; shutter → multiple of 50 | FPS → nearest valid; shutter → multiple of 60 | none |

---

## Files to change

| File | What changes |
|---|---|
| `index.html` | Add Region selector card; remove hardcoded FPS & shutter preset buttons (keep custom inputs + wrapper divs) |
| `src/style.css` | Add `.region-preset` to the preset-chip group |
| `src/ui/temporalChart.ts` | Add `regionHz` module variable + getter/setter + rounding helpers; remove `SHUTTER_PRESETS` constant; fix `setFrameRate()` to use region-aware multiples |
| `src/main.ts` | Region click handlers via event delegation; timezone auto-detect; `rebuildFpsPresets()` / `rebuildShutterPresets()`; manual-input auto-detection on `change`; region-highlight |
| `src/optimizer.ts` | Round `shutterDenom` and `fps` to region-valid values after hardware clamp |

---

## Step-by-step

### 1. `src/ui/temporalChart.ts` — Add region state & fix shutter adjustment

**Remove** `SHUTTER_PRESETS = [30, 60, 120, 250, 500, 1000]` (line 108).

**Add** module variable:
```ts
let regionHz = 50;   // 50, 60, or 0 for Free
```

**Add helpers:**

```ts
export function getRegionHz(): number { return regionHz; }

// Shutter step = hz (50 or 60). Free: 25 for convenience.
function shutterStep(hz: number): number {
  return hz > 0 ? hz : 25;
}

// FPS step = hz (50 or 60). Free: 25 for convenience.
function fpsStep(hz: number): number {
  return hz > 0 ? hz : 25;
}

// ---- Shutter rounding ----
function nearestShutterMultiple(denom: number, hz: number): number {
  if (hz === 0) return Math.round(denom);
  const step = shutterStep(hz);
  return Math.round(denom / step) * step;
}

function ceilShutter(denom: number, hz: number): number {
  if (hz === 0) return denom;
  const step = shutterStep(hz);
  return Math.ceil(denom / step) * step;
}

// ---- FPS rounding ----
// Is this FPS valid for the region?
function isValidFps(fps: number, hz: number): boolean {
  if (hz === 0) return true;
  return fps === hz / 2 || fps % hz === 0;
}

function nearestValidFps(fps: number, hz: number, maxFps: number): number {
  if (hz === 0) return Math.max(1, Math.min(maxFps, Math.round(fps)));
  const half = hz / 2;
  const nearestMultiple = Math.round(fps / hz) * hz;
  const useHalf = Math.abs(fps - half) < Math.abs(fps - nearestMultiple);
  const candidate = useHalf ? half : nearestMultiple;
  return Math.max(1, Math.min(maxFps, candidate));
}

function ceilValidFps(fps: number, hz: number, maxFps: number): number {
  if (hz === 0) return Math.max(1, Math.min(maxFps, Math.round(fps)));
  const half = hz / 2;
  if (fps <= half) return half;
  return Math.min(maxFps, Math.ceil(fps / hz) * hz);
}
```

**`setRegionHz(hz: number)`:**
```ts
export function setRegionHz(hz: number): void {
  regionHz = hz;
  frameRate = nearestValidFps(frameRate, hz, maxFps);
  if (shutterDenom < frameRate) {
    shutterDenom = Math.max(frameRate, ceilShutter(frameRate, hz));
  } else {
    shutterDenom = Math.max(frameRate, nearestShutterMultiple(shutterDenom, hz));
  }
}
```

**Fix `setFrameRate()`** — replace the `SHUTTER_PRESETS.filter(...)` logic:
```ts
export function setFrameRate(fps: number): void {
  frameRate = Math.max(1, Math.min(maxFps, Math.round(fps)));
  if (shutterDenom < frameRate) {
    shutterDenom = Math.max(frameRate, ceilShutter(frameRate, regionHz));
  }
  if (appRef) drawTemporalChart(appRef, true);
}
```

### 2. `index.html` — Quick controls changes

**Add** a Region card between FPS and Shutter cards:
```html
<!-- Region -->
<div class="shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50 p-1.5">
  <p class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Region</p>
  <div class="flex items-center gap-0.5" id="region-presets">
    <button data-region="50" class="region-preset rounded px-1 py-1 text-[11px] font-medium leading-none">50Hz</button>
    <button data-region="60" class="region-preset rounded px-1 py-1 text-[11px] font-medium leading-none">60Hz</button>
    <button data-region="0" class="region-preset rounded px-1 py-1 text-[11px] font-medium leading-none">Free</button>
  </div>
</div>
```

**Remove** hardcoded `.fps-preset` and `.shutter-preset` buttons. Keep `<div id="fps-presets">` / `<div id="shutter-presets">` containers and `<input>` elements (`#fps-custom`, `#shutter-custom`).

### 3. `src/style.css` — Add region-preset to chip group

Add `region-preset` to the same `@apply` line as `vel-preset`, `fps-preset`, `shutter-preset` etc.

### 4. `src/main.ts` — All wired logic

#### 4a. Timezone auto-detect
```ts
function detectDefaultRegion(): number {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const is60Hz = tz.startsWith('America/') ||
      ['Asia/Seoul', 'Asia/Tokyo', 'Asia/Manila', 'Asia/Taipei'].includes(tz);
    return is60Hz ? 60 : 50;
  } catch {
    return 50;
  }
}
const defaultHz = detectDefaultRegion();
setRegionHz(defaultHz);
```

#### 4b. Region preset buttons — event delegation on `#region-presets`
```ts
document.getElementById('region-presets')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.region-preset') as HTMLButtonElement;
  if (!btn) return;
  const hz = parseInt(btn.dataset.region || '0', 10);
  if (hz === getRegionHz()) return;
  setRegionHz(hz);
  rebuildFpsPresets();
  rebuildShutterPresets();
  updateRegionPresetStyles();
  refreshAll();
});
```

#### 4c. `rebuildFpsPresets()` — dynamic FPS buttons

For 50Hz: emit 25, then 50, 100, 150, 200...
For 60Hz: emit 30, then 60, 120, 180, 240...

```ts
function rebuildFpsPresets(): void {
  const container = document.getElementById('fps-presets');
  if (!container) return;
  container.querySelectorAll('.fps-preset').forEach(el => el.remove());
  const regionHz = getRegionHz();
  const max = getMaxFpsLimit();
  // Insert the half-value first (25 or 30)
  if (regionHz > 0) {
    const half = regionHz / 2;
    if (half <= max) {
      const btn = document.createElement('button');
      btn.dataset.fps = String(half);
      btn.className = 'fps-preset rounded px-1 py-1 text-[11px] font-medium text-center leading-none';
      btn.textContent = String(half);
      container.insertBefore(btn, document.getElementById('fps-custom'));
    }
  }
  // Then full multiples of hz
  const step = fpsStep(regionHz);
  for (let v = step; v <= max; v += step) {
    if (v > 300) break;
    const btn = document.createElement('button');
    btn.dataset.fps = String(v);
    btn.className = 'fps-preset rounded px-1 py-1 text-[11px] font-medium text-center leading-none';
    btn.textContent = String(v);
    container.insertBefore(btn, document.getElementById('fps-custom'));
  }
  updateFpsPresetStyles();
}
```

Event delegation on `#fps-presets` (set up once at init):
```ts
document.getElementById('fps-presets')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.fps-preset') as HTMLButtonElement;
  if (!btn) return;
  const fps = parseInt(btn.dataset.fps || '0', 10);
  if (fps > getMaxFpsLimit()) return;
  setFrameRate(fps);
  updateFpsPresetStyles();
  updateFpsLabel();
  updateShutterPresetStyles();
  refreshAll();
});
```

#### 4d. `rebuildShutterPresets()` — dynamic shutter buttons

For 50Hz: 50, 100, 150, 200...
For 60Hz: 60, 120, 180, 240...

```ts
function rebuildShutterPresets(): void {
  const container = document.getElementById('shutter-presets');
  if (!container) return;
  container.querySelectorAll('.shutter-preset').forEach(el => el.remove());
  const regionHz = getRegionHz();
  const step = shutterStep(regionHz);
  const max = getMaxShutterLimit();
  const minDenom = getFrameRate();
  for (let v = Math.max(step, minDenom); v <= max; v += step) {
    if (v > 8000) break;
    const btn = document.createElement('button');
    btn.dataset.shutter = String(v);
    btn.className = 'shutter-preset rounded px-1 py-1 text-[11px] font-medium text-center leading-none';
    btn.textContent = '1/' + v;
    container.insertBefore(btn, document.getElementById('shutter-custom'));
  }
  updateShutterPresetStyles();
}
```

Event delegation on `#shutter-presets`:
```ts
document.getElementById('shutter-presets')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.shutter-preset') as HTMLButtonElement;
  if (!btn) return;
  const d = parseInt(btn.dataset.shutter || '0', 10);
  if (d < getFrameRate()) return;
  setShutterDenom(d);
  updateShutterPresetStyles();
  refreshAll();
});
```

#### 4e. Manual input auto-detection (on `change`, not `input`)

Use `change` (fires on blur/enter) to avoid triggering region switch on partial keystrokes:

```ts
function detectRegionForValue(value: number): number {
  // 60Hz: value === 30 (FPS special) or value % 60 === 0 (FPS + shutter)
  if (value === 30 || (value > 0 && value % 60 === 0)) return 60;
  // 50Hz: value === 25 (FPS special) or value % 50 === 0 (FPS + shutter)
  if (value === 25 || (value > 0 && value % 50 === 0)) return 50;
  return 0;  // Free
}
```

In the custom FPS `change` handler and shutter `change` handler, after setting the value:
```ts
const detected = detectRegionForValue(parsedValue);
if (detected !== getRegionHz()) {
  setRegionHz(detected);
  rebuildFpsPresets();
  rebuildShutterPresets();
  updateRegionPresetStyles();
}
```

#### 4f. `updateRegionPresetStyles()`
```ts
function updateRegionPresetStyles(): void {
  updatePresetStyles('.region-preset', () => getRegionHz(), 'region');
}
```

#### 4g. Initialisation order

1. `detectDefaultRegion()` → `setRegionHz(defaultHz)`
2. Set up event delegation for `#fps-presets`, `#shutter-presets`, `#region-presets`
3. `rebuildFpsPresets()`
4. `rebuildShutterPresets()`
5. `setFrameRate(frameRate)` (ensure shutter valid for current fps)
6. `updateRegionPresetStyles()`
7. `refreshAll()`

### 5. `src/optimizer.ts` — Lock output to region

After clamping to hardware limits, apply region rounding. Order: **clamp → round → re-clamp**.

```ts
const regionHz = getRegionHz();   // import from temporalChart
let shutterDenom = Math.min(idealShutterDenom, c.maxShutterDenom);
let fps = Math.min(shutterDenom, c.maxFps);

if (regionHz > 0) {
  // Round shutter to nearest multiple of hz
  shutterDenom = Math.round(shutterDenom / regionHz) * regionHz;
  shutterDenom = Math.max(c.maxFps, Math.min(c.maxShutterDenom, shutterDenom));

  // Round fps to nearest valid (half-value or multiple of hz)
  const half = regionHz / 2;
  const nearestMultiple = Math.round(fps / regionHz) * regionHz;
  const useHalf = Math.abs(fps - half) < Math.abs(fps - nearestMultiple);
  fps = useHalf ? half : nearestMultiple;
  fps = Math.min(shutterDenom, Math.min(fps, c.maxFps));
}
```

This happens **before** candidate selection (lines 94-123) to compare region-valid candidates.

---

## Auto-detect matrix

| Value | 60Hz match? | 50Hz match? | Result |
|---|---|---|---|
| 25 | no (30? no. %60? no) | yes (25? yes) | 50Hz |
| 30 | yes (30? yes) | no (25? no. %50? no) | 60Hz |
| 60 | yes (%60=0) | no (25? no. %50? no) | 60Hz |
| 50 | no (30? no. %60? no) | yes (%50=0) | 50Hz |
| 100 | no (%60≠0) | yes (%50=0) | 50Hz |
| 120 | yes (%60=0) | no (%50≠0) | 60Hz |
| 150 | no (%60≠0) | yes (%50=0) | 50Hz |
| 33 | no | no | Free |
| 300 | yes (%60=0) | yes (%50=0) | 60Hz (60Hz checked first) |

---

## Edge cases & behaviour matrix

| Scenario | Behaviour |
|---|---|
| Region=50Hz, user types shutter=1/33 in custom input, blurs | `change` fires → 33 matches neither → Free highlighted |
| Region=60Hz, user types FPS=90, blurs | `change` → 90%60≠0, 90≠30 → Free highlighted (90 not in {30,60,120,180}) |
| Region=60Hz, user types FPS=120, blurs | `change` → 120%60=0 → 60Hz stays highlighted |
| Region=50Hz (FPS=50), user clicks 60Hz preset | `setRegionHz(60)` → `nearestValidFps(50,60)=60`, shutter rounded/reclamped |
| Region=Free, shutter=1/33 typed | Auto-detect: no match → stays Free |
| Optimizer: region=50Hz, tOptimal=0.009s → ideal=111 | Clamp → round 111 to 100 (nearest 50) → reclamp |
| Optimizer: region=60Hz, tOptimal=0.01s → ideal=100 | Clamp → round 100 to 120 (nearest 60) → reclamp |
| User types "6" in FPS input (typing "60") | `input` fires → fps=6. `change` not yet fired → region unchanged. On blur `change` fires → value=60 → 60Hz highlighted |
| Intl unavailable | try/catch → region=50Hz |
| FPS=300 custom input, region=60Hz | 300%60=0 → valid, no region switch needed |

---

## Concern checklist

| Issue | Fix |
|---|---|
| FPS/shutter have **different** valid sets | Separate `nearestValidFps`/`ceilValidFps` (allows hz/2) from `nearestShutterMultiple`/`ceilShutter` (only multiples of hz) |
| Dynamic buttons need event listeners | Event delegation on parent containers — set up once at init, never rebinds |
| `SHUTTER_PRESETS` stale after region changes | Removed; `setFrameRate()` uses region-aware `ceilShutter()` |
| `setFrameRate()` shutter adjustment | Uses `ceilShutter(frameRate, regionHz)` with step = hz, not hz/2 |
| Auto-detect flickers on partial input | `change` event (blur/enter) not `input` |
| `25` vs `30` auto-detect collision | Check `===30` and `===25` explicitly before modulo checks |
| `300` matches both 50Hz and 60Hz | 60Hz checked first (higher Hz priority) |
| Optimizer rounding violates hardware bounds | clamp → round → re-clamp |
| `Intl` throws | try/catch → 50Hz |
| `nearestValidFps` might pick `half` when `half` equals `nearestMultiple` (e.g. fps=50, hz=50 → half=25, nearestMultiple=50) | `distHalf=25, distMultiple=0` → correctly picks 50 (not 25) |
