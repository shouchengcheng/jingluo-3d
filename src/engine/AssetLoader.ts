import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Unified asset loading layer.
 * Keeps model and JSON loading decoupled so future offline single-file bundling
 * (e.g. vite-plugin-singlefile + GLTFLoader.parse) requires no changes to callers.
 */
export class AssetLoader {
  private readonly gltfLoader = new GLTFLoader();
  private readonly baseUrl: string;

  constructor(baseUrl: string = import.meta.env.BASE_URL) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  public resolvePath(relativePath: string): string {
    const normalized = relativePath.replace(/^\/+/, '');
    return `${this.baseUrl}${normalized}`;
  }

  public async loadGLB(relativePath: string): Promise<GLTF> {
    const url = this.resolvePath(relativePath);
    return this.gltfLoader.loadAsync(url);
  }

  public async loadJSON<T>(relativePath: string): Promise<T> {
    const url = this.resolvePath(relativePath);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load JSON asset "${url}": HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}

export const assetLoader = new AssetLoader();
