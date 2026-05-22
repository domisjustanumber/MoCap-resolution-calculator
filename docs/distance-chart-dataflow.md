# Min Resolvable Distance Chart — Complete Dataflow

## Overview

The "Minimum resolvable feature vs distance" chart plots the smallest resolvable feature size (mm, Y-axis) against distance from the camera (m, X-axis). Every element feeding into this chart is traced below.

---

## 1. User Inputs

### Lens Controls
| Input | Symbol | Units | Range | Affects |
|-------|--------|-------|-------|---------|
| Focal length | `focalLength` | mm | > 0 | vImg, feature projection |
| Diagonal FoV | `diagonalFov` | degrees | 0–180 | focal length (derived) |
| Aperture (f-number) | `aperture` | — | 1.0–32 | fc |
| Wavelength | `wavelength` | nm | 380–2500 | fc |
| Lens quality tier | `lensTier` | — | cheap-plastic \| mid-glass \| premium-stack | fcAberrated |

### Sensor Controls
| Input | Symbol | Units | Range | Affects |
|-------|--------|-------|-------|---------|
| Pixel pitch | `pixelPitch` | μm | > 0 | Nyquist, sensor dimensions |
| Native width × height | `nativeWidth`, `nativeHeight` | px | ≥ 1 | skipping factor, Nyquist |
| OLPF present | `olpfPresent` | boolean | — | Nyquist × 0.85 penalty |
| Pixel binning | `pixelBinning` | — | 1, 2, 4 | effective pitch |
| Dynamic range | `dynamicRangeDb` | dB | — | fDRLimited |

### Processing Controls
| Input | Symbol | Units | Range | Affects |
|-------|--------|-------|-------|---------|
| Extracted width × height | `extractedWidth`, `extractedHeight` | px | ≥ 1 | skipping factor |
| Subsampling method | `subsamplingMethod` | — | line-skip \| binning-average | (informational, not in core formula) |
| Output format | `outputFormat` | — | mjpg, h264, nv12, uyuv, raw8, raw10 | formatEfficiency |
| JPEG quality (MJPG) | `mjpgQuality` | — | 1–100 | formatEfficiency |
| H.264 QP | `h264Qp` | — | 0–51 | formatEfficiency |
| H.264 bitrate | `h264BitrateMbps` | Mbps | 0.5–50 | formatEfficiency |
| Measurement mode | `measurementMode` | — | luma \| chroma | chroma penalty on formatEfficiency |

### Scene Controls
| Input | Symbol | Units | Range | Affects |
|-------|--------|-------|-------|---------|
| Distance to subject | `distanceToSubject` | m | ≥ 0.1 | vImg, feature projection |
| Slider: max chart distance | `maxDistance` (dMax) | m | ≥ 1 | X-axis range |
| Slider: Y-axis ceiling | `yMaxOverride` | mm | 20–500 | Y-axis range, grid steps |

### Temporal / Motion Controls (from Quick Settings Bar + Camera Sync tab)
| Input | Symbol | Units | Range | Affects |
|-------|--------|-------|-------|---------|
| Subject velocity | `getSpatialVelocity()` | m/s | 0–20 | fTemporal50, vImg |
| Shutter speed | `getShutterTime()` (1/denom) | s | derived | fTemporal50 |
| Camera sync toggle | `isSyncToggleOn()` | boolean | — | quadrature sync error addition |
| Sync error P95 | `getSyncErrorP95()` | mm | 0+ | quadrature addition to optical limit |

---

## 2. Engine Computation Chain (engine.ts → `calculateResults`)

### Step 1: Diffraction Cutoff
```
fc = 1 / (wavelength_mm × aperture)
```
Pure diffraction-limited spatial frequency (Rayleigh criterion). Wavelength is converted nm → mm via `/1_000_000`.

### Step 2: Lens Aberration Degradation
```
fcAberrated = fc × lensTierScalar(lensTier)
```
Scalars: cheap-plastic = 0.6, mid-glass = 0.8, premium-stack = 0.95.

### Step 3: Nyquist Frequency (Skipped)
```
skippedPitchMm = effectivePixelPitch / 1000
fNyquistSkipped = [1 / (2 × skippedPitchMm)] × olpfPenalty
```
`effectivePixelPitch = pixelPitch × pixelBinning × skippingFactor`
`skippingFactor = max(nativeWidth/extractedWidth, nativeHeight/extractedHeight)`
`olpfPenalty = 0.85 if olpfPresent, else 1.0`

### Step 4: Format Efficiency (Compression)
- **MJPG**: `formatEfficiency = 0.4 + 0.6 × (mjpgQuality / 100)`
- **H.264**: `formatEfficiency = min(qpEfficiency, bitrateEfficiency)` where:
  - `qpEfficiency = 0.30 + 0.70 × (1 − h264Qp/51)`
  - `bitrateEfficiency = min(1, bitsPerPixel / 0.25)`
  - `bitsPerPixel = h264BitrateMbps × 10⁶ / (pixelsPerFrame × fps)`
- **Chroma mode**: formatEfficiency *= 0.5 (UYVY 4:2:2) or 0.25 (all other 4:2:0)

### Step 5: Motion (Temporal) MTF50
```
vImg = velocity × focalLength / max(0.1, distanceToSubject)
fTemporal50 = 0.603 / (vImg × shutterTime)
```
Converts scene velocity (m/s) to image-plane velocity (mm/s). The constant 0.603 is the argument at which `|sinc(x)| = 0.5`.

vImg derivation using thin-lens magnification: `image_speed = object_speed × focalLength / distance`.

### Step 6: Dynamic Range Limit
```
contrastFloor = 1 / 10^(dynamicRangeDb / 20)
fDRLimited = fcAberrated × sqrt(max(0, 1 − contrastFloor / max(0.01, formatEfficiency)))
```
Maps dynamic range (in dB) to a contrast floor. When the floor approaches the system's transmittable contrast, effective resolution degrades.

### Step 7: Optical Cascade → Effective Frequency
```
limitingFrequency = min(fcAberrated, fNyquistSkipped, fTemporal50, fDRLimited)
fEffective = limitingFrequency × formatEfficiency
```
The optical resolution is the tightest single constraint, then degraded by compression/multiplication efficiency.

### Step 8: Minimum Feature Size (Sensor Plane)
```
minFeatureSize = [1 / (2 × fEffective)] × 1000   [units: μm]
```
Half a line pair (one feature) at the sensor plane. `1/(2f)` gives mm then ×1000 converts to μm.
*This is the value fed to the distance chart for optical projection.*

### Step 9: Project to Scene (via Thin Lens)
```
featureBase = [1 / (2 × fEffective) / focalLength] × (distanceToSubject × 1000)   [units: mm]
```
Similar triangles: `sensor_feature_mm / focalLength_mm = scene_feature_mm / distance_mm`.

### Step 10: Sync Error Addition (only when `syncEnabled`)
```
featureSizeAtDistance = hypot(featureBase, syncErrorP95)   [units: mm]
```
Sync spatial error (mm at scene, from Monte Carlo simulation) adds in quadrature to the optical resolution projection. The quadrature combination models two independent error sources.

---

## 3. Camera Sync Simulation (temporalChart.ts → `getSyncErrorP95`)

### Simulation Inputs
| Parameter | Variable | Default | Range |
|-----------|----------|---------|-------|
| Subject velocity | `targetVelocity` | 1.5 m/s | 0–20 |
| Frame rate | `frameRate` | 30 fps | 1–240 |
| Phase offset | `phaseOffset` | 16.6 ms | 0–300 |
| Timing jitter | `jitterMs` | 10.0 ms | 0–300 |

### Simulation
Monte Carlo with 2,500 samples:
1. For each sample, generate random camera phase and Gaussian jitter (Box-Muller transform)
2. Compute timing delta between two cameras: `deltaT = |phaseMs + N(0,1) × jitterMs|`
3. Spatial error: `spatialError = deltaT × velocity_mm_ms`
4. P95 is extracted from the sorted error distribution

The `syncErrorP95` output is the 95th percentile spatial error at the scene, in mm.

---

## 4. Distance Chart Rendering (distanceChart.ts → `drawDistanceChart`)

### Canvas Setup
- Width: matches the MTF chart column width
- Height: matches the MTF chart height (4:6 aspect ratio), scaled by CSS width
- Padding: top=36, right=40, bottom=52, left=60

### Axes
| Axis | Variable | Formula | Description |
|------|----------|---------|-------------|
| X (distance) | `dMax` | user slider (default 3m) | Camera-to-subject distance in meters |
| Y (feature size) | `yMaxOverride` | user slider (default 100mm) | Ceiling of the feature size axis |
| X step | `xStep` | `max(0.5, ceil(dMax / 6))` | Auto-nice tick spacing |
| Y step | `yStep` | `yMax / 5` | 5 grid divisions |

### Coordinate Mapping
```
px(d) = pad.left + (d / dMax) × plotW
py(f) = pad.top + (1 − f / yMax) × plotH
```

### Curve Formula (`featureMm` function)
```
featureMm(d) = syncEnabled
  ? hypot((minFeatureSize × d) / focalLength, syncErrP95)
  : (minFeatureSize × d) / focalLength
```
- **Without sync**: straight line through origin, slope = `minFeatureSize / focalLength`
- **With sync**: hyperbolic curve starting at `syncErrP95` at d=0 (clipped by plot bounds)

### Curve Drawing
- 100 segments from d=0 to d=dMax
- Clipped to plot area (`ctx.clip()`)
- Color: indigo (`rgba(99, 102, 241, 0.9)`), line width 2.5

### Interactive Features
- **Hover**: vertical cursor line + dot on curve + tooltip with feature size + ChArUco marker recommendation (feature × 8.8 for 8×8 grid marker)
- **Click**: pins a marker at clicked distance, shows feature size and ChArUco size
- **Metric card** (`card-feature-distance`): updated from hover tooltip

### Hash / Redraw Trigger
```
hash = String(minFeatureSize) + String(focalLength) + String(dMax) +
       String(yMaxOverride) + pinsHash + String(syncToggle) + String(syncErrorP95)
```
A redraw is triggered when any of these change.

---

## 5. Complete Formula Summary

The final plotted value at distance `d` meters is:

```
minFeatureSize = 1000 / (2 × fEffective)
fEffective = min(fcAberrated, fNyquistSkipped, fTemporal50, fDRLimited) × formatEfficiency

opticalFeatureMm(d) = (minFeatureSize / focalLength) × d

featureMm(d) = syncEnabled
  ? √(opticalFeatureMm(d)² + syncErrorP95²)
  : opticalFeatureMm(d)
```

Where:
- `fcAberrated` depends on: aperture, wavelength, lens tier
- `fNyquistSkipped` depends on: pixel pitch, binning, native/extracted resolution, OLPF
- `fTemporal50` depends on: velocity, focal length, distance, shutter speed
- `fDRLimited` depends on: dynamic range, formatEfficiency, fcAberrated
- `formatEfficiency` depends on: output format, quality/QP/bitrate, chroma mode
- `syncErrorP95` depends on: velocity, frame rate, phase offset, jitter (from Camera Sync tab)
- `focalLength` directly scales the optical projection
- `d` is the X-axis variable (distance from camera)

All optical chain values are expressed in **spatial frequency (lp/mm)**. The final output is in **millimeters at the scene**.
