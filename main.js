// Keep all Three.js imports on the same fixed CDN version (see index.html import map).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.querySelector('#scene-canvas');
const viewport = document.querySelector('.viewport');
const modelStatus = document.querySelector('#model-status');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2230);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3.5;
controls.maxDistance = 18;
controls.maxPolarAngle = Math.PI - 0.08;

const target = new THREE.Vector3(0, 3.1, 0);
const initialView = { position: new THREE.Vector3(7.2, 5.2, 9.2), target: target.clone() };
const cameraViews = {
  front: { position: new THREE.Vector3(0, 3.4, 10), target: target.clone() },
  side: { position: new THREE.Vector3(10, 3.4, 0), target: target.clone() },
  back: { position: new THREE.Vector3(0, 3.4, -10), target: target.clone() },
  high: { position: new THREE.Vector3(5.8, 10.5, 7.2), target: target.clone() },
  low: { position: new THREE.Vector3(5.8, 0.9, 8), target: new THREE.Vector3(0, 2.8, 0) },
  reset: initialView,
};

camera.position.copy(initialView.position);
controls.target.copy(initialView.target);
controls.update();

scene.add(new THREE.HemisphereLight(0xddeeff, 0x283040, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(4, 9, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(8, 64),
  new THREE.MeshStandardMaterial({ color: 0x303b4c, roughness: 0.9 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// The GLB stays local to this repository so GitHub Pages never depends on an
// external model host. The rig object is intentionally retained for future pose tools.
const mannequinRig = {
  scene: null,
  skeleton: null,
  bones: new Map(),
};

window.poseEasyMannequin = {
  get scene() {
    return mannequinRig.scene;
  },
  get skeleton() {
    return mannequinRig.skeleton;
  },
  getBone(name) {
    return mannequinRig.bones.get(name) ?? null;
  },
};

const modelLoader = new GLTFLoader();

function setModelStatus(message, hasError = false) {
  modelStatus.textContent = message;
  modelStatus.classList.toggle('error', hasError);
}

modelLoader.load(
  './assets/models/human-base-rigged.glb',
  (gltf) => {
    const skinnedMesh = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
    if (!skinnedMesh?.skeleton) {
      throw new Error('The loaded GLB does not contain a skinned skeleton.');
    }

    mannequinRig.scene = gltf.scene;
    mannequinRig.skeleton = skinnedMesh.skeleton;
    mannequinRig.bones = new Map(mannequinRig.skeleton.bones.map((bone) => [bone.name, bone]));

    mannequinRig.scene.scale.setScalar(3.5);
    mannequinRig.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mannequinRig.scene);
    const center = bounds.getCenter(new THREE.Vector3());
    mannequinRig.scene.position.set(-center.x, -bounds.min.y, -center.z);

    mannequinRig.scene.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    scene.add(mannequinRig.scene);

    const bones = mannequinRig.skeleton.bones.map((bone) => ({
      name: bone.name,
      parent: mannequinRig.skeleton.bones.includes(bone.parent) ? bone.parent.name : '(scene root)',
    }));
    console.groupCollapsed(`Pose Easy mannequin rig (${bones.length} bones)`);
    console.table(bones);
    console.log('Access a bone with: window.poseEasyMannequin.getBone("upperarm_l")');
    console.groupEnd();
    setModelStatus(`인체 모델 로드 완료 · ${bones.length} bones`);
  },
  (progress) => {
    if (progress.total > 0) {
      setModelStatus(`3D 인체 모델을 불러오는 중… ${Math.round((progress.loaded / progress.total) * 100)}%`);
    }
  },
  (error) => {
    console.error('Unable to load the local GLB model.', error);
    setModelStatus('3D 인체 모델을 불러오지 못했습니다. 모델 파일을 확인하세요.', true);
  },
);

function resizeRenderer() {
  const { width, height } = viewport.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resizeRenderer);
resizeRenderer();

let moveAnimation = null;
function moveCamera(viewName) {
  const view = cameraViews[viewName];
  if (!view) return;
  const fromPosition = camera.position.clone();
  const fromTarget = controls.target.clone();
  const startedAt = performance.now();
  const duration = 520;
  moveAnimation = (now) => {
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - (1 - progress) ** 3;
    camera.position.lerpVectors(fromPosition, view.position, eased);
    controls.target.lerpVectors(fromTarget, view.target, eased);
    if (progress === 1) moveAnimation = null;
  };
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === viewName && viewName !== 'reset');
  });
}

document.querySelector('.camera-controls').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]');
  if (button) moveCamera(button.dataset.view);
});

function render(now) {
  requestAnimationFrame(render);
  moveAnimation?.(now);
  controls.update();
  renderer.render(scene, camera);
}

requestAnimationFrame(render);
