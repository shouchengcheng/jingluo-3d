import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetLoader } from './AssetLoader';
import { RaycasterPicker, type PickableMarkerMeta } from './RaycasterPicker';
import { useAtlasStore, type AtlasState } from '../store/useAtlasStore';
import { ANATOMICAL_LANDMARKS } from '../components/CunReferenceModal';
import { matchesAcupointQuery } from '../utils/searchMatch';
import type {
  Acupoint,
  AcupointCoordinate3D,
  AmbiguousPick,
  AuditStatus,
  BodyTheme,
  FocusMode,
  HoverInfo,
  MeridianCode,
  MeridianMeta,
  ProjectedLabel,
  RegionPreset,
  UiTheme,
  ViewPreset,
} from '../types/atlas';

/** ARCHITECTURE.md Section 6.1: Offset marker 0.0015m along surface normal to eliminate Z-fighting */
const MARKER_NORMAL_OFFSET = 0.0015;
/** Meridian tube surface offset slightly above skin */
const TUBE_NORMAL_OFFSET = 0.0024;

const SELECTED_COLOR = 0xe2553a; // 朱砂 cinnabar
const PRESCRIPTION_COLOR = 0xf1c35a; // 配穴金黄
const HOVER_COLOR = 0xffffff;

const SCENE_BG: Record<UiTheme, number> = {
  ink: 0x0f0d0b,
  paper: 0xe9e2d2,
};

/**
 * Local anatomical region quick-jump presets (UI audit 4.3).
 * Canonical (+X) side; mirrored by activeSide at runtime. Model: 1.75 m, Y-up, facing +Z.
 */
export const REGION_PRESETS: Record<
  RegionPreset,
  { label: string; target: [number, number, number]; camera: [number, number, number] }
> = {
  head_face: { label: '头面部', target: [0, 1.62, 0.04], camera: [0, 1.66, 0.78] },
  head_side: { label: '耳周 · 侧头', target: [0.06, 1.6, 0.0], camera: [0.72, 1.63, 0.06] },
  neck_nape: { label: '颈项 · 后头', target: [0, 1.52, -0.03], camera: [0, 1.6, -0.78] },
  chest_abdomen: { label: '胸腹部', target: [0, 1.2, 0.1], camera: [0, 1.26, 1.32] },
  back_lumbar: { label: '腰背部', target: [0, 1.22, -0.05], camera: [0, 1.3, -1.36] },
  arm_inner: { label: '上肢内侧', target: [0.33, 1.1, 0.03], camera: [0.56, 1.15, 1.02] },
  arm_outer: { label: '上肢外侧', target: [0.33, 1.1, -0.01], camera: [0.82, 1.2, -0.86] },
  hand_palm: { label: '手掌', target: [0.39, 0.94, 0.02], camera: [0.46, 0.99, 0.44] },
  hand_back: { label: '手背', target: [0.405, 0.92, -0.01], camera: [0.64, 1.0, -0.34] },
  leg_front: { label: '下肢前外侧', target: [0.12, 0.45, 0.04], camera: [0.52, 0.55, 1.22] },
  leg_back: { label: '下肢后侧', target: [0.11, 0.5, -0.03], camera: [0.26, 0.6, -1.28] },
  foot_dorsum: { label: '足背', target: [0.11, 0.06, 0.1], camera: [0.2, 0.44, 0.6] },
  foot_sole: { label: '足底', target: [0.1, 0.03, 0.05], camera: [0.16, -0.4, 0.16] },
};

interface MarkerInstance {
  instanceIndex: number;
  code: string;
  name: string;
  meridianCode: MeridianCode;
  meridianColor: string;
  order: number;
  side: 1 | -1;
  bilateral: boolean;
  isEndpoint: boolean;
  auditStatus: AuditStatus;
  surfacePos: THREE.Vector3;
  worldNormal: THREE.Vector3;
  worldPos: THREE.Vector3;
  visible: boolean;
  pickVisible: boolean;
}

interface ArrowInstance {
  instanceIndex: number;
  meridianCode: MeridianCode;
  bilateral: boolean;
  side: 1 | -1;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  color: THREE.Color;
  visible: boolean;
}

interface MeridianTubeInstance {
  meridianCode: MeridianCode;
  bilateral: boolean;
  side: 1 | -1;
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  curve: THREE.CatmullRomCurve3;
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
}

interface QiParticleInstance {
  meridianCode: MeridianCode;
  bilateral: boolean;
  side: 1 | -1;
  curve: THREE.CatmullRomCurve3;
  arcLength: number;
  offset: number;
  sprite: THREE.Sprite;
  trails: THREE.Sprite[];
}

export interface MeridianSceneOptions {
  onLabelsUpdate?: (labels: ProjectedLabel[]) => void;
  onHoverChange?: (info: HoverInfo | null) => void;
  onAmbiguousPick?: (pick: AmbiguousPick) => void;
  onCameraAzimuth?: (deg: number) => void;
  onInteractionChange?: (active: boolean) => void;
}

function parsePointNumber(code: string): number {
  const m = code.match(/\d+$/);
  return m ? Number.parseInt(m[0], 10) : 0;
}

function hasActiveFilter(state: AtlasState): boolean {
  return (
    state.searchQuery.trim().length > 0 ||
    Boolean(state.specialFilter) ||
    Boolean(state.activePrescriptionId)
  );
}

function activePrescriptionSet(state: AtlasState): Set<string> | null {
  if (!state.activePrescriptionId) return null;
  const rx = state.prescriptions.find((p) => p.id === state.activePrescriptionId);
  return rx ? new Set(rx.points) : null;
}

function isQuizLocatePending(state: AtlasState): boolean {
  return state.isQuizMode && state.quizKind === 'locate' && !state.quizQuestion?.answer;
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
  private readonly options: MeridianSceneOptions;

  private readonly markerGroup = new THREE.Group();
  private readonly tubeGroup = new THREE.Group();
  private readonly particleGroup = new THREE.Group();
  private readonly reticleGroup = new THREE.Group();
  private readonly landmarkGroup = new THREE.Group();
  private readonly quizGroup = new THREE.Group();
  private innerReticle!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private outerReticle!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private needleGroup!: THREE.Group;
  private pedestalOuter!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private pedestalInner!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  private readonly sharedVisualSphere = new THREE.SphereGeometry(0.0042, 16, 12);
  private readonly sharedMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  /** Dark back-face halo so markers read clearly on every body material (UI audit 2.6) */
  private readonly sharedOutlineMaterial = new THREE.MeshBasicMaterial({
    color: 0x16110c,
    side: THREE.BackSide,
  });
  private readonly sharedArrowCone = new THREE.ConeGeometry(0.0021, 0.0062, 10);
  private readonly sharedArrowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
  });
  private readonly sharedLandmarkGeo = new THREE.OctahedronGeometry(0.0052, 0);
  private readonly sharedLandmarkMat = new THREE.MeshBasicMaterial({
    color: 0xf1c35a,
    transparent: true,
    opacity: 0.9,
  });
  private glowTexture: THREE.CanvasTexture | null = null;

  private skinMeshes: THREE.Mesh[] = [];
  private skinMaterials: THREE.MeshPhysicalMaterial[] = [];
  private wireframeMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];

  private markers: MarkerInstance[] = [];
  private markerInstancedMesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private outlineInstancedMesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private arrows: ArrowInstance[] = [];
  private arrowInstancedMesh: THREE.InstancedMesh<THREE.ConeGeometry, THREE.MeshBasicMaterial> | null = null;
  private tubes: MeridianTubeInstance[] = [];
  private qiParticles: QiParticleInstance[] = [];

  private hoveredCode: string | null = null;
  private isOrbiting = false;
  private lastWakeMs = performance.now();
  private lastRenderMs = 0;
  private lastFrameMs = 0;
  private lastViewNonce = 0;
  private lastRegionNonce = 0;
  private lastFocusNonce = 0;
  private lastLabelEmitMs = 0;
  private lastAzimuthDeg = Number.NaN;
  private appliedBottomInset = 0;
  private rafId: number | null = null;
  private disposed = false;

  private readonly occlusionRaycaster = new THREE.Raycaster();
  private readonly tmpProj = new THREE.Vector3();
  private readonly tmpToCam = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly identityQuat = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  constructor(container: HTMLElement, options?: MeridianSceneOptions) {
    this.container = container;
    this.options = options ?? {};

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SCENE_BG[useAtlasStore.getState().uiTheme]);

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
    this.controls.addEventListener('change', this.wakeRenderLoop);

    this.glowTexture = this.createRadialGlowTexture();
    this.setupLightsAndPedestal();
    this.setupSelectionReticle();
    this.setupAnatomicalLandmarks();
    this.applyUiTheme(useAtlasStore.getState().uiTheme);

    this.scene.add(
      this.tubeGroup,
      this.particleGroup,
      this.markerGroup,
      this.landmarkGroup,
      this.reticleGroup,
      this.quizGroup,
    );

    this.picker = new RaycasterPicker(this.renderer.domElement, this.camera, this.controls, {
      getPickableMarkers: (): PickableMarkerMeta[] =>
        this.markers.map((m) => ({
          code: m.code,
          side: m.side,
          bilateral: m.bilateral,
          position: m.worldPos,
          normal: m.worldNormal,
          visible: m.pickVisible,
        })),
      getSkinMeshes: () => this.skinMeshes,
      isSurfaceCalibrationActive: () => {
        const s = useAtlasStore.getState();
        return Boolean(import.meta.env.DEV && s.auditMode && s.surfacePickArmed && s.selectedAcupointId);
      },
      isQuizLocateActive: () => isQuizLocatePending(useAtlasStore.getState()),
      getSelectedBilateralFlag: () => {
        const s = useAtlasStore.getState();
        if (!s.selectedAcupointId) return true;
        const prefix = s.selectedAcupointId.replace(/\d+$/, '');
        return prefix !== 'CV' && prefix !== 'GV';
      },
      onHoverAcupoint: (hit) => {
        const next = hit?.code ?? null;
        const changed = next !== this.hoveredCode;
        this.hoveredCode = next;
        if (changed) this.wakeRenderLoop();
        if (hit || changed) this.options.onHoverChange?.(hit);
      },
      onSelectAcupoint: (code, side, gesture) => {
        const s = useAtlasStore.getState();
        if (s.isQuizMode) return;
        s.selectAcupoint(code, { focus: gesture === 'double' ? 'full' : 'pan', side });
      },
      onAmbiguousPick: (candidates, x, y) => {
        this.options.onAmbiguousPick?.({ candidates, x, y });
      },
      onSurfacePick: (payload, side) => {
        const s = useAtlasStore.getState();
        if (!s.selectedAcupointId) return;
        s.applySurfaceCalibration(s.selectedAcupointId, payload);
        s.selectAcupoint(s.selectedAcupointId, { focus: false, side });
      },
      onQuizSurfaceClick: (point) => {
        useAtlasStore.getState().answerQuizLocate(point);
      },
      onInteractionChange: (active) => {
        this.isOrbiting = active;
        this.wakeRenderLoop();
        this.options.onInteractionChange?.(active);
      },
    });

    useAtlasStore.getState().registerLiveCameraGetter(() => {
      const side = useAtlasStore.getState().activeSide;
      return this.picker.getCurrentCanonicalCameraPreset(side);
    });

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.wakeRenderLoop);

    this.unsubscribeStore = useAtlasStore.subscribe((state, prevState) => {
      this.wakeRenderLoop();
      this.onStoreChanged(state, prevState);
    });

    void this.initializeAssets();
    this.animate(performance.now());
  }

  private readonly wakeRenderLoop = (): void => {
    this.lastWakeMs = performance.now();
  };

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
    const hemi = new THREE.HemisphereLight(0xfdf3e1, 0x1a140e, 1.15);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.65);
    keyLight.position.set(-1.8, 2.6, 2.2);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x8fd3d0, 1.0);
    rimLight.position.set(2.0, 1.8, -2.0);
    this.scene.add(rimLight);

    const backFill = new THREE.DirectionalLight(0xe8d5b0, 0.7);
    backFill.position.set(-1.5, 1.2, -2.2);
    this.scene.add(backFill);

    this.pedestalOuter = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.395, 72),
      new THREE.MeshBasicMaterial({
        color: 0x4fa3a5,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35,
      }),
    );
    this.pedestalOuter.rotation.x = -Math.PI / 2;
    this.pedestalOuter.position.y = 0.001;
    this.scene.add(this.pedestalOuter);

    this.pedestalInner = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.246, 64),
      new THREE.MeshBasicMaterial({
        color: 0xd2a54a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.25,
      }),
    );
    this.pedestalInner.rotation.x = -Math.PI / 2;
    this.pedestalInner.position.y = 0.001;
    this.scene.add(this.pedestalInner);
  }

  private setupAnatomicalLandmarks(): void {
    for (const lm of ANATOMICAL_LANDMARKS) {
      const sides: (1 | -1)[] = lm.bilateral ? [1, -1] : [1];
      for (const s of sides) {
        const pin = new THREE.Mesh(this.sharedLandmarkGeo, this.sharedLandmarkMat);
        pin.position.set(lm.position[0] * s, lm.position[1], lm.position[2]);
        const outline = new THREE.Mesh(this.sharedLandmarkGeo, this.sharedOutlineMaterial);
        outline.scale.setScalar(1.4);
        pin.add(outline);
        this.landmarkGroup.add(pin);
      }
    }
    this.landmarkGroup.visible = useAtlasStore.getState().showLandmarks;
  }

  private applyUiTheme(theme: UiTheme): void {
    (this.scene.background as THREE.Color).setHex(SCENE_BG[theme]);
    if (this.pedestalOuter) {
      this.pedestalOuter.material.color.setHex(theme === 'paper' ? 0x2c6f72 : 0x4fa3a5);
      this.pedestalOuter.material.opacity = theme === 'paper' ? 0.5 : 0.35;
      this.pedestalInner.material.color.setHex(theme === 'paper' ? 0x9a7420 : 0xd2a54a);
      this.pedestalInner.material.opacity = theme === 'paper' ? 0.45 : 0.25;
    }
  }

  private setupSelectionReticle(): void {
    this.innerReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.0068, 0.008, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf1c35a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
      }),
    );

    this.outerReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.0095, 0.0105, 48),
      new THREE.MeshBasicMaterial({
        color: SELECTED_COLOR,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
        depthTest: false,
      }),
    );

    this.needleGroup = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.00025, 0.0008, 0.042, 10),
      new THREE.MeshBasicMaterial({
        color: 0xf1d394,
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
            transparent: true,
            opacity: useAtlasStore.getState().bodyOpacity,
          });
          this.applyMaterialTheme(skinMat, useAtlasStore.getState().bodyTheme);
          obj.material = skinMat;
          this.skinMeshes.push(obj);
          this.skinMaterials.push(skinMat);

          const wireMat = new THREE.MeshBasicMaterial({
            color: 0x4fa3a5,
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
      this.wakeRenderLoop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useAtlasStore.getState().setLoadError(msg);
    }
  }

  private applyMaterialTheme(mat: THREE.MeshPhysicalMaterial, theme: BodyTheme): void {
    if (theme === 'skin') {
      mat.color.setHex(0xc89a7e);
      mat.emissive.setHex(0x1f1109);
      mat.emissiveIntensity = 0.18;
      mat.roughness = 0.56;
      mat.metalness = 0.02;
      mat.clearcoat = 0.08;
      mat.clearcoatRoughness = 0.58;
      mat.sheen = 0.42;
      mat.sheenColor = new THREE.Color(0xffe4d1);
    } else if (theme === 'bronze') {
      mat.color.setHex(0x8e673e);
      mat.emissive.setHex(0x170e05);
      mat.emissiveIntensity = 0.3;
      mat.roughness = 0.34;
      mat.metalness = 0.78;
      mat.clearcoat = 0.18;
      mat.clearcoatRoughness = 0.38;
      mat.sheen = 0.32;
      mat.sheenColor = new THREE.Color(0xfbbf24);
    } else {
      mat.color.setHex(0x24443f);
      mat.emissive.setHex(0x08140f);
      mat.emissiveIntensity = 0.45;
      mat.roughness = 0.46;
      mat.metalness = 0.06;
      mat.clearcoat = 0.22;
      mat.clearcoatRoughness = 0.45;
      mat.sheen = 0.55;
      mat.sheenColor = new THREE.Color(0x9fd8d6);
    }
    mat.needsUpdate = true;
  }

  private onStoreChanged(state: AtlasState, prevState: AtlasState): void {
    if (state.uiTheme !== prevState.uiTheme) {
      this.applyUiTheme(state.uiTheme);
    }

    if (state.bodyTheme !== prevState.bodyTheme) {
      for (const mat of this.skinMaterials) {
        this.applyMaterialTheme(mat, state.bodyTheme);
      }
    }

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

    if (state.showLandmarks !== prevState.showLandmarks) {
      this.landmarkGroup.visible = state.showLandmarks;
    }

    if (
      state.coordinates !== prevState.coordinates ||
      state.meridianPaths !== prevState.meridianPaths ||
      state.meridians !== prevState.meridians ||
      state.acupoints !== prevState.acupoints
    ) {
      this.rebuildAcupointsAndMeridians(state);
    } else {
      this.syncVisibilityAndColors(state);
    }

    if (state.quizQuestion !== prevState.quizQuestion || state.isQuizMode !== prevState.isQuizMode) {
      this.rebuildQuizFeedback(state);
    }

    if (state.viewRequest && state.viewRequest.nonce !== this.lastViewNonce) {
      this.lastViewNonce = state.viewRequest.nonce;
      this.applyViewPreset(state.viewRequest.preset);
    }

    if (state.regionRequest && state.regionRequest.nonce !== this.lastRegionNonce) {
      this.lastRegionNonce = state.regionRequest.nonce;
      this.applyRegionPreset(state.regionRequest.preset, state.activeSide);
    }

    if (state.focusRequest.nonce !== this.lastFocusNonce) {
      this.lastFocusNonce = state.focusRequest.nonce;
      this.focusSelectedAcupoint(state, state.focusRequest.mode);
    }
  }

  private applyViewPreset(preset: ViewPreset): void {
    const d = 2.75;
    const target: [number, number, number] = [0, 0.9, 0];
    let pos: [number, number, number] = [0, 0.98, d];
    if (preset === 'back') pos = [0, 0.98, -d];
    else if (preset === 'right') pos = [d, 0.98, 0];
    else if (preset === 'left') pos = [-d, 0.98, 0];
    this.picker.flyTo({ position: pos, target }, 1, 640);
  }

  private applyRegionPreset(preset: RegionPreset, side: 1 | -1): void {
    const def = REGION_PRESETS[preset];
    if (!def) return;
    this.picker.flyTo({ position: def.camera, target: def.target }, side, 680);
  }

  private focusSelectedAcupoint(state: AtlasState, mode: FocusMode): void {
    if (!state.selectedAcupointId || !state.coordinates) return;
    const coord = state.coordinates.points[state.selectedAcupointId];
    if (!coord) return;
    const prefix = state.selectedAcupointId.replace(/\d+$/, '');
    const bilateral = prefix !== 'CV' && prefix !== 'GV';
    const side: 1 | -1 = bilateral ? state.activeSide : 1;

    if (mode !== 'full') {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const currentDist = offset.length();
      const presetDist = new THREE.Vector3(...coord.cameraPreset.position).distanceTo(
        new THREE.Vector3(...coord.cameraPreset.target),
      );
      const pointPos = new THREE.Vector3(coord.position[0] * side, coord.position[1], coord.position[2]);
      const pointNormal = new THREE.Vector3(coord.normal[0] * side, coord.normal[1], coord.normal[2]);
      const facing = offset.clone().normalize().dot(pointNormal.normalize()) > 0.05;
      const isClose = currentDist <= presetDist * 1.35;

      if (isClose && facing) {
        this.picker.flyToPose(pointPos.clone().add(offset), pointPos, 460);
        return;
      }
      if (mode === 'pan') return;
    }
    this.picker.flyTo(coord.cameraPreset, side, 680);
  }

  private clearDynamicGroups(): void {
    if (this.markerInstancedMesh) {
      this.markerGroup.remove(this.markerInstancedMesh);
      this.markerInstancedMesh.dispose();
      this.markerInstancedMesh = null;
    }
    if (this.outlineInstancedMesh) {
      this.markerGroup.remove(this.outlineInstancedMesh);
      this.outlineInstancedMesh.dispose();
      this.outlineInstancedMesh = null;
    }
    this.markers = [];

    if (this.arrowInstancedMesh) {
      this.tubeGroup.remove(this.arrowInstancedMesh);
      this.arrowInstancedMesh.dispose();
      this.arrowInstancedMesh = null;
    }
    this.arrows = [];

    for (const t of this.tubes) {
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      this.tubeGroup.remove(t.mesh);
    }
    this.tubes = [];

    for (const p of this.qiParticles) {
      p.sprite.material.dispose();
      this.particleGroup.remove(p.sprite);
      for (const tr of p.trails) {
        tr.material.dispose();
        this.particleGroup.remove(tr);
      }
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

    const endpointCodes = new Set<string>();
    const byMeridian = new Map<string, string[]>();
    for (const code of Object.keys(state.coordinates.points)) {
      const prefix = code.replace(/\d+$/, '');
      const list = byMeridian.get(prefix) ?? [];
      list.push(code);
      byMeridian.set(prefix, list);
    }
    for (const list of byMeridian.values()) {
      list.sort((a, b) => parsePointNumber(a) - parsePointNumber(b));
      endpointCodes.add(list[0]);
      endpointCodes.add(list[list.length - 1]);
    }

    // 1. Collect acupoint marker descriptors, then back them with 2 GPU InstancedMeshes (Audit 4.1)
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

        const worldPos = surfacePos.clone().addScaledVector(worldNormal, MARKER_NORMAL_OFFSET);

        this.markers.push({
          instanceIndex: this.markers.length,
          code,
          name: acupoint?.name ?? code,
          meridianCode: prefix,
          meridianColor: meta.color,
          order,
          side,
          bilateral,
          isEndpoint: endpointCodes.has(code),
          auditStatus: coord.audit.status,
          surfacePos,
          worldNormal,
          worldPos,
          visible: true,
          pickVisible: true,
        });
      }
    }

    if (this.markers.length > 0) {
      this.markerInstancedMesh = new THREE.InstancedMesh(
        this.sharedVisualSphere,
        this.sharedMarkerMaterial,
        this.markers.length,
      );
      this.markerInstancedMesh.frustumCulled = false;

      this.outlineInstancedMesh = new THREE.InstancedMesh(
        this.sharedVisualSphere,
        this.sharedOutlineMaterial,
        this.markers.length,
      );
      this.outlineInstancedMesh.frustumCulled = false;

      for (const m of this.markers) {
        this.tmpMatrix.makeTranslation(m.worldPos.x, m.worldPos.y, m.worldPos.z);
        this.markerInstancedMesh.setMatrixAt(m.instanceIndex, this.tmpMatrix);
        this.outlineInstancedMesh.setMatrixAt(m.instanceIndex, this.tmpMatrix);
        this.markerInstancedMesh.setColorAt(m.instanceIndex, this.tmpColor.set(m.meridianColor));
      }
      this.markerGroup.add(this.outlineInstancedMesh, this.markerInstancedMesh);
    }

    // 2. Build continuous skin-hugging Meridian TubeGeometry per branch + collect flow arrows
    for (const meta of state.meridians) {
      const branches = state.meridianPaths?.meridians?.[meta.code] ?? [];
      const baseColor = new THREE.Color(meta.color);
      const highlightColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35);

      for (const br of branches) {
        if (br.points.length < 2) continue;
        const sides: (1 | -1)[] = br.bilateral ? [1, -1] : [1];

        for (const side of sides) {
          const controlPoints: THREE.Vector3[] = [];
          for (let i = 0; i < br.points.length; i++) {
            const p = br.points[i];
            const n = br.normals[i] ?? [0, 0, 1];
            const worldP = new THREE.Vector3(p[0] * side, p[1], p[2]);
            const worldN = new THREE.Vector3(n[0] * side, n[1], n[2]).normalize();
            const lifted = worldP.addScaledVector(worldN, TUBE_NORMAL_OFFSET);
            const prev = controlPoints[controlPoints.length - 1];
            if (!prev || prev.distanceTo(lifted) > 0.003) {
              controlPoints.push(lifted);
            }
          }
          if (controlPoints.length < 2) continue;

          const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal', 0.5);
          const arcLength = Math.max(curve.getLength(), 0.04);
          const tubularSegments = Math.min(220, Math.max(20, Math.round(arcLength / 0.012)));

          const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, 0.00095, 6, false);
          const tubeMat = new THREE.MeshBasicMaterial({
            color: baseColor,
            transparent: true,
            opacity: 0.6,
          });
          const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
          this.tubeGroup.add(tubeMesh);

          const arrowCount = Math.max(1, Math.min(8, Math.round(arcLength / 0.16)));
          for (let a = 0; a < arrowCount; a++) {
            const u = (a + 0.5) / arrowCount;
            const quat = new THREE.Quaternion().setFromUnitVectors(
              this.yAxis,
              curve.getTangentAt(u).normalize(),
            );
            this.arrows.push({
              instanceIndex: this.arrows.length,
              meridianCode: meta.code,
              bilateral: br.bilateral,
              side,
              position: curve.getPointAt(u),
              quaternion: quat,
              color: highlightColor.clone(),
              visible: true,
            });
          }

          this.tubes.push({
            meridianCode: meta.code,
            bilateral: br.bilateral,
            side,
            mesh: tubeMesh,
            curve,
            baseColor,
            highlightColor,
          });

          if (this.glowTexture) {
            const particleCount = Math.max(1, Math.min(6, Math.round(arcLength / 0.18)));
            for (let pIdx = 0; pIdx < particleCount; pIdx++) {
              const makeSprite = (opacity: number): THREE.Sprite => {
                const spMat = new THREE.SpriteMaterial({
                  map: this.glowTexture,
                  color: highlightColor,
                  transparent: true,
                  opacity,
                  depthWrite: false,
                  blending: THREE.AdditiveBlending,
                });
                const sp = new THREE.Sprite(spMat);
                sp.scale.set(0.0085, 0.0085, 1);
                this.particleGroup.add(sp);
                return sp;
              };
              this.qiParticles.push({
                meridianCode: meta.code,
                bilateral: br.bilateral,
                side,
                curve,
                arcLength,
                offset: pIdx / particleCount,
                sprite: makeSprite(0.85),
                trails: [makeSprite(0.42), makeSprite(0.2)],
              });
            }
          }
        }
      }
    }

    if (this.arrows.length > 0) {
      this.arrowInstancedMesh = new THREE.InstancedMesh(
        this.sharedArrowCone,
        this.sharedArrowMaterial,
        this.arrows.length,
      );
      this.arrowInstancedMesh.frustumCulled = false;
      for (const arr of this.arrows) {
        this.arrowInstancedMesh.setColorAt(arr.instanceIndex, arr.color);
      }
      this.tubeGroup.add(this.arrowInstancedMesh);
    }

    this.syncVisibilityAndColors(state);
    this.rebuildQuizFeedback(state);
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
    const locatePending = isQuizLocatePending(state);
    const filtering = hasActiveFilter(state);
    const rxSet = activePrescriptionSet(state);

    for (const m of this.markers) {
      const acupoint = acupointMap.get(m.code);
      const meridianVisible = visibleSet.has(m.meridianCode);
      const sideVisible = this.isSideAllowed(m.bilateral, m.side, state);
      const filterVisible = rxSet
        ? rxSet.has(m.code)
        : matchesAcupointQuery(acupoint, m.code, state.searchQuery, state.specialFilter);

      const isVisible = meridianVisible && sideVisible && filterVisible && !locatePending;
      m.visible = isVisible;
      m.pickVisible = isVisible;
    }

    const selectedPrefix = state.selectedAcupointId?.replace(/\d+$/, '') as
      | MeridianCode
      | undefined;
    const fewMeridians = state.visibleMeridians.length <= 3;

    for (const t of this.tubes) {
      const meridianVisible = visibleSet.has(t.meridianCode);
      const sideVisible = this.isSideAllowed(t.bilateral, t.side, state);
      t.mesh.visible = meridianVisible && sideVisible;
      const isActiveMeridian = t.meridianCode === selectedPrefix;
      if (t.mesh.visible) {
        t.mesh.material.color.copy(isActiveMeridian ? t.highlightColor : t.baseColor);
        t.mesh.material.opacity = filtering ? 0.18 : isActiveMeridian ? 0.68 : 0.36;
      }
    }

    for (const arr of this.arrows) {
      const meridianVisible = visibleSet.has(arr.meridianCode);
      const sideVisible = this.isSideAllowed(arr.bilateral, arr.side, state);
      const isActiveMeridian = arr.meridianCode === selectedPrefix;
      arr.visible = meridianVisible && sideVisible && !filtering && (fewMeridians || isActiveMeridian);
    }

    for (const p of this.qiParticles) {
      const meridianVisible = visibleSet.has(p.meridianCode);
      const sideVisible = this.isSideAllowed(p.bilateral, p.side, state);
      const vis = state.flowAnimation && meridianVisible && sideVisible && !filtering;
      p.sprite.visible = vis;
      for (const tr of p.trails) tr.visible = vis;
    }
  }

  private rebuildQuizFeedback(state: AtlasState): void {
    for (const child of [...this.quizGroup.children]) {
      this.quizGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    const q = state.quizQuestion;
    if (!state.isQuizMode || !q?.answer?.clickPoint || !state.coordinates) return;
    const coord = state.coordinates.points[q.code];
    if (!coord) return;

    const click = new THREE.Vector3(...q.answer.clickPoint);
    const target = new THREE.Vector3(coord.position[0] * q.side, coord.position[1], coord.position[2]);
    const color = q.answer.correct ? 0x5fae74 : 0xe0483a;

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.0048, 14, 10),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    dot.position.copy(click);
    dot.renderOrder = 12;

    const lineGeo = new THREE.BufferGeometry().setFromPoints([click, target]);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineDashedMaterial({
        color,
        dashSize: 0.006,
        gapSize: 0.004,
        depthTest: false,
        transparent: true,
      }),
    );
    line.computeLineDistances();
    line.renderOrder = 12;
    this.quizGroup.add(dot, line);
  }

  private emitProjectedLabels(nowMs: number, state: AtlasState): void {
    if (nowMs - this.lastLabelEmitMs < 65) return;
    this.lastLabelEmitMs = nowMs;

    if (this.options.onCameraAzimuth) {
      const dx = this.camera.position.x - this.controls.target.x;
      const dz = this.camera.position.z - this.controls.target.z;
      const deg = THREE.MathUtils.radToDeg(Math.atan2(dx, dz));
      if (Number.isNaN(this.lastAzimuthDeg) || Math.abs(deg - this.lastAzimuthDeg) > 1.5) {
        this.lastAzimuthDeg = deg;
        this.options.onCameraAzimuth(deg);
      }
    }

    if (!this.options.onLabelsUpdate) return;

    if (state.isQuizMode || !state.showLabels) {
      this.options.onLabelsUpdate([]);
      return;
    }

    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    if (width <= 0 || height <= 0) return;

    this.tmpProj.set(0, 1.0, 0).project(this.camera);
    const bodyScreenCenterX = (this.tmpProj.x * 0.5 + 0.5) * width;

    const rxSet = activePrescriptionSet(state);
    const rawCandidates: ProjectedLabel[] = [];
    const orderedMarkers = [...this.markers].sort((a, b) => {
      const aPri = a.code === state.selectedAcupointId ? 2 : rxSet?.has(a.code) ? 1 : 0;
      const bPri = b.code === state.selectedAcupointId ? 2 : rxSet?.has(b.code) ? 1 : 0;
      if (bPri !== aPri) return bPri - aPri;
      return a.order - b.order;
    });

    for (const m of orderedMarkers) {
      if (!m.visible) continue;
      if (m.bilateral && m.side !== state.activeSide) continue;

      this.tmpProj.copy(m.worldPos).project(this.camera);
      if (this.tmpProj.z < -1 || this.tmpProj.z > 1) continue;

      const sx = (this.tmpProj.x * 0.5 + 0.5) * width;
      const sy = (-this.tmpProj.y * 0.5 + 0.5) * height;
      if (sx < 24 || sx > width - 24 || sy < 44 || sy > height - 44) continue;

      this.tmpToCam.copy(this.camera.position).sub(m.worldPos);
      if (this.tmpToCam.dot(m.worldNormal) < 0.05) continue;

      const isSelected = m.code === state.selectedAcupointId;
      const isPriority = isSelected || Boolean(rxSet?.has(m.code));
      if (!isPriority && rawCandidates.length >= 11) continue;
      if (
        !isPriority &&
        rawCandidates.some((c) => Math.hypot(c.x - sx, c.y - sy) < 22)
      ) {
        continue;
      }

      if (this.skinMeshes.length > 0) {
        const distToCam = this.tmpToCam.length();
        this.occlusionRaycaster.set(
          this.camera.position,
          this.tmpToCam.clone().negate().normalize(),
        );
        const hit = this.occlusionRaycaster.intersectObjects(this.skinMeshes, false)[0];
        if (hit && hit.distance < distToCam - 0.012) continue;
      }

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

    this.options.onLabelsUpdate(rawCandidates);
  }

  private updateViewOffset(targetInset: number, dtMs: number): void {
    if (this.appliedBottomInset === targetInset) return;
    const alpha = this.lastFrameMs === 0 ? 1 : 1 - Math.exp(-Math.max(dtMs, 16) / 60);
    const next = this.appliedBottomInset + (targetInset - this.appliedBottomInset) * alpha;
    const settled = Math.abs(targetInset - next) < 0.5 ? targetInset : next;
    this.appliedBottomInset = settled;
    this.applyViewOffset();
    this.wakeRenderLoop();
  }

  private applyViewOffset(): void {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    const inset = Math.min(this.appliedBottomInset, h * 0.65);
    if (inset < 1) {
      this.camera.clearViewOffset();
    } else {
      this.camera.setViewOffset(w, h, 0, inset * 0.42, w, h);
    }
    this.camera.updateProjectionMatrix();
  }

  private readonly handleResize = (): void => {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.applyViewOffset();
    this.wakeRenderLoop();
  };

  private readonly animate = (nowMs: number): void => {
    if (this.disposed) return;
    this.rafId = window.requestAnimationFrame(this.animate);

    if (typeof document !== 'undefined' && document.hidden) return;

    const state = useAtlasStore.getState();
    const isActive =
      state.flowAnimation ||
      this.isOrbiting ||
      this.picker.isFlying() ||
      Boolean(state.listHoverCode) ||
      this.appliedBottomInset !== state.viewportBottomInset ||
      nowMs - this.lastWakeMs < 1100;

    if (!isActive && nowMs - this.lastRenderMs < 100) {
      return;
    }
    this.lastRenderMs = nowMs;

    const dtMs = this.lastFrameMs > 0 ? nowMs - this.lastFrameMs : 0;
    this.updateViewOffset(state.viewportBottomInset, dtMs);
    this.lastFrameMs = nowMs;

    this.picker.update(nowMs);
    this.controls.update();

    let selectedMarker: MarkerInstance | null = null;
    const listHover = state.listHoverCode;
    const rxSet = activePrescriptionSet(state);
    const isSelectedVisible = Boolean(
      state.selectedAcupointId && !(state.isQuizMode && state.quizKind === 'locate' && !state.quizQuestion?.answer),
    );

    if (this.markerInstancedMesh && this.outlineInstancedMesh) {
      for (const m of this.markers) {
        if (!m.visible) {
          this.markerInstancedMesh.setMatrixAt(m.instanceIndex, this.zeroMatrix);
          this.outlineInstancedMesh.setMatrixAt(m.instanceIndex, this.zeroMatrix);
          continue;
        }
        const isSameCode = m.code === state.selectedAcupointId;
        const isSelected = isSameCode && (!m.bilateral || m.side === state.activeSide);
        const isMirror = isSameCode && !isSelected;
        const isRxPartner = Boolean(rxSet?.has(m.code)) && !isSelected;
        const isHovered = m.code === this.hoveredCode || m.code === listHover;
        if (isSelected) selectedMarker = m;

        const camDist = this.camera.position.distanceTo(m.worldPos);
        const distScale = THREE.MathUtils.clamp(camDist / 2.35, 0.28, 1.0);

        const stateScale = isSelected
          ? 1.16 + 0.08 * Math.sin(nowMs * 0.006)
          : m.code === listHover
            ? 1.3 + 0.15 * Math.sin(nowMs * 0.012)
            : isHovered
              ? 1.22
              : isRxPartner
                ? 1.18 + 0.05 * Math.sin(nowMs * 0.005)
                : isMirror
                  ? 1.08
                  : m.isEndpoint
                    ? 1.15
                    : 1.0;

        const s = distScale * stateScale;
        this.tmpScale.setScalar(s);
        this.tmpMatrix.compose(m.worldPos, this.identityQuat, this.tmpScale);
        this.markerInstancedMesh.setMatrixAt(m.instanceIndex, this.tmpMatrix);

        this.tmpScale.setScalar(s * 1.55);
        this.tmpMatrix.compose(m.worldPos, this.identityQuat, this.tmpScale);
        this.outlineInstancedMesh.setMatrixAt(m.instanceIndex, this.tmpMatrix);

        if (isSelected) {
          this.tmpColor.setHex(SELECTED_COLOR);
        } else if (isHovered) {
          this.tmpColor.setHex(HOVER_COLOR);
        } else if (import.meta.env.DEV && state.auditMode) {
          this.tmpColor.setHex(m.auditStatus === 'gb_verified' ? 0x10b981 : 0xf59e0b);
        } else if (isRxPartner) {
          this.tmpColor.setHex(PRESCRIPTION_COLOR);
        } else if (isMirror) {
          this.tmpColor.set(m.meridianColor).lerp(new THREE.Color(SELECTED_COLOR), 0.45);
        } else {
          this.tmpColor.set(m.meridianColor);
        }
        this.markerInstancedMesh.setColorAt(m.instanceIndex, this.tmpColor);
      }

      this.markerInstancedMesh.instanceMatrix.needsUpdate = true;
      this.outlineInstancedMesh.instanceMatrix.needsUpdate = true;
      if (this.markerInstancedMesh.instanceColor) {
        this.markerInstancedMesh.instanceColor.needsUpdate = true;
      }
    }

    if (selectedMarker && selectedMarker.visible && isSelectedVisible) {
      const selDist = this.camera.position.distanceTo(selectedMarker.worldPos);
      const reticleDistScale = THREE.MathUtils.clamp(selDist / 2.35, 0.32, 1.0);

      this.reticleGroup.visible = true;
      this.reticleGroup.position.copy(selectedMarker.worldPos);
      this.reticleGroup.quaternion.setFromUnitVectors(this.zAxis, selectedMarker.worldNormal);
      this.reticleGroup.scale.setScalar(reticleDistScale);

      const wave = (nowMs * 0.0008) % 1;
      this.innerReticle.scale.setScalar(1 + 0.05 * Math.sin(nowMs * 0.004));
      this.outerReticle.scale.setScalar(1.0 + wave * 0.32);
      this.outerReticle.material.opacity = 0.5 * (1 - wave);
      this.needleGroup.position.z = 0.002 + 0.003 * Math.sin(nowMs * 0.004);
    } else {
      this.reticleGroup.visible = false;
    }

    if (this.arrowInstancedMesh) {
      for (const arr of this.arrows) {
        if (!arr.visible) {
          this.arrowInstancedMesh.setMatrixAt(arr.instanceIndex, this.zeroMatrix);
          continue;
        }
        const aDist = this.camera.position.distanceTo(arr.position);
        this.tmpScale.setScalar(THREE.MathUtils.clamp(aDist / 2.35, 0.3, 1.0));
        this.tmpMatrix.compose(arr.position, arr.quaternion, this.tmpScale);
        this.arrowInstancedMesh.setMatrixAt(arr.instanceIndex, this.tmpMatrix);
      }
      this.arrowInstancedMesh.instanceMatrix.needsUpdate = true;
    }

    if (state.flowAnimation) {
      for (const qp of this.qiParticles) {
        if (!qp.sprite.visible) continue;
        const speed = 0.00013 / Math.max(qp.arcLength, 0.18);
        const t = (nowMs * speed + qp.offset) % 1;
        qp.sprite.position.copy(qp.curve.getPointAt(t));
        const pDist = this.camera.position.distanceTo(qp.sprite.position);
        const pScale = 0.0085 * THREE.MathUtils.clamp(pDist / 2.35, 0.32, 1.0);
        qp.sprite.scale.set(pScale, pScale, 1);

        const trailStep = Math.min(0.06, 0.012 / Math.max(qp.arcLength, 0.18));
        for (let k = 0; k < qp.trails.length; k++) {
          const tt = t - trailStep * (k + 1);
          const tr = qp.trails[k];
          if (tt < 0) {
            tr.visible = false;
            continue;
          }
          tr.visible = true;
          tr.position.copy(qp.curve.getPointAt(tt));
          const s = pScale * (0.78 - 0.18 * k);
          tr.scale.set(s, s, 1);
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.emitProjectedLabels(nowMs, state);
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
    document.removeEventListener('visibilitychange', this.wakeRenderLoop);
    this.controls.removeEventListener('change', this.wakeRenderLoop);
    this.unsubscribeStore();
    useAtlasStore.getState().registerLiveCameraGetter(null);
    this.picker.dispose();
    this.controls.dispose();

    this.clearDynamicGroups();
    this.rebuildQuizFeedback({ ...useAtlasStore.getState(), isQuizMode: false });
    this.sharedVisualSphere.dispose();
    this.sharedMarkerMaterial.dispose();
    this.sharedOutlineMaterial.dispose();
    this.sharedArrowCone.dispose();
    this.sharedArrowMaterial.dispose();
    this.sharedLandmarkGeo.dispose();
    this.sharedLandmarkMat.dispose();
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
