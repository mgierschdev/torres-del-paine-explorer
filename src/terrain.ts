import * as THREE from 'three';
import type { QualityProfile } from './config';
import { SCENE } from './config';
import { TerrainSampler } from './terrain-data';

const PATCHES = 8;
const SOURCE_INTERVALS = (SCENE.gridSize - 1) / PATCHES;

function terrainColor(sampler: TerrainSampler, x: number, z: number): THREE.Color {
  const elevation = sampler.elevationAtWorld(x, z);
  const d = 1.1;
  const riseX = Math.abs(sampler.worldHeightAt(x + d, z) - sampler.worldHeightAt(x - d, z));
  const riseZ = Math.abs(sampler.worldHeightAt(x, z + d) - sampler.worldHeightAt(x, z - d));
  const steepness = THREE.MathUtils.clamp((riseX + riseZ) / (d * 1.6), 0, 1);
  const grain = Math.sin(x * .23 + Math.sin(z * .17)) * .5 + Math.sin(z * .51) * .25;

  const moss = new THREE.Color('#344333');
  const grass = new THREE.Color('#60704a');
  const earth = new THREE.Color('#50483d');
  const granite = new THREE.Color('#39424a');
  const snow = new THREE.Color('#d8dee0');

  let color: THREE.Color;
  if (elevation < 160) color = moss.clone().lerp(grass, THREE.MathUtils.clamp((elevation - 25) / 180, 0, 1));
  else if (elevation < 750) color = grass.clone().lerp(earth, (elevation - 160) / 590);
  else color = earth.clone().lerp(granite, THREE.MathUtils.clamp((elevation - 750) / 700, 0, 1));
  const snowLine = 1280 + grain * 170 + steepness * 430;
  if (elevation > snowLine) color.lerp(snow, THREE.MathUtils.smoothstep(elevation, snowLine, snowLine + 440));
  color.offsetHSL(grain * .012, grain * .018, grain * .018 - steepness * .055);
  return color;
}

function createPatchGeometry(sampler: TerrainSampler, patchX: number, patchZ: number, divisor: number): THREE.BufferGeometry {
  const intervals = SOURCE_INTERVALS / divisor;
  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const centerGridX = patchX * SOURCE_INTERVALS + SOURCE_INTERVALS / 2;
  const centerGridZ = patchZ * SOURCE_INTERVALS + SOURCE_INTERVALS / 2;
  const centerX = (centerGridX / (SCENE.gridSize - 1) - .5) * SCENE.worldWidth;
  const centerZ = (centerGridZ / (SCENE.gridSize - 1) - .5) * SCENE.worldDepth;

  for (let row = 0; row <= intervals; row++) {
    for (let col = 0; col <= intervals; col++) {
      const gridX = patchX * SOURCE_INTERVALS + col * divisor;
      const gridZ = patchZ * SOURCE_INTERVALS + row * divisor;
      const x = (gridX / (SCENE.gridSize - 1) - .5) * SCENE.worldWidth;
      const z = (gridZ / (SCENE.gridSize - 1) - .5) * SCENE.worldDepth;
      const y = sampler.worldHeightAt(x, z);
      vertices.push(x - centerX, y, z - centerZ);
      const color = terrainColor(sampler, x, z);
      colors.push(color.r, color.g, color.b);
    }
  }

  const stride = intervals + 1;
  for (let row = 0; row < intervals; row++) {
    for (let col = 0; col < intervals; col++) {
      const a = row * stride + col;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createTerrain(sampler: TerrainSampler, quality: QualityProfile): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terrain';
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: .96,
    metalness: 0,
    dithering: true,
  });

  for (let patchZ = 0; patchZ < PATCHES; patchZ++) {
    for (let patchX = 0; patchX < PATCHES; patchX++) {
      const lod = new THREE.LOD();
      const centerGridX = patchX * SOURCE_INTERVALS + SOURCE_INTERVALS / 2;
      const centerGridZ = patchZ * SOURCE_INTERVALS + SOURCE_INTERVALS / 2;
      lod.position.set(
        (centerGridX / (SCENE.gridSize - 1) - .5) * SCENE.worldWidth,
        0,
        (centerGridZ / (SCENE.gridSize - 1) - .5) * SCENE.worldDepth,
      );
      [1, 2, 4].forEach((divisor, index) => {
        const mesh = new THREE.Mesh(createPatchGeometry(sampler, patchX, patchZ, divisor), material);
        mesh.receiveShadow = true;
        mesh.castShadow = index === 0;
        lod.addLevel(mesh, [0, 58, 118][index] * quality.lodBias);
      });
      group.add(lod);
    }
  }
  return group;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createScrub(sampler: TerrainSampler): THREE.InstancedMesh {
  const count = 1300;
  const geometry = new THREE.IcosahedronGeometry(.18, 0);
  geometry.scale(1, .6, 1);
  const material = new THREE.MeshStandardMaterial({ color: '#1c2c26', roughness: 1 });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const random = seededRandom(74051);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const x = (random() - .5) * SCENE.worldWidth * .92;
    const z = (random() - .15) * SCENE.worldDepth * .72;
    const elevation = sampler.elevationAtWorld(x, z);
    const y = sampler.worldHeightAt(x, z);
    const visible = elevation > 45 && elevation < 420;
    const s = visible ? .55 + random() * 1.8 : 0;
    position.set(x, y + .12, z);
    scale.set(s, s * (.6 + random() * .6), s);
    rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, random() * Math.PI * 2);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

export function createWaterGeometry(sampler: TerrainSampler, segments = 512): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const masks: number[] = [];
  const indices: number[] = [];
  const size = segments + 1;
  const componentIds = new Int32Array(size * size).fill(-1);
  const componentLevels: number[] = [];
  let component = 0;

  for (let start = 0; start < size * size; start++) {
    const startX = start % size;
    const startZ = Math.floor(start / size);
    const worldX = (startX / segments - .5) * SCENE.worldWidth;
    const worldZ = (startZ / segments - .5) * SCENE.worldDepth;
    if (componentIds[start] !== -1 || !sampler.isLake(worldX, worldZ)) continue;
    const queue = [start];
    componentIds[start] = component;
    const elevations: number[] = [];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      const x = index % size;
      const z = Math.floor(index / size);
      const px = (x / segments - .5) * SCENE.worldWidth;
      const pz = (z / segments - .5) * SCENE.worldDepth;
      elevations.push(sampler.elevationAtWorld(px, pz));
      for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        const neighbor = nz * size + nx;
        if (componentIds[neighbor] !== -1) continue;
        const neighborX = (nx / segments - .5) * SCENE.worldWidth;
        const neighborZ = (nz / segments - .5) * SCENE.worldDepth;
        if (!sampler.isLake(neighborX, neighborZ)) continue;
        componentIds[neighbor] = component;
        queue.push(neighbor);
      }
    }
    elevations.sort((a, b) => a - b);
    componentLevels[component] = elevations[Math.floor(elevations.length / 2)];
    component++;
  }

  for (let row = 0; row <= segments; row++) {
    for (let col = 0; col <= segments; col++) {
      const u = col / segments;
      const v = row / segments;
      const x = (u - .5) * SCENE.worldWidth;
      const z = (v - .5) * SCENE.worldDepth;
      const index = row * size + col;
      let waterComponent = componentIds[index];
      if (waterComponent < 0) {
        for (let dz = -1; dz <= 1 && waterComponent < 0; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = col + dx;
            const nz = row + dz;
            if (nx >= 0 && nz >= 0 && nx < size && nz < size && componentIds[nz * size + nx] >= 0) {
              waterComponent = componentIds[nz * size + nx];
              break;
            }
          }
        }
      }
      const y = waterComponent >= 0
        ? componentLevels[waterComponent] * SCENE.metersToWorld * SCENE.verticalExaggeration + .035
        : sampler.worldHeightAt(x, z);
      positions.push(x, y, z);
      uvs.push(u, v);
      masks.push(componentIds[index] >= 0 ? 1 : 0);
    }
  }
  const stride = size;
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * stride + col;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aWater', new THREE.Float32BufferAttribute(masks, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
