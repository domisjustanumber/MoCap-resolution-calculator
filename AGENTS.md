# Project Structure Rules

These rules apply to all AI coding assistants (opencode, Cursor, etc.) working on this project. Follow them to keep the architecture clean and prevent drift.

## Build & Verify

```bash
npx tsc --noEmit        # type check — must be clean before committing
npm test                # run all vitest tests including DOM bindings checker
```

The DOM binding checker (`tests/dom-bindings.test.ts`) automatically verifies every HTML `id` has a matching `getElementById` call (and vice versa). It must pass before any commit that touches `index.html` or `src/ui/`.

## Layer Architecture

Dependency direction is strictly top → bottom. No upward imports, no circular deps.

```
src/main.ts              Bootstrap only — wires state + UI + charts + tab switching
  ↓
src/ui/*                 DOM manipulation, event binding, Canvas rendering
  ↓
src/state.ts             Global state: createState, recalculate, applyPreset, setField
src/optimizer.ts         Camera config optimizer
src/temporalState.ts     Motion params, fps/shutter/region, sync simulation
  ↓
src/engine.ts            Pure spatial math, formatting helpers, shared computation fns
src/exposure.ts          Exposure/Snr optimization math
src/temporalQuantize.ts  Region-grid fps/shutter enumeration math
  ↓
src/constants.ts         Physics constants, range limits, lookup tables, shared util fns
src/types.ts             All TypeScript interfaces and type aliases
  ↓
presets/                 Static JSON data, loaders — imports NOTHING from src/
```

### Import rules

- **UI files** may import from `src/state`, `src/optimizer`, `src/temporalState`, `src/engine`, `src/constants`, `src/types`
- **Business logic** (`state.ts`, `optimizer.ts`, `temporalState.ts`) may import from math, constants, types
- **Pure math** (`engine.ts`, `exposure.ts`, `temporalQuantize.ts`) may ONLY import from `constants.ts` and `types.ts` — never from state or UI
- **`constants.ts`** may import from `types.ts` only
- **`presets/`** must never import from `src/`

## Where New Code Goes

| Concern | File |
|---|---|
| Shared TypeScript interfaces / type aliases | `src/types.ts` |
| Physics constants, range limits, configurable defaults | `src/constants.ts` |
| Shared pure-function utilites (`clamped`, chroma penalty, etc.) | `src/constants.ts` |
| Spatial math (MTF, diffraction, Nyquist, FOV, feature size) | `src/engine.ts` |
| Exposure math (photons, electrons, SNR, dark current) | `src/exposure.ts` |
| Camera config optimization logic | `src/optimizer.ts` |
| Motion params, fps/shutter/region state, sync simulation | `src/temporalState.ts` |
| FPS/shutter region-grid math | `src/temporalQuantize.ts` |
| Global state CRUD, preset application, field setters | `src/state.ts` |
| App bootstrap, tab switching, slider bindings | `src/main.ts` |
| One DOM panel / concern | `src/ui/<name>.ts` |
| Shared DOM helpers (getElementById with guard) | `src/ui/domUtils.ts` |
| Shared Canvas helpers (sizing, grid, axes) | `src/ui/canvasUtils.ts` |
| Static sensor/lens/camera JSON data | `presets/<type>/<name>.json` |
| Preset loader modules | `presets/<type>s.ts` |
| Preset barrel re-exports | `presets/index.ts` |
| Preset-specific types | `presets/types.ts` |
| Vitest unit tests | `tests/<name>.test.ts` |
| Playwright e2e tests | `e2e/<name>.spec.ts` |

## DOM Binding Rules

- Every `id="..."` in `index.html` MUST be read or written by at least one TS file
- Every `document.getElementById('...')` call MUST match an element in `index.html`
- Use the shared helpers instead of ad-hoc patterns:
  - `setText(id, text)` from `outputs.ts` — set element text content
  - `setInputIfNotFocused(id, value)` from `ui/domUtils.ts` — set input value without stealing focus
  - `syncTargetInput(id, value, decimals)` from `outputs.ts` — sync input with display rounding
  - `bindNumberInput(id, key)`, `bindSelectInput(id, key)`, etc. from `inputs.ts` — wire input to state
- The `tests/dom-bindings.test.ts` checker keeps this consistent — when it finds a mismatch, clean up BOTH sides (remove the dead HTML ID AND the stale JS reference)
- DOM ID naming: kebab-case is preferred (`exp-snr-bar`, `mtf-chart`). camelCase accepted for IDs that directly mirror `AppState` property names (`focalLength`, `pixelPitch`, `desiredSnrDb`). Never mix conventions within the same UI section.
- Dynamically-created elements should use `data-*` attributes for identification, not auto-generated IDs

## Code Re-use — Use These Before Writing Inline

| Instead of ad-hoc... | Use the shared version | From |
|---|---|---|
| `Math.max(0, Math.min(MAX, v))` | `clamped(v, min, max)` | `constants.ts` |
| `Math.max(min, Math.min(max, round(v/step)*step))` | `clampStep(v, min, max, step)` | `constants.ts` |
| Inline `if (colour && !RAW_FORMATS) ...` | `chromaSnrPenaltyDb(state)` or `chromaFormatEfficiencyPenalty(state)` | `constants.ts` |
| Inline vEff/vRot/vTotal/vImg chain | `computeImageVelocity(motion, shutterTime, focalLength, distance)` | `engine.ts` |
| Inline `epsilon * fps * fps` / `epsilon * fps / hw * (180/PI)` | `motionHeadroom(motion, fps, errorBudgetMm)` | `optimizer.ts` |
| `document.getElementById('x'); if (el) el.textContent = v` | `setText('x', v)` | `ui/outputs.ts` |
| `if (el && el !== document.activeElement) el.value = v` | `setInputIfNotFocused('x', v)` | `ui/domUtils.ts` |
| Hardcoded data tables in UI files | Move to `constants.ts` or `presets/` | — |
| Loader wrapper `(raw: unknown) => raw as T` | Direct `as T` cast | — |

## Naming

- **DOM IDs**: kebab-case (`exp-snr-bar`). camelCase for domain-model fields (`focalLength`).
- **Functions / variables**: camelCase (`calculateResults`, `shutterDenom`)
- **Interfaces / types**: PascalCase (`AppState`, `MotionParams`)
- **Constants**: UPPER_SNAKE_CASE (`SNR_DB_MAX`, `MOTION_MTF50_CONST`)
- **Source files**: camelCase matching primary export (`temporalState.ts` → `getTemporalState`)

## Data Tables

Any mapping between human-readable labels and numeric values (lens tier → DR, lux preset → value, motion preset → params) belongs in `constants.ts` or the appropriate `presets/` file. Never hardcode these in UI event handlers.
