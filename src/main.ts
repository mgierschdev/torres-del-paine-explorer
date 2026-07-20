import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { nextQuality, QUALITY, SCENE, START_CAMERA } from './config';
import type { QualityName } from './config';
import { loadTerrain } from './terrain-data';
import { createScrub, createTerrain, createWaterGeometry } from './terrain';
import { Navigator } from './navigation';
import { skyFragment, skyVertex, waterFragment, waterVertex } from './shaders';

declare global {
  interface Window {
    __PAINE_EXPLORER__?: {
      ready: boolean;
      mode: () => string;
      quality: () => string;
      camera: () => number[];
      view: (name: 'opening' | 'alternate') => void;
    };
  }
}

const container = document.querySelector<HTMLDivElement>('#scene');
if (!container) throw new Error('Scene container is missing.');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const fogColor = new THREE.Color('#8ba4b5');
scene.fog = new THREE.FogExp2(fogColor, .00255);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, .25, 1100);
camera.position.fromArray(START_CAMERA.position);
camera.lookAt(new THREE.Vector3().fromArray(START_CAMERA.target));

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ssao = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssao.kernelRadius = 10;
ssao.minDistance = .003;
ssao.maxDistance = .07;
composer.addPass(ssao);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), .1, .45, .88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const sunDirection = new THREE.Vector3(.7, .45, .18).normalize();
const hemisphere = new THREE.HemisphereLight('#b9d2df', '#1b201c', 1.65);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight('#ffe2b4', 4.2);
sun.position.copy(sunDirection).multiplyScalar(180);
sun.castShadow = true;
sun.shadow.camera.left = -150;
sun.shadow.camera.right = 150;
sun.shadow.camera.top = 150;
sun.shadow.camera.bottom = -150;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 430;
sun.shadow.bias = -.00015;
scene.add(sun);
const fill = new THREE.DirectionalLight('#6f94b7', .75);
fill.position.set(-90, 75, -120);
scene.add(fill);

const skyMaterial = new THREE.ShaderMaterial({
  vertexShader: skyVertex,
  fragmentShader: skyFragment,
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: { uTime: { value: 0 }, uClouds: { value: 1 } },
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(650, 48, 24), skyMaterial);
scene.add(sky);

function createCloudTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 160;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  let state = 81723;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < 58; i++) {
    const x = 82 + random() * 220;
    const y = 66 + random() * 34;
    const radius = 20 + random() * 42;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(224,230,232,${.18 + random() * .25})`);
    gradient.addColorStop(.48, 'rgba(168,180,188,.18)');
    gradient.addColorStop(1, 'rgba(90,105,116,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const cloudBank = new THREE.Group();
const cloudTexture = createCloudTexture();
[
  [-205, 95, -360, 250, 86, .58], [-58, 130, -410, 310, 105, .48],
  [125, 108, -380, 270, 90, .52], [235, 160, -430, 285, 92, .42],
  [-175, 230, -300, 330, 110, .32], [70, 255, -330, 350, 116, .3],
].forEach(([x, y, z, width, height, opacity]) => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: cloudTexture,
    color: '#9ba9b2',
    transparent: true,
    opacity,
    depthWrite: false,
    fog: false,
  }));
  sprite.position.set(x, y, z);
  sprite.scale.set(width, height, 1);
  cloudBank.add(sprite);
});
sky.add(cloudBank);

const waterMaterial = new THREE.ShaderMaterial({
  vertexShader: waterVertex,
  fragmentShader: waterFragment,
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTime: { value: 0 },
    uSunDirection: { value: sunDirection },
    uFogColor: { value: fogColor },
  },
});
let water: THREE.Mesh;

const storedQuality = localStorage.getItem('paine-quality');
let qualityName: QualityName = storedQuality === 'low' || storedQuality === 'medium' || storedQuality === 'high' ? storedQuality : 'high';
let navigator: Navigator;
let terrainRoot: THREE.Group;
let lastTime = performance.now();
let frames = 0;
let performanceWindow = 0;
let qualityManuallySet = storedQuality !== null;
let pageVisible = !document.hidden;
const staticFrame = new URLSearchParams(window.location.search).has('static');

function setQuality(next: QualityName, announce = true): void {
  qualityName = next;
  const profile = QUALITY[next];
  renderer.setPixelRatio(Math.min(devicePixelRatio, profile.pixelRatio));
  renderer.shadowMap.enabled = next !== 'low';
  sun.shadow.mapSize.set(profile.shadowMap, profile.shadowMap);
  ssao.enabled = next !== 'low';
  bloom.enabled = profile.bloom;
  skyMaterial.uniforms.uClouds.value = profile.clouds ? 1 : 0;
  cloudBank.visible = profile.clouds;
  if (terrainRoot) {
    terrainRoot.traverse((object) => {
      if (object instanceof THREE.LOD) {
        object.levels.forEach((level, index) => { level.distance = [0, 58, 118][index] * profile.lodBias; });
      }
    });
  }
  localStorage.setItem('paine-quality', next);
  const label = document.querySelector('#quality span:last-child');
  if (label) label.textContent = next[0].toUpperCase() + next.slice(1);
  if (announce) showToast(`${next[0].toUpperCase() + next.slice(1)} quality`);
}

function showToast(message: string): void {
  const toast = document.querySelector<HTMLDivElement>('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 1800);
}

function setupInterface(): void {
  const modeButton = document.querySelector<HTMLButtonElement>('#mode');
  const status = document.querySelector<HTMLSpanElement>('#status');
  modeButton?.addEventListener('click', () => {
    const mode = navigator.toggle();
    const label = modeButton.querySelector('span:last-child');
    if (label) label.textContent = mode === 'orbit' ? 'Orbit' : 'Fly';
    if (status) status.textContent = `${mode.toUpperCase()} MODE`;
    showToast(mode === 'fly' ? 'Fly mode · click the landscape, then use WASD' : 'Orbit mode');
    localStorage.setItem('paine-mode', mode);
  });
  document.querySelector('#reset')?.addEventListener('click', () => {
    navigator.reset();
    showToast('Viewpoint restored');
  });
  document.querySelector('#quality')?.addEventListener('click', () => {
    qualityManuallySet = true;
    setQuality(nextQuality(qualityName));
  });
  document.querySelector('#sound')?.addEventListener('click', () => showToast('Ambient sound is off'));
  document.querySelector('#fullscreen')?.addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  });
  const hint = document.querySelector('#hint');
  document.querySelector('#dismiss-hint')?.addEventListener('click', () => {
    hint?.classList.add('hidden');
    localStorage.setItem('paine-hint-dismissed', 'true');
  });
  if (localStorage.getItem('paine-hint-dismissed') === 'true') hint?.classList.add('hidden');

  const panel = document.querySelector<HTMLElement>('#about-panel');
  const about = document.querySelector<HTMLButtonElement>('#about');
  const toggleAbout = (open: boolean): void => {
    panel?.classList.toggle('open', open);
    panel?.setAttribute('aria-hidden', String(!open));
    about?.setAttribute('aria-expanded', String(open));
  };
  about?.addEventListener('click', () => toggleAbout(!panel?.classList.contains('open')));
  document.querySelector('#close-about')?.addEventListener('click', () => toggleAbout(false));
}

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  setQuality(qualityName, false);
}

function animate(now: number): void {
  requestAnimationFrame(animate);
  if (!pageVisible || !navigator) return;
  const delta = Math.min((now - lastTime) / 1000, .05);
  lastTime = now;
  navigator.update(delta);
  sky.position.copy(camera.position);
  const shaderTime = staticFrame ? 12 : now / 1000;
  skyMaterial.uniforms.uTime.value = shaderTime;
  waterMaterial.uniforms.uTime.value = shaderTime;
  composer.render();

  frames++;
  performanceWindow += delta;
  if (!staticFrame && performanceWindow > 8) {
    const fps = frames / performanceWindow;
    if (!qualityManuallySet && fps < 42 && qualityName !== 'low') {
      setQuality(qualityName === 'high' ? 'medium' : 'low');
      showToast('Quality adjusted for smoother flight');
    }
    frames = 0;
    performanceWindow = 0;
  }
}

async function start(): Promise<void> {
  try {
    const sampler = await loadTerrain(SCENE);
    terrainRoot = createTerrain(sampler, QUALITY[qualityName]);
    scene.add(terrainRoot, createScrub(sampler));
    water = new THREE.Mesh(createWaterGeometry(sampler), waterMaterial);
    water.renderOrder = 2;
    scene.add(water);
    navigator = new Navigator(camera, renderer.domElement, sampler);
    const storedMode = localStorage.getItem('paine-mode');
    if (storedMode === 'fly') navigator.setMode('fly');
    setupInterface();
    setQuality(qualityName, false);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      pageVisible = !document.hidden;
      lastTime = performance.now();
    });
    document.querySelector('#loading')?.classList.add('complete');
    window.__PAINE_EXPLORER__ = {
      ready: true,
      mode: () => navigator.mode,
      quality: () => qualityName,
      camera: () => camera.position.toArray(),
      view: (name) => {
        if (name === 'alternate') {
          camera.position.set(55, 20, 96);
          navigator.orbit.target.set(-8, 14, -72);
        } else {
          camera.position.fromArray(START_CAMERA.position);
          navigator.orbit.target.fromArray(START_CAMERA.target);
        }
        camera.lookAt(navigator.orbit.target);
        navigator.orbit.update();
      },
    };
    requestAnimationFrame(animate);
  } catch (error) {
    console.error(error);
    const loading = document.querySelector<HTMLDivElement>('#loading');
    if (loading) loading.innerHTML = '<p>Unable to form the landscape.<br/>Check the bundled terrain assets.</p>';
  }
}

void start();
