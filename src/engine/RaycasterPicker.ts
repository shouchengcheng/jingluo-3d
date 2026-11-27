import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraPreset, Vec3Tuple } from '../types/atlas';
import type { SurfaceCalibrationPayload } from '../store/useAtlasStore';

export interface PickableMarkerMeta {
  code: string;
  side: 1 | -1;
  bilateral: boolean;
  hitbox: THREE.Mesh;
}

export interface RaycasterPickerCallbacks {
  getPickableMarkers: () => PickableMarkerMeta[];
  getSkinMeshes: () => THREE.Mesh[];
  isSurfaceCalibrationActive: () => boolean;
  getSelectedBilateralFlag: () => boolean;
  onHoverAcupoint: (code: string | null) => void;
  onSelectAcupoint: (code: string, side: 1 | -1) => void;
  onSurfacePick: (payload: SurfaceCalibrationPayload, side: 1 | -1) => void;
}

interface CameraFlight {
  startTime: number;
  durationMs: number;
  startCamPos: THREE.Vector3;
  endCamPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
}

function roundVec(v: THREE.Vector3, decimals: number): Vec3Tuple {
  const f = 10 ** decimals;
  return [
    Math.round(v.x * f) / f,
    Math.round(v.y * f) / f,
    Math.round(v.z * f) / f,
  ];
}

/**
 * Pure Three.js Raycaster & smooth camera interpolation controller (ARCHITECTURE.md Section 4).
 * Handles touch-friendly enlarged hitboxes, DEV surface calibration picking, and smooth fly-to transitions.
 */
export class RaycasterPicker {
  private readonly domElement: HTMLElement;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly callbacks: RaycasterPickerCallbacks;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDownPos: [number, number] | null = null;
  private flight: CameraFlight | null = null;

  constructor(
    domElement: HTMLElement,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    callbacks: RaycasterPickerCallbacks,
  ) {
    this.domElement = domElement;
    this.camera = camera;
    this.controls = controls;
    this.callbacks = callbacks;

    this.controls.addEventListener('start', this.cancelFlight);
    this.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.domElement.addEventListener('pointerup', this.handlePointerUp);
  }

  public flyTo(preset: CameraPreset, side: 1 | -1 = 1, durationMs = 620): void {
    const endCamPos = new THREE.Vector3(
      preset.position[0] * side,
      preset.position[1],
      preset.position[2],
    );
    const endTarget = new THREE.Vector3(
      preset.target[0] * side,
      preset.target[1],
      preset.target[2],
    );

    this.flight = {
      startTime: performance.now(),
      durationMs,
      startCamPos: this.camera.position.clone(),
      endCamPos,
      startTarget: this.controls.target.clone(),
      endTarget,
    };
  }

  public update(nowMs: number): void {
    if (!this.flight) return;
    const elapsed = nowMs - this.flight.startTime;
    const t = Math.min(1, Math.max(0, elapsed / this.flight.durationMs));
    const ease = 1 - Math.pow(1 - t, 3);

    this.camera.position.lerpVectors(this.flight.startCamPos, this.flight.endCamPos, ease);
    this.controls.target.lerpVectors(this.flight.startTarget, this.flight.endTarget, ease);

    if (t >= 1) {
      this.flight = null;
    }
  }

  public getCurrentCanonicalCameraPreset(activeSide: 1 | -1): CameraPreset {
    const camCanonical = new THREE.Vector3(
      this.camera.position.x * activeSide,
      this.camera.position.y,
      this.camera.position.z,
    );
    const targetCanonical = new THREE.Vector3(
      this.controls.target.x * activeSide,
      this.controls.target.y,
      this.controls.target.z,
    );
    return {
      position: roundVec(camCanonical, 4),
      target: roundVec(targetCanonical, 4),
    };
  }

  private readonly cancelFlight = (): void => {
    this.flight = null;
  };

  private updateNormalizedPointer(event: PointerEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    this.pointer.x = ((event.clientX - rect.left) / width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / height) * 2 + 1;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDownPos = [event.clientX, event.clientY];
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.updateNormalizedPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.callbacks.isSurfaceCalibrationActive()) {
      const skinHits = this.raycaster.intersectObjects(this.callbacks.getSkinMeshes(), false);
      this.domElement.style.cursor = skinHits.length > 0 ? 'crosshair' : '';
      this.callbacks.onHoverAcupoint(null);
      return;
    }

    const pickables = this.callbacks.getPickableMarkers();
    const hitboxes = pickables.filter((m) => m.hitbox.visible).map((m) => m.hitbox);
    const hits = this.raycaster.intersectObjects(hitboxes, false);

    if (hits.length > 0) {
      const code = hits[0].object.userData.code as string | undefined;
      this.domElement.style.cursor = 'pointer';
      this.callbacks.onHoverAcupoint(code ?? null);
    } else {
      this.domElement.style.cursor = '';
      this.callbacks.onHoverAcupoint(null);
    }
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.pointerDownPos) return;
    const dist = Math.hypot(
      event.clientX - this.pointerDownPos[0],
      event.clientY - this.pointerDownPos[1],
    );
    this.pointerDownPos = null;
    if (dist > 6) return;

    this.updateNormalizedPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // 1. DEV 3D Surface Re-picking Calibration Mode
    if (this.callbacks.isSurfaceCalibrationActive()) {
      const skinHits = this.raycaster.intersectObjects(this.callbacks.getSkinMeshes(), false);
      const hit = skinHits[0];
      if (hit && hit.face) {
        const worldPoint = hit.point.clone();
        const worldNormal = hit.face.normal
          .clone()
          .transformDirection(hit.object.matrixWorld)
          .normalize();

        // Ensure normal faces outward toward camera
        const toCam = this.camera.position.clone().sub(worldPoint);
        if (worldNormal.dot(toCam) < 0) {
          worldNormal.negate();
        }

        const isBilateral = this.callbacks.getSelectedBilateralFlag();
        // Canonical coordinates store right side (+X) for bilateral points, or X=0 midline for CV/GV
        const clickedSide: 1 | -1 = isBilateral && worldPoint.x < 0 ? -1 : 1;

        const canonicalPos = new THREE.Vector3(
          isBilateral ? Math.abs(worldPoint.x) : 0,
          worldPoint.y,
          worldPoint.z,
        );
        const canonicalNormal = new THREE.Vector3(
          isBilateral ? worldNormal.x * clickedSide : 0,
          worldNormal.y,
          worldNormal.z,
        ).normalize();

        const camCanonicalPos = new THREE.Vector3(
          this.camera.position.x * clickedSide,
          this.camera.position.y,
          this.camera.position.z,
        );

        this.callbacks.onSurfacePick(
          {
            position: roundVec(canonicalPos, 5),
            normal: roundVec(canonicalNormal, 5),
            cameraPreset: {
              position: roundVec(camCanonicalPos, 4),
              target: roundVec(canonicalPos, 4),
            },
          },
          clickedSide,
        );
        return;
      }
    }

    // 2. Standard Acupoint Marker Picking
    const pickables = this.callbacks.getPickableMarkers();
    const hitboxes = pickables.filter((m) => m.hitbox.visible).map((m) => m.hitbox);
    const hits = this.raycaster.intersectObjects(hitboxes, false);
    if (hits.length > 0) {
      const hitObj = hits[0].object;
      const code = hitObj.userData.code as string | undefined;
      const side = (hitObj.userData.side as 1 | -1 | undefined) ?? 1;
      if (code) {
        this.callbacks.onSelectAcupoint(code, side);
      }
    }
  };

  public dispose(): void {
    this.controls.removeEventListener('start', this.cancelFlight);
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.domElement.style.cursor = '';
  }
}
