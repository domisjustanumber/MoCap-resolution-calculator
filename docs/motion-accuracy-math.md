# How Motion Affects Accuracy

This document explains how subject motion degrades spatial resolution in the Camera Spatial Resolution Calculator. It walks step-by-step through the math and shows exactly how each formula is used in the Minimum Resolvable Distance chart.

## 1. Motion Components

The model combines three independent motion sources into a single effective speed on the sensor plane.

| Parameter          | Symbol   | Range    | Unit   | Source file                         |
|--------------------|----------|----------|--------|-------------------------------------|
| Linear velocity    | `v`      | 0–20     | m/s    | `src/ui/temporalChart.ts:26`        |
| Acceleration       | `a`      | 0–20     | m/s²   | `src/ui/temporalChart.ts:27`        |
| Angular velocity   | `ω`      | 0–360    | °/s    | `src/ui/temporalChart.ts:28`        |
| Subject half-width | `w`      | 0.1–2    | m      | `src/ui/temporalChart.ts:29`        |

Motion presets provide sensible defaults (`src/main.ts:136-139`):

| Preset    | Linear velocity | Acceleration | Angular velocity |
|-----------|-----------------|--------------|------------------|
| Static    | 0 m/s           | 0 m/s²       | 0 °/s            |
| Walking   | 1.5 m/s         | 0.5 m/s²     | 10 °/s           |
| Sports    | 5 m/s           | 4 m/s²       | 60 °/s           |

## 2. Combining Motion Into a Single Speed

Three formulas transform the raw motion parameters into an image-plane velocity, computed identically in two places:

- `src/engine.ts:123-127` — the main calculation engine
- `src/ui/distanceChart.ts:148-150` — the distance chart (re-computed per pixel for varying distance)
- `src/ui/chart.ts:34-37` — the MTF chart

### Effective linear velocity (includes acceleration)

```
vEff = v + 0.5 * a * t
```

Where `t` is the shutter time in seconds (e.g. `1/60` = 0.0167 s).  
The `0.5 * a * t` term accounts for the fact that the subject is accelerating during the exposure — the *average* extra velocity over the shutter window is half the acceleration times the duration.

**Example:** A walking subject (`v = 1.5 m/s`, `a = 0.5 m/s²`) with a `1/60 s` shutter:

```
vEff = 1.5 + 0.5 * 0.5 * 0.0167
     = 1.5 + 0.0042
     = 1.504 m/s
```

Acceleration adds very little here because the shutter is so short. The effect grows with longer exposures.

### Rotational velocity

```
vRot = (ω * π / 180) * w
```

This converts angular velocity (degrees/second) to tangential velocity (meters/second) at the edge of the subject. `ω * π / 180` converts °/s to rad/s, then multiplying by `w` (the subject half-width) gives the tangential speed of the subject's edge relative to its centre.

**Example:** A walking subject (`ω = 10 °/s`, `w = 0.5 m`):

```
vRot = (10 * 3.14159 / 180) * 0.5
     = 0.1745 * 0.5
     = 0.087 m/s
```

### Vector sum (root-sum-square)

```
vTotal = sqrt(vEff² + vRot²)
```

Linear and rotational velocities are largely orthogonal (forward motion vs. turning), so they combine as perpendicular vectors.

**Example:** From above, `vEff = 1.504`, `vRot = 0.087`:

```
vTotal = sqrt(1.504² + 0.087²)
       = sqrt(2.262 + 0.0076)
       = sqrt(2.270)
       = 1.507 m/s
```

Rotation adds negligible contribution for walking, but for sports (`ω = 60 °/s`) with the same shutter:

```
vRot = (60 * π / 180) * 0.5
     = (1.047) * 0.5
     = 0.524 m/s

vTotal = sqrt(5² + 0.524²)  // acceleration effect is also larger at longer exposures
       = sqrt(25 + 0.275)
       = 5.03 m/s           // rotation adds ~0.6% to total speed
```

For handheld or gimbal-mounted cameras tracking a fast-moving subject, rotation often dominates.

### Image-plane projection

```
vImg = vTotal * f / d
```

This projects the subject-space speed (m/s) onto the sensor plane. The factor `f / d` (focal length / distance) is the optical magnification.

**Example:** `vTotal = 1.507 m/s`, `f = 3.6 mm`, `d = 2 m`:

```
vImg = 1.507 * 0.0036 / 2.0
     = 0.00271 m/s
     = 2.71 mm/s
```

At 10 m:

```
vImg = 1.507 * 0.0036 / 10.0
     = 0.000543 m/s
     = 0.543 mm/s
```

**Key insight:** Motion blur is less damaging at longer distances because the same subject motion produces less image displacement. This distance dependence is what the Minimum Resolvable Distance chart visualizes.

## 3. From Image Speed to MTF

The blur distance on the sensor during exposure is simply:

```
dBlur = vImg * t    (in mm)
```

The MTF of a uniform motion blur is a sinc function (`src/ui/chart.ts:301-307`):

```
MTF_motion(f) = |sinc(π * f * dBlur)|
              = |sin(π * f * vImg * t) / (π * f * vImg * t)|
```

Two important frequencies characterise this function:

| Frequency       | Formula                        | Meaning                                  |
|-----------------|--------------------------------|------------------------------------------|
| First null      | `fNull = 1 / (vImg * t)`     | Frequency where contrast drops to zero   |
| MTF50           | `fMTF50 = 0.603 / (vImg * t)`| Frequency where contrast drops to 50%    |

The constant `0.603` comes from solving `|sinc(π * x)| = 0.5`, which gives `x ≈ 0.603`. It is defined in `src/constants.ts:65` as `MOTION_MTF50_CONST`.

**Example:** Walking subject at 2 m with `1/60 s` shutter:

```
dBlur = 2.71 mm/s * 0.0167 s = 0.0453 mm
fNull = 1 / 0.0453 = 22.1 lp/mm
fMTF50 = 0.603 / 0.0453 = 13.3 lp/mm
```

Same subject at 10 m:

```
dBlur = 0.543 mm/s * 0.0167 s = 0.00907 mm
fNull = 1 / 0.00907 = 110.3 lp/mm
fMTF50 = 0.603 / 0.00907 = 66.5 lp/mm
```

At 2 m, motion limits the system to 13 lp/mm. At 10 m, the same motion allows 66 lp/mm — nearly 5× better, purely from the magnification change.

## 4. How the Distance Chart Uses This Math

The Minimum Resolvable Distance chart (`src/ui/distanceChart.ts`) plots **minimum resolvable feature size on the subject** (y-axis, mm) against **distance from camera** (x-axis, metres). The function `featureMm(d)` at line 152 is called for every pixel along the x-axis.

Inside `featureMm(d)` the chain of calculations is:

```
1. vEff = v + 0.5 * a * t                    (line 148)
2. vRot = (ω * π / 180) * w                  (line 149)
3. vTotal = sqrt(vEff² + vRot²)              (line 150)
4. vImg = vTotal * f / d                      (line 155)
5. fTemporal = 0.603 / (vImg * t)             (line 157) — motion-limited spatial frequency
6. fEffective = min(lens, sensor, motion, DR) * formatEfficiency   (line 158)
7. minFeat = 500 / fEffective                 (line 160) — minimum feature on sensor in mm
8. optical = minFeat * d / f                  (line 161) — project back to subject space
9. final = hypot(optical, syncError)          (line 162) — RSS with multi-camera sync error
```

### Worked example: full calculation at a specific distance

**Setup:** Walking preset (`v = 1.5 m/s`, `a = 0.5 m/s²`, `ω = 10 °/s`, `w = 0.5 m`), `f = 3.6 mm`, `t = 1/60 s`, `d = 2 m`.

Other system limits (from a typical Pi Camera v1 / OV5647):
- `fcAberrated = 245 lp/mm` (lens diffraction + aberrations)
- `fNyquistSkipped = 198 lp/mm` (sensor Nyquist after binning)
- `fDRLimited = 212 lp/mm` (dynamic range / noise floor)
- `formatEfficiency = 0.85` (chroma subsampling)

**Step 1-3 — combine motion:**
```
vEff = 1.5 + 0.5 * 0.5 * 0.0167 = 1.504 m/s
vRot = (10 * 0.01745) * 0.5 = 0.087 m/s
vTotal = sqrt(1.504² + 0.087²) = 1.507 m/s
```

**Step 4 — project to sensor:**
```
vImg = 1.507 * 0.0036 / 2.0 = 0.00271 m/s = 2.71 mm/s
```

**Step 5 — motion-limited frequency:**
```
fTemporal = 0.603 / (0.00271 * 0.0167) = 0.603 / 0.0000453 = 13,310 lp/mm
```

Wait — 13,310 lp/mm? That seems too high. Let me re-check the units.

`vImg = 0.00271 m/s = 2.71 mm/s` — that's in *millimeters per second*, but the formula in the code uses meters.

Let me re-check:

```
vImg = 1.507 * 3.6 / 2000 = 1.507 * 0.0018 = 0.00271 m/s
```

This 0.00271 m/s = 2.71 mm/s. But `shutterTime = 0.0167 s`. So:

```
fTemporal = 0.603 / (0.00271 * 0.0167) = 0.603 / 0.0000453 = 13,312
```

Hmm, but that's in cycles per meter. Converting to lp/mm:

```
13,312 cycles/m = 13.3 cycles/mm = 13.3 lp/mm
```

Yes, that makes sense! So `fTemporal = 13.3 lp/mm`.

**Step 6 — effective system frequency:**
```
fEffective = min(245, 198, 13.3, 212) * 0.85
           = 13.3 * 0.85
           = 11.3 lp/mm
```

Motion is the clear bottleneck here.

**Step 7 — minimum feature on sensor:**
```
minFeat = 500 / 11.3 = 44.2 µm
         = 0.0442 mm
```

The formula `500 / fEffective` comes from `1/(2*fEffective) * 1000` — the half-period of the limiting spatial frequency, converted from mm to µm.

**Step 8 — project to subject space:**
```
optical = 0.0442 * 2000 / 3.6 = 24.6 mm
```

At 2 m, the smallest resolvable feature on a walking subject is about 25 mm. A standard ChArUco calibration target square (which is 8.8 times the minimum feature size) would need to be about 216 mm wide.

### Same calculation at 10 m (all else equal)

```
vImg = 1.507 * 0.0036 / 10.0 = 0.000543 m/s
fTemporal = 0.603 / (0.000543 * 0.0167) = 0.603 / 0.00000907 = 66,536 cycles/m = 66.5 lp/mm
fEffective = min(245, 198, 66.5, 212) * 0.85 = 56.5 lp/mm
minFeat = 500 / 56.5 = 8.85 µm = 0.00885 mm
optical = 0.00885 * 10000 / 3.6 = 24.6 mm
```

Same 24.6 mm! This is because the distance dependence cancels out when motion is the bottleneck: `fTemporal ∝ d / f`, and `optical ∝ minFeat * d / f`, so the distance-to-subject term cancels and the resolvable feature size becomes constant when the system is purely motion-limited.

### If motion were not the bottleneck (static subject)

With `v = 0`, motion blur is zero. The fallback path in `featureMm` (line 167) runs:

```
optical = minFeatureSize * d / f
```

Where `minFeatureSize = 500 / fEffective` from `engine.ts:137`. Now the optical projection grows linearly with distance — at 2 m it might be ~1 mm, at 10 m it becomes ~5 mm. The curve is a straight line through the origin.

This makes the distance chart's behaviour dramatically different with and without motion:

- **Static:** Resolution degrades linearly with distance (lens/sensor limits dominate, magnification shrinks the image).
- **Motion:** Resolution is roughly *constant* with distance when motion is the bottleneck (the motion blur gets less severe at longer distances, exactly compensating the magnification loss).

## 5. Motion vs. Other Bottlenecks

The engine determines the system bottleneck by comparing all limiting frequencies (`src/engine.ts:135`):

```typescript
const limitingFrequency = Math.min(fcAberrated, fNyquistSkipped, fTemporal50, fDRLimited);
```

A system is classified as **motion-limited** when `fTemporal50` is at least 15% lower than every other frequency (`BOTTLENECK_RATIO = 0.85`, engine.ts:153-155).

| Limiting frequency | Symbol       | Source of limit               | Typically set by                |
|--------------------|--------------|-------------------------------|---------------------------------|
| Lens + diffraction | `fcAberrated`| Aperture, wavelength, lens MTF| Lens quality, f-number          |
| Sensor Nyquist     | `fNyquistSkipped`| Pixel pitch, binning mode | Sensor, readout mode            |
| Motion MTF50       | `fTemporal50`| Subject velocity, shutter     | Shutter speed, tracking         |
| Dynamic range      | `fDRLimited` | Noise floor, contrast         | Lighting, gain, SNR target      |
| Sync error         | `fSyncMTF50` | Multi-camera time offset      | Frame rate, jitter, phase       |

The distance chart's curve shape reveals which bottleneck is active:

- **Steep upward slope** = lens or sensor limited (feature size ∝ distance)
- **Flat plateau** = motion limited (feature size constant with distance)
- **Sudden drop at close range** = sync error is washed out by large optical magnification

## 6. Summary of the Data Flow

```
Motion UI controls                    Temporal Monte Carlo sim
  (main.ts, temporalChart.ts)           (temporalChart.ts)
         │                                      │
         ▼                                      ▼
   MotionParams {                      syncErrorP95
     v, a, ω, w }                           │
         │                                   │
         ├── engine.ts ── fTemporal50 ───────┤── fSyncMTF50
         │                                   │
         ▼                                   ▼
     fEffective = min(lens, sensor, motion, sync, DR)
         │
         ├── engine.ts:137 → minFeatureSize → results displayed in sidebar
         │
         └── distanceChart.ts:152-169 → featureMm(d) → curve drawn per pixel
                 │
                 └── Combined with sync error via hypot() → final feature size
```

The same motion math (`vEff`, `vRot`, `vTotal`) appears in three places in the codebase:

| File                 | Purpose                                         |
|----------------------|--------------------------------------------------|
| `engine.ts:123-127`  | Single calculation at the user's chosen distance |
| `distanceChart.ts:148-160` | Re-computed for every pixel across the distance range |
| `chart.ts:34-39`     | Used to draw the motion MTF curve on the spatial frequency chart |

The distance chart is the only place where motion blur's *distance dependence* is visible — it answers the practical question "how far can I stand and still resolve a feature of this size?"
