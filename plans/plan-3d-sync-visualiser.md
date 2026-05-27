# 3D Camera Sync Visualiser — Implementation Plan

## Goal

Add an interactive 3D scene to the Camera Sync tab that shows camera positions, the tracked object with motion vector arrows, and a translucent positional error zone — making the multi-camera timing uncertainty model spatially intuitive.

---

## Overview & Architecture

### New dependency

```
npm install three
npm install -D @types/three
```

No other new dependencies. Camera view animations use a simple lerp in the render loop (no gsap).

### Files to create

| File | Purpose |
|---|---|
| `src/ui/scene3d.ts` | Three.js scene init, render loop, all 3D objects (cameras, sphere, arrows, error zone), OrbitControls, velocity arrow dragging |
| `src/ui/syncSceneControls.ts` | DOM event bindings for 3D scene controls — camera count, object size, quick view buttons |

### Files to modify

| File | Changes |
|---|---|
| `index.html` | Add 3D canvas + overlay buttons + camera count slider + object size slider inside `#panel-temporal` |
| `src/main.ts` | Wire `initScene3d()` and `initSyncSceneControls()` on boot; call `updateScene3d()` from `refreshAll`; resize 3D canvas on tab switch + window resize |
| `src/temporalState.ts` | Add `temporalObjectRadius` state with getter/setter |

### Layer compliance

- **`scene3d.ts`** (UI) may import from `temporalState.ts`, `engine.ts`, `constants.ts`, `types.ts`
- **`syncSceneControls.ts`** (UI) may import from `temporalState.ts`, `scene3d.ts`, `types.ts`, `ui/domUtils.ts`
- Three.js types live in `node_modules/@types/three` — no layer violations

---

## Architecture decisions & invariants

- **Velocity model across phases:** The 3D scene always reads `targetVelocity` (m/s, module-level scalar in `temporalState.ts`) for the arrow magnitude and the error zone radius. Direction starts as +Y in Phase 1; Phase 3 adds full 3D direction via drag. The Monte Carlo simulation uses only the magnitude — direction is visual only.
- **Units:** The scene uses metres everywhere. `getSyncErrorP95()` returns mm — convert to metres by dividing by 1000 before setting the error zone radius.
- **Error zone shape:** Always a sphere (isotropic). The radius = `syncErrorP95 / 1000` (m). The Monte Carlo simulation gives a worst-case positional uncertainty — the sphere shows the volume the tracked point could be in.
- **Camera view buttons:** Use `data-cam-index` attributes instead of dynamic IDs, so the static DOM binding checker doesn't fail. Only static IDs (`sync-view-overview`, `sync-view-cam-container`) are declared in HTML.
- **Left-click routing:** Use a pointer-event priority system:
  1. If the ray hits the arrow head mesh → start drag (Phase 3)
  2. Otherwise → OrbitControls handles the event
- **`targetVelocity` vs `linearVelocity`:** The preset button click sets both `setMotionParams()` and `setTemporalVelocity()` simultaneously. The arrow always reads `targetVelocity`. If custom sliders change `motionParams.linearVelocity` without calling `setTemporalVelocity()`, the arrow and error zone can temporarily disagree with the motion model — acceptable for Phase 1; Phase 3's drag sets `targetVelocity` directly, keeping them consistent.
- **Camera count phase transition:** Phase 1 hardcodes 2 cameras. Phase 2 adds the slider. When Phase 2 is implemented, the hardcoded 2 is replaced by the slider value (default 3). View buttons dynamically render based on count using `data-cam-index` attributes.

---

## Phase 1 — 3D Scene & Visual Elements

### Context

This phase builds the complete 3D scene with 2 hardcoded cameras (default placement from user spec). Camera positions depend on `distanceToSubject` (from AppState). Only linear velocity along +Y is modelled. The camera count slider comes in Phase 2.

### Task 1.1 — Install dependency, create file scaffold

**Files:** `src/ui/scene3d.ts`

**Changes:**
- Run `npm install three @types/three`
- Create `src/ui/scene3d.ts` with:
  - Module-level variables: `renderer`, `scene`, `camera`, `controls`
  - `initScene3d(canvas: HTMLCanvasElement, app: AppState): void` — creates renderer (WebGLRenderer, alpha: false, antialias: true), scene, perspective camera (75° FOV, aspect from canvas), ambient + directional lights, grid helper on XZ plane, sets `renderer.setAnimationLoop(animate)`
  - `animate(): void` — calls `controls.update()` (once Phase 3 adds OrbitControls), calls `renderer.render(scene, camera)`
  - `resizeScene3d(): void` — reads parent clientWidth/clientHeight, calls `renderer.setSize(w, h)`, updates camera aspect, calls `renderer.setPixelRatio(window.devicePixelRatio)`
  - `disposeScene3d(): void` — calls `renderer.dispose()`, removes canvas from DOM
  - `updateScene3d(app: AppState): void` — stub for later phases (logs to console)

**Acceptance:** `index.html` has a `<canvas id="sync-3d-canvas">` inside `#panel-temporal`; `main.ts` calls `initScene3d()` on boot; a simple lit scene with grid appears.

**References:** `src/ui/canvasUtils.ts` (similar sizing pattern), existing `main.ts` chart init pattern

### Task 1.2 — Add tracked object sphere + velocity arrow + error zone

**Files:** `src/ui/scene3d.ts`, `src/temporalState.ts`

**Changes to `src/temporalState.ts`:**
```typescript
let temporalObjectRadius = 0.5;   // m, radius of the tracked object sphere

export function getTemporalObjectRadius(): number { return temporalObjectRadius; }
export function setTemporalObjectRadius(m: number): void {
  temporalObjectRadius = clamped(m, 0.1, 2.0);
}
```

**Changes to `src/ui/scene3d.ts`:**

Add module-level mesh references:
- `objectSphere: THREE.Mesh` — sphere geometry (radius from `getTemporalObjectRadius()`), `MeshPhongMaterial` with opacity 0.5
- `velocityArrow: THREE.ArrowHelper` — from origin, direction `(0, 1, 0)`, length = `getTemporalVelocity()` (note: return value is m/s, directly used as scene metres)
- `errorZone: THREE.Mesh` — sphere geometry (radius = `getSyncErrorP95() / 1000`), `MeshPhongMaterial` with opacity 0.15, visible only when `isSyncToggleOn()`

In `updateScene3d()`:
- Update sphere radius from `getTemporalObjectRadius()`
- Update arrow length from `getTemporalVelocity()`
- Update error zone radius from `getSyncErrorP95() / 1000`
- Show/hide error zone based on `isSyncToggleOn()`

**Acceptance:** Sphere, arrow, and error zone render in the scene. Changing the object radius slider or velocity slider updates the scene immediately. Toggling sync on/off shows/hides the error zone.

### Task 1.3 — Add 2 hardcoded camera frustums with direction indicators

**Files:** `src/ui/scene3d.ts`

**Changes:**
- Camera position lookup: For 2 cameras at `[-45°, 45°]` from face-on (-Z axis), at distance `D = state.distanceToSubject`:
  ```
  xᵢ = D × sin(θᵢ)
  zᵢ = -D × cos(θᵢ)
  yᵢ = 0
  ```
- Each camera is a `THREE.Group` containing:
  - A small box (body) + cone (lens) mesh, coloured distinctly (e.g. `#3b82f6` for cam 1, `#ef4444` for cam 2)
  - A thin line or cone pointing from the camera toward origin
  - A sprite text label "Cam 1", "Cam 2" (use `THREE.CanvasTexture` with a 2D canvas to render text)
- `group.lookAt(0, 0, 0)` aims all cameras at origin
- Group is parented to a pivot at origin so position updates can translate directly

In `updateScene3d()`:
- Update camera positions when `distanceToSubject` changes
- Each camera group re-aims at origin

**Acceptance:** Two coloured camera models appear at correct positions, pointing at the sphere. Labels are readable.

### Task 1.4 — DOM wiring: HTML + controls + view buttons + wire into main.ts

**Files:** `index.html`, `src/ui/syncSceneControls.ts`, `src/main.ts`

**HTML to add inside `#panel-temporal`, after summary text and before the chart:**

```html
<div class="rounded-lg border border-slate-800 bg-slate-950 p-2 mb-2">
  <div class="relative">
    <canvas id="sync-3d-canvas" class="w-full h-72"></canvas>
    <div class="absolute top-2 right-2 flex gap-1">
      <button id="sync-view-overview" class="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">Overview</button>
      <div id="sync-view-cam-container" class="flex gap-1"></div>
    </div>
  </div>
  <div class="mt-2 flex gap-4 items-center">
    <label class="text-xs text-slate-500">Cameras <input id="sync-camera-count" type="range" min="1" max="6" value="2" class="w-24 align-middle" /> <span id="sync-camera-count-label" class="text-xs font-mono text-slate-400">2</span></label>
    <label class="text-xs text-slate-500">Object size <input id="sync-object-radius" type="range" min="0.1" max="2" step="0.1" value="0.5" class="w-24 align-middle" /> <span id="sync-object-radius-label" class="text-xs font-mono text-slate-400">0.5 m</span></label>
  </div>
</div>
```

Note: The camera count slider is added here in Phase 1 HTML but is wired in Phase 2. It starts at value=2. The static IDs (`sync-3d-canvas`, `sync-view-overview`, `sync-view-cam-container`, `sync-camera-count`, `sync-camera-count-label`, `sync-object-radius`, `sync-object-radius-label`) satisfy the DOM binding checker.

**`src/ui/syncSceneControls.ts`:**
- `initSyncSceneControls(refreshAll: () => void): void`
- Bind `sync-object-radius` slider → `setTemporalObjectRadius(value)` + `refreshAll()`
- Bind `sync-view-overview` button → animate camera position to `(10, 8, 10)` looking at `(0, 0, 0)`
- For Phase 1, camera view buttons are static (Cam 1, Cam 2) using hardcoded buttons. Phase 2 will make them dynamic.
- Export `rebuildCameraViewButtons(count: number)` — in Phase 1, this creates 2 buttons with `data-cam-index="0"` and `data-cam-index="1"`, each clicking animates to that camera's world position. In Phase 2, this will be parameterised.

**`src/main.ts`:**
- Import `initScene3d`, `updateScene3d`, `disposeScene3d`, `resizeScene3d` from `./ui/scene3d`
- Import `initSyncSceneControls` from `./ui/syncSceneControls`
- After other chart init calls: `initScene3d(document.getElementById('sync-3d-canvas'), app)` and `initSyncSceneControls(refreshAll)`
- In `refreshAll`: call `updateScene3d(app)`
- On tab switch to `panel-temporal`: call `resizeScene3d()`
- On window resize (the existing resize handler): also call `resizeScene3d()`

**Acceptance:** The 3D scene renders in the temporal tab. Object size slider changes the sphere. Overview button animates the view. Tab-switch in/out works without console errors.

---

## Phase 2 — Camera Selector

### Task 2.1 — Replace hardcoded 2 cameras with camera count slider

**Files:** `src/temporalState.ts`, `src/ui/scene3d.ts`, `src/ui/syncSceneControls.ts`, `index.html`

**Changes to `src/temporalState.ts`:**
- Add `temporalCameraCount: number` with default 3, range 1–6
- Export `getTemporalCameraCount(): number` and `setTemporalCameraCount(n: number): void`

**Changes to `src/ui/scene3d.ts`:**
- Replace the 2 hardcoded camera groups with a `cameraMeshes: THREE.Group[]` array that is rebuilt on count change
- Add `getCameraPositions(count: number, distance: number): { x: number; z: number }[]` — lookup table returning the positions for each count:

  | Count | Angles θ (from -Z axis) |
  |---|---|
  | 1 | [0°] |
  | 2 | [-45°, 45°] |
  | 3 | [-45°, 0°, 45°] |
  | 4 | [45°, 135°, 225°, 315°] |
  | 5 | [0°, 45°, 135°, 225°, 315°] |
  | 6 | [0°, 60°, 120°, 180°, 240°, 300°] |

- `rebuildCameras(count: number): void` — removes all existing camera groups, creates new ones at correct positions, adds labels
- Called from `updateScene3d()` when count or distance changes

**Changes to `src/ui/syncSceneControls.ts`:**
- Wire `sync-camera-count` slider → `setTemporalCameraCount(value)` + `rebuildCameraViewButtons(value)` + `refreshAll()`
- Update `sync-camera-count-label` text

**Changes to `index.html`:**
- Change the camera count slider value from 2 to 3 to match Phase 2 default

**Acceptance:** Sliding the camera count from 1–6 rebuilds the scene with correct camera positions. Labels update. No orphaned meshes.

### Task 2.2 — Dynamic camera view buttons

**Files:** `src/ui/syncSceneControls.ts`

**Changes to `syncSceneControls.ts`:**
- `rebuildCameraViewButtons(count: number): void`:
  - Clear `#sync-view-cam-container` innerHTML
  - For each camera index `i` in `0..count-1`, create a `<button>` with `data-cam-index="${i}"`, text `"Cam ${i+1}"`, class `text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700`
  - Bind click → animate camera to that camera's world position
- The camera world position for camera i is derived from the same angle lookup in `getCameraPositions()`. The scene3d.ts module exports `getCameraWorldPosition(index: number): THREE.Vector3` so the controls module doesn't duplicate the placement logic.

**Acceptance:** Changing camera count updates the view button row. Each button animates to the corresponding camera's viewpoint.

---

## Phase 3 — Mouse Navigation

### Task 3.1 — Add OrbitControls with centre-locked rotation + zoom

**Files:** `src/ui/scene3d.ts`

**Changes:**
- In `initScene3d()`:
  ```typescript
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 0.5;
  controls.maxDistance = 50;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  ```
- The existing `animate()` function already calls `controls.update()` — verify this
- `resizeScene3d()` must update the renderer size (already done)

**Acceptance:** Drag rotates around origin, scroll zooms in/out, right-drag pans. Centre stays on the object. Smooth damping feels natural.

### Task 3.2 — Velocity arrow drag (direction + magnitude)

**Files:** `src/ui/scene3d.ts`

**Changes:**

Add drag state variables:
- `isDraggingArrow = false`
- `dragPlane: THREE.Plane` — a plane through origin perpendicular to the camera's view direction (so the arrow tip follows the mouse naturally)
- `arrowHeadHitMesh: THREE.Mesh` — a small invisible `SphereGeometry` at the arrow tip position, used for raycasting

Arrow direction model:
- The velocity arrow uses `targetVelocity` as magnitude
- Direction is stored as a `THREE.Vector3` — initially `(0, 1, 0)` for Phase 1 compatibility
- The arrow helper is recreated when direction or length changes

Pointer event flow:

```
pointerdown:
  1. Cast ray through mouse position
  2. If hit arrowHeadHitMesh → isDraggingArrow = true, set dragPlane perpendicular to camera
  3. Otherwise → let OrbitControls handle it (do NOT call event.stopPropagation)

pointermove (if isDraggingArrow):
  1. Cast ray onto dragPlane → intersection point
  2. New direction = intersection point normalized (from origin)
  3. New length = intersection point magnitude, clamped to [0.1, 20]
  4. Update arrow visually (live)
  5. Skip OrbitControls update this frame

pointerup (if isDraggingArrow):
  1. isDraggingArrow = false
  2. Read final direction and length from arrow
  3. Set direction in state, setTemporalVelocity(newLength)
  4. Call refreshAll() → updates error zone + labels
```

Export `getVelocityDirection(): THREE.Vector3` for use by the controls module (future sync math).

**Visual feedback during drag:**
- Arrow colour changes to bright yellow (`#eab308`)
- A dashed guideline from origin to arrow tip appears

**Acceptance:** Click-drag on the arrow tip moves it in 3D. Arrow changes direction and length. Releasing calls `refreshAll()` and the error zone updates. OrbitControls does not interfere (click on empty space still rotates).

### Task 3.3 — Update velocity arrow on preset/input changes

**Files:** `src/ui/scene3d.ts`, `src/ui/syncSceneControls.ts`

**Changes:**
- In `updateScene3d()`, the arrow already updates from `targetVelocity` magnitude. Now also read the stored direction (from `getVelocityDirection()` or a module variable) to set the arrow's direction each frame.
- Add a small sprite label near the arrow tip showing `"v = X.X m/s"` updated each frame.
- The velocity arrow direction should reset to `(0, 1, 0)` when a motion preset button is clicked (the preset sets `linearVelocity` and `targetVelocity` but doesn't touch direction). Add `resetVelocityDirection()` export from `scene3d.ts`, call it from `syncSceneControls.ts` when a `.vel-preset` button is clicked.

**Acceptance:** Preset buttons reset arrow to +Y. Custom drag persists until next preset click. Labels show correct speed.

---

## Integration Checklist (applies across all phases)

### main.ts wiring summary

```typescript
import { initScene3d, updateScene3d, resizeScene3d, disposeScene3d } from './ui/scene3d';
import { initSyncSceneControls } from './ui/syncSceneControls';

// In init/onload:
const canvas3d = document.getElementById('sync-3d-canvas') as HTMLCanvasElement;
initScene3d(canvas3d, app);
initSyncSceneControls(refreshAll);

// In refreshAll():
updateScene3d(app);

// In tab-switch handler (switchTab):
if (tab === 'temporal') setTimeout(resizeScene3d, 0);

// In window resize handler:
resizeScene3d();
```

### DOM binding compliance

All static IDs referenced by TypeScript `getElementById`:

| ID | File |
|---|---|
| `sync-3d-canvas` | `scene3d.ts` |
| `sync-camera-count` | `syncSceneControls.ts` |
| `sync-camera-count-label` | `syncSceneControls.ts` |
| `sync-object-radius` | `syncSceneControls.ts` |
| `sync-object-radius-label` | `syncSceneControls.ts` |
| `sync-view-overview` | `syncSceneControls.ts` |
| `sync-view-cam-container` | `syncSceneControls.ts` (used for dynamic button insertion) |

Dynamic view buttons within `#sync-view-cam-container` use `data-cam-index` — no dynamic IDs required.

### Tab-switch lifecycle

- On switch **to** temporal tab: call `resizeScene3d()`. The render loop is already running via `setAnimationLoop` — it's a single shared loop.
- On switch **away** from temporal tab: no action needed. The render loop continues but the canvas is hidden by CSS. Optionally set `renderer.setAnimationLoop(null)` when hidden and restart when shown for performance.
- On page leave/unload: `disposeScene3d()` cleans up the renderer.

---

## Acceptance criteria (all phases)

1. `npm run tsc --noEmit` passes
2. `npm test` passes (DOM binding checker)
3. 3D scene renders in the temporal tab with sphere, cameras, arrow, error zone
4. Camera count slider (1–6) repositions cameras correctly
5. View buttons animate camera to preset positions
6. OrbitControls: rotate, zoom, pan around the object
7. Arrow drag changes direction + speed; error zone updates on release
8. Sync toggle hides/shows the error zone
9. Object size slider changes sphere radius
10. Tab switch + window resize work without console errors
