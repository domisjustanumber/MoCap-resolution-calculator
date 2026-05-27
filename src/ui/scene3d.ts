import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { AppStateFull } from '../types';
import {
  getTemporalCameraCount,
  getTemporalVelocity,
  setTemporalVelocity,
  setVelocityDirXZ,
  getCameraAngles,
  getSyncErrorP95,
  getCachedMaxErrors,
  runAndCacheSimulation,
} from '../temporalState';

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let pointCloud: THREE.Points | null = null;
let velocityArrow: THREE.ArrowHelper | null = null;
let velocityArrowLabel: THREE.Sprite | null = null;
let cameraGroups: THREE.Group[] = [];
let cameraLabels: THREE.Sprite[] = [];
let cameraCount = 2;
let isDraggingArrow = false;
let dragPlane = new THREE.Plane();
let dragStartPoint = new THREE.Vector3();
let dragStartLen = 0;
let arrowHeadHitSphere: THREE.Mesh | null = null;
let velocityDirection = new THREE.Vector3(1, 0, 0);
let animatingCamera = false;
let animTargetPos = new THREE.Vector3();
let animStartPos = new THREE.Vector3();
let animProgress = 0;
let currentApp: AppStateFull | null = null;
let raycaster = new THREE.Raycaster();
let pointer = new THREE.Vector2();
let refreshCallback: (() => void) | null = null;

const ANIM_DURATION = 0.5;
const CAMERA_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

function getCameraPositions(count: number, distance: number): { x: number; z: number }[] {
  const angles = getCameraAngles(count);
  return angles.map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: distance * Math.sin(rad), z: -distance * Math.cos(rad) };
  });
}

export function getCameraWorldPosition(index: number, distance: number): THREE.Vector3 {
  const count = cameraCount;
  const positions = getCameraPositions(count, distance);
  const clampedIndex = Math.min(index, positions.length - 1);
  const pos = positions[clampedIndex];
  return new THREE.Vector3(pos.x, 0, pos.z);
}

function makeTextSprite(text: string, color: string = '#94a3b8'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.6, 0.15, 1);
  return sprite;
}

function buildCameraGroup(index: number, pos: { x: number; z: number }): THREE.Group {
  const group = new THREE.Group();

  const bodyGeo = new THREE.BoxGeometry(0.15, 0.08, 0.1);
  const bodyMat = new THREE.MeshPhongMaterial({ color: CAMERA_COLORS[index % CAMERA_COLORS.length] });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0, 0.05);
  group.add(body);

  const lensGeo = new THREE.ConeGeometry(0.04, 0.08, 12);
  const lensMat = new THREE.MeshPhongMaterial({ color: '#1e293b' });
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0, 0.12);
  group.add(lens);

  const dirMat = new THREE.LineBasicMaterial({ color: '#fbbf24' });
  const dirPoints = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0.3)];
  const dirGeo = new THREE.BufferGeometry().setFromPoints(dirPoints);
  const dirLine = new THREE.Line(dirGeo, dirMat);
  dirLine.position.set(0, 0, 0.15);
  group.add(dirLine);

  group.position.set(pos.x, 0, pos.z);
  group.lookAt(0, 0, 0);
  return group;
}

export function initScene3d(canvas: HTMLCanvasElement, app: AppStateFull): void {
  currentApp = app;

  const rect = canvas.parentElement?.getBoundingClientRect() ?? { width: 800, height: 288 };
  const w = rect.width;
  const h = Math.max(200, Math.min(400, w * 0.45));

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x020617);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
  camera.position.set(4, 3, 4);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 0.5;
  controls.maxDistance = 50;
  controls.update();

  const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
  fillLight.position.set(-3, 1, -5);
  scene.add(fillLight);

  const gridHelper = new THREE.GridHelper(4, 16, 0x1e293b, 0x1e293b);
  gridHelper.position.y = -0.5;
  scene.add(gridHelper);

  buildSceneElements(app);
  setupPointerEvents(renderer.domElement);
  animate();
}

function buildPointCloud(): THREE.Points | null {
  runAndCacheSimulation();
  const errors = getCachedMaxErrors();
  if (!errors) return null;
  const n = errors.length;
  const dir = velocityDirection.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(dir.dot(up)) > 0.99) up.set(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const localUp = new THREE.Vector3().crossVectors(right, dir).normalize();
  const LATERAL_FACTOR = 0.35;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const p95mm = getSyncErrorP95();
  const p95m = Math.max(p95mm / 1000, 0.001);
  for (let i = 0; i < n; i++) {
    const errorM = errors[i] / 1000;
    const lateralMag = errorM * LATERAL_FACTOR * (0.5 + Math.random());
    const theta = Math.random() * Math.PI * 2;
    const lateralOffset = new THREE.Vector3()
      .addScaledVector(right, Math.cos(theta) * lateralMag)
      .addScaledVector(localUp, Math.sin(theta) * lateralMag);
    const primaryOffset = new THREE.Vector3().copy(dir).multiplyScalar(errorM);
    const pos = new THREE.Vector3().copy(primaryOffset).add(lateralOffset);
    positions[i * 3] = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;
    const t = Math.min(errorM / p95m, 1);
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 1 - t * 0.7;
    colors[i * 3 + 2] = 1 - t;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.008,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  return new THREE.Points(geo, mat);
}

function buildSceneElements(app: AppStateFull): void {
  if (!scene) return;
  cleanupSceneElements();

  const distance = app.state.distanceToSubject || 2;

  pointCloud = buildPointCloud();
  if (pointCloud) scene.add(pointCloud);

  const vel = getTemporalVelocity();
  const arrowLen = Math.max(vel * 0.15, 0.015);
  velocityArrow = new THREE.ArrowHelper(
    velocityDirection.clone().normalize(),
    new THREE.Vector3(0, 0, 0),
    arrowLen,
    0x22c55e,
    Math.max(arrowLen * 0.25, 0.002),
    Math.max(arrowLen * 0.12, 0.001),
  );
  scene.add(velocityArrow);

  const label = makeTextSprite(`v = ${vel.toFixed(1)} m/s`, '#22c55e');
  label.position.set(0, arrowLen + 0.03, 0);
  scene.add(label);
  velocityArrowLabel = label;

  const hitRadius = Math.max(0.005, arrowLen * 0.4);
  arrowHeadHitSphere = new THREE.Mesh(
    new THREE.SphereGeometry(hitRadius, 8, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  arrowHeadHitSphere.position.set(0, arrowLen, 0);
  scene.add(arrowHeadHitSphere);

  const count = getTemporalCameraCount();
  cameraCount = count;
  const positions = getCameraPositions(count, distance);
  for (let i = 0; i < positions.length; i++) {
    const group = buildCameraGroup(i, positions[i]);
    scene.add(group);
    cameraGroups.push(group);

    const lbl = makeTextSprite(`Cam ${i + 1}`, CAMERA_COLORS[i % CAMERA_COLORS.length]);
    lbl.position.set(positions[i].x, 0.3, positions[i].z);
    scene.add(lbl);
    cameraLabels.push(lbl);
  }
}

function cleanupSceneElements(): void {
  if (pointCloud) { scene?.remove(pointCloud); pointCloud.geometry.dispose(); (pointCloud.material as THREE.Material).dispose(); pointCloud = null; }
  if (velocityArrow) { scene?.remove(velocityArrow); velocityArrow = null; }
  if (velocityArrowLabel) { scene?.remove(velocityArrowLabel); velocityArrowLabel.material.map?.dispose(); velocityArrowLabel.material.dispose(); velocityArrowLabel = null; }
  if (arrowHeadHitSphere) { scene?.remove(arrowHeadHitSphere); arrowHeadHitSphere.geometry.dispose(); (arrowHeadHitSphere.material as THREE.Material).dispose(); arrowHeadHitSphere = null; }
  cameraGroups.forEach((g) => { scene?.remove(g); g.children.forEach((c) => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); } }); });
  cameraGroups = [];
  cameraLabels.forEach((l) => { scene?.remove(l); l.material.map?.dispose(); l.material.dispose(); });
  cameraLabels = [];
}

function animate(): void {
  requestAnimationFrame(animate);
  if (!renderer || !scene || !camera || !controls) return;

  if (animatingCamera) {
    animProgress += 1 / (60 * ANIM_DURATION);
    if (animProgress >= 1) {
      animProgress = 1;
      animatingCamera = false;
    }
    const t = smoothstep(animProgress);
    camera.position.lerpVectors(animStartPos, animTargetPos, t);
    controls!.target.set(0, 0, 0);
  }

  controls.update();
  updateSpriteScales();
  renderer.render(scene, camera);
}

function updateSpriteScales(): void {
  if (!camera) return;
  const refDist = 3;
  const camPos = camera.position;
  if (velocityArrowLabel) {
    const d = Math.max(0.1, camPos.distanceTo(velocityArrowLabel.position));
    const s = d / refDist;
    velocityArrowLabel.scale.set(0.9 * s, 0.225 * s, 1);
  }
  for (const lbl of cameraLabels) {
    const d = Math.max(0.1, camPos.distanceTo(lbl.position));
    const s = d / refDist;
    lbl.scale.set(0.6 * s, 0.15 * s, 1);
  }
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function setupPointerEvents(domElement: HTMLElement): void {
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
}

function onPointerDown(event: PointerEvent): void {
  if (!camera || !arrowHeadHitSphere || !scene) return;
  const rect = renderer!.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(arrowHeadHitSphere);
  if (hits.length > 0) {
    isDraggingArrow = true;
    controls!.enabled = false;
    dragStartLen = arrowHeadHitSphere.position.length();
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    dragPlane.setFromNormalAndCoplanarPoint(camDir, arrowHeadHitSphere.position);
    raycaster.setFromCamera(pointer, camera);
    raycaster.ray.intersectPlane(dragPlane, dragStartPoint);
    renderer!.domElement.style.cursor = 'grabbing';
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!isDraggingArrow || !camera || !scene) return;
  const rect = renderer!.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hitPoint = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return;

  // Relative movement from the initial click point, projected onto radial direction
  const delta = new THREE.Vector3().subVectors(hitPoint, dragStartPoint);
  const dir = hitPoint.clone().normalize();
  const radialDelta = delta.dot(dir);
  const newLen = Math.max(0.015, Math.min(3, dragStartLen + radialDelta));
  const vel = newLen / 0.15;

  velocityDirection.copy(dir);
  setVelocityDirXZ(dir.x, dir.z);
  if (velocityArrow) {
    scene.remove(velocityArrow);
    velocityArrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), newLen, 0xeab308, Math.max(newLen * 0.25, 0.002), Math.max(newLen * 0.12, 0.001));
    scene.add(velocityArrow);
  }
  arrowHeadHitSphere!.position.copy(dir.clone().multiplyScalar(newLen));
  if (velocityArrowLabel) {
    scene.remove(velocityArrowLabel);
    const lbl = makeTextSprite(`v = ${vel.toFixed(1)} m/s`, '#eab308');
    lbl.position.set(0, newLen + 0.03, 0);
    scene.add(lbl);
    velocityArrowLabel = lbl;
  }
}

function onPointerUp(_event: PointerEvent): void {
  if (!isDraggingArrow) return;
  isDraggingArrow = false;
  controls!.enabled = true;
  renderer!.domElement.style.cursor = 'default';
  const displayLen = arrowHeadHitSphere!.position.length();
  setTemporalVelocity(displayLen / 0.15);
  if (refreshCallback) refreshCallback();
}

export function setRefreshCallback(cb: () => void): void {
  refreshCallback = cb;
}

export function updateScene3d(app: AppStateFull): void {
  if (!scene) return;
  currentApp = app;

  cleanupSceneElements();
  buildSceneElements(app);
}

export function resizeScene3d(): void {
  if (!renderer || !camera) return;
  const canvas = renderer.domElement;
  const parent = canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const w = rect.width;
  const h = Math.max(200, Math.min(400, w * 0.45));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

export function disposeScene3d(): void {
  cleanupSceneElements();
  if (controls) { controls.dispose(); controls = null; }
  if (renderer) { renderer.dispose(); renderer = null; }
  scene = null;
  camera = null;
  currentApp = null;
}

export function animateCameraTo(pos: THREE.Vector3): void {
  if (!camera) return;
  animStartPos.copy(camera.position);
  animTargetPos.copy(pos);
  animProgress = 0;
  animatingCamera = true;
}

export function animateCameraToPos(x: number, y: number, z: number): void {
  animateCameraTo(new THREE.Vector3(x, y, z));
}

export function rebuildCameraViewButtons(count: number): void {
  cameraCount = count;
  const distance = currentApp?.state.distanceToSubject || 2;
  const positions = getCameraPositions(count, distance);
  const container = document.getElementById('sync-view-cam-container');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < positions.length; i++) {
    const btn = document.createElement('button');
    btn.className = 'text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700';
    btn.textContent = `Cam ${i + 1}`;
    btn.dataset.camIndex = String(i);
    btn.addEventListener('click', () => {
      const pos = getCameraWorldPosition(i, currentApp?.state.distanceToSubject || 2);
      animateCameraTo(pos);
    });
    container.appendChild(btn);
  }
}

export function getVelocityDirection(): THREE.Vector3 {
  return velocityDirection.clone();
}

export function resetVelocityDirection(): void {
  velocityDirection.set(1, 0, 0);
  setVelocityDirXZ(1, 0);
}

export function computeOverviewPosition(): THREE.Vector3 {
  if (!currentApp) return new THREE.Vector3(4, 3, 4);
  const distance = currentApp.state.distanceToSubject || 2;
  const count = getTemporalCameraCount();
  const camPositions = getCameraPositions(count, distance);
  if (camPositions.length === 0) return new THREE.Vector3(4, 3, 4);

  // Compute average XZ position of all cameras to find the cluster center
  let avgX = 0, avgZ = 0;
  for (const p of camPositions) { avgX += p.x; avgZ += p.z; }
  avgX /= camPositions.length;
  avgZ /= camPositions.length;

  // Face the overview from the opposite side of the camera cluster,
  // with elevation proportional to the cluster spread
  const avgMag = Math.sqrt(avgX * avgX + avgZ * avgZ);
  const viewDir = avgMag < 0.001
    ? new THREE.Vector3(1, 0.6, 1).normalize()
    : new THREE.Vector3(-avgX, 0.6 * distance, -avgZ).normalize();

  // Max perpendicular distance from the view direction to any camera
  let maxPerp = 0;
  for (const p of camPositions) {
    const pos = new THREE.Vector3(p.x, 0, p.z);
    const along = pos.dot(viewDir);
    const perp = Math.sqrt(Math.max(0, pos.lengthSq() - along * along));
    if (perp > maxPerp) maxPerp = perp;
  }

  // Account for origin objects (point cloud + arrow + label)
  const vel = getTemporalVelocity();
  const arrowExtent = Math.max(vel * 0.15, 0.015) + 0.03;
  maxPerp = Math.max(maxPerp, arrowExtent);

  const camFov = camera?.fov || 50;
  const halfAngle = (camFov * Math.PI) / 360;
  const requiredDist = maxPerp / Math.tan(halfAngle);
  return viewDir.multiplyScalar(requiredDist);
}

export function animateToOverview(): void {
  const pos = computeOverviewPosition();
  animateCameraTo(pos);
}

export function computeObjectPosition(): THREE.Vector3 {
  runAndCacheSimulation();
  const p95mm = getSyncErrorP95();
  const pcExtent = p95mm / 1000;
  const vel = getTemporalVelocity();
  const arrowLen = Math.max(vel * 0.15, 0.015);
  const arrowLabelDist = arrowLen + 0.03;
  const maxR = Math.max(pcExtent, arrowLabelDist);
  // View perpendicular to velocity direction so the point cloud spread is visible
  const velDir = velocityDirection.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(velDir.dot(up)) > 0.99) up.set(1, 0, 0);
  const viewDir = new THREE.Vector3().crossVectors(velDir, up).normalize();
  viewDir.add(new THREE.Vector3(0, 0.6, 0)).normalize();
  const camFov = camera?.fov || 50;
  const halfAngle = (camFov * Math.PI) / 360;
  const requiredDist = (maxR / Math.tan(halfAngle)) * 1.1;
  return viewDir.multiplyScalar(requiredDist);
}

export function animateToObject(): void {
  const pos = computeObjectPosition();
  animateCameraTo(pos);
}
