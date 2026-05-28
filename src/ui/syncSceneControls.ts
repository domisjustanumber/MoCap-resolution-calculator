import {
  getTemporalCameraCount,
  setTemporalCameraCount,
  isLinkMode,
  setTemporalVelocityOnly,
} from '../temporalState';
import {
  animateToOverview,
  animateToObject,
  rebuildCameraViewButtons,
  reapplyCurrentView,
  setRefreshCallback,
  resetVelocityDirection,
} from './scene3d';
import type { AppStateFull } from '../types';

const VELOCITY_VALUES: Record<string, number> = {
  static: 0,
  walking: 1.5,
  running: 8,
  agility: 1,
};

export function initSyncSceneControls(
  app: AppStateFull,
  refreshAll: () => void,
  refreshTemporalOnly: () => void,
): void {
  setRefreshCallback(() => {
    if (isLinkMode()) refreshAll();
    else refreshTemporalOnly();
  });

  const cameraCountSlider = document.getElementById('sync-camera-count') as HTMLInputElement | null;
  const cameraCountInput = document.getElementById('sync-camera-count-input') as HTMLInputElement | null;
  if (cameraCountSlider && cameraCountInput) {
    cameraCountSlider.value = String(getTemporalCameraCount());
    cameraCountInput.value = String(getTemporalCameraCount());
    const applyCount = (v: number) => {
      setTemporalCameraCount(v);
      rebuildCameraViewButtons(v);
      refreshAll();
      reapplyCurrentView();
    };
    cameraCountSlider.addEventListener('input', () => {
      const v = parseInt(cameraCountSlider.value, 10);
      if (cameraCountInput !== document.activeElement) cameraCountInput.value = String(v);
      applyCount(v);
    });
    cameraCountInput.addEventListener('input', () => {
      const v = parseInt(cameraCountInput.value, 10);
      if (isNaN(v)) return;
      const clamped = Math.max(1, Math.min(6, v));
      if (cameraCountSlider !== document.activeElement) cameraCountSlider.value = String(clamped);
      applyCount(clamped);
    });
  }

  const overviewBtn = document.getElementById('sync-view-overview');
  if (overviewBtn) {
    overviewBtn.addEventListener('click', () => {
      animateToOverview();
    });
  }

  const objectBtn = document.getElementById('sync-view-object');
  if (objectBtn) {
    objectBtn.addEventListener('click', () => {
      animateToObject();
    });
  }

  rebuildCameraViewButtons(getTemporalCameraCount());

  // Velocity preset buttons inside the sync tab.  Capture phase so the
  // unlinked check runs before the motion-controls bubble handler.
  const temporalPanel = document.getElementById('panel-temporal');
  if (temporalPanel) {
    temporalPanel.querySelectorAll('.vel-preset').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (!isLinkMode()) {
          const preset = (el as HTMLButtonElement).dataset.velocity;
          if (preset && VELOCITY_VALUES[preset] !== undefined) {
            setTemporalVelocityOnly(VELOCITY_VALUES[preset]);
            resetVelocityDirection();
            refreshTemporalOnly();
            e.stopImmediatePropagation();
            return;
          }
        }
        // Linked mode: let the motion-controls handler do the full refresh.
        // Don't reset the arrow direction — the user's angle is preserved.
      }, { capture: true });
    });
  }
}
