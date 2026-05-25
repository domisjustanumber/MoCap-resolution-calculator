# Motion Preset Enrichment Plan

## Goal

Include acceleration (m/s²) and angular velocity (°/s) alongside linear speed in the walking/sports motion presets, so the engine's motion blur calculation accounts for non-constant-velocity motion.

---

## Background

### Current state

- **Presets**: `VELOCITY_PRESETS` in `src/main.ts:130` — flat `Record<string, number>` with `{ static: 0, walking: 1.5, sports: 5 }` (m/s)
- **Velocity state**: Two module-level globals in `src/ui/temporalChart.ts:24-25` — `targetVelocity` (Monte Carlo sync sim) and `spatialVelocity` (spatial MTF + engine)
- **Flow**: `main.ts` → `state.ts:recalculate()` → `engine.ts:calculateResults()` + `exposure.ts:calculateExposureOptimizer()`, each taking a bare `velocity: number`
- **Acceleration tab** (`accelerationChart.ts`): Standalone display-only feature computing *system tracking limits* (`a_max = 8·ε·fps²`, `ω_max = fps·180°/s`). Does not feed into the engine and does not describe subject motion.
- **Optimizer** (`optimizer.ts:28`): Hardcodes `velocity = 0` — blind to all motion when searching for optimal resolution/FPS.

### Gap

The motion blur model assumes constant velocity during exposure (`vImg = v · f / D`). Real walking/sports involve acceleration (starting, stopping, turning) and rotation (pivoting, head turn) — both add extra blur.

The optimizer's `velocity = 0` means it never considers motion blur or acceleration tracking requirements, causing it to select high-resolution / low-FPS configurations that work for static subjects but fail with real motion.

---

## Plan

### ① Data Model — `src/types.ts`

```typescript
export interface MotionParams {
  linearVelocity: number;   // m/s, forward speed (0–20)
  acceleration: number;     // m/s², longitudinal acceleration (0–20)
  angularVelocity: number;  // °/s, subject rotation rate (0–360)
  subjectHalfWidth: number; // m, characteristic half-size (0.1–2, default 0.5)
}
```

### ② Motion State — `src/ui/temporalChart.ts`

Replace scalar globals with a `MotionParams` object:

```typescript
let motionParams: MotionParams = {
  linearVelocity: 1.5,
  acceleration: 0,
  angularVelocity: 0,
  subjectHalfWidth: 0.5,
};
```

Export getters/setters:
- `getMotionParams(): MotionParams`
- `setMotionParams(p: Partial<MotionParams>): void`
- Individual `getLinearVelocity()`, `setAcceleration(v)`, etc.

Keep `targetVelocity` as a separate scalar (used by Monte Carlo sim). The presets set `linearVelocity` as before, and the Monte Carlo sim continues to use `targetVelocity` (or defaults from `linearVelocity`).

### ③ Presets — `src/main.ts`

Replace `VELOCITY_PRESETS` with `MOTION_PRESETS`:

```typescript
const MOTION_PRESETS: Record<string, MotionParams> = {
  static:  { linearVelocity: 0,   acceleration: 0,   angularVelocity: 0,   subjectHalfWidth: 0.5 },
  walking: { linearVelocity: 1.5, acceleration: 0.5, angularVelocity: 10,  subjectHalfWidth: 0.5 },
  sports:  { linearVelocity: 5,   acceleration: 4,   angularVelocity: 60,  subjectHalfWidth: 0.5 },
};
```

`detectMotionPreset(v)` remains driven by `linearVelocity` (primary discriminant). The custom input stays, but when custom is active, users tune all params independently in the detailed controls.

### ④ Engine Physics — `src/engine.ts`

Change `calculateResults` signature to accept `motion: MotionParams` and `shutterTime: number`.

Replace lines 123-124:

```typescript
// Current:
const vImg = velocity * state.focalLength / Math.max(0.1, state.distanceToSubject);

// New:
const vEff = motion.linearVelocity + 0.5 * motion.acceleration * shutterTime;
const vRot = (motion.angularVelocity * Math.PI / 180) * motion.subjectHalfWidth;
const vTotal = Math.sqrt(vEff * vEff + vRot * vRot);
const vImg = vTotal * state.focalLength / Math.max(0.1, state.distanceToSubject);
```

The existing `fTemporal50 = 0.603 / (vImg * shutterTime)` stays unchanged — it just receives a larger `vImg`.

### ⑤ Exposure Optimizer — `src/exposure.ts`

Same signature change: accept `motion: MotionParams`. Apply identical effective-velocity formula on line 55 for `tMotionMax`.

### ⑥ State Wiring — `src/state.ts`

Change `recalculate()` to read `getMotionParams()` instead of `getSpatialVelocity()`. Pass `motion` + `shutterTime` to both engine calls.

### ⑦ UI — `index.html`

**Motion fieldset** — stacked alongside Sensor Output and Compression in the detailed controls grid.

The detailed controls grid stays `lg:grid-cols-5`. Sensor Output `<fieldset>` and Compression `<fieldset>` are wrapped in a `<div class="flex flex-col gap-4">` inside column 4. The Motion fieldset goes in column 5.

```
┌──────────┬──────────┬──────────────────┬────────────────────┬────────────────┐
│  Lens    │  Sensor  │ Light & Temp     │  flex-col gap-4    │    Motion (new) │
│          │          │                  │ ┌────────────────┐ │ ┌──────────────┐│
│          │          │                  │ │ Sensor Output  │ │ │ Acceleration ││
│          │          │                  │ │ (½ height)     │ │ │ Angular vel  ││
│          │          │                  │ ├────────────────┤ │ │ Half-width   ││
│          │          │                  │ │ Compression    │ │ └──────────────┘│
│          │          │                  │ │ (½ height)     │ │                │
│          │          │                  │ └────────────────┘ │                │
└──────────┴──────────┴──────────────────┴────────────────────┴────────────────┘
```

```html
<fieldset class="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
  <legend class="px-2 text-xs font-semibold uppercase tracking-wider text-rose-400">Motion</legend>
  <div class="space-y-3">
    <div>
      <label class="mb-1 block text-xs font-medium text-slate-400">Acceleration</label>
      <div class="flex items-center gap-2">
        <input id="motion-accel" class="w-full" type="range" min="0" max="20" step="0.1" value="0" />
        <input id="motion-accel-input" class="calc-input input-field w-14" type="number" step="0.1" min="0" max="20" value="0" />
        <span class="text-xs text-slate-500">m/s²</span>
      </div>
    </div>
    <div>
      <label class="mb-1 block text-xs font-medium text-slate-400">Angular velocity</label>
      <div class="flex items-center gap-2">
        <input id="motion-angular" class="w-full" type="range" min="0" max="360" step="1" value="0" />
        <input id="motion-angular-input" class="calc-input input-field w-14" type="number" step="1" min="0" max="360" value="0" />
        <span class="text-xs text-slate-500">°/s</span>
      </div>
    </div>
    <div>
      <label class="mb-1 block text-xs font-medium text-slate-400">Subject half-width</label>
      <div class="flex items-center gap-2">
        <input id="motion-halfwidth" class="w-full" type="range" min="0.1" max="2" step="0.1" value="0.5" />
        <input id="motion-halfwidth-input" class="calc-input input-field w-14" type="number" step="0.1" min="0.1" max="2" value="0.5" />
        <span class="text-xs text-slate-500">m</span>
      </div>
    </div>
  </div>
</fieldset>
```

**Acceleration tab** — add two new metric cards:
- **Subject Acceleration**: `motionParams.acceleration` → `X.X m/s²` (highlight red if > system ceiling)
- **Subject Rotation**: `motionParams.angularVelocity` → `X °/s`

### ⑧ Motion Control Binding — `src/main.ts`

- On preset button click: `setMotionParams(MOTION_PRESETS[preset])`, refresh
- On custom velocity input: set `linearVelocity`, set `activeMotionPreset = 'custom'`, refresh
- On acceleration/angular/half-width slider change: set individual field, set `activeMotionPreset = 'custom'`, refresh
- Add `bindSlider` calls for the three new sliders
- Update optimizer call: `runOptimization(app)` → `runOptimization(app, getMotionParams())`

### ⑨ Acceleration Tab — `src/ui/accelerationChart.ts`

Keep existing system tracking limit cards. Read from `getMotionParams()` each time `updateAccelOutputs()` runs:

- **Subject Acceleration**: `motionParams.acceleration` — compare against `maxAccel` ceiling, highlight red if exceeded
- **Subject Rotation**: `motionParams.angularVelocity`

Export `getErrorBudget()` so the optimizer can share the same error budget value.

### ⑩ Optimizer — `src/optimizer.ts`

Two changes:

**A — Pass real motion params** (line 28):
```
runOptimization(app: ..., motion: MotionParams, errorBudgetMm: number = 5)
```
Replace `const velocity = 0;` with using `motion.linearVelocity`. Pass `motion` through to all `calculateResults` and `calculateExposureOptimizer` calls. This makes the motion blur ceiling (`tMotionMax`) finite during candidate evaluation, penalizing slow shutters on high-resolution modes for moving subjects.

**B — Enforce FPS floor from acceleration tracking** (after `fps = Math.min(shutterDenom, c.maxFps)` on line 55):
```typescript
const minFpsForAccel = motion.acceleration > 0
  ? Math.sqrt(motion.acceleration / (8 * errorBudgetMm / 1000))
  : 0;
if (!isFinite(minFpsForAccel) || fps < minFpsForAccel) continue;
```
This rejects candidates whose FPS is below the temporal sampling rate needed to track the subject's acceleration. The formula inverts the acceleration tab's `a_max = 8·ε·fps²`. With sports preset (4 m/s², 5mm budget): `fps_min ≈ sqrt(4 / 0.04) = 10`. More aggressive acceleration or tighter error budgets make this binding.

### ⑪ Files Changed

| File | Change |
|------|--------|
| `src/types.ts` | Add `MotionParams` interface |
| `src/ui/temporalChart.ts` | Replace scalars with `MotionParams`, add getters |
| `src/engine.ts` | Accept `MotionParams`, compute effective vImg |
| `src/exposure.ts` | Accept `MotionParams`, same formula |
| `src/state.ts` | Read motion params instead of bare velocity |
| `src/main.ts` | `MOTION_PRESETS`, slider bindings, preset dispatch, update optimizer call |
| `index.html` | Motion fieldset + stacked Sensor Output/Compression + accel tab cards |
| `src/ui/accelerationChart.ts` | Add subject accel/rotation readout, export `getErrorBudget()` |
| `src/optimizer.ts` | Accept `MotionParams`, use real velocity, enforce accel FPS floor |

---

## Potential Issues & Risks

### 1. Signature breakage in `calculateResults` / `calculateExposureOptimizer`

Changing the signature from `velocity: number` to `motion: MotionParams` breaks every call site. `state.ts` calls it twice (lines 146, 148), exposure calls it once (line 147), and the optimizer calls it twice (lines 47, 74). All must be updated atomically.

### 2. `targetVelocity` vs `linearVelocity` divergence

The Monte Carlo sim in `temporalChart.ts` uses `targetVelocity` independently from `spatialVelocity`. Currently `applyVelocityPreset` syncs both (`setSpatialVelocity(v)` + `setTemporalVelocity(v)`). The plan keeps `targetVelocity` separate and defaults it from `linearVelocity`, but if someone changes acceleration/rotation without changing linear velocity, the Monte Carlo sim still runs with the old velocity. This is arguably correct (the sync sim cares about tracking speed, not subject dynamics), but the two values can silently diverge in custom mode. **Mitigation**: Add a comment explaining this, and optionally update `targetVelocity` when `linearVelocity` changes via the preset system.

### 3. Responsive layout — fieldset stacking

The detailed controls use `lg:grid-cols-5`. Sensor Output and Compression are wrapped in a `<div class="flex flex-col gap-4">` in one column, with Motion in the 5th column. This works at `lg` and above. Below `lg`, Tailwind's grid collapses to single-column — each fieldset stacks naturally. No breakpoint changes needed.

### 4. Preset detection ambiguity

`detectVelocityPreset` checks `Math.abs(v - presetValue) < 0.05` against linear velocity. If a user sets custom linear velocity back to 1.5 but has non-zero acceleration, the "Walking" button will show as active even though it's not the walking preset. **Mitigation**: `detectVelocityPreset` should check *all* motion params, or rename the concept to "activeMotionPreset" that gets set to `'custom'` whenever any non-preset value is entered, regardless of linear velocity match.

### 5. Circular dependency in exposure optimizer `tMotionMax`

The formula `tMotionMax = 0.603 / (v_eff · K)` where `v_eff = v + 0.5·a·tMotionMax` creates a quadratic in `tMotionMax`:

```
0.5·a·K·t² + v·K·t - 0.603 = 0    where K = f/D · fEffective
```

Two approaches:
- **Solve the quadratic**: compute the positive root for `tMotionMax`. More correct but more complex.
- **Use raw velocity**: compute `tMotionMax` with `linearVelocity` only (ignore acceleration). Slightly conservative (underestimates the ceiling), avoids the quadratic entirely. The acceleration term is included in the final `calculateResults` pass which has the definitive shutter time.

**Recommendation**: Use raw `linearVelocity` for the exposure optimizer's ceiling, full formula in the final pass. The ~1-2% error on the ceiling is harmless for a bound.

### 6. Acceleration sign ambiguity

All values are positive magnitudes. Deceleration produces the same blur magnitude as acceleration (the velocity changes by the same amount), so this is fine for blur calculations. But it means a "walking then stopping" preset would have the same blur as "starting from rest." For a sports context this is acceptable.

### 7. Angular velocity axis simplification

The model assumes rotation around a vertical axis (yaw), producing lateral motion at the subject's edge. In reality, sports subjects also pitch (leaning forward while running) and roll (a ball spinning). The yaw-only model captures the dominant blur component for walking/running athletes. **Document as a simplification** in the UI note.

### 8. Subject half-width corner cases

For a ball (radius ~0.11m), rotation contributes almost nothing. For a wide vehicle (half-width ~1m), rotation dominates. The slider range (0.1–2m) covers these, but a small subject with fast rotation (e.g., a spinning ball) will be underrepresented. **Acceptable** for the intended use case (humans walking/sports).

### 9. Error budget source for FPS floor

The optimizer needs `errorBudgetMm` to compute the FPS floor from acceleration. Options:
- Import `getErrorBudget()` from `accelerationChart.ts` (creates dependency optimizer → UI module)
- Default to 5mm and let it be overridden

**Recommendation**: Accept `errorBudgetMm` as an optional parameter defaulting to 5, matching the acceleration tab's default. No cross-module import needed.

### 10. Optimizer's `velocity = 0` — scope impact

The optimizer currently sets `velocity = 0` on line 28. This isn't just a convenience — it means the optimizer ignores `fTemporal50` and `fDRLimited` when scoring candidates, making the search purely optical. With the change to real velocity, `fTemporal50` becomes a meaningful limit and may dominate at high resolutions. This is the desired behavior — the optimizer should reject modes where motion blur makes the resolution irrelevant.

### 11. Acceleration tab cross-reactivity

The acceleration tab's FPS slider calls `setFrameRate()` which triggers `drawTemporalChart`. If the new subject-acceleration readout reads from `motionParams`, it must also refresh when motion params change. The existing `updateAccelOutputs()` is called at the end of `refreshAll()`, so the new cards will update automatically as long as they read from the same motion state. **Mitigation**: The accel tab should read `getMotionParams()` each time `updateAccelOutputs()` is called, not cache the values.

---

## Verification Checklist

After implementation, verify:

- [ ] `npm run build` compiles without errors
- [ ] Static preset: all motion params = 0 → engine output identical to current
- [ ] Walking preset: acceleration 0.5 m/s², angular 10°/s → `fTemporal50` slightly lower than current
- [ ] Sports preset: acceleration 4 m/s², angular 60°/s → `fTemporal50` noticeably lower
- [ ] Custom mode: changing each slider independently updates calculations
- [ ] Preset detection: buttons highlight correctly; custom input clears preset detection
- [ ] Acceleration tab shows subject accel/rotation values matching the preset
- [ ] Acceleration tab warns when subject accel exceeds tracking ceiling
- [ ] Optimizer with sports preset: `velocity = 0` replaced, candidates penalized by motion blur
- [ ] Optimizer with sports preset: rejects modes whose `maxFps < accel-tracking floor`
- [ ] Optimizer with static preset: produces identical results to current (zero motion params)
- [ ] Sensor Output and Compression stack at half-height in one column on desktop
- [ ] No visual regression on detailed controls layout at any viewport width
- [ ] Responsive grid collapses correctly below `lg` breakpoint
- [ ] Monte Carlo sim produces consistent results (`targetVelocity` unaffected)
