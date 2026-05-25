# Preset Configuration Files

## Overview

Presets live in `presets/{sensors,lenses,cameras}/` as individual JSON files.
They are loaded at build time via `presets/{sensors,lenses,cameras}.ts` and re-exported from `presets/index.ts`.

**"Custom" is not a preset.** Custom buttons exist in the UI as passive indicators — they highlight when the user's current settings do not match any known preset. There is no `custom.json` file for any preset type.

---

## Sensor Presets (`presets/sensors/*.json`)

TypeScript interface: `presets/types.ts` → `SensorPreset`

| Field | Unit | Required | Used by | Source |
|---|---|---|---|---|
| `name` | string slug | **yes** | sensor lookup key | Unique identifier, e.g. `"imx219"` |
| `label` | string | **yes** | display only | Human-readable name, e.g. `"Sony IMX219"` |
| `colourVariant` | `"monochrome"` \| `"colour"` \| `"both"` | **yes** | `state.ts` auto-sets measurement mode | Whether the sensor die is available in monochrome, colour, or both variants |
| `pixelPitch` | µm | **yes** | `engine.ts` spatial calculation, `state.ts` preset detection | Sensor datasheet |
| `nativeWidth` | pixels | **yes** | `engine.ts` spatial calculation, `state.ts` preset detection | Sensor datasheet |
| `nativeHeight` | pixels | **yes** | `engine.ts` spatial calculation, `state.ts` preset detection | Sensor datasheet |
| `radiometry` | object | **yes** | `state.ts` → `exposure.ts` exposure optimizer | Sensor datasheet / characterization |
| `v4l2` | object | optional | stored for reference / future driver integration | Linux kernel driver source |

### `radiometry` sub-fields

| Field | Unit | Required | Used by | Notes |
|---|---|---|---|---|
| `qePercent` | % | **yes** | `exposure.ts` photon flux calculation | Quantum efficiency at 550 nm |
| `fullWellCapacity` | e⁻ | **yes** | `exposure.ts` saturation check | Full well capacity per pixel |
| `readNoiseE` | e⁻ | **yes** | `exposure.ts` SNR calculation | Read noise in electrons |
| `darkCurrentE` | e⁻/s | **yes** | `exposure.ts` dark current noise | At 25 °C |
| `conversionGainUvPerE` | µV/e⁻ | **yes** | displayed in advanced sensor specs | ADC conversion gain |
| `adcBits` | bits | **yes** | quantization noise estimation | ADC resolution |
| `readoutTimeUs` | µs/row | **yes** | `state.ts` max FPS / shutter limits | Row readout time |
| `lensTransmission` | 0–1 | **yes** | `exposure.ts` light throughput | Default 0.85 |
| `cfaFactor` | 0–1 | **yes** | `exposure.ts` effective QE adjustment | 0.55 for Bayer, 1.0 for monochrome |
| `hasDualCG` | bool | **yes** | displayed in advanced sensor specs | Dual conversion gain support |
| `hcgReadNoiseE` | e⁻ | optional | not currently read by the app | HCG mode read noise if `hasDualCG` is true |

### `v4l2` sub-fields

| Field | Unit | Required | Used by | Notes |
|---|---|---|---|---|
| `chipId` | integer | optional | reference | Register-level chip ID (e.g. `0x0219` = 537) |
| `nativeSize` | `{width, height}` px | optional | reference | Full die size including borders |
| `activeArray` | `{left, top, width, height}` px | optional | reference | Active pixel region coordinates |
| `pixelRates` | Hz | optional | reference | Pixel clock per mode |
| `linkFreqs` | Hz | optional | reference | MIPI CSI-2 link frequencies |
| `mipiLanes` | integer | optional | reference | Number of MIPI data lanes |
| `xclk` | Hz | optional | reference | External clock frequency |
| `busFormats` | string[] | optional | reference | Media bus format codes (e.g. `"SBGGR10_1X10"`) |
| `supplies` | string[] | optional | reference | Regulator supply names |
| `modes` | array | optional | reference | Supported output modes with `{width, height, maxFps, pixelRateIndex, hts, vts}` |
| `exposure` | `{min, max, step, default}` | optional | reference | Exposure line count limits |
| `analogueGain` | `{min, max, step, default}` | optional | reference | Analogue gain register values (not dB) |
| `digitalGain` | `{min, max, step, default}` | optional | reference | Digital gain register values |
| `hblank` | `{min, max, default}` px | optional | reference | Horizontal blanking pixels |
| `vblank` | `{min, max, default}` lines | optional | reference | Vertical blanking lines |

The V4L2 block is purely informational — no calculation currently reads it. It documents the Linux kernel driver configuration for reference use.

---

## Lens Presets (`presets/lenses/*.json`)

TypeScript interface: `presets/types.ts` → `LensPreset`

| Field | Unit | Required | Used by | Notes |
|---|---|---|---|---|
| `name` | string slug | **yes** | lookup key, `lensTier` comparison | e.g. `"cheap-plastic"` |
| `label` | string | **yes** | display only | e.g. `"Cheap Plastic"` |
| `tier` | string | **yes** | `state.ts` `lensTier` assignment | Must be one of `"cheap-plastic"`, `"mid-glass"`, `"premium-stack"` |
| `qualityScalar` | 0–1 | **yes** | `presets/lenses.ts` `lensTierScalar()`, `engine.ts` MTF calculation | Multiplier on diffraction-limited cutoff |
| `focalLength` | mm | **yes** | `state.ts` lens preset application, `engine.ts` FoV calculation | |
| `aperture` | f-number | **yes** | `state.ts` lens preset application, `engine.ts` diffraction calculation | |

The three lens presets are:
- `cheap-plastic`: `qualityScalar: 0.6`, `focalLength: 3.6`, `aperture: 2.0`
- `mid-glass`: `qualityScalar: 0.8`, `focalLength: 6.0`, `aperture: 1.8`
- `premium-stack`: `qualityScalar: 0.95`, `focalLength: 8.0`, `aperture: 1.4`

---

## Camera Presets (`presets/cameras/*.json`)

TypeScript interface: `presets/types.ts` → `CameraPreset`

| Field | Unit | Required | Used by | Notes |
|---|---|---|---|---|
| `name` | string slug | **yes** | lookup key, PresetName enum | Must match filename |
| `label` | string | **yes** | display only | |
| `sensorName` | string | **yes** | `state.ts` sensor geometry/radiometry lookup | Must match a sensor preset `name` |
| `lensName` | string | **yes** | `state.ts` lens parameters lookup | Must match a lens preset `name` |

Camera presets contain **no `values` field**. They are pure references — the selected sensor provides geometry + radiometry, and the selected lens provides focal length + aperture + quality tier. All four existing camera presets follow this pattern.

---

## Adding a New Preset

1. Create the JSON file in the appropriate `presets/{type}/` directory
2. Add the JSON import and entry in `presets/{type}s.ts`
3. For camera presets: update `PresetName` union in `src/types.ts`
4. If the preset should appear in the UI, add a matching `<button>` in `index.html`
5. Build and test: `npm run build && npm test`

---

## Preset Detection Logic (`src/state.ts`)

- **Sensor**: `detectSensorPreset()` compares `pixelPitch`, `nativeWidth`, `nativeHeight` against all `SENSOR_GEOMETRY` entries. On match, returns the sensor name; otherwise returns `"custom"`.
- **Lens**: `detectLensPreset()` compares `focalLength`, `aperture`, `lensTier` against all `LENS_PRESETS` entries. On match, returns the lens name; otherwise returns `"custom"`.
- **Camera**: `setField()` sets `activePreset = 'custom'` whenever any field (except `lensTier`) is changed. Only `applyPreset()` sets `activePreset` to a real camera name.
- When no known sensor is detected (`activeSensorPreset = 'custom'`), `recalculate()` falls back to `DEFAULT_RADIOMETRY` (exported from `src/constants.ts`).
