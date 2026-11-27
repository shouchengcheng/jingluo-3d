import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetLoader } from './AssetLoader';
import { RaycasterPicker, type PickableMarkerMeta } from './RaycasterPicker';
import { useAtlasStore, type AtlasState } from '../store/useAtlasStore';
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
  visualMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  pickVisible: boolean;
}

interface MeridianTubeInstance {
  meridianCode: MeridianCode;
  side: 1 | -1;
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  arrow: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
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
  return state.searchQuery.trim().length > 0 || Boolean(state.specialFilter);
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
  private readonly quizGroup = new THREE.Group();
  private innerReticle!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private outerReticle!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private needleGroup!: THREE.Group;
  private pedestalOuter!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private pedestalInner!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  private readonly sharedVisualSphere = new THREE.SphereGeometry(0.0042, 16, 12);
  /** Dark back-face halo so markers read clearly on every body material (UI audit 2.6) */
  private readonly sharedOutlineMaterial = new THREE.MeshBasicMaterial({
    color: 0x16110c,
    side: THREE.BackSide,
  });
  private readonly sharedArrowCone = new THREE.ConeGeometry(0.0021, 0.0062, 10);
  private glowTexture: THREE.CanvasTexture | null = null;

  private skinMeshes: THREE.Mesh[] = [];
  private skinMaterials: THREE.MeshPhysicalMaterial[] = [];
  private wireframeMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];

  private markers: MarkerInstance[] = [];
  private tubes: MeridianTubeInstance[] = [];
  private qiParticles: QiParticleInstance[] = [];

  private hoveredCode: string | null = null;
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

    this.glowTexture = this.createRadialGlowTexture();
    this.setupLightsAndPedestal();
    this.setupSelectionReticle();
    this.applyUiTheme(useAtlasStore.getState().uiTheme);

    this.scene.add(
      this.tubeGroup,
      this.particleGroup,
      this.markerGroup,
      this.reticleGroup,
      this.quizGroup,
    );

    this.picker = new RaycasterPicker(this.renderer.domElement, this.camera, this.controls, {
      getPickableMarkers: (): PickableMarkerMeta[] =>
        this.markers.map((m) => ({
          code: m.code,
          side: m.side,
          bilateral: m.bilateral,
          position: m.visualMesh.position,
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
        if (hit || changed) this.options.onHoverChange?.(hit);
      },
      onSelectAcupoint: (code, side, gesture) => {
        const s = useAtlasStore.getState();
        if (s.isQuizMode) return; // quiz answers come from the quiz panel, not marker clicks
        // UI audit 4.2: single click selects (pan only when already zoomed close); double = full focus
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

    // Subtle anatomical standing ring pedestal at y = 0
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

    if (
      state.coordinates !== prevState.coordinates ||
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

  /**
   * UI audit 4.2 — 'full': fly to stored cameraPreset; 'pan': if already zoomed at least as close as
   * the preset (and the point faces the camera), glide the orbit target to the point keeping the
   * current distance/angle, otherwise do nothing; 'auto': pan when close, else full fly-to.
   */
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
    // AGENTS.md Rule 4.1: Explicitly dispose materials and geometries to prevent WebGL memory leaks
    for (const m of this.markers) {
      m.visualMesh.material.dispose();
      this.markerGroup.remove(m.visualMesh);
    }
    this.markers = [];

    for (const t of this.tubes) {
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      t.arrow.material.dispose();
      this.tubeGroup.remove(t.mesh, t.arrow);
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

    // Meridian start / end points (起止穴) get a slightly larger marker (UI audit 4.4)
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

    // 1. Build markers with 0.0015m normal offset + dark outline halo
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
        const outline = new THREE.Mesh(this.sharedVisualSphere, this.sharedOutlineMaterial);
        outline.scale.setScalar(1.55);
        visualMesh.add(outline);

        this.markerGroup.add(visualMesh);

        this.markers.push({
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
          visualMesh,
          pickVisible: true,
        });
      }
    }

    // 2. Build anti-clipping skin-hugging Meridian TubeGeometry + direction arrows + Qi flow particles
    for (const meta of state.meridians) {
      const sides: (1 | -1)[] = meta.bilateral ? [1, -1] : [1];
      for (const side of sides) {
        const orderedMarkers = this.markers
          .filter((m) => m.meridianCode === meta.code && m.side === side)
          .sort((a, b) => a.order - b.order);

        const byCode = new Map(orderedMarkers.map((m) => [m.code, m]));
        const segmentPairs: [MarkerInstance, MarkerInstance][] = [];
        for (let i = 1; i < orderedMarkers.length; i++) {
          const prev = orderedMarkers[i - 1];
          const curr = orderedMarkers[i];
          // ST40 (丰隆) is the lateral Luo-connecting branch off the main anterior tibial line (ST37->ST39->ST41)
          if (prev.code === 'ST39' && curr.code === 'ST40') continue;
          if (prev.code === 'ST40' && curr.code === 'ST41') continue;
          segmentPairs.push([prev, curr]);
        }
        if (meta.code === 'ST') {
          const st37 = byCode.get('ST37');
          const st39 = byCode.get('ST39');
          const st40 = byCode.get('ST40');
          const st41 = byCode.get('ST41');
          if (st39 && st41) segmentPairs.push([st39, st41]);
          if (st37 && st40) segmentPairs.push([st37, st40]);
        }

        for (let i = 0; i < segmentPairs.length; i++) {
          const [a, b] = segmentPairs[i];
          const dist = a.surfacePos.distanceTo(b.surfacePos);
          const normalDot = a.worldNormal.dot(b.worldNormal);

          // Avoid connecting distant non-adjacent gaps across torso/limbs on partially modeled meridians
          if (dist > 0.34 || normalDot < -0.15) continue;

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

          // Flow-direction arrowhead at segment midpoint; acupoint numbering follows circulation direction
          const arrowMat = new THREE.MeshBasicMaterial({
            color: highlightColor,
            transparent: true,
            opacity: 0.9,
          });
          const arrow = new THREE.Mesh(this.sharedArrowCone, arrowMat);
          const mid = curve.getPointAt(0.5);
          const tangent = curve.getTangentAt(0.5).normalize();
          arrow.position.copy(mid);
          arrow.quaternion.setFromUnitVectors(this.yAxis, tangent);
          this.tubeGroup.add(arrow);

          this.tubes.push({
            meridianCode: meta.code,
            side,
            mesh: tubeMesh,
            arrow,
            curve,
            baseColor,
            highlightColor,
          });

          if (this.glowTexture) {
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
              side,
              curve,
              offset: (i * 0.23) % 1,
              sprite: makeSprite(0.85),
              trails: [makeSprite(0.42), makeSprite(0.2)],
            });
          }
        }
      }
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

    for (const m of this.markers) {
      const acupoint = acupointMap.get(m.code);
      const meridianVisible = visibleSet.has(m.meridianCode);
      const sideVisible = this.isSideAllowed(m.bilateral, m.side, state);
      const filterVisible = matchesAcupointQuery(acupoint, m.code, state.searchQuery, state.specialFilter);

      const isVisible = meridianVisible && sideVisible && filterVisible && !locatePending;
      m.visualMesh.visible = isVisible;
      m.pickVisible = isVisible;
    }

    const selectedPrefix = state.selectedAcupointId?.replace(/\d+$/, '') as
      | MeridianCode
      | undefined;
    const fewMeridians = state.visibleMeridians.length <= 3;

    for (const t of this.tubes) {
      const meridianVisible = visibleSet.has(t.meridianCode);
      const sideVisible = this.isSideAllowed(
        t.meridianCode !== 'CV' && t.meridianCode !== 'GV',
        t.side,
        state,
      );
      t.mesh.visible = meridianVisible && sideVisible;
      const isActiveMeridian = t.meridianCode === selectedPrefix;
      if (t.mesh.visible) {
        t.mesh.material.color.copy(isActiveMeridian ? t.highlightColor : t.baseColor);
        // UI audit 4.5: dim full-length routes while a search / special filter narrows the markers
        t.mesh.material.opacity = filtering ? 0.14 : isActiveMeridian ? 0.68 : 0.34;
      }
      t.arrow.visible = t.mesh.visible && !filtering && (fewMeridians || isActiveMeridian);
    }

    for (const p of this.qiParticles) {
      const meridianVisible = visibleSet.has(p.meridianCode);
      const sideVisible = this.isSideAllowed(
        p.meridianCode !== 'CV' && p.meridianCode !== 'GV',
        p.side,
        state,
      );
      const vis = state.flowAnimation && meridianVisible && sideVisible && !filtering;
      p.sprite.visible = vis;
      for (const tr of p.trails) tr.visible = vis;
    }
  }

  /** Quiz "看名找穴" feedback: user click dot + dashed connector to the correct point. */
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

    // Camera azimuth for the orientation gizmo (UI audit 4.6)
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

    // PRD 4.4: Hide all floating acupoint labels when Quiz Mode is active or labels disabled
    if (state.isQuizMode || !state.showLabels) {
      this.options.onLabelsUpdate([]);
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

    this.options.onLabelsUpdate(rawCandidates);
  }

  /**
   * UI audit 8.2: when the mobile bottom sheet covers the lower canvas, shift the projected image
   * upward via setViewOffset so the visual centre sits in the uncovered area.
   */
  private lastFrameMs = 0;

  private updateViewOffset(targetInset: number, dtMs: number): void {
    if (this.appliedBottomInset === targetInset) return;
    const alpha = this.lastFrameMs === 0 ? 1 : 1 - Math.exp(-Math.max(dtMs, 16) / 60);
    const next = this.appliedBottomInset + (targetInset - this.appliedBottomInset) * alpha;
    const settled = Math.abs(targetInset - next) < 0.5 ? targetInset : next;
    this.appliedBottomInset = settled;
    this.applyViewOffset();
  }

  private applyViewOffset(): void {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    const inset = Math.min(this.appliedBottomInset, h * 0.65);
    if (inset < 1) {
      this.camera.clearViewOffset();
    } else {
      // Shift projection centre upward into the uncovered upper canvas without altering FOV zoom
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
  };

  private readonly animate = (nowMs: number): void => {
    if (this.disposed) return;
    this.rafId = window.requestAnimationFrame(this.animate);

    const dtMs = this.lastFrameMs > 0 ? nowMs - this.lastFrameMs : 0;
    const state = useAtlasStore.getState();
    this.updateViewOffset(state.viewportBottomInset, dtMs);
    this.lastFrameMs = nowMs;

    this.picker.update(nowMs);
    this.controls.update();

    let selectedMarker: MarkerInstance | null = null;
    const listHover = state.listHoverCode;
    const isSelectedVisible = Boolean(
      state.selectedAcupointId && !(state.isQuizMode && state.quizKind === 'locate' && !state.quizQuestion?.answer),
    );

    for (const m of this.markers) {
      if (!m.visualMesh.visible) continue;
      const isSameCode = m.code === state.selectedAcupointId;
      const isSelected = isSameCode && (!m.bilateral || m.side === state.activeSide);
      const isMirror = isSameCode && !isSelected; // UI audit 4.7: faint highlight on contralateral point
      const isHovered = m.code === this.hoveredCode || m.code === listHover;
      if (isSelected) selectedMarker = m;

      // Shrink marker smoothly as camera zooms in close so exact anatomical landmarks are never occluded
      const camDist = this.camera.position.distanceTo(m.visualMesh.position);
      const distScale = THREE.MathUtils.clamp(camDist / 2.35, 0.28, 1.0);

      const stateScale = isSelected
        ? 1.16 + 0.08 * Math.sin(nowMs * 0.006)
        : m.code === listHover
          ? 1.3 + 0.15 * Math.sin(nowMs * 0.012)
          : isHovered
            ? 1.22
            : isMirror
              ? 1.08
              : m.isEndpoint
                ? 1.15
                : 1.0;
      m.visualMesh.scale.setScalar(distScale * stateScale);

      if (isSelected) {
        m.visualMesh.material.color.setHex(SELECTED_COLOR);
      } else if (isHovered) {
        m.visualMesh.material.color.setHex(HOVER_COLOR);
      } else if (import.meta.env.DEV && state.auditMode) {
        // PRD 4.5: Color-code draft_imported (amber) vs gb_verified (emerald) in DEV audit mode
        m.visualMesh.material.color.setHex(
          m.auditStatus === 'gb_verified' ? 0x10b981 : 0xf59e0b,
        );
      } else if (isMirror) {
        this.tmpColor.set(m.meridianColor).lerp(new THREE.Color(SELECTED_COLOR), 0.45);
        m.visualMesh.material.color.copy(this.tmpColor);
      } else {
        m.visualMesh.material.color.set(m.meridianColor);
      }
    }

    if (selectedMarker && selectedMarker.visualMesh.visible && isSelectedVisible) {
      const selDist = this.camera.position.distanceTo(selectedMarker.visualMesh.position);
      const reticleDistScale = THREE.MathUtils.clamp(selDist / 2.35, 0.32, 1.0);

      this.reticleGroup.visible = true;
      this.reticleGroup.position.copy(selectedMarker.visualMesh.position);
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

    for (const t of this.tubes) {
      if (!t.arrow.visible) continue;
      const aDist = this.camera.position.distanceTo(t.arrow.position);
      t.arrow.scale.setScalar(THREE.MathUtils.clamp(aDist / 2.35, 0.3, 1.0));
    }

    if (state.flowAnimation) {
      for (const qp of this.qiParticles) {
        if (!qp.sprite.visible) continue;
        const t = (nowMs * 0.00038 + qp.offset) % 1;
        qp.sprite.position.copy(qp.curve.getPointAt(t));
        const pDist = this.camera.position.distanceTo(qp.sprite.position);
        const pScale = 0.0085 * THREE.MathUtils.clamp(pDist / 2.35, 0.32, 1.0);
        qp.sprite.scale.set(pScale, pScale, 1);
        // Fading comet tail behind the particle makes the circulation direction readable
        for (let k = 0; k < qp.trails.length; k++) {
          const tt = t - 0.045 * (k + 1);
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
    this.unsubscribeStore();
    useAtlasStore.getState().registerLiveCameraGetter(null);
    this.picker.dispose();
    this.controls.dispose();

    this.clearDynamicGroups();
    this.rebuildQuizFeedback({ ...useAtlasStore.getState(), isQuizMode: false });
    this.sharedVisualSphere.dispose();
    this.sharedOutlineMaterial.dispose();
    this.sharedArrowCone.dispose();
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
