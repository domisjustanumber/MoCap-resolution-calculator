Here is a structural blueprint and development plan to build an **Optical System Spatial Resolution Calculator**.

Because your design requirements focus on modularity and high performance, the architecture isolates the complex math into a pure calculation engine, updates in real time based on user inputs, and yields both a theoretical ceiling and a realistic "effective" resolution.

---

## 1. Technical Architecture Design

To keep the application highly scannable and modular, we will separate the system into a three-tier architecture:

* **UI Layer (HTML5 / Tailwind CSS):** A clean, two-column responsive grid. The left column houses grouped input fields (Sensor, Lens, Processing); the right column displays a real-time data readout and a dynamic canvas plot of the system's MTF decay.
* **Reactive Controller Layer (Vanilla JS / Alpine.js):** Listens for input changes, validates bounds (e.g., preventing a $Q$-factor $> 100$), executes the mathematical chain, and updates the view.
* **The Math Engine (`ResolutionEngine.js`):** A standalone, dependency-free JavaScript object containing the precise formulas we established.

---

## 2. Mathematical Pipeline (The Core Logic)

The calculator must process inputs sequentially, cascading downstream degradation. Here is the strict logical execution order your engine will use:

```
[ Lens Inputs ] ──> Calculate Diffraction Cutoff (fc)
                          │
[ Sensor Inputs ] ──> Calculate Native Nyquist (fN) ──> Apply Subsampling (fN-skipped)
                                                              │
[ Stream Inputs ] ────────────────────────────────────────────┴──> Apply JPEG/Chroma Penalty
                                                                        │
                                                                 [ Final Effective lp/mm ]

```

### Step 1: Optical Limit (Lens)

Using target wavelength ($\lambda$, default $550\text{ nm}$) and Aperture ($N$):


$$f_c = \frac{1}{\lambda \times N}$$

### Step 2: Sampling Limit (Sensor)

Using Native Pixel Pitch ($p$), Native Horizontal Width ($W_{\text{native}}$), and Requested Output Width ($W_{\text{output}}$):


$$S = \frac{W_{\text{native}}}{W_{\text{output}}}$$

$$p_{\text{eff}} = p \times S$$

$$f_{\text{Nyquist}} = \frac{1}{2 \times p_{\text{eff}}}$$

### Step 3: Compression & Pipeline Degradation

Using JPEG Quality Factor ($Q$) and Output Format Choice (Modifier $C_{\text{format}}$):


$$\text{Efficiency}_{\text{mjpg}} = 0.4 + \left(0.6 \times \frac{Q}{100}\right)$$

$$f_{\text{Effective}} = \min(f_c, f_{\text{Nyquist}}) \times \text{Efficiency}_{\text{mjpg}} \times C_{\text{format}}$$

---

## 3. UI Input/Output Specification

### Input Matrix

| Category | Input Field | Element Type | Default Value | Unit / Range |
| --- | --- | --- | --- | --- |
| **Lens** | Aperture ($f$-stop) | `number` (step 0.1) | 2.8 | $f/1.0 - f/32$ |
|  | Light Wavelength | `number` | 550 | $\text{nm}$ |
| **Sensor** | Native Pixel Pitch | `number` (step 0.01) | 3.0 | $\mu\text{m}$ |
|  | Native Horiz. Pixels | `number` | 1920 | Pixels |
| **Processing** | Extracted Horiz. Pixels | `number` | 640 | Pixels (≤ Native) |
|  | Camera Output Format | `select` | `mjpg` | `uyuv`, `nv12`, `mjpg` |
|  | MJPG Quality ($Q$) | `range` (slider) | 60 | $1 - 100$ |

### Output Metrics Display

* **Lens Diffraction Cutoff:** $f_c$ ($\text{lp/mm}$)
* **Sensor Nyquist Limit:** $f_{\text{Nyquist}}$ ($\text{lp/mm}$)
* **System Bottle-neck:** Identifies textually whether the system is *Lens-Limited*, *Sensor-Limited*, or *Compression-Throttled*.
* **Final Effective Spatial Resolution:** $f_{\text{Effective}}$ ($\text{lp/mm}$)
* **Minimum Resolvable Feature Size:** Translates the final $\text{lp/mm}$ value back into an easily understandable real-world physical metric:

$$\text{Feature Size} = \frac{1}{2 \times f_{\text{Effective}}} \times 1000\ (\mu\text{m})$$



---

## 4. Implementation Steps & Milestones

### Phase 1: Pure JavaScript Engine (`engine.js`)

Write the mathematical calculation engine as an isolated class or module. This allows you to test the input/output values against the manual math we ran earlier without fighting UI rendering bugs simultaneously.

### Phase 2: HTML UI Structure & Direct Binding

Create the single-page layout. Wrap the input container in a simple event listener architecture:

```javascript
const inputs = document.querySelectorAll('.calc-input');
inputs.forEach(input => input.addEventListener('input', calculateSystemResolution));

```

### Phase 3: Add an Interactive Chart (Canvas API)

To make the tool truly valuable, implement a native `<canvas>` rendering loop that draws the cascading MTF curves based on the current inputs.

* Plot a clean, ideal lens MTF straight line from $1.0$ down to $f_c$.
* Draw a vertical dotted line marking the sensor's $f_{\text{Nyquist}}$.
* Draw the actual, degraded system curve showing the sudden compression drop-off.

### Phase 4: Extreme Parameter Edge-Case Handling

Implement validation rules to handle boundary states gracefully:

* If the user switches the format to `uyuv` or `nv12`, the UI should gray out and disable the MJPG Quality slider.
* If Extracted Resolution equals Native Resolution, force the skipping factor $S$ to $1.0$.

---

## 5. Extensibility for Future Revisions

Once the core calculator is functional, you can easily scale its utility by adding advanced modifiers to the math pipeline:

1. **OLPF Toggle:** A simple checkbox that multiplies the sensor's $f_{\text{Nyquist}}$ by a scalar of `0.85` if an Anti-Aliasing filter is present.
2. **Lens Tier Presets:** A dropdown to let users select baseline MTF qualities if they don't know their lens specs (e.g., "Cheap Molded Plastic Webcam Lens" $\rightarrow$ forces a `0.6` penalty; "Premium 7P Smartphone Stack" $\rightarrow$ uses a `0.95` modifier).



In addition to the values already included, the calculator must also enable me to input:
- Sensor size
- Camera fov in degrees
- A drop down for lens quality (cheap webcam, phone camera, high quality lens)
- Distance object is from the camera

The output must be maximum resolution in mm


To integrate these new physical, geometric, and optical parameters, we need to transition the calculator from working strictly in optical space (line pairs per millimeter on the sensor surface) to **object space** (resolvable detail in millimeters at a specific working distance).

Here is the updated mathematical plan and structural workflow to incorporate these inputs into your browser-based engine.

---

## 1. Geometric & Optical Physics Additions

To map sensor-level resolution to real-world object resolution, the calculator must handle the magnification of the system. This requires geometric translation using the sensor size, field of view, and distance.

### A. Sensor Size Translation

Instead of forcing the user to know their exact physical dimensions, the dropdown will look up the standard industry width ($W_s$) and height ($H_s$) in millimeters:

* **1-inch:** $13.2\text{ mm} \times 8.8\text{ mm}$
* **1/2-inch:** $6.4\text{ mm} \times 4.8\text{ mm}$
* **1/3-inch (Common Webcam):** $4.8\text{ mm} \times 3.6\text{ mm}$
* **1/4-inch (Cheap Webcam):** $3.6\text{ mm} \times 2.7\text{ mm}$

### B. Focal Length Estimation ($\text{mm}$)

If the user inputs the Horizontal Field of View ($\text{HFOV}$) in degrees and selects a sensor size, the effective focal length ($f$) of the lens can be derived geometrically:

$$f = \frac{W_s}{2 \cdot \tan\left(\frac{\text{HFOV}}{2} \cdot \frac{\pi}{180}\right)}$$

### C. Optical Magnification Factor ($m$)

With the focal length ($f$) and the user's input for **Distance to the Object ($D$, converted to mm)**, we calculate the lens magnification. This tells us how much an object shrinks when projected onto the sensor:

$$m = \frac{f}{D - f}$$

---

## 2. Updated Mathematical Pipeline

The math engine will now execute in two stages: computing the sensor-plane resolution limit, then projecting that limit out into object space through the magnification factor.

```
[ Lens, Sensor, Quality, Format Inputs ] ──> Calculate Sensor Plane Resolution (lp/mm)
                                                               │
[ Sensor Size, FOV, Distance Inputs ] ──────> Calculate Optical Magnification (m)
                                                               │
                                                               ▼
                                              [ Final Object Resolution (mm) ]

```

### Step 1: Sensor-Plane Resolution ($f_{\text{sensor}}$)

Calculate the effective line pairs per millimeter ($\text{lp/mm}$) exactly as before, but introduce the **Lens Quality Modifier ($M_{\text{lens}}$)** to scale down the baseline MTF performance before compression:

* **High Quality Lens:** $M_{\text{lens}} = 1.0$ (Near diffraction limit)
* **Phone Camera Stack:** $M_{\text{lens}} = 0.85$ (Sharp center, slight edge degradation)
* **Cheap Webcam:** $M_{\text{lens}} = 0.50$ (Heavy spherical and chromatic aberrations)

$$f_{\text{sensor}} = \min(f_c, f_{\text{Nyquist}}) \times M_{\text{lens}} \times \text{Efficiency}_{\text{mjpg}} \times C_{\text{format}}$$

### Step 2: Object-Plane Resolution ($\text{lp/mm}_{\text{object}}$)

Project the sensor-plane resolution back out into the real world using the magnification factor $m$:

$$f_{\text{object}} = f_{\text{sensor}} \times m$$

### Step 3: Final Output Translation (Spatial Resolution in $\text{mm}$)

A single "line pair" consists of one black line and one white line. To find the absolute **minimum resolvable feature size in millimeters**, we calculate the physical width of a single line (half of a line pair):

$$\text{Minimum Feature Size (mm)} = \frac{1}{2 \times f_{\text{object}}}$$

---

## 3. UI Input/Output Specification Update

### New Input Field Groupings

```
[ Optical Parameters ]          [ Geometric Parameters ]
├── Lens Quality (Dropdown)     ├── Sensor Size (Dropdown)
├── Aperture (f-stop)           ├── Camera HFOV (Degrees)
└── Light Wavelength (nm)       └── Target Distance (mm or meters)

```

* **Sensor Size Dropdown:** Options for `1"`, `1/2"`, `1/3"`, `1/4"`, or a `Custom` option that exposes width/height manual inputs.
* **Lens Quality Dropdown:** Options mapping to the performance modifiers (`High Quality`, `Smartphone Array`, `Cheap Plastic Webcam`).
* **Distance Object is from Camera:** A numeric input field with a unit toggle select (`mm`, `cm`, `meters`).

### The Target Output Card

* **Maximum Spatial Resolution:** Displayed prominently in **$\text{mm}$** (e.g., `"0.125 mm"`).
* **Contextual Label:** Add a descriptive string below the value to make the data actionable for engineering or verification tests, such as:
> *"At a distance of 1.5 meters, features smaller than 0.125 mm will blur together into a single pixel/block."*



---

## 4. Foundational JavaScript Engine Core

Here is the decoupled JavaScript logic for the calculation engine update. You can drop this directly into your reactive application loop:

```javascript
const OpticalEngine = {
    // Standard Sensor Sizes Lookup (Width and Height in mm)
    // Used to calculate exact aspect ratios for DFOV -> HFOV conversion
    SENSOR_DIMENSIONS: {
        "1-inch": { w: 13.2, h: 8.8 },
        "1/2-inch": { w: 6.4, h: 4.8 },
        "1/3-inch": { w: 4.8, h: 3.6 },
        "1/4-inch": { w: 3.6, h: 2.7 }
    },

    // Lens Quality MTF Penalties
    LENS_QUALITIES: {
        "high-quality": 1.0,  // Near diffraction limit
        "smartphone": 0.85,    // Sharp center, slight edge degradation
        "cheap-webcam": 0.50   // Heavy optical aberrations
    },

    /**
     * Calculates the system's maximum spatial resolution in object space using Diagonal FOV.
     * @param {Object} inputs - The parameters collected from the browser UI.
     * @param {number} inputs.aperture - Lens f-number (e.g., 2.8).
     * @param {number} inputs.wavelength - Light wavelength in nanometers (e.g., 550).
     * @param {number} inputs.pixelPitch - Native pixel pitch in micrometers (e.g., 3.0).
     * @param {number} inputs.nativeWidth - Native horizontal sensor pixels (e.g., 1920).
     * @param {number} inputs.nativeHeight - Native vertical sensor pixels (e.g., 1080).
     * @param {number} inputs.outputWidth - Extracted/streaming horizontal pixels (e.g., 640).
     * @param {string} inputs.sensorSize - Key from SENSOR_DIMENSIONS (e.g., "1/3-inch").
     * @param {number} inputs.dfov - Diagonal Field of View in degrees.
     * @param {number} inputs.distance - Distance from camera to object in millimeters.
     * @param {string} inputs.format - Output format ("uyuv", "nv12", "mjpg").
     * @param {number} inputs.jpegQuality - MJPG Quality factor from 1-100.
     */
    calculateResolution: function(inputs) {
        // 1. Parse and Standardize Units to Millimeters (mm)
        const N = parseFloat(inputs.aperture); 
        const lambda = parseFloat(inputs.wavelength) * 1e-6; // nm to mm
        const p = parseFloat(inputs.pixelPitch) * 1e-3;       // um to mm
        const W_native = parseInt(inputs.nativeWidth);
        const H_native = parseInt(inputs.nativeHeight);
        const W_output = parseInt(inputs.outputWidth);
        const Q = parseFloat(inputs.jpegQuality);
        const format = inputs.format;
        
        const sensorDimensions = this.SENSOR_DIMENSIONS[inputs.sensorSize];
        const dfovRad = parseFloat(inputs.dfov) * (Math.PI / 180);
        const distanceObj = parseFloat(inputs.distance); // Expected in mm

        // 2. Convert Diagonal FOV to Horizontal FOV
        // Calculate the physical sensor diagonal using its aspect ratio
        const sensorAspect = W_native / H_native; 
        const sensorWidth = sensorDimensions.w;
        const sensorHeight = sensorWidth / sensorAspect; // Derive active height based on pixel aspect ratio
        const sensorDiagonal = Math.sqrt(sensorWidth * sensorWidth + sensorHeight * sensorHeight);

        // Convert diagonal angle to horizontal angle using trigonometry
        const hfovRad = 2 * Math.atan((sensorWidth / sensorDiagonal) * Math.tan(dfovRad / 2));

        // 3. Optical Lens Limit (Diffraction Cutoff Frequency in lp/mm)
        const fc = 1 / (lambda * N);

        // 4. Sensor Sampling Limit (Accounting for Line Skipping / Subsampling)
        const S = W_native / W_output;
        const p_eff = p * S;
        const f_nyquist = 1 / (2 * p_eff);

        // 5. Apply Downstream Efficiencies (Lens Quality & Format Bottlenecks)
        const m_lens = this.LENS_QUALITIES[inputs.lensQuality];
        
        let m_format = 1.0;
        if (format === "uyuv" || format === "nv12") {
            m_format = 1.0; 
        } else if (format === "mjpg") {
            m_format = 0.4 + (0.6 * (Q / 100)); 
        }

        // Determine the limiting resolution at the physical sensor plane (lp/mm)
        const f_sensor = Math.min(fc, f_nyquist) * m_lens * m_format;

        // 6. Geometrical System Magnification
        // Derive Focal Length using the calculated HFOV and physical sensor width
        const focalLength = sensorWidth / (2 * Math.tan(hfovRad / 2));
        
        // Safety check to prevent division by zero or negative magnification
        if (distanceObj <= focalLength) {
            return { error: "Object distance must be greater than the lens focal length." };
        }
        
        const magnification = focalLength / (distanceObj - focalLength);

        // 7. Project Sensor Resolution into Object Space (lp/mm at the target object)
        const f_object = f_sensor * magnification; 

        // 8. Convert Line Pairs to absolute minimum resolvable feature width in mm
        const maxResolutionMM = 1 / (2 * f_object);

        // Determine system bottleneck for UI feedback text
        let bottleneck = "Sensor Sampling Limit";
        if (fc < f_nyquist) {
            bottleneck = "Lens Diffraction (Aperture Limited)";
        } else if (m_lens === 0.50 && inputs.lensQuality === "cheap-webcam") {
            bottleneck = "Lens Optical Aberrations (Poor Glass/Plastic)";
        } else if (format === "mjpg" && Q < 75) {
            bottleneck = "MJPG Compression Artifacts";
        }

        return {
            maxResolutionMM: maxResolutionMM,        // The final target output in mm
            sensorLpmm: f_sensor,                    // Resolution baseline on sensor (lp/mm)
            focalLengthMM: focalLength,              // Calculated physical focal length (mm)
            hfovDegrees: hfovRad * (180 / Math.PI),  // Derived HFOV for verification
            magnification: magnification,            // Optical magnification ratio
            bottleneck: bottleneck                  // Dominant limiting factor
        };
    }
};

```