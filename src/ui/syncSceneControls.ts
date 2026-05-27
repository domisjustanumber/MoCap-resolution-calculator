import {
  getTemporalCameraCount,
  setTemporalCameraCount,
} from '../temporalState';
import {
  animateToOverview,
  animateToObject,
  rebuildCameraViewButtons,
  setRefreshCallback,
  resetVelocityDirection,
} from './scene3d';
import type { AppStateFull } from '../types';

export function initSyncSceneControls(app: AppStateFull, refreshAll: () => void): void {
  setRefreshCallback(refreshAll);

  const cameraCountSlider = document.getElementById('sync-camera-count') as HTMLInputElement | null;
  const cameraCountLabel = document.getElementById('sync-camera-count-label');
  if (cameraCountSlider && cameraCountLabel) {
    cameraCountSlider.value = String(getTemporalCameraCount());
    cameraCountLabel.textContent = String(getTemporalCameraCount());
    cameraCountSlider.addEventListener('input', () => {
      const v = parseInt(cameraCountSlider.value, 10);
      setTemporalCameraCount(v);
      cameraCountLabel.textContent = String(v);
      rebuildCameraViewButtons(v);
      refreshAll();
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

  document.querySelectorAll('.vel-preset').forEach((el) => {
    el.addEventListener('click', () => {
      resetVelocityDirection();
    });
  });
}
