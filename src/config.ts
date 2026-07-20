export type QualityName = 'low' | 'medium' | 'high';

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface QualityProfile {
  pixelRatio: number;
  shadowMap: number;
  lodBias: number;
  bloom: boolean;
  clouds: boolean;
}

export interface SceneConfig {
  bounds: GeoBounds;
  gridSize: number;
  worldWidth: number;
  worldDepth: number;
  metersToWorld: number;
  verticalExaggeration: number;
  waterElevation: number;
  minimumClearance: number;
}

export const SCENE: SceneConfig = {
  bounds: { west: -73.28, south: -51.2, east: -72.82, north: -50.88 },
  gridSize: 513,
  worldWidth: 321.4,
  worldDepth: 356.2,
  metersToWorld: 0.01,
  verticalExaggeration: 1.18,
  waterElevation: 29,
  minimumClearance: 2.2,
};

export const QUALITY: Record<QualityName, QualityProfile> = {
  low: { pixelRatio: 1, shadowMap: 1024, lodBias: 0.7, bloom: false, clouds: false },
  medium: { pixelRatio: 1.4, shadowMap: 1536, lodBias: 1, bloom: true, clouds: true },
  high: { pixelRatio: 2, shadowMap: 2048, lodBias: 1.25, bloom: true, clouds: true },
};

export const START_CAMERA = {
  position: [-35, 24, 145] as const,
  target: [0, 14, -58] as const,
};

export function nextQuality(current: QualityName): QualityName {
  const names: QualityName[] = ['high', 'medium', 'low'];
  return names[(names.indexOf(current) + 1) % names.length];
}
