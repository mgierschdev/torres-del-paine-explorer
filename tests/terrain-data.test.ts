import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { nextQuality, SCENE } from '../src/config';
import { constrainPosition } from '../src/navigation';
import { TerrainSampler, type TerrainMetadata } from '../src/terrain-data';

const meta: TerrainMetadata = {
  width: 2,
  height: 2,
  minElevation: 0,
  maxElevation: 300,
  bounds: { west: -74, south: -52, east: -72, north: -50 },
  source: 'test',
};

function sampler(waterMask?: Uint8Array): TerrainSampler {
  return new TerrainSampler(new Uint16Array([0, 100, 200, 300]), meta, SCENE, waterMask);
}

describe('TerrainSampler', () => {
  it('maps geographic bounds into centered world coordinates', () => {
    const point = sampler().geoToWorld(-73, -51);
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(0);
  });

  it('bilinearly interpolates height samples', () => {
    expect(sampler().elevationAtWorld(0, 0)).toBeCloseTo(150);
  });

  it('uses the bundled water mask for lake classification', () => {
    const terrain = sampler(new Uint8Array([0, 1, 0, 0]));
    expect(terrain.isLake(SCENE.worldWidth / 2, -SCENE.worldDepth / 2)).toBe(true);
    expect(terrain.isLake(-SCENE.worldWidth / 2, -SCENE.worldDepth / 2)).toBe(false);
  });
});

describe('navigation and quality', () => {
  it('keeps the camera inside the scene and above the surface', () => {
    const result = constrainPosition(new THREE.Vector3(999, -50, -999), sampler());
    expect(result.x).toBeLessThan(SCENE.worldWidth / 2);
    expect(result.z).toBeGreaterThan(-SCENE.worldDepth / 2);
    expect(result.y).toBeGreaterThan(0);
  });

  it('cycles quality profiles deterministically', () => {
    expect(nextQuality('high')).toBe('medium');
    expect(nextQuality('medium')).toBe('low');
    expect(nextQuality('low')).toBe('high');
  });
});
