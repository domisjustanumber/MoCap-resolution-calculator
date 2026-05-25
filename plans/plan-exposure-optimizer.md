# Exposure Optimizer Implementation Plan

## Purpose

Given a scene's lux, subject velocity, and sensor radiometric specifications, automatically compute the optimal exposure time and analog gain that produce the highest achievable SNR while respecting motion blur, saturation, and SNR floor constraints.

---

## Architecture Overview

```
lux_subject, reflectance, temp(C) ─┐
velocity, focal_len, distance ─────┤
sensor radiometrics (QE, FWC, RN) ─┤
aperture, wavelength ──────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  calculateExposureOptimizer()       │
│  (new module: src/exposure.ts)      │
│                                     │
│  1. E_sensor = lux × R × T / (4N²) │
│  2. photons/px/s → e⁻/px/s         │
│  3. compute SNR at candidate t's   │
│  4. solve t_min (SNR floor)        │
│  5. compute t_motion_max (blur)    │
│  6. compute t_sat (FWC ceiling)    │
│  7. pick t_optimal = clamp         │
│  8. compute optimal gain           │
│  9. derive max_fps                 │
└──────────┬──────────────────────────┘
           │ ExposureOptimization
           ▼
 calculateResults()  ← receives t_optimal, gain
           │
     updateOutputs()  ← displays recommendations
```

## The Chicken-and-Egg Resolution Problem

```ts
t_optimal ──depends on──→ fEffective
                              ↑
fEffective ──depends on──→ fTemporal50
                              ↑
fTemporal50 ──depends on──→ t_optimal
```

The optimizer needs `fEffective` (the system's effective resolution) to compute the motion blur ceiling `t_motion_max`. But `fEffective` depends on `fTemporal50`, which depends on the very shutter time we're trying to optimize.

### Solution: Two-Pass Calculation

1. **First pass**: Run `calculateResults()` with a neutral shutter time (1/30s), producing `fEffective_0`
2. **Optimizer**: Feed `fEffective_0` as the fixed `f_target` into motion ceiling calculation
3. **Final pass**: Run `calculateResults()` again with the optimizer's `t_optimal` to get accurate final results

The error from this approximation is:
- **Harmless** when the bottleneck is sensor, lens, or DR (none depend on shutter)
- **Conservative** when motion-limited in first pass (optimizer picks shorter shutter → better SNR than predicted)
- **Small** when the velocity causes motion bottleneck in both passes (same regime)

---

## Optimizer Logic

### The Core Problem

For a given scene (lux, reflectance), sensor (QE, FWC, noise), and subject (velocity, distance), find the exposure time and analog gain producing the highest SNR while respecting three hard constraints:

| Constraint | Limits Exposure | Formula |
|---|---|---|
| SNR target | t ≥ t_min | quadratic from SNR(t) ≥ target |
| Motion blur | t ≤ t_motion_max | 0.603 / (v_img × f_target) |
| Saturation | t ≤ 0.8 × t_sat | FWC / S, with 80% headroom |

```ts
t_optimal = clamp(t_min, t_motion_max, 0.8 × t_sat)
gain = clamp((0.5 × FWC) / (S × t_optimal), 1.0, 8.0)
```

### Step-by-Step

#### Step 1: Photon Flux

```ts
E_sensor = lux × reflectance × T_lens / (4 × N²)
photons/px/s = E_sensor × pixel_area × 41.3 × CFA_factor
e⁻/px/s = photons/px/s × (QE / 100)
```

#### Step 2: Solve SNR Floor (t_min)

```ts
SNR = (S·t) / √(S·t + RN² + DC·t)
```
Set SNR ≥ target (linear). Solve quadratic for t. If discriminant is negative, the SNR target is unreachable — flag as photon-starved.

#### Step 3: Compute Motion Ceiling (t_motion_max)

```ts
v_image = velocity × focalLength / distance
t_motion = 0.603 / (v_image × f_target)
```
Uses `fEffective` from the first-pass calculation as `f_target`.

#### Step 4: Compute Saturation Ceiling (t_sat)

```ts
t_sat = FWC / S
```

#### Step 5: Pick t_optimal

```ts
t_ceiling = min(0.8 × t_sat, t_motion_max)
t_optimal = max(t_ceiling, t_min)
photonStarved = t_optimal < t_min  // true if SNR target not met
```

#### Step 6: Compute Optimal Gain

```ts
target_e⁻ = 0.5 × FWC              // 50% ADC utilization
actual_e⁻ = S × t_optimal
gain = clamp(target_e⁻ / actual_e⁻, 1.0, 8.0)
```

Why 50% FWC? Balances ADC bits against highlight headroom. Why min 1×? Never digitally attenuate (throws away bits). Why max 8×? Analog gain on cheap sensor boards hits diminishing returns.

#### Step 7: Derive FPS

```ts
readout_s = readoutTimeUs × nativeHeight / 1e6
fps = 1 / (t_optimal + readout_s)
```

---

## File-by-File Changes

### 1. `src/types.ts`

New interfaces:
- `SensorRadiometry` — QE, FWC, read noise, dark current, conversion gain, ADC bits, readout time, lens transmission, dual CG support
- `ExposureOptimization` — illuminance, photon rate, t_min, t_motion, t_sat, t_optimal, gain, fps, SNR, photonStarved, signal %FWC, headroom stops

New AppState fields:
- `luxAtSubject`, `subjectReflectance`, `desiredSnrDb`, `temperatureC`, `exposureMode`

Extend `Results`:
- `exposure: ExposureOptimization`

Extend `BottleneckType`:
- `'photon-starved'`

### 2. `src/constants.ts`

Physics constants: photons/µm²/lux·s, electron energy, lens transmission defaults.

Sensor radiometry lookup table per preset — confirmed values from datasheets, estimated values marked.

### 3. `src/exposure.ts` (new file)

Core function: `calculateExposureOptimizer(state, derived, radiometry, velocity, targetFEffective)`

Pure function — testable independently.

### 4. `src/engine.ts`

Modify `calculateResults()` signature to accept optional `ExposureOptimization`.

Export the optimizer.

### 5. `src/state.ts`

New defaults. Two-pass calculation in `recalculate()`.

### 6. `index.html`

New DOM elements:
- Lux slider/input, reflectance, SNR target, temperature (hidden, toggleable)
- Exposure mode toggle (optimized / manual)
- Exposure recommendation display block
- Advanced sensor specs collapsible section

### 7. `src/ui/inputs.ts`

Wire new input event bindings. Populate advanced sensor specs panel.

### 8. `src/ui/outputs.ts`

New exposure recommendation panel. Photon-starved banner. Bottleneck priority update.

---

## What the Optimizer Does NOT Do

- Does not recommend ISO — only analog gain multipliers
- Does not model lens vignetting or MTF rolloff at edges
- Does not account for scene dynamic range beyond 18% gray
- Does not iterate the chicken-and-egg resolution problem
- Does not handle HDR modes or multi-exposure fusion
- Does not model AC flicker (50/60 Hz banding)

---

## Verification

1. Sunlight (100k lux) → short exposure, base gain, high FPS, no starvation
2. Office (100 lux) → moderate exposure, 2-4× gain, ~60 fps
3. Low-light (1 lux) → photon-starved, max gain, max usable exposure
4. Static subject (0 m/s) → longest exposure to 80% FWC, gain=1
5. Fast subject (10 m/s) → exposure capped at motion limit
6. High temperature (70°C) → higher dark current, lower SNR

---

## Implementation Order

1. `src/types.ts`
2. `src/constants.ts`
3. `src/exposure.ts`
4. `src/engine.ts`
5. `src/state.ts`
6. `index.html`
7. `src/ui/inputs.ts`
8. `src/ui/outputs.ts`
9. Build and verify
