import * as THREE from 'three';
import type { GeoBounds, SceneConfig } from './config';

export interface TerrainMetadata {
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  bounds: GeoBounds;
  source: string;
}

export class TerrainSampler {
  readonly values: Uint16Array;
  readonly meta: TerrainMetadata;
  readonly config: SceneConfig;
  readonly waterMask?: Uint8Array;

  constructor(values: Uint16Array, meta: TerrainMetadata, config: SceneConfig, waterMask?: Uint8Array) {
    if (values.length !== meta.width * meta.height) {
      throw new Error(`Terrain sample count ${values.length} does not match ${meta.width}×${meta.height}`);
    }
    this.values = values;
    this.meta = meta;
    this.config = config;
    this.waterMask = waterMask;
  }

  geoToWorld(longitude: number, latitude: number): THREE.Vector2 {
    const u = (longitude - this.meta.bounds.west) / (this.meta.bounds.east - this.meta.bounds.west);
    const v = (this.meta.bounds.north - latitude) / (this.meta.bounds.north - this.meta.bounds.south);
    return new THREE.Vector2((u - 0.5) * this.config.worldWidth, (v - 0.5) * this.config.worldDepth);
  }

  worldToGrid(x: number, z: number): THREE.Vector2 {
    const u = THREE.MathUtils.clamp(x / this.config.worldWidth + 0.5, 0, 1);
    const v = THREE.MathUtils.clamp(z / this.config.worldDepth + 0.5, 0, 1);
    return new THREE.Vector2(u * (this.meta.width - 1), v * (this.meta.height - 1));
  }

  elevationAtWorld(x: number, z: number): number {
    const grid = this.worldToGrid(x, z);
    const x0 = Math.floor(grid.x);
    const z0 = Math.floor(grid.y);
    const x1 = Math.min(x0 + 1, this.meta.width - 1);
    const z1 = Math.min(z0 + 1, this.meta.height - 1);
    const tx = grid.x - x0;
    const tz = grid.y - z0;
    const a = THREE.MathUtils.lerp(this.value(x0, z0), this.value(x1, z0), tx);
    const b = THREE.MathUtils.lerp(this.value(x0, z1), this.value(x1, z1), tx);
    return THREE.MathUtils.lerp(a, b, tz);
  }

  worldHeightAt(x: number, z: number): number {
    const elevation = this.elevationAtWorld(x, z);
    const base = elevation * this.config.metersToWorld * this.config.verticalExaggeration;
    const mountain = THREE.MathUtils.smoothstep(elevation, 520, 1850);
    const ridge = (
      Math.sin(x * .29 + Math.sin(z * .11) * 1.7) * .22 +
      Math.sin(z * .41 - x * .08) * .12
    ) * mountain;
    const summit = Math.pow(THREE.MathUtils.clamp((elevation - 1050) / 1650, 0, 1), 1.65) * 2.7;
    return base + ridge + summit;
  }

  isLake(x: number, z: number): boolean {
    const grid = this.worldToGrid(x, z);
    if (this.waterMask) {
      const gx = Math.round(grid.x);
      const gz = Math.round(grid.y);
      return this.waterMask[gz * this.meta.width + gx] > 0;
    }
    return this.elevationAtWorld(x, z) <= this.config.waterElevation + 3;
  }

  private value(x: number, z: number): number {
    return this.values[z * this.meta.width + x];
  }
}

export async function loadTerrain(config: SceneConfig): Promise<TerrainSampler> {
  const [metaResponse, dataResponse, waterResponse] = await Promise.all([
    fetch('/data/terrain-meta.json'),
    fetch('/data/terrain.bin'),
    fetch('/data/water-mask.bin'),
  ]);
  if (!metaResponse.ok || !dataResponse.ok || !waterResponse.ok) throw new Error('Unable to load bundled terrain data.');
  const meta = await metaResponse.json() as TerrainMetadata;
  const buffer = await dataResponse.arrayBuffer();
  const waterMask = new Uint8Array(await waterResponse.arrayBuffer());
  return new TerrainSampler(new Uint16Array(buffer), meta, config, waterMask);
}
