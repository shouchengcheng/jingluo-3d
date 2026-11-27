import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraPreset, PickCandidate, Vec3Tuple } from '../types/atlas';
import type { SurfaceCalibrationPayload } from '../store/useAtlasStore';

export interface PickableMarkerMeta {
  code: string;
  side: 1 | -1;
  bilateral: boolean;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  visible: boolean;
}

export type SelectGesture = 'click' | 'double';

export interface RaycasterPickerCallbacks {
  getPickableMarkers: () => PickableMarkerMeta[];
  getSkinMeshes: () => THREE.Mesh[];
  isSurfaceCalibrationActive: () => boolean;
  isQuizLocateActive: () => boolean;
  getSelectedBilateralFlag: () => boolean;
  onHoverAcupoint: (hit: { code: string; side: 1 | -1; x: number; y: number } | null) => void;
  onSelectAcupoint: (code: string, side: 1 | -1, gesture: SelectGesture) => void;
  onAmbiguousPick: (candidates: PickCandidate[], x: number, y: number) => void;
  onSurfacePick: (payload: SurfaceCalibrationPayload, side: 1 | -1) => void;
  onQuizSurfaceClick: (point: Vec3Tuple) => void;
  onInteractionChange: (active: boolean) => void;
}

interface CameraFlight {
  startTime: number;
  durationMs: number;
  startCamPos: THREE.Vector3;
  endCamPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
}

interface ScreenCandidate {
  code: string;
  side: 1 | -1;
  distPx: number;
  worldPos: THREE.Vector3;
}

/** Screen-space pick radius: generous on touch (UI audit 8.3), precise on mouse. */
const PICK_RADIUS_TOUCH_PX = 24;
const PICK_RADIUS_MOUSE_PX = 11;
const DOUBLE_TAP_MS = 340;
const AMBIGUITY_GAP_PX = 9;

function roundVec(v: THREE.Vector3, decimals: number): Vec3Tuple {
  const f = 10 ** decimals;
  return [
    Math.round(v.x * f) / f,
    Math.round(v.y * f) / f,
    Math.round(v.z * f) / f,
  ];
}

/**
 * Pure Three.js picking & smooth camera interpolation controller (ARCHITECTURE.md Section 4).
 * Uses screen-space proximity picking (touch-friendly), separates single-click "select" from
 * double-click / double-tap "focus", and handles DEV surface calibration & quiz locate clicks.
 */
export class RaycasterPicker {
  private readonly domElement: HTMLElement;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly callbacks: RaycasterPickerCallbacks;
  private readonly raycaster = new THREE.Raycaster();
  private readonly occlusionRay = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private pointerDownPos: [number, number] | null = null;
  private lastTap: { code: string; time: number; x: number; y: number } | null = null;
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

    this.controls.addEventListener('start', this.handleControlsStart);
    this.controls.addEventListener('end', this.handleControlsEnd);
    this.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.domElement.addEventListener('pointerleave', this.handlePointerLeave);
  }

  public flyTo(preset: CameraPreset, side: 1 | -1 = 1, durationMs = 620): void {
    this.flyToPose(
      new THREE.Vector3(preset.position[0] * side, preset.position[1], preset.position[2]),
      new THREE.Vector3(preset.target[0] * side, preset.target[1], preset.target[2]),
      durationMs,
    );
  }

  public flyToPose(camPos: THREE.Vector3, target: THREE.Vector3, durationMs = 560): void {
    this.flight = {
      startTime: performance.now(),
      durationMs,
      startCamPos: this.camera.position.clone(),
      endCamPos: camPos.clone(),
      startTarget: this.controls.target.clone(),
      endTarget: target.clone(),
    };
  }

  public update(nowMs: number): void {
    if (!this.flight) return;
    const elapsed = nowMs - this.flight.startTime;
    const t = Math.min(1, Math.max(0, elapsed / this.flight.durationMs));
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    this.camera.position.lerpVectors(this.flight.startCamPos, this.flight.endCamPos, ease);
    this.controls.target.lerpVectors(this.flight.startTarget, this.flight.endTarget, ease);

    if (t >= 1) {
      this.flight = null;
    }
  }

  public isFlying(): boolean {
    return this.flight !== null;
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

  private readonly handleControlsStart = (): void => {
    this.flight = null;
    this.callbacks.onInteractionChange(true);
  };

  private readonly handleControlsEnd = (): void => {
    this.callbacks.onInteractionChange(false);
  };

  private localXY(event: PointerEvent): [number, number] {
    const rect = this.domElement.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  private updateNormalizedPointer(event: PointerEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    this.pointer.x = ((event.clientX - rect.left) / width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / height) * 2 + 1;
  }

  /** Front-facing, non-occluded markers within `radiusPx` of the pointer, nearest first. */
  private screenCandidates(x: number, y: number, radiusPx: number): ScreenCandidate[] {
    const rect = this.domElement.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    const near: ScreenCandidate[] = [];

    for (const m of this.callbacks.getPickableMarkers()) {
      if (!m.visible) continue;
      this.tmp.copy(m.position).project(this.camera);
      if (this.tmp.z < -1 || this.tmp.z > 1) continue;
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - x, sy - y);
      if (d > radiusPx) continue;
      this.tmp2.copy(this.camera.position).sub(m.position);
      if (this.tmp2.dot(m.normal) < 0) continue; // back-facing
      near.push({ code: m.code, side: m.side, distPx: d, worldPos: m.position });
    }
    near.sort((a, b) => a.distPx - b.distPx);

    const skins = this.callbacks.getSkinMeshes();
    if (skins.length === 0) return near;
    const visible: ScreenCandidate[] = [];
    for (const c of near) {
      this.tmp2.copy(c.worldPos).sub(this.camera.position);
      const dist = this.tmp2.length();
      this.occlusionRay.set(this.camera.position, this.tmp2.normalize());
      this.occlusionRay.far = dist;
      const hit = this.occlusionRay.intersectObjects(skins, false)[0];
      if (hit && hit.distance < dist - 0.012) continue;
      visible.push(c);
      if (visible.length >= 4) break;
    }
    return visible;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDownPos = [event.clientX, event.clientY];
  };

  private readonly handlePointerLeave = (): void => {
    this.callbacks.onHoverAcupoint(null);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    if (event.buttons !== 0) {
      this.callbacks.onHoverAcupoint(null);
      return;
    }

    if (this.callbacks.isSurfaceCalibrationActive() || this.callbacks.isQuizLocateActive()) {
      this.updateNormalizedPointer(event);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const skinHits = this.raycaster.intersectObjects(this.callbacks.getSkinMeshes(), false);
      this.domElement.style.cursor = skinHits.length > 0 ? 'crosshair' : '';
      this.callbacks.onHoverAcupoint(null);
      return;
    }

    const [x, y] = this.localXY(event);
    const best = this.screenCandidates(x, y, PICK_RADIUS_MOUSE_PX)[0];
    if (best) {
      this.domElement.style.cursor = 'pointer';
      this.callbacks.onHoverAcupoint({ code: best.code, side: best.side, x, y });
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

    // 2. Quiz "看名找穴" — report the clicked skin point
    if (this.callbacks.isQuizLocateActive()) {
      const hit = this.raycaster.intersectObjects(this.callbacks.getSkinMeshes(), false)[0];
      if (hit) this.callbacks.onQuizSurfaceClick(roundVec(hit.point, 5));
      return;
    }

    // 3. Screen-space acupoint picking
    const isTouch = event.pointerType !== 'mouse';
    const [x, y] = this.localXY(event);
    const cands = this.screenCandidates(x, y, isTouch ? PICK_RADIUS_TOUCH_PX : PICK_RADIUS_MOUSE_PX);
    if (cands.length === 0) {
      this.lastTap = null;
      return;
    }

    const distinct: ScreenCandidate[] = [];
    for (const c of cands) {
      if (!distinct.some((d) => d.code === c.code && d.side === c.side)) distinct.push(c);
    }
    if (
      isTouch &&
      distinct.length > 1 &&
      distinct[1].distPx - distinct[0].distPx < AMBIGUITY_GAP_PX
    ) {
      this.lastTap = null;
      this.callbacks.onAmbiguousPick(
        distinct.slice(0, 4).map((c) => ({ code: c.code, side: c.side })),
        x,
        y,
      );
      return;
    }

    const best = distinct[0];
    const now = performance.now();
    const isDouble =
      this.lastTap !== null &&
      this.lastTap.code === best.code &&
      now - this.lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(this.lastTap.x - x, this.lastTap.y - y) < 24;
    this.lastTap = isDouble ? null : { code: best.code, time: now, x, y };
    this.callbacks.onSelectAcupoint(best.code, best.side, isDouble ? 'double' : 'click');
  };

  public dispose(): void {
    this.controls.removeEventListener('start', this.handleControlsStart);
    this.controls.removeEventListener('end', this.handleControlsEnd);
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.domElement.removeEventListener('pointerleave', this.handlePointerLeave);
    this.domElement.style.cursor = '';
  }
}
