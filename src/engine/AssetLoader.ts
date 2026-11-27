import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type {
  Acupoint,
  AtlasBundle,
  Coordinates3DFile,
  MeridianMeta,
  MeridianPathsFile,
  Prescription,
} from '../types/atlas';

const acupointModules = import.meta.glob<{ default: Acupoint[] }>('../../data/acupoints/*.json');

declare global {
  interface Window {
    __JINGLUO_EMBEDDED_GLB_BASE64__?: string;
  }
}

function decodeBase64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Unified asset loading layer (ARCHITECTURE.md Principle 4 & AGENTS.md Rule 1.3).
 * Supports both standard HTTP `.glb` loading and zero-network `GLTFLoader.parse()` from an
 * embedded Base64 payload when built via `npm run build:offline`.
 */
export class AssetLoader {
  private readonly gltfLoader = new GLTFLoader();
  private readonly baseUrl: string;
  private cachedBundle: AtlasBundle | null = null;

  constructor(baseUrl: string = import.meta.env.BASE_URL) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  public resolvePublicPath(relativePath: string): string {
    const normalized = relativePath.replace(/^\/+/, '');
    return `${this.baseUrl}${normalized}`;
  }

  public async loadHumanBodyModel(): Promise<GLTF> {
    const embedded = typeof window !== 'undefined' ? window.__JINGLUO_EMBEDDED_GLB_BASE64__ : undefined;
    if (embedded) {
      const buffer = decodeBase64ToArrayBuffer(embedded);
      return await new Promise<GLTF>((resolve, reject) => {
        this.gltfLoader.parse(buffer, '', resolve, reject);
      });
    }
    const url = this.resolvePublicPath('models/human-body.glb');
    return this.gltfLoader.loadAsync(url);
  }

  public async loadAtlasBundle(): Promise<AtlasBundle> {
    if (this.cachedBundle) {
      return {
        meridians: this.cachedBundle.meridians,
        acupoints: this.cachedBundle.acupoints,
        coordinates: structuredClone(this.cachedBundle.coordinates),
        meridianPaths: this.cachedBundle.meridianPaths,
        prescriptions: this.cachedBundle.prescriptions,
      };
    }

    const [meridiansMod, coordinatesMod, pathsMod, prescriptionsMod, ...acupointMods] =
      await Promise.all([
        import('../../data/meridians.json'),
        import('../../data/coordinates-3d.json'),
        import('../../data/meridian-paths.json'),
        import('../../data/prescriptions.json'),
        ...Object.values(acupointModules).map((loader) => loader()),
      ]);

    const meridians = meridiansMod.default as unknown as MeridianMeta[];
    const coordinates = coordinatesMod.default as unknown as Coordinates3DFile;
    const meridianPaths = pathsMod.default as unknown as MeridianPathsFile;
    const prescriptions = prescriptionsMod.default as unknown as Prescription[];
    const acupoints = acupointMods.flatMap((m) => m.default);

    this.cachedBundle = {
      meridians,
      acupoints,
      coordinates,
      meridianPaths,
      prescriptions,
    };

    return {
      meridians,
      acupoints,
      coordinates: structuredClone(coordinates),
      meridianPaths,
      prescriptions,
    };
  }
}

export const assetLoader = new AssetLoader();
