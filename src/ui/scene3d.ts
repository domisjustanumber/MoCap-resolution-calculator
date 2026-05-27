import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { AppStateFull } from '../types';
import {
  getTemporalCameraCount,
  getTemporalVelocity,
  setTemporalVelocity,
  setTemporalVelocityOnly,
  setSpatialVelocity,
  setVelocityDirXZ,
  getCameraAngles,
  getCameraHeight,
  getObjectSizeMm,
  getTemporalDistance,
  getTotalErrorP95,
  getCachedMaxErrors,
  getCachedMaxBlurs,
  runAndCacheSimulation,
  isLinkMode,
} from '../temporalState';

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let blurCloud: THREE.Group | null = null;
let objectSphere: THREE.Mesh | null = null;
let gridHelper: THREE.GridHelper | null = null;
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
let currentView: 'overview' | 'object' | 'camera' | null = null;

const ANIM_DURATION = 0.5;
const CAMERA_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

function getCameraPositions(count: number, distance: number): { x: number; y: number; z: number }[] {
  const h = getCameraHeight();
  const angles = getCameraAngles(count);
  return angles.map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: distance * Math.sin(rad), y: h, z: -distance * Math.cos(rad) };
  });
}

export function getCameraWorldPosition(index: number, distance: number): THREE.Vector3 {
  const count = cameraCount;
  const positions = getCameraPositions(count, distance);
  const clampedIndex = Math.min(index, positions.length - 1);
  const pos = positions[clampedIndex];
  // Slight offset so the camera model doesn't occlude the view
  return new THREE.Vector3(pos.x, pos.y + 0.15, pos.z);
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

function buildCameraGroup(index: number, pos: { x: number; y: number; z: number }): THREE.Group {
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

  group.position.set(pos.x, pos.y, pos.z);
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
  controls.minDistance = 0.001;
  controls.maxDistance = 100;
  controls.update();

  const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
  fillLight.position.set(-3, 1, -5);
  scene.add(fillLight);

  // Grid created in syncSceneWithState, but seed with a default so it exists early
  gridHelper = new THREE.GridHelper(4, 16, 0x1e293b, 0x1e293b);
  gridHelper.position.y = -0.5;
  scene.add(gridHelper);

  buildSceneElements(app);
  controls.maxDistance = computeSceneMaxDistance();
  setupPointerEvents(renderer.domElement);
  animate();
}

function buildBlurCloud(): THREE.Group | null {
  runAndCacheSimulation();
  const syncErrors = getCachedMaxErrors();
  const blurs = getCachedMaxBlurs();
  if (!syncErrors || !blurs) return null;
  const n = syncErrors.length;
  const dir = velocityDirection.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(dir.dot(up)) > 0.99) up.set(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const localUp = new THREE.Vector3().crossVectors(right, dir).normalize();

  // Sort sample indices by total error so we can split into opacity tiers
  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => (syncErrors[a] + blurs[a]) - (syncErrors[b] + blurs[b]));

  // 4 opacity tiers: core = most opaque (highest confidence), tail = most transparent
  const tiers = [
    { start: 0,            end: Math.floor(n * 0.4), opacity: 0.35, color: 0xcbd5e1 },
    { start: Math.floor(n * 0.4), end: Math.floor(n * 0.7), opacity: 0.22, color: 0x94a3b8 },
    { start: Math.floor(n * 0.7), end: Math.floor(n * 0.9), opacity: 0.12, color: 0x64748b },
    { start: Math.floor(n * 0.9), end: n,                   opacity: 0.05, color: 0x475569 },
  ];

  const group = new THREE.Group();

  for (const tier of tiers) {
    const count = tier.end - tier.start;
    if (count <= 0) continue;

    const positions: number[] = [];
    for (let j = 0; j < count; j++) {
      const i = indices[tier.start + j];
      const syncM = syncErrors[i] / 1000;
      const blurHalfM = (blurs[i] / 1000) / 2;

      const lateralMag = (syncM + blurHalfM * 2) * 0.25 * (0.5 + Math.random());
      const theta = Math.random() * Math.PI * 2;
      const center = new THREE.Vector3()
        .addScaledVector(dir, syncM)
        .addScaledVector(right, Math.cos(theta) * lateralMag)
        .addScaledVector(localUp, Math.sin(theta) * lateralMag);

      // Object physical extent: random scatter within object radius
      const objR = getObjectSizeMm() / 1000;
      const objTheta = Math.random() * Math.PI * 2;
      const objPhi = Math.acos(2 * Math.random() - 1);
      const objOffset = new THREE.Vector3(
        Math.sin(objPhi) * Math.cos(objTheta),
        Math.sin(objPhi) * Math.sin(objTheta),
        Math.cos(objPhi),
      ).multiplyScalar(objR * Math.random());

      const start = center.clone().add(objOffset).addScaledVector(dir, -blurHalfM);
      const end = center.clone().add(objOffset).addScaledVector(dir, blurHalfM);
      positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }

    const geo = new LineGeometry();
    geo.setPositions(positions);
    const mat = new LineMaterial({
      color: tier.color,
      linewidth: getObjectSizeMm() / 1000,  // matches object radius in world units
      transparent: true,
      opacity: tier.opacity,
      depthWrite: false,
      blending: THREE.NormalBlending,
      worldUnits: true,
    });
    group.add(new Line2(geo, mat));
  }

  return group;
}

function buildSceneElements(app: AppStateFull): void {
  if (!scene) return;
  cleanupSceneElements();

  const distance = getTemporalDistance();

  blurCloud = buildBlurCloud();
  if (blurCloud) {
    const showCloud = document.getElementById('sync-show-cloud') as HTMLInputElement | null;
    blurCloud.visible = showCloud ? showCloud.checked : true;
    scene.add(blurCloud);
  }

  // Tracked object sphere at origin
  const showObject = document.getElementById('sync-show-object') as HTMLInputElement | null;
  objectSphere = new THREE.Mesh(
    new THREE.SphereGeometry(getObjectSizeMm() / 1000, 16, 16),
    new THREE.MeshPhongMaterial({ color: 0x3b82f6, opacity: 0.7, transparent: true }),
  );
  objectSphere.visible = showObject ? showObject.checked : true;
  scene.add(objectSphere);

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
    lbl.position.set(positions[i].x, positions[i].y + 0.3, positions[i].z);
    scene.add(lbl);
    cameraLabels.push(lbl);
  }

  // Grid scales with camera distance
  const gridSize = Math.max(4, distance * 2.5);
  if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); }
  gridHelper = new THREE.GridHelper(gridSize, Math.round(gridSize * 4), 0x1e293b, 0x1e293b);
  gridHelper.position.y = -0.5;
  scene.add(gridHelper);
}

function cleanupSceneElements(): void {
  if (blurCloud) {
    scene?.remove(blurCloud);
    blurCloud.children.forEach(c => {
      const line = c as Line2;
      line.geometry?.dispose();
      line.material?.dispose();
    });
    blurCloud = null;
  }
  if (gridHelper) { scene?.remove(gridHelper); gridHelper.geometry.dispose(); gridHelper = null; }
  if (objectSphere) { scene?.remove(objectSphere); objectSphere.geometry.dispose(); (objectSphere.material as THREE.Material).dispose(); objectSphere = null; }
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

  // Dynamic near/far planes for depth precision at all zoom levels
  const dist = camera.position.distanceTo(controls.target);
  const newNear = Math.max(0.0001, dist * 0.001);
  const newFar = Math.max(10, dist * 100);
  if (camera.near !== newNear || camera.far !== newFar) {
    camera.near = newNear;
    camera.far = newFar;
    camera.updateProjectionMatrix();
  }

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
  const vel = displayLen / 0.15;
  if (isLinkMode()) {
    setTemporalVelocity(vel);
    setSpatialVelocity(vel);
  } else {
    setTemporalVelocityOnly(vel);
  }
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
  if (controls) controls.maxDistance = computeSceneMaxDistance();
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
  const distance = getTemporalDistance();
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
      currentView = 'camera';
      const pos = getCameraWorldPosition(i, getTemporalDistance());
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

export function toggleObjectSphere(show: boolean): void {
  if (objectSphere) objectSphere.visible = show;
}

export function toggleBlurCloud(show: boolean): void {
  if (blurCloud) blurCloud.visible = show;
}

function computeSceneMaxDistance(): number {
  if (!camera) return 50;
  const distance = getTemporalDistance();
  const count = getTemporalCameraCount();
  const camPositions = getCameraPositions(count, distance);
  const h = getCameraHeight();

  // Compute max perpendicular extent from origin for all scene objects
  let maxR = 0;
  for (const p of camPositions) {
    const r = Math.sqrt(p.x * p.x + (p.y - h) * (p.y - h) + p.z * p.z);
    if (r > maxR) maxR = r;
  }
  // Account for blur cloud extent
  const p95mm = getTotalErrorP95();
  maxR = Math.max(maxR, p95mm / 1000);
  // Account for velocity arrow
  const vel = getTemporalVelocity();
  maxR = Math.max(maxR, Math.max(vel * 0.15, 0.015) + 0.03);

  const halfAngle = (camera.fov * Math.PI) / 360;
  return maxR / Math.tan(halfAngle);
}

// Home view: point cloud + arrow + object, from a perpendicular elevated angle.
// Same framing as the old Object view — shows the full scene context.
export function computeOverviewPosition(): THREE.Vector3 {
  runAndCacheSimulation();
  const syncErrors = getCachedMaxErrors();
  const blurs = getCachedMaxBlurs();

  let maxSyncM = 0;
  let maxBlurM = 0;
  if (syncErrors && blurs) {
    for (let i = 0; i < syncErrors.length; i++) {
      const sm = syncErrors[i] / 1000;
      const bm = blurs[i] / 1000;
      if (sm > maxSyncM) maxSyncM = sm;
      if (bm > maxBlurM) maxBlurM = bm;
    }
  }
  const primaryExtent = maxSyncM + maxBlurM;
  const lateralExtent = primaryExtent * 0.25 * 1.5;
  const pcMaxR = Math.sqrt(primaryExtent * primaryExtent + lateralExtent * lateralExtent);

  const vel = getTemporalVelocity();
  const arrowLabelDist = Math.max(vel * 0.15, 0.015) + 0.03;
  const maxR = Math.max(pcMaxR, arrowLabelDist);

  const velDir = velocityDirection.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(velDir.dot(up)) > 0.99) up.set(1, 0, 0);
  const viewDir = new THREE.Vector3().crossVectors(velDir, up).normalize();
  viewDir.add(new THREE.Vector3(0, 0.6, 0)).normalize();
  const camFov = camera?.fov || 50;
  const halfAngle = (camFov * Math.PI) / 360;
  const requiredDist = (maxR / Math.tan(halfAngle)) * 1.05;
  return viewDir.multiplyScalar(requiredDist);
}

// Object view: tightly frames just the point cloud extent, no cameras.
export function computeObjectPosition(): THREE.Vector3 {
  runAndCacheSimulation();
  const syncErrors = getCachedMaxErrors();
  const blurs = getCachedMaxBlurs();

  let maxSyncM = 0;
  let maxBlurM = 0;
  if (syncErrors && blurs) {
    for (let i = 0; i < syncErrors.length; i++) {
      const sm = syncErrors[i] / 1000;
      const bm = blurs[i] / 1000;
      if (sm > maxSyncM) maxSyncM = sm;
      if (bm > maxBlurM) maxBlurM = bm;
    }
  }
  const primaryExtent = maxSyncM + maxBlurM + getObjectSizeMm() / 1000;
  const lateralExtent = primaryExtent * 0.25 * 1.5;
  const maxR = Math.sqrt(primaryExtent * primaryExtent + lateralExtent * lateralExtent);

  const velDir = velocityDirection.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(velDir.dot(up)) > 0.99) up.set(1, 0, 0);
  const viewDir = new THREE.Vector3().crossVectors(velDir, up).normalize();
  viewDir.add(new THREE.Vector3(0, 0.3, 0)).normalize();  // lower angle for tighter view
  const camFov = camera?.fov || 50;
  const halfAngle = (camFov * Math.PI) / 360;
  return viewDir.multiplyScalar(maxR / Math.tan(halfAngle));
}

export function animateToOverview(): void {
  currentView = 'overview';
  const pos = computeOverviewPosition();
  animateCameraTo(pos);
}

export function animateToObject(): void {
  currentView = 'object';
  const pos = computeObjectPosition();
  animateCameraTo(pos);
}

export function reapplyCurrentView(): void {
  if (currentView === 'overview') animateToOverview();
  else if (currentView === 'object') animateToObject();
}

