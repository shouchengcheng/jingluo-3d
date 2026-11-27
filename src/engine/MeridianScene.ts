import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetLoader } from './AssetLoader';
import { RaycasterPicker, type PickableMarkerMeta } from './RaycasterPicker';
import { useAtlasStore, type AtlasState } from '../store/useAtlasStore';
import type {
  Acupoint,
  AcupointCoordinate3D,
  AuditStatus,
  MeridianCode,
  MeridianMeta,
  ProjectedLabel,
  ViewPreset,
} from '../types/atlas';

/** ARCHITECTURE.md Section 6.1: Offset marker 0.0015m along surface normal to eliminate Z-fighting */
const MARKER_NORMAL_OFFSET = 0.0015;
/** Meridian tube surface offset slightly above skin */
const TUBE_NORMAL_OFFSET = 0.0024;

interface MarkerInstance {
  code: string;
  name: string;
  meridianCode: MeridianCode;
  meridianColor: string;
  order: number;
  side: 1 | -1;
  bilateral: boolean;
  auditStatus: AuditStatus;
  surfacePos: THREE.Vector3;
  worldNormal: THREE.Vector3;
  visualMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  hitboxMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

interface MeridianTubeInstance {
  meridianCode: MeridianCode;
  side: 1 | -1;
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  curve: THREE.CatmullRomCurve3;
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
}

interface QiParticleInstance {
  meridianCode: MeridianCode;
  side: 1 | -1;
  curve: THREE.CatmullRomCurve3;
  offset: number;
  sprite: THREE.Sprite;
}

export interface MeridianSceneOptions {
  onLabelsUpdate?: (labels: ProjectedLabel[]) => void;
}

function parsePointNumber(code: string): number {
  const m = code.match(/\d+$/);
  return m ? Number.parseInt(m[0], 10) : 0;
}

function matchesFilter(acupoint: Acupoint | undefined, code: string, state: AtlasState): boolean {
  if (state.specialFilter) {
    if (!acupoint) return false;
    const matchedSpecial = acupoint.specialCategory.some((cat) =>
      cat.includes(state.specialFilter ?? ''),
    );
    if (!matchedSpecial) return false;
  }

  const q = state.searchQuery.trim().toLowerCase();
  if (!q) return true;
  if (!acupoint) {
    return code.toLowerCase().includes(q);
  }

  const haystack = [
    acupoint.code,
    acupoint.name,
    acupoint.pinyin,
    ...acupoint.specialCategory,
    ...acupoint.clinical.indications,
    acupoint.clinical.functions,
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(q);
}

/**
 * Pure Three.js scene engine isolated from React lifecycle (ARCHITECTURE.md Principle 3 & AGENTS.md Rule 1.2).
 */
export class MeridianScene {
  private readonly container: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly picker: RaycasterPicker;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribeStore: () => void;
  private readonly onLabelsUpdate?: (labels: ProjectedLabel[]) => void;

  private readonly markerGroup = new THREE.Group();
  private readonly tubeGroup = new THREE.Group();
  private readonly particleGroup = new THREE.Group();
  private readonly reticleGroup = new THREE.Group();
  private innerReticle!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private outerReticle!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private needleGroup!: THREE.Group;

  private readonly sharedVisualSphere = new THREE.SphereGeometry(0.0042, 16, 12);
  private readonly sharedHitboxSphere = new THREE.SphereGeometry(0.018, 10, 8);
  private readonly sharedHitboxMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private glowTexture: THREE.CanvasTexture | null = null;

  private skinMeshes: THREE.Mesh[] = [];
  private skinMaterials: THREE.MeshPhysicalMaterial[] = [];
  private wireframeMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];

  private markers: MarkerInstance[] = [];
  private tubes: MeridianTubeInstance[] = [];
  private qiParticles: QiParticleInstance[] = [];

  private hoveredCode: string | null = null;
  private lastViewNonce = 0;
  private lastFocusNonce = 0;
  private lastLabelEmitMs = 0;
  private rafId: number | null = null;
  private disposed = false;

  private readonly occlusionRaycaster = new THREE.Raycaster();
  private readonly tmpProj = new THREE.Vector3();
  private readonly tmpToCam = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  constructor(container: HTMLElement, options?: MeridianSceneOptions) {
    this.container = container;
    this.onLabelsUpdate = options?.onLabelsUpdate;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070d19);

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.03, 50);
    this.camera.position.set(0, 0.98, 2.75);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    // AGENTS.md Rule 4.2: Cap pixel ratio <= 2 for mobile performance
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 0.28;
    this.controls.maxDistance = 5.2;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = Math.PI - 0.05;
    this.controls.target.set(0, 0.9, 0);
    this.controls.update();

    this.glowTexture = this.createRadialGlowTexture();
    this.setupLightsAndPedestal();
    this.setupSelectionReticle();

    this.scene.add(this.tubeGroup, this.particleGroup, this.markerGroup, this.reticleGroup);

    this.picker = new RaycasterPicker(this.renderer.domElement, this.camera, this.controls, {
      getPickableMarkers: (): PickableMarkerMeta[] =>
        this.markers.map((m) => ({
          code: m.code,
          side: m.side,
          bilateral: m.bilateral,
          hitbox: m.hitboxMesh,
        })),
      getSkinMeshes: () => this.skinMeshes,
      isSurfaceCalibrationActive: () => {
        const s = useAtlasStore.getState();
        return Boolean(import.meta.env.DEV && s.auditMode && s.surfacePickArmed && s.selectedAcupointId);
      },
      getSelectedBilateralFlag: () => {
        const s = useAtlasStore.getState();
        if (!s.selectedAcupointId) return true;
        const prefix = s.selectedAcupointId.replace(/\d+$/, '');
        return prefix !== 'CV' && prefix !== 'GV';
      },
      onHoverAcupoint: (code) => {
        this.hoveredCode = code;
      },
      onSelectAcupoint: (code, side) => {
        useAtlasStore.getState().selectAcupoint(code, { focus: true, side });
      },
      onSurfacePick: (payload, side) => {
        const s = useAtlasStore.getState();
        if (!s.selectedAcupointId) return;
        s.applySurfaceCalibration(s.selectedAcupointId, payload);
        s.selectAcupoint(s.selectedAcupointId, { focus: false, side });
      },
    });

    useAtlasStore.getState().registerLiveCameraGetter(() => {
      const side = useAtlasStore.getState().activeSide;
      return this.picker.getCurrentCanonicalCameraPreset(side);
    });

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.handleResize);

    this.unsubscribeStore = useAtlasStore.subscribe((state, prevState) => {
      this.onStoreChanged(state, prevState);
    });

    void this.initializeAssets();
    this.animate(performance.now());
  }

  private createRadialGlowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.32, 'rgba(255,255,255,0.75)');
      grad.addColorStop(0.7, 'rgba(255,255,255,0.18)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private setupLightsAndPedestal(): void {
    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 1.15);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.65);
    keyLight.position.set(-1.8, 2.6, 2.2);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.15);
    rimLight.position.set(2.0, 1.8, -2.0);
    this.scene.add(rimLight);

    const backFill = new THREE.DirectionalLight(0x93c5fd, 0.75);
    backFill.position.set(-1.5, 1.2, -2.2);
    this.scene.add(backFill);

    // Subtle anatomical standing ring pedestal at y = 0
    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.395, 72),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35,
      }),
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = 0.001;
    this.scene.add(outerRing);

    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.246, 64),
      new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.22,
      }),
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.001;
    this.scene.add(innerRing);
  }

  private setupSelectionReticle(): void {
    this.innerReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.0068, 0.008, 48),
      new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );

    this.outerReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.0095, 0.0105, 48),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
      }),
    );

    this.needleGroup = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.00025, 0.0008, 0.042, 10),
      new THREE.MeshBasicMaterial({
        color: 0xfde68a,
        transparent: true,
        opacity: 0.85,
      }),
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.025;

    const handleTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.0018, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfef3c7 }),
    );
    handleTip.position.z = 0.047;

    this.needleGroup.add(shaft, handleTip);
    this.reticleGroup.add(this.innerReticle, this.outerReticle, this.needleGroup);
    this.reticleGroup.renderOrder = 10;
    this.reticleGroup.visible = false;
  }

  private async initializeAssets(): Promise<void> {
    try {
      const [gltf, bundle] = await Promise.all([
        assetLoader.loadHumanBodyModel(),
        assetLoader.loadAtlasBundle(),
      ]);
      if (this.disposed) return;

      const loadedMeshes: THREE.Mesh[] = [];
      gltf.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          loadedMeshes.push(obj);
        }
      });

      for (const obj of loadedMeshes) {
        const isEye =
          (obj.material instanceof THREE.Material && obj.material.name === 'EyeMaterial') ||
          obj.name.toLowerCase().includes('eye');

        if (isEye) {
          const eyeMat = new THREE.MeshPhysicalMaterial({
            color: 0xe2e8f0,
            roughness: 0.3,
            metalness: 0.0,
          });
          obj.material = eyeMat;
        } else {
          const skinMat = new THREE.MeshPhysicalMaterial({
            color: 0x1e3a4c,
            emissive: 0x071521,
            emissiveIntensity: 0.45,
            roughness: 0.46,
            metalness: 0.06,
            clearcoat: 0.2,
            clearcoatRoughness: 0.45,
            sheen: 0.55,
            sheenColor: new THREE.Color(0x7dd3fc),
            transparent: true,
            opacity: useAtlasStore.getState().bodyOpacity,
          });
          obj.material = skinMat;
          this.skinMeshes.push(obj);
          this.skinMaterials.push(skinMat);

          const wireMat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            wireframe: true,
            transparent: true,
            opacity: 0.08,
            depthWrite: false,
          });
          const wireMesh = new THREE.Mesh(obj.geometry, wireMat);
          wireMesh.visible = useAtlasStore.getState().wireframeOverlay;
          obj.add(wireMesh);
          this.wireframeMeshes.push(wireMesh);
        }
      }

      this.scene.add(gltf.scene);
      this.scene.updateMatrixWorld(true);

      useAtlasStore.getState().setAtlasBundle(bundle);
      this.rebuildAcupointsAndMeridians(useAtlasStore.getState());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useAtlasStore.getState().setLoadError(msg);
    }
  }

  private onStoreChanged(state: AtlasState, prevState: AtlasState): void {
    if (state.bodyOpacity !== prevState.bodyOpacity) {
      for (const mat of this.skinMaterials) {
        mat.opacity = state.bodyOpacity;
        mat.depthWrite = state.bodyOpacity > 0.88;
        mat.needsUpdate = true;
      }
    }

    if (state.wireframeOverlay !== prevState.wireframeOverlay) {
      for (const wm of this.wireframeMeshes) {
        wm.visible = state.wireframeOverlay;
      }
    }

    if (
      state.coordinates !== prevState.coordinates ||
      state.meridians !== prevState.meridians ||
      state.acupoints !== prevState.acupoints
    ) {
      this.rebuildAcupointsAndMeridians(state);
    } else {
      this.syncVisibilityAndColors(state);
    }

    if (state.viewRequest && state.viewRequest.nonce !== this.lastViewNonce) {
      this.lastViewNonce = state.viewRequest.nonce;
      this.applyViewPreset(state.viewRequest.preset);
    }

    if (state.focusNonce !== this.lastFocusNonce) {
      this.lastFocusNonce = state.focusNonce;
      this.focusSelectedAcupoint(state);
    }
  }

  private applyViewPreset(preset: ViewPreset): void {
    const d = 2.75;
    const target: [number, number, number] = [0, 0.9, 0];
    let pos: [number, number, number] = [0, 0.98, d];
    if (preset === 'back') pos = [0, 0.98, -d];
    else if (preset === 'right') pos = [d, 0.98, 0];
    else if (preset === 'left') pos = [-d, 0.98, 0];
    this.picker.flyTo({ position: pos, target }, 1, 580);
  }

  private focusSelectedAcupoint(state: AtlasState): void {
    if (!state.selectedAcupointId || !state.coordinates) return;
    const coord = state.coordinates.points[state.selectedAcupointId];
    if (!coord) return;
    const prefix = state.selectedAcupointId.replace(/\d+$/, '');
    const bilateral = prefix !== 'CV' && prefix !== 'GV';
    const side: 1 | -1 = bilateral ? state.activeSide : 1;
    this.picker.flyTo(coord.cameraPreset, side, 620);
  }

  private clearDynamicGroups(): void {
    // AGENTS.md Rule 4.1: Explicitly dispose materials and geometries to prevent WebGL memory leaks
    for (const m of this.markers) {
      m.visualMesh.material.dispose();
      this.markerGroup.remove(m.visualMesh, m.hitboxMesh);
    }
    this.markers = [];

    for (const t of this.tubes) {
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      this.tubeGroup.remove(t.mesh);
    }
    this.tubes = [];

    for (const p of this.qiParticles) {
      p.sprite.material.dispose();
      this.particleGroup.remove(p.sprite);
    }
    this.qiParticles = [];
  }

  private rebuildAcupointsAndMeridians(state: AtlasState): void {
    this.clearDynamicGroups();
    if (!state.coordinates) return;

    const meridianMap = new Map<MeridianCode, MeridianMeta>(
      state.meridians.map((m) => [m.code, m]),
    );
    const acupointMap = new Map<string, Acupoint>(state.acupoints.map((a) => [a.code, a]));

    // 1. Build Markers with 0.0015m normal offset + enlarged mobile touch hitboxes
    for (const [code, coord] of Object.entries(state.coordinates.points) as [
      string,
      AcupointCoordinate3D,
    ][]) {
      const prefix = code.replace(/\d+$/, '') as MeridianCode;
      const meta = meridianMap.get(prefix);
      if (!meta) continue;

      const acupoint = acupointMap.get(code);
      const bilateral = meta.bilateral;
      const sides: (1 | -1)[] = bilateral ? [1, -1] : [1];
      const order = parsePointNumber(code);

      for (const side of sides) {
        const surfacePos = new THREE.Vector3(
          coord.position[0] * side,
          coord.position[1],
          coord.position[2],
        );
        const worldNormal = new THREE.Vector3(
          coord.normal[0] * side,
          coord.normal[1],
          coord.normal[2],
        ).normalize();

        const markerWorldPos = surfacePos
          .clone()
          .addScaledVector(worldNormal, MARKER_NORMAL_OFFSET);

        const visualMat = new THREE.MeshBasicMaterial({ color: meta.color });
        const visualMesh = new THREE.Mesh(this.sharedVisualSphere, visualMat);
        visualMesh.position.copy(markerWorldPos);

        const hitboxMesh = new THREE.Mesh(this.sharedHitboxSphere, this.sharedHitboxMaterial);
        hitboxMesh.position.copy(markerWorldPos);
        hitboxMesh.userData = { code, side };

        this.markerGroup.add(visualMesh, hitboxMesh);

        this.markers.push({
          code,
          name: acupoint?.name ?? code,
          meridianCode: prefix,
          meridianColor: meta.color,
          order,
          side,
          bilateral,
          auditStatus: coord.audit.status,
          surfacePos,
          worldNormal,
          visualMesh,
          hitboxMesh,
        });
      }
    }

    // 2. Build anti-clipping skin-hugging Meridian TubeGeometry + Qi flow particles
    for (const meta of state.meridians) {
      const sides: (1 | -1)[] = meta.bilateral ? [1, -1] : [1];
      for (const side of sides) {
        const orderedMarkers = this.markers
          .filter((m) => m.meridianCode === meta.code && m.side === side)
          .sort((a, b) => a.order - b.order);

        for (let i = 1; i < orderedMarkers.length; i++) {
          const a = orderedMarkers[i - 1];
          const b = orderedMarkers[i];
          const dist = a.surfacePos.distanceTo(b.surfacePos);
          const normalDot = a.worldNormal.dot(b.worldNormal);

          // Avoid connecting distant non-adjacent gaps across torso/limbs on partially modeled meridians
          if (dist > 0.32 || normalDot < -0.15) continue;

          const controlPoints: THREE.Vector3[] = [
            a.surfacePos.clone().addScaledVector(a.worldNormal, TUBE_NORMAL_OFFSET),
          ];

          const subSteps = dist < 0.045 ? 2 : dist < 0.12 ? 3 : 5;
          for (let s = 1; s < subSteps; s++) {
            const t = s / subSteps;
            const lerped = a.surfacePos.clone().lerp(b.surfacePos, t);
            const interpNormal = a.worldNormal.clone().lerp(b.worldNormal, t).normalize();

            // Raycast onto exact continuous mesh triangle face along -interpNormal
            let projectedPt: THREE.Vector3 | null = null;
            if (this.skinMeshes.length > 0) {
              const rayOrigin = lerped.clone().addScaledVector(interpNormal, 0.05);
              this.occlusionRaycaster.set(rayOrigin, interpNormal.clone().negate());
              const hit = this.occlusionRaycaster.intersectObjects(this.skinMeshes, false)[0];
              if (hit && hit.distance < 0.1) {
                projectedPt = hit.point.clone().addScaledVector(interpNormal, TUBE_NORMAL_OFFSET);
              }
            }

            const candidate =
              projectedPt ?? lerped.addScaledVector(interpNormal, TUBE_NORMAL_OFFSET);
            const prevPt = controlPoints[controlPoints.length - 1];
            if (prevPt && candidate.distanceTo(prevPt) > 0.003) {
              controlPoints.push(candidate);
            }
          }

          const endPt = b.surfacePos.clone().addScaledVector(b.worldNormal, TUBE_NORMAL_OFFSET);
          if (controlPoints[controlPoints.length - 1].distanceTo(endPt) < 0.003 && controlPoints.length > 1) {
            controlPoints[controlPoints.length - 1] = endPt;
          } else {
            controlPoints.push(endPt);
          }

          const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal', 0.5);
          const baseColor = new THREE.Color(meta.color);
          const highlightColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35);

          const tubeGeo = new THREE.TubeGeometry(curve, 18, 0.00095, 6, false);
          const tubeMat = new THREE.MeshBasicMaterial({
            color: baseColor,
            transparent: true,
            opacity: 0.6,
          });
          const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
          this.tubeGroup.add(tubeMesh);

          this.tubes.push({
            meridianCode: meta.code,
            side,
            mesh: tubeMesh,
            curve,
            baseColor,
            highlightColor,
          });

          if (this.glowTexture) {
            const spMat = new THREE.SpriteMaterial({
              map: this.glowTexture,
              color: highlightColor,
              transparent: true,
              opacity: 0.82,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const sprite = new THREE.Sprite(spMat);
            sprite.scale.set(0.0085, 0.0085, 1);
            this.particleGroup.add(sprite);

            this.qiParticles.push({
              meridianCode: meta.code,
              side,
              curve,
              offset: (i * 0.23) % 1,
              sprite,
            });
          }
        }
      }
    }

    this.syncVisibilityAndColors(state);
  }

  private isSideAllowed(bilateral: boolean, side: 1 | -1, state: AtlasState): boolean {
    if (!bilateral) return true;
    if (state.displaySide === 'both') return true;
    if (state.displaySide === 'right') return side === 1;
    return side === -1;
  }

  private syncVisibilityAndColors(state: AtlasState): void {
    const visibleSet = new Set(state.visibleMeridians);
    const acupointMap = new Map<string, Acupoint>(state.acupoints.map((a) => [a.code, a]));

    for (const m of this.markers) {
      const acupoint = acupointMap.get(m.code);
      const meridianVisible = visibleSet.has(m.meridianCode);
      const sideVisible = this.isSideAllowed(m.bilateral, m.side, state);
      const filterVisible = matchesFilter(acupoint, m.code, state);

      const isVisible = meridianVisible && sideVisible && filterVisible;
      m.visualMesh.visible = isVisible;
      m.hitboxMesh.visible = isVisible;
    }

    const selectedPrefix = state.selectedAcupointId?.replace(/\d+$/, '') as
      | MeridianCode
      | undefined;

    for (const t of this.tubes) {
      const meridianVisible = visibleSet.has(t.meridianCode);
      const sideVisible = this.isSideAllowed(
        t.meridianCode !== 'CV' && t.meridianCode !== 'GV',
        t.side,
        state,
      );
      t.mesh.visible = meridianVisible && sideVisible;
      if (t.mesh.visible) {
        const isActiveMeridian = t.meridianCode === selectedPrefix;
        t.mesh.material.color.copy(isActiveMeridian ? t.highlightColor : t.baseColor);
        t.mesh.material.opacity = isActiveMeridian ? 0.65 : 0.32;
      }
    }

    for (const p of this.qiParticles) {
      const meridianVisible = visibleSet.has(p.meridianCode);
      const sideVisible = this.isSideAllowed(
        p.meridianCode !== 'CV' && p.meridianCode !== 'GV',
        p.side,
        state,
      );
      p.sprite.visible = state.flowAnimation && meridianVisible && sideVisible;
    }
  }

  private emitProjectedLabels(nowMs: number, state: AtlasState): void {
    if (!this.onLabelsUpdate) return;
    if (nowMs - this.lastLabelEmitMs < 65) return;
    this.lastLabelEmitMs = nowMs;

    // PRD 4.4: Hide all floating acupoint labels when Quiz Mode is active or labels disabled
    if (state.isQuizMode || !state.showLabels) {
      this.onLabelsUpdate([]);
      return;
    }

    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    if (width <= 0 || height <= 0) return;

    // Project torso center to decide clean left/right outward label direction
    this.tmpProj.set(0, 1.0, 0).project(this.camera);
    const bodyScreenCenterX = (this.tmpProj.x * 0.5 + 0.5) * width;

    const rawCandidates: ProjectedLabel[] = [];
    const orderedMarkers = [...this.markers].sort((a, b) => {
      const aSel = a.code === state.selectedAcupointId ? 1 : 0;
      const bSel = b.code === state.selectedAcupointId ? 1 : 0;
      if (bSel !== aSel) return bSel - aSel;
      return a.order - b.order;
    });

    for (const m of orderedMarkers) {
      if (!m.visualMesh.visible) continue;
      // Show label on activeSide only for bilateral points to avoid clutter
      if (m.bilateral && m.side !== state.activeSide) continue;

      this.tmpProj.copy(m.visualMesh.position).project(this.camera);
      if (this.tmpProj.z < -1 || this.tmpProj.z > 1) continue;

      const sx = (this.tmpProj.x * 0.5 + 0.5) * width;
      const sy = (-this.tmpProj.y * 0.5 + 0.5) * height;
      if (sx < 24 || sx > width - 24 || sy < 44 || sy > height - 44) continue;

      // Backface culling via surface normal
      this.tmpToCam.copy(this.camera.position).sub(m.visualMesh.position);
      if (this.tmpToCam.dot(m.worldNormal) < 0.05) continue;

      const isSelected = m.code === state.selectedAcupointId;
      if (!isSelected && rawCandidates.length >= 11) continue;
      if (
        !isSelected &&
        rawCandidates.some((c) => Math.hypot(c.x - sx, c.y - sy) < 22)
      ) {
        continue;
      }

      // Mesh occlusion check
      if (this.skinMeshes.length > 0) {
        const distToCam = this.tmpToCam.length();
        this.occlusionRaycaster.set(
          this.camera.position,
          this.tmpToCam.clone().negate().normalize(),
        );
        const hit = this.occlusionRaycaster.intersectObjects(this.skinMeshes, false)[0];
        if (hit && hit.distance < distToCam - 0.012) continue;
      }

      // Place label outward away from body midline so acupoints & meridian paths stay unobstructed
      const placeRightOfDot = sx >= bodyScreenCenterX - 8;
      const align: 'left' | 'right' =
        sx > width - 135 ? 'right' : sx < 135 ? 'left' : placeRightOfDot ? 'left' : 'right';

      rawCandidates.push({
        code: m.code,
        name: m.name,
        meridianCode: m.meridianCode,
        color: m.meridianColor,
        x: Math.round(sx),
        y: Math.round(sy),
        labelY: Math.round(sy),
        align,
        isSelected,
        auditStatus: m.auditStatus,
      });
    }

    // Resolve vertical overlaps independently per side
    const minGap = 26;
    for (const sideAlign of ['left', 'right'] as const) {
      const group = rawCandidates
        .filter((c) => c.align === sideAlign)
        .sort((a, b) => a.y - b.y);
      for (let i = 1; i < group.length; i++) {
        if (group[i].labelY - group[i - 1].labelY < minGap) {
          group[i].labelY = group[i - 1].labelY + minGap;
        }
      }
    }

    this.onLabelsUpdate(rawCandidates);
  }

  private readonly handleResize = (): void => {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
  };

  private readonly animate = (nowMs: number): void => {
    if (this.disposed) return;
    this.rafId = window.requestAnimationFrame(this.animate);

    this.picker.update(nowMs);
    this.controls.update();

    const state = useAtlasStore.getState();
    let selectedMarker: MarkerInstance | null = null;

    for (const m of this.markers) {
      if (!m.visualMesh.visible) continue;
      const isSelected =
        m.code === state.selectedAcupointId && (!m.bilateral || m.side === state.activeSide);
      const isHovered = m.code === this.hoveredCode;
      if (isSelected) selectedMarker = m;

      // Shrink marker smoothly as camera zooms in close so exact anatomical landmarks are never occluded
      const camDist = this.camera.position.distanceTo(m.visualMesh.position);
      const distScale = THREE.MathUtils.clamp(camDist / 2.35, 0.28, 1.0);

      const stateScale = isSelected
        ? 1.16 + 0.06 * Math.sin(nowMs * 0.005)
        : isHovered
          ? 1.18
          : 1.0;
      m.visualMesh.scale.setScalar(distScale * stateScale);
      m.hitboxMesh.scale.setScalar(THREE.MathUtils.clamp(camDist / 2.2, 0.36, 1.0));

      if (isSelected) {
        m.visualMesh.material.color.setHex(0xfef08a);
      } else if (isHovered) {
        m.visualMesh.material.color.setHex(0xffffff);
      } else if (import.meta.env.DEV && state.auditMode) {
        // PRD 4.5: Color-code draft_imported (amber) vs gb_verified (emerald) in DEV audit mode
        m.visualMesh.material.color.setHex(
          m.auditStatus === 'gb_verified' ? 0x10b981 : 0xf59e0b,
        );
      } else {
        m.visualMesh.material.color.set(m.meridianColor);
      }
    }

    if (selectedMarker && selectedMarker.visualMesh.visible) {
      const selDist = this.camera.position.distanceTo(selectedMarker.visualMesh.position);
      const reticleDistScale = THREE.MathUtils.clamp(selDist / 2.35, 0.32, 1.0);

      this.reticleGroup.visible = true;
      this.reticleGroup.position.copy(selectedMarker.visualMesh.position);
      this.reticleGroup.quaternion.setFromUnitVectors(this.zAxis, selectedMarker.worldNormal);
      this.reticleGroup.scale.setScalar(reticleDistScale);

      const wave = (nowMs * 0.0008) % 1;
      this.innerReticle.scale.setScalar(1 + 0.05 * Math.sin(nowMs * 0.004));
      this.outerReticle.scale.setScalar(1.0 + wave * 0.32);
      this.outerReticle.material.opacity = 0.42 * (1 - wave);
      this.needleGroup.position.z = 0.002 + 0.003 * Math.sin(nowMs * 0.004);
    } else {
      this.reticleGroup.visible = false;
    }

    if (state.flowAnimation) {
      for (const qp of this.qiParticles) {
        if (!qp.sprite.visible) continue;
        const t = (nowMs * 0.00038 + qp.offset) % 1;
        qp.sprite.position.copy(qp.curve.getPointAt(t));
        const pDist = this.camera.position.distanceTo(qp.sprite.position);
        const pScale = 0.0085 * THREE.MathUtils.clamp(pDist / 2.35, 0.32, 1.0);
        qp.sprite.scale.set(pScale, pScale, 1);
      }
    }

    this.emitProjectedLabels(nowMs, state);
    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.handleResize);
    this.unsubscribeStore();
    useAtlasStore.getState().registerLiveCameraGetter(null);
    this.picker.dispose();
    this.controls.dispose();

    this.clearDynamicGroups();
    this.sharedVisualSphere.dispose();
    this.sharedHitboxSphere.dispose();
    this.sharedHitboxMaterial.dispose();
    this.glowTexture?.dispose();

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((mat) => mat.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
