import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { SCENE, START_CAMERA } from './config';
import type { TerrainSampler } from './terrain-data';

export type NavigationMode = 'orbit' | 'fly';

export function constrainPosition(position: THREE.Vector3, sampler: TerrainSampler): THREE.Vector3 {
  const inset = 4;
  const halfW = SCENE.worldWidth / 2 - inset;
  const halfD = SCENE.worldDepth / 2 - inset;
  const constrained = position.clone();
  constrained.x = THREE.MathUtils.clamp(constrained.x, -halfW, halfW);
  constrained.z = THREE.MathUtils.clamp(constrained.z, -halfD, halfD);
  const ground = sampler.worldHeightAt(constrained.x, constrained.z);
  const water = SCENE.waterElevation * SCENE.metersToWorld * SCENE.verticalExaggeration;
  constrained.y = THREE.MathUtils.clamp(constrained.y, Math.max(ground, water) + SCENE.minimumClearance, 120);
  return constrained;
}

export class Navigator {
  readonly orbit: OrbitControls;
  readonly pointer: PointerLockControls;
  mode: NavigationMode = 'orbit';
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sampler: TerrainSampler;
  private readonly keys = new Set<string>();
  private speed = 22;

  constructor(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, sampler: TerrainSampler) {
    this.camera = camera;
    this.sampler = sampler;
    this.orbit = new OrbitControls(camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = .055;
    this.orbit.minDistance = 8;
    this.orbit.maxDistance = 270;
    this.orbit.maxPolarAngle = Math.PI * .49;
    this.orbit.target.fromArray(START_CAMERA.target);
    this.pointer = new PointerLockControls(camera, canvas);
    this.pointer.pointerSpeed = .65;

    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (event.code === 'Equal') this.speed = Math.min(90, this.speed * 1.2);
      if (event.code === 'Minus') this.speed = Math.max(4, this.speed / 1.2);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    canvas.addEventListener('click', () => {
      if (this.mode === 'fly' && !this.pointer.isLocked) this.pointer.lock();
    });
  }

  setMode(mode: NavigationMode): void {
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    if (mode === 'orbit') this.pointer.unlock();
  }

  toggle(): NavigationMode {
    this.setMode(this.mode === 'orbit' ? 'fly' : 'orbit');
    return this.mode;
  }

  reset(): void {
    this.pointer.unlock();
    this.camera.position.fromArray(START_CAMERA.position);
    this.orbit.target.fromArray(START_CAMERA.target);
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  update(delta: number): void {
    if (this.mode === 'orbit') {
      const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1;
      const amount = this.speed * .6 * boost * delta;
      const forwardInput = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
      const strafeInput = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
      if (forwardInput !== 0 || strafeInput !== 0) {
        const forward = this.orbit.target.clone().sub(this.camera.position);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();
        const movement = forward.multiplyScalar(forwardInput * amount).add(right.multiplyScalar(strafeInput * amount));
        this.camera.position.add(movement);
        this.orbit.target.add(movement);
        const halfW = SCENE.worldWidth / 2 - 4;
        const halfD = SCENE.worldDepth / 2 - 4;
        this.orbit.target.x = THREE.MathUtils.clamp(this.orbit.target.x, -halfW, halfW);
        this.orbit.target.z = THREE.MathUtils.clamp(this.orbit.target.z, -halfD, halfD);
      }
      this.orbit.update();
    } else if (this.pointer.isLocked) {
      const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1;
      const amount = this.speed * boost * delta;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.pointer.moveForward(amount);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.pointer.moveForward(-amount);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.pointer.moveRight(-amount);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.pointer.moveRight(amount);
      if (this.keys.has('Space')) this.camera.position.y += amount;
      if (this.keys.has('ControlLeft') || this.keys.has('KeyC')) this.camera.position.y -= amount;
    }
    this.constrainCamera(delta);
  }

  private constrainCamera(delta: number): void {
    const constrained = constrainPosition(this.camera.position, this.sampler);
    this.camera.position.x = constrained.x;
    this.camera.position.z = constrained.z;
    const minimum = constrained.y;
    if (this.camera.position.y < minimum) {
      this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, minimum, Math.min(1, delta * 9));
    }
    this.camera.position.y = Math.min(this.camera.position.y, 120);
  }
}
