# Sensor Specification Comparison

> **Legend**: Values marked ✅ are confirmed from datasheets. Values marked ⚠ are estimated from similar products and may vary ±15–20%.

---

## 1. Basic Specifications

| Parameter | OV5647 | IMX219 | IMX708 | IMX477 | OV9281 | AR0234 (GS) | Smartphone (generic) |
|---|---|---|---|---|---|---|---|
| **Manufacturer** | OmniVision | Sony | Sony | Sony | OmniVision | onsemi | — |
| **Shutter type** | Rolling ✅ | Rolling ✅ | Rolling ⚠ | Rolling ✅ | Global ✅ | Global ⚠ | Rolling |
| **Pixel pitch** | 1.4 µm ✅ | 1.12 µm ✅ | 1.4 µm ✅ | 1.55 µm ✅ | 3.0 µm ✅ | 3.0 µm ⚠ | 2.5 µm |
| **Native resolution** | 2592×1944 ✅ | 3280×2464 ✅ | 4608×2592 ✅ | 4056×3040 ✅ | 1280×800 ✅ | 1920×1200 ⚠ | 4080×3060 |
| **Megapixels** | 5 MP ✅ | 8 MP ✅ | 12 MP ✅ | 12.3 MP ✅ | 1 MP ✅ | 2.3 MP ⚠ | 12.5 MP |
| **Sensor diagonal** | 3.67 mm ⚠ | 3.68 mm ⚠ | 6.45 mm ⚠ | 6.29 mm ⚠ | 3.90 mm ✅ | 5.76 mm ⚠ | ~10.2 mm |
| **Optical format** | 1/4" ✅ | 1/4" ✅ | ~1/2.5" ⚠ | 1/2.3" ✅ | 1/4" ✅ | 1/2.6" ⚠ | ~1/1.5" |
| **CFA type** | Bayer ✅ | Bayer ✅ | Bayer ⚠ | Bayer ✅ | Monochrome ✅ | Bayer ⚠ | Quad-Bayer |
| **Colour variant** | colour ✅ | colour ✅ | colour ⚠ | colour ✅ | monochrome ✅ | colour ⚠ | colour ⚠ |
| **OLPF present** | Yes ✅ | Yes ✅ | Yes ⚠ | No ✅ | Yes ⚠ | No ⚠ | No |
| **ADC bit depth** | 10-bit ✅ | 10-bit ✅ | 12-bit ⚠ | 12-bit ⚠ | 10-bit ✅ | 12-bit ⚠ | 12-bit ⚠ |
| **Row readout time** | 32 µs ⚠ | 28 µs ⚠ | 25 µs ⚠ | 20 µs ⚠ | 15 µs ✅ | 25 µs ⚠ | 12 µs ⚠ |
| **Min exposure (1 row)** | 32 µs (1/31250) | 28 µs (1/35714) | 25 µs (1/40000) | 20 µs (1/50000) | 1 µs (1/1M) ⚠ | 5 µs (1/200000) ⚠ | 12 µs (1/83333) |
| **Max fps (datasheet)** | 30 ✅ | 30 ✅ | 30 ⚠ | 40 ✅ | 120 ✅ | 60 ⚠ | 30 ⚠ |
| **Max fps (readout-limited)** | 16 fps | 14 fps | 15 fps | 16 fps | 83 fps | 33 fps | 27 fps |
| **Interface** | MIPI 2-lane ✅ | MIPI 2-lane ✅ | MIPI 2-lane ✅ | MIPI 4-lane ✅ | MIPI 2-lane / DVP ✅ | MIPI 4-lane ⚠ | MIPI 4-lane ⚠ |

## 2. Radiometric / Electron-Domain Specifications

| Parameter | OV5647 | IMX219 | IMX708 | IMX477 | OV9281 | AR0234 (GS) | Smartphone (generic) |
|---|---|---|---|---|---|---|---|
| **QE @ 550nm (green)** | ~55% ⚠ | ~72% ⚠ | ~62% ⚠ | ~75% ⚠ | ~85% ⚠ | ~38% ⚠ | ~65% ⚠ |
| **QE @ 850nm (NIR)** | ~8% ⚠ | ~12% ⚠ | ~12% ⚠ | ~15% ⚠ | ~40% ⚠ | ~28% ⚠ | ~10% ⚠ |
| **Full-well capacity** | ~3,500 e⁻ ⚠ | ~2,200 e⁻ ⚠ | ~3,500 e⁻ ⚠ | ~4,300 e⁻ ⚠ | ~8,500 e⁻ ⚠ | ~10,000 e⁻ ⚠ | ~3,500 e⁻ ⚠ (binned: ~14,000) |
| **Read noise (RMS)** | ~4.0 e⁻ ⚠ | ~3.5 e⁻ ⚠ | ~2.5 e⁻ ⚠ | ~3.0 e⁻ ⚠ | ~6.0 e⁻ ⚠ | ~7.0 e⁻ ⚠ | ~2.0 e⁻ ⚠ |
| **Conversion gain** | ~150 µV/e⁻ ⚠ | ~180 µV/e⁻ ⚠ | ~140 µV/e⁻ ⚠ | ~110 µV/e⁻ ⚠ | ~50 µV/e⁻ ⚠ | ~40 µV/e⁻ ⚠ | ~130 µV/e⁻ ⚠ |
| **Dark current @ 25°C** | ~25 e⁻/s ⚠ | ~15 e⁻/s ⚠ | ~12 e⁻/s ⚠ | ~10 e⁻/s ⚠ | ~35 e⁻/s ⚠ | ~45 e⁻/s ⚠ | ~8 e⁻/s ⚠ |
| **Sensitivity @ 550nm** | ~45 e⁻/lux·s ⚠ | ~36 e⁻/lux·s ⚠ | ~58 e⁻/lux·s ⚠ | ~72 e⁻/lux·s ⚠ | ~310 e⁻/lux·s ⚠ | ~140 e⁻/lux·s ⚠ | ~163 e⁻/lux·s ⚠ (binned: ~651) |
| **Dynamic range** | ~59 dB ⚠ | ~56 dB ⚠ | ~63 dB ⚠ | ~63 dB ⚠ | ~63 dB ⚠ | ~63 dB ⚠ | ~65 dB (binned: ~72 dB) |
| **Max SNR (full well)** | ~35.7 dB ⚠ | ~33.7 dB ⚠ | ~35.7 dB ⚠ | ~36.3 dB ⚠ | ~39.3 dB ⚠ | ~40.0 dB ⚠ | ~35.7 dB (binned: ~41.5 dB) |
| **Technology node** | OmniBSI ✅ | BSI CMOS ✅ | Stacked BSI ⚠ | Stacked BSI ✅ | OmniPixel3-GS ✅ | CMOS GS ⚠ | Stacked BSI |
| **Binning support** | 2×2 ✅ | 2×2 ✅ | 2×2+ ⚠ | 2×2 ✅ | 2×2 ✅ | 2×2 ⚠ | 2×2, 4×4 |

## 3. Electrical & Power

| Parameter | OV5647 | IMX219 | IMX708 | IMX477 | OV9281 | AR0234 (GS) |
|---|---|---|---|---|---|---|
| **Active power** | ~180 mW ⚠ | ~200 mW ⚠ | ~220 mW ⚠ | ~250 mW ⚠ | 156 mW ✅ | ~180 mW ⚠ |
| **Standby** | ~100 µA ⚠ | ~80 µA ⚠ | ~100 µA ⚠ | ~100 µA ⚠ | 150 µA ✅ | ~200 µA ⚠ |
| **Supply voltages** | 1.5V/2.8V ✅ | 1.2V/2.8V ✅ | 1.2V/2.8V ⚠ | 1.2V/2.8V ⚠ | 1.2V/2.8V ✅ | 1.2V/2.8V ⚠ |
| **Operating temp** | -20°C to +70°C ✅ | -20°C to +70°C ✅ | -20°C to +70°C ⚠ | -20°C to +70°C ⚠ | -30°C to +85°C ✅ | -30°C to +70°C ⚠ |

## 4. Mechanical & Optical

| Parameter | OV5647 | IMX219 | IMX708 | IMX477 | OV9281 | AR0234 (GS) |
|---|---|---|---|---|---|---|
| **Package** | CSP ✅ | CSP ✅ | CSP ⚠ | CSP ✅ | CSP ✅ | CSP ⚠ |
| **CRA (chief ray angle)** | 25° ✅ | 28.5° ✅ | ~30° ⚠ | 17° ⚠ | 9° ✅ | ~20° ⚠ |
| **Image area** | 3.67×2.74 mm ⚠ | 3.68×2.76 mm ⚠ | 6.45×3.63 mm ⚠ | 6.29×4.71 mm ⚠ | 3.90×2.45 mm ✅ | 5.76×3.60 mm ⚠ |
| **IR filter** | Separate ✅ | Separate ✅ | Separate ✅ | CS/C-mount ✅ | Separate ⚠ | Separate ⚠ |

## 5. Spatial Resolution Limits (from calculator presets)

| Parameter | OV5647 | IMX219 | IMX708 | IMX477 | OV9281 | AR0234 (GS) |
|---|---|---|---|---|---|---|
| **Nyquist (native)** | 357 lp/mm | 446 lp/mm | 357 lp/mm | 323 lp/mm | 167 lp/mm | 167 lp/mm |
| **Nyquist (OLPF)** | 304 lp/mm | 379 lp/mm | 304 lp/mm | 323 lp/mm | 142 lp/mm | 167 lp/mm |
| **Diffraction cutoff (f/N)** | f/2.0: 909 lp/mm | f/2.0: 909 lp/mm | f/1.8: 1010 lp/mm | f/2.8: 649 lp/mm | f/2.8: 649 lp/mm | f/2.0: 909 lp/mm |
| **Limiting factor** | Sensor Nyquist | Sensor Nyquist | Sensor Nyquist | Lens diffraction | Sensor Nyquist | Sensor Nyquist |

## 6. Light Level Resolution Estimates

### Effective Dynamic Range vs Scene Brightness

*Assuming f-stop per preset, 1/30s exposure, lens T-stop ≈ nominal + 0.2*

| Scene (EV100) | OV5647 (f/2.0) | IMX219 (f/2.0) | IMX708 (f/1.8) | IMX477 (f/2.8) | OV9281 (f/2.8) | AR0234 (f/2.0) |
|---|---|---|---|---|---|---|
| **15 (sunlight)** | 59 dB ⚠ | 56 dB ⚠ | 63 dB | 63 dB | 63 dB | 63 dB |
| **10 (overcast)** | 46 dB ⚠ | 44 dB ⚠ | 52 dB | 51 dB | 52 dB | 54 dB |
| **5 (indoor office)** | 27 dB ⚠ | 22 dB ⚠ | 31 dB | 34 dB | 42 dB | 39 dB |
| **0 (dim interior)** | 10 dB ⚠ | 6 dB ⚠ | 11 dB | 16 dB | 23 dB | 19 dB |
| **-3 (moonlight)** | R/N limited ⚠ | R/N limited ⚠ | 3 dB | 6 dB | 9 dB | 8 dB |

### Photons per Pixel per Frame

| Scene (EV100) | OV5647 | IMX219 | IMX708 | IMX477 | OV9281 | AR0234 (GS) |
|---|---|---|---|---|---|---|
| **15 (sunlight)** | ~3,500 | ~2,200 | ~3,500 | ~4,300 | ~8,500 | ~10,000 |
| **10 (overcast)** | ~1,100 | ~700 | ~1,100 | ~1,350 | ~2,700 | ~3,200 |
| **5 (indoor office)** | ~68 | ~44 | ~68 | ~85 | ~170 | ~200 |
| **0 (dim interior)** | ~4.2 | ~2.7 | ~4.2 | ~5.3 | ~10.5 | ~12.5 |
| **-3 (moonlight)** | ~0.5 | ~0.3 | ~0.5 | ~0.6 | ~1.2 | ~1.5 |

## 7. Datasheet Source Key

| Sensor | Document | Source | Confirmed Values |
|---|---|---|---|
| **OV5647** | `OV5647_full_datasheet.pdf` (2.5 MB) | SparkFun CDN (origin: GitHub wiki `sernaleon/charlie`) | Resolution, pixel pitch, CFA type, ADC, package, CRA, supply voltages, OTP, binning support |
| **IMX219** | `IMX219PQH5_full_datasheet.pdf` (2.2 MB) | `github.com/rellimmot/Sony-IMX219-Raspberry-Pi-V2-CMOS` | Resolution, pixel pitch, CFA type, register map, timing, electrical, mechanical |
| **IMX219 PB** | `IMX219_Product_Brief.pdf` (74 KB) | Same repo | Summary specs |
| **IMX219 DRM** | `IMX219_Module_Design_Reference_Manual.pdf` (2.1 MB) | Same repo | PCB layout, lens requirements, mechanical integration |
| **IMX708** | *(no datasheet available)* | N/A | Resolution and pixel pitch only (from Raspberry Pi public docs) |
| **IMX477** | `IMX477_Flyer.pdf` (99 KB) | `sony-semicon.com` consumer cameras page | Resolution, pixel pitch, CFA type, frame rate, interface, package |
| **OV9281** | `OV9281_Product_Brief.pdf` (979 KB) | `ovt.com/products/ov9281/` | Resolution, pixel pitch, CFA type, image area, frame rate, interface, power, package, CRA, operating temp, binning |
| **AR0234** | *(no datasheet available)* | N/A | No confirmed electron-domain values |
| **Smartphone** | *(generic composite)* | N/A | Illustrative values only |

## 8. Estimation Methods

| Parameter | Method |
|---|---|
| **QE** | Process-node benchmarks from known sensors of same manufacturer and generation. Scaled by CFA type (Bayer ≈ 0.5–0.6× monochrome peak for green channel). |
| **Full-well capacity** | Proportional to pixel area × process node scaling constant. Benchmarked against sensors with known FWC at similar pixel pitch. |
| **Read noise** | Process-node benchmarks. Global shutter adds +2–4 e⁻ vs equivalent rolling shutter due to storage node transfer noise. |
| **Conversion gain** | Inversely proportional to photodiode capacitance (which scales with pixel area). Lower CG for larger pixels. |
| **Dark current** | Process-node benchmarks. Global shutter approximately doubles dark current vs rolling shutter of same generation. Doubles every ~6°C above 25°C. |
| **Sensitivity** | Computed as QE_eff × pixel_area × 40.8 photons/µm²/lux·s. 40.8 is derived from standard illuminant (2700 K Planckian, 555 nm peak) integrated over visible spectrum. |
| **Dynamic range** | 20·log₁₀(FWC / read_noise). Shot-noise-limited DR from flat-field illumination is always lower than this max figure. |
| **SNR max** | 20·log₁₀(√FWC). Photon shot noise limit at full saturation. |

## 9. Key Takeaways

1. **OV5647** (Pi Cam v1) — Oldest process node. Full datasheet available. Lowest QE, highest dark current of the RS sensors. Lens-limited at the cheap plastic tier.

2. **IMX219** (Pi Cam v2) — Smallest pixel (1.12 µm) but BSI helps QE. Full datasheet available (very rare for Sony). Very low FWC limits DR. Always sensor-limited.

3. **IMX708** (Pi Cam v3) — **All electron-domain values are estimates.** No datasheet found. Modern Sony stacked BSI likely has best specs of the Pi camera sensors. HDR and PDAF features not modeled by the calculator.

4. **IMX477** (Pi HQ Cam) — Sony flyer only (no full datasheet publicly found). Largest Pi camera pixel (1.55 µm) + C/CS mount. No OLPF. Best DR of the Pi cameras. Only Pi sensor that can be lens-limited.

5. **OV9281** (GS) — Monochrome global shutter. Product brief available. High QE in NIR, large pixel for GS. 120 fps max. Worst Nyquist limit (large 3 µm pitch = 167 lp/mm) but best light sensitivity per pixel.

6. **AR0234** (GS) — **All electron-domain values are estimates.** Global shutter for machine vision. Largest FWC (~10,000 e⁻) but low QE and high read noise vs rolling shutter competitors. Bayer CFA penalties apply.

7. **Smartphone** — Generic composite. Values are illustrative benchmarks, not any specific sensor. The 4× binning effectively creates 5.0 µm virtual pixels at 3.1 MP, dramatically improving light sensitivity.
