# Plan: 3D Velocity Direction Gizmo for Camera Sync Scene

Two-phase implementation. Phase 1 replaces the broken arrow-head drag with a hover-activated XZ gizmo. Phase 2 adds Y-axis support.

---

## Phase 1 — XZ Gizmo (Replace Broken Arrow Drag)

### Problem

The current arrow-head drag system (`scene3d.ts`) has a pre-existing bug: the invisible hit sphere is always placed at `(0, arrowLen, 0)` regardless of the arrow's actual direction (`scene3d.ts:296`). It also conflates direction and magnitude (arrow length = velocity), making precise direction control difficult.

### Goal

Replace the arrow-head drag with a hover-activated gizmo at the object origin. Click+drag on the **existing blue object sphere** changes the velocity direction by projecting the pointer onto the XZ plane. Red (X) and blue (Z) axis arrows provide visual reference. The velocity arrow remains display-only and updates its direction to match.

### Interaction model

```
mouse enters canvas          → gizmo axis arrows appear at origin
mouse over object sphere     → cursor = pointer (already over the drag target)
pointer down on sphere       → start drag, disable OrbitControls
pointer move (dragging)      → project pointer onto XZ plane,
                               compute direction from origin to projected point,
                               set velocity direction, update arrow + label
pointer up                   → commit direction to state, re-enable OrbitControls
mouse leaves canvas          → gizmo axis arrows hide
```

No per-axis handle dragging. The sphere IS the handle. Axis arrows are visual only.

### File: `src/ui/scene3d.ts`

#### Remove

Old drag system variables (`scene3d.ts:37-41`):

| Variable | Lines | Notes |
|---|---|---|
| `isDraggingArrow` | 37 | No longer needed — gizmo drag uses `isDraggingGizmo` |
| `dragPlane` | 38 | Gizmo uses its own XZ-plane drag |
| `dragStartPoint` | 39 | Gizmo uses different drag math |
| `dragStartLen` | 40 | Gizmo doesn't change magnitude |
| `arrowHeadHitSphere` | 41 | Replaced by raycast against `objectSphere` |

#### Add

Gizmo state variables (after line 41):

```typescript
let gizmoGroup: THREE.Group | null = null;       // X + Z axis arrows + labels
let isDraggingGizmo = false;                      // trackball drag active
let gizmoDragStartDir = new THREE.Vector3();      // initial direction at drag start
```

#### Functions

**`buildGizmo()`**
- Called once from `initScene3d()`
- Creates a `THREE.Group` containing:
  - **No central sphere** — uses the existing blue `objectSphere` at origin
  - X axis: `ArrowHelper(new Vector3(1,0,0), origin, 0.25, 0xef4444, 0.04, 0.02)`
  - Z axis: `ArrowHelper(new Vector3(0,0,1), origin, 0.25, 0x3b82f6, 0.04, 0.02)`
  - X label: `makeTextSprite('X', '#ef4444')` near tip
  - Z label: `makeTextSprite('Z', '#3b82f6')` near tip
- Sets `gizmoGroup.visible = false`
- Adds to `scene`
- ArrowHelpers start at `(0,0,0)` — they render on top of the translucent `objectSphere`, which looks fine

**`destroyGizmo()`**
- Called from `disposeScene3d()`
- Disposes all geometries, materials, textures in the gizmo group
- Removes from scene, nulls references

**`showGizmo()` / `hideGizmo()`**
- Toggle `gizmoGroup.visible`
- Called from pointer enter/leave

#### Modify pointer events

Replace `setupPointerEvents()` (`scene3d.ts:393-397`):

```typescript
function setupPointerEvents(domElement: HTMLElement): void {
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointerenter', onPointerEnter);
  domElement.addEventListener('pointerleave', onPointerLeave);
}
```

**`onPointerEnter`** — show gizmo:
```typescript
function onPointerEnter(): void {
  showGizmo();
}
```

**`onPointerLeave`** — hide gizmo, cancel any active drag:
```typescript
function onPointerLeave(): void {
  hideGizmo();
  if (isDraggingGizmo) {
    isDraggingGizmo = false;
    controls!.enabled = true;
    renderer!.domElement.style.cursor = 'default';
  }
}
```

**`onPointerDown`** — raycast against the object sphere (the drag handle):
```typescript
function onPointerDown(event: PointerEvent): void {
  if (!camera || !objectSphere || !scene || !gizmoGroup?.visible) return;
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(objectSphere);
  if (hits.length === 0) return; // let OrbitControls handle it

  isDraggingGizmo = true;
  gizmoDragStartDir.copy(velocityDirection);
  controls!.enabled = false;
  renderer!.domElement.style.cursor = 'grabbing';
}
```

**`onPointerMove`** — XZ trackball drag:
```typescript
function onPointerMove(event: PointerEvent): void {
  if (!camera || !scene) return;
  updatePointer(event);

  if (isDraggingGizmo) {
    // Project pointer onto XZ plane (Y=0) through origin
    raycaster.setFromCamera(pointer, camera);
    const hitPoint = new THREE.Vector3();
    const xzPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    if (!raycaster.ray.intersectPlane(xzPlane, hitPoint)) return;

    const newDir = hitPoint.clone().normalize();
    if (isFinite(newDir.x) && isFinite(newDir.z)) {
      velocityDirection.set(newDir.x, 0, newDir.z);
      setVelocityDirXZ(newDir.x, newDir.z);
      updateArrowDirection();
    }
  }
  // No hover highlight — sphere is the only handle, cursor changes are handled
  // by the pointerdown/up state
}
```

**`onPointerUp`** — commit direction:
```typescript
function onPointerUp(): void {
  if (!isDraggingGizmo) return;
  isDraggingGizmo = false;
  controls!.enabled = true;
  renderer!.domElement.style.cursor = 'default';
  if (refreshCallback) refreshCallback();
}
```

**`updateArrowDirection()`** — uses `setDirection` instead of recreating:
```typescript
function updateArrowDirection(): void {
  if (!velocityArrow) return;
  const dir = velocityDirection.clone().normalize();
  velocityArrow.setDirection(dir);
  updateArrowLabel();
}
```

**`updateArrowLabel()`** — extracted shared helper (from the duplicated code at lines 279-288 and 443-453):
```typescript
function updateArrowLabel(): void {
  if (!velocityArrowLabel || !scene) return;
  const vel = getTemporalVelocity();
  const arrowLen = Math.max(vel * 0.15, 0.015);
  const dir = velocityDirection.clone().normalize();
  const mid = dir.clone().multiplyScalar(arrowLen / 2);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const perp = worldUp.clone().addScaledVector(dir, -worldUp.dot(dir)).normalize();
  if (perp.length() < 0.01) perp.set(0, 0, 1);
  velocityArrowLabel.position.copy(mid.clone().addScaledVector(perp, 0.01));
}
```

#### Modify `buildSceneElements()`

- Remove lines 291-297 (hit sphere creation):
  ```typescript
  // DELETE these lines:
  const hitRadius = Math.max(0.005, arrowLen * 0.4);
  arrowHeadHitSphere = new THREE.Mesh(...);
  arrowHeadHitSphere.position.set(0, arrowLen, 0);
  scene.add(arrowHeadHitSphere);
  ```

- The rest of `buildSceneElements()` is unchanged — the velocity arrow and label are still built, the object sphere is still created.

#### Modify `cleanupSceneElements()`

- Remove hit sphere cleanup:
  ```typescript
  // DELETE: if (arrowHeadHitSphere) { ... }
  ```

#### Modify `initScene3d()`

- Add `buildGizmo()` after line 163 (before `setupPointerEvents`)

#### Modify `disposeScene3d()`

```typescript
export function disposeScene3d(): void {
  destroyGizmo();            // NEW
  cleanupSceneElements();
  if (controls) { controls.dispose(); controls = null; }
  if (renderer) { renderer.dispose(); renderer = null; }
  scene = null;
  camera = null;
  currentApp = null;
}
```

#### Hide gizmo during camera animation

In `animateCameraTo()`:
```typescript
export function animateCameraTo(pos: THREE.Vector3): void {
  hideGizmo();
  if (!camera) return;
  animStartPos.copy(camera.position);
  animTargetPos.copy(pos);
  animProgress = 0;
  animatingCamera = true;
}
```

Gizmo re-appears on next pointer move/enter naturally after animation completes.

### File: `src/temporalState.ts`

No changes. Phase 1 uses the existing `setVelocityDirXZ()` API.

### File: `src/main.ts`

Add `beforeunload` handler to dispose WebGL resources:

```typescript
window.addEventListener('beforeunload', () => {
  disposeScene3d();
});
```

Place at the end of the file, after line 577.

### Files NOT modified

- `index.html` — no new DOM IDs
- `tests/dom-bindings.test.ts` — no new DOM IDs
- `src/ui/syncSceneControls.ts` — `resetVelocityDirection()` still works
- `src/types.ts` — no new types

### Verification

1. `npx tsc --noEmit` — type check
2. `npm test` — DOM binding test
3. Manual: open Temporal tab, mouse over 3D canvas → X/Z axis arrows appear, click+drag on blue object sphere → arrow direction follows pointer in XZ plane, mouse leave → gizmo disappears
4. Arrow length (velocity magnitude) unchanged by gizmo drag — verify via slider

---

## Phase 2 — XYZ (Full 3D Velocity Direction)

### Goal

Add Y-axis to the gizmo and extend the simulation to use full 3D velocity direction. The Y axis arrow (green) appears alongside X and Z. Drag on the object sphere projects onto a camera-perpendicular plane instead of XZ-only.

### Changes

#### `src/temporalState.ts`

**Add** module-level variable:
```typescript
let velocityDirY = 0;
```

**Add** getter/setter:
```typescript
export function getVelocityDir3D(): { x: number; y: number; z: number } {
  return { x: velocityDirX, y: velocityDirY, z: velocityDirZ };
}

export function setVelocityDir3D(x: number, y: number, z: number): void {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < 1e-6) { velocityDirX = 1; velocityDirY = 0; velocityDirZ = 0; }
  else { velocityDirX = x / len; velocityDirY = y / len; velocityDirZ = z / len; }
}
```

**Update** `makeSimHash()` to include Y:
```typescript
velocityDirX.toFixed(3), velocityDirY.toFixed(3), velocityDirZ.toFixed(3),
```

**Update** `runSimulation()` — extend dot product to full 3D:

Lines 293-301 become:
```typescript
const tangFactors = angles.map(deg => {
  const rad = (deg * Math.PI) / 180;
  const d = Math.sqrt(D * D + h * h);
  const viewX = -Math.sin(rad) * D / d;
  const viewY = -h / d;
  const viewZ = Math.cos(rad) * D / d;
  const dot = velocityDirX * viewX + velocityDirY * viewY + velocityDirZ * viewZ;
  return Math.sqrt(Math.max(0, 1 - dot * dot));
});
```

**Constrain Y range**: Clamp Y component to `[-0.7, 0.7]` to prevent pointing straight up/down (60° max elevation from horizontal).

#### `src/ui/scene3d.ts`

**Add Y axis to gizmo** in `buildGizmo()`:
- Y axis: `ArrowHelper(new Vector3(0,1,0), origin, 0.25, 0x22c55e, 0.04, 0.02)`
- Y label: `makeTextSprite('Y', '#22c55e')` near tip

Axis colour scheme: X=red `0xef4444`, Y=green `0x22c55e`, Z=blue `0x3b82f6`

**Update drag math** in `onPointerMove` — use camera-perpendicular plane instead of XZ plane:
```typescript
if (isDraggingGizmo) {
  raycaster.setFromCamera(pointer, camera);
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(0, 0, 0));
  const hitPoint = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return;

  const newDir = hitPoint.clone().normalize();
  // Constrain Y to [-0.7, 0.7], renormalize XZ
  newDir.y = Math.max(-0.7, Math.min(0.7, newDir.y));
  newDir.xz().normalize();   // preserve XZ unit length after Y constraint
  newDir.normalize();

  if (isFinite(newDir.x) && isFinite(newDir.y) && isFinite(newDir.z)) {
    velocityDirection.copy(newDir);
    setVelocityDir3D(newDir.x, newDir.y, newDir.z);
    updateArrowDirection();
  }
}
```

No per-axis handles needed — the sphere-at-origin trackball naturally extends to 3D.

### Physical justification

Adding Y-axis velocity models subjects with vertical motion (jumping, drones, uneven terrain). The tangential factor `sqrt(1 - dot²)` correctly computes the perpendicular component of a full 3D velocity relative to the 3D camera view direction, so the existing formula still holds.

### Files NOT modified

- `index.html` — no changes
- `src/ui/syncSceneControls.ts` — no changes
- `src/types.ts` — no changes
- `tests/dom-bindings.test.ts` — no changes
