import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Acupoint, AtlasBundle, Coordinates3DFile, MeridianMeta } from '../types/atlas';

const acupointModules = import.meta.glob<{ default: Acupoint[] }>('../../data/acupoints/*.json');

/**
 * Unified asset loading layer (ARCHITECTURE.md Principle 4 & AGENTS.md Rule 1.3).
 * Centralizes all .glb and JSON data loading so business components never call fetch()
 * directly and future single-file offline packaging requires zero caller changes.
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
    const url = this.resolvePublicPath('models/human-body.glb');
    return this.gltfLoader.loadAsync(url);
  }

  public async loadAtlasBundle(): Promise<AtlasBundle> {
    if (this.cachedBundle) {
      return {
        meridians: this.cachedBundle.meridians,
        acupoints: this.cachedBundle.acupoints,
        coordinates: structuredClone(this.cachedBundle.coordinates),
      };
    }

    const [meridiansMod, coordinatesMod, ...acupointMods] = await Promise.all([
      import('../../data/meridians.json'),
      import('../../data/coordinates-3d.json'),
      ...Object.values(acupointModules).map((loader) => loader()),
    ]);

    const meridians = meridiansMod.default as unknown as MeridianMeta[];
    const coordinates = coordinatesMod.default as unknown as Coordinates3DFile;
    const acupoints = acupointMods.flatMap((m) => m.default);

    this.cachedBundle = {
      meridians,
      acupoints,
      coordinates,
    };

    return {
      meridians,
      acupoints,
      coordinates: structuredClone(coordinates),
    };
  }
}

export const assetLoader = new AssetLoader();
