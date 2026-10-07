// Keep all Three.js imports on the same fixed CDN version (see index.html import map).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.querySelector('#scene-canvas');
const viewport = document.querySelector('.viewport');
const modelStatus = document.querySelector('#model-status');
const rightArmUi = {
  lift: document.querySelector('#shoulder-lift'),
  spread: document.querySelector('#shoulder-spread'),
  twist: document.querySelector('#shoulder-twist'),
  elbow: document.querySelector('#elbow-bend'),
  reset: document.querySelector('#right-arm-reset'),
};

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
controls.enablePan = true;
controls.panSpeed = 1;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};

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

const rightArmRig = {
  upperArm: null,
  lowerArm: null,
  baseUpperArmRotation: null,
  baseLowerArmRotation: null,
};

const localXAxis = new THREE.Vector3(1, 0, 0);
const localYAxis = new THREE.Vector3(0, 1, 0);
const localZAxis = new THREE.Vector3(0, 0, 1);

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

function applyRightArmPose() {
  if (!rightArmRig.upperArm || !rightArmRig.lowerArm) return;

  // These limits describe artist-friendly motions, not the model's raw axes.
  const liftValue = Number(rightArmUi.lift.value) / 100;
  const liftDegrees = liftValue < 0 ? liftValue * 35 : liftValue * 120;
  const liftAngle = THREE.MathUtils.degToRad(liftDegrees);
  const spreadAngle = THREE.MathUtils.degToRad(-Number(rightArmUi.spread.value));
  const twistAngle = THREE.MathUtils.degToRad(Number(rightArmUi.twist.value));
  const elbowAngle = THREE.MathUtils.degToRad((Number(rightArmUi.elbow.value) / 100) * 135);

  const liftRotation = new THREE.Quaternion().setFromAxisAngle(localXAxis, liftAngle);
  const spreadRotation = new THREE.Quaternion().setFromAxisAngle(localZAxis, spreadAngle);
  const twistRotation = new THREE.Quaternion().setFromAxisAngle(localYAxis, twistAngle);
  const elbowRotation = new THREE.Quaternion().setFromAxisAngle(localXAxis, elbowAngle);

  // Multiplying after the bind rotation applies each adjustment in the bone's
  // own coordinate system and leaves every unrelated bone untouched.
  rightArmRig.upperArm.quaternion
    .copy(rightArmRig.baseUpperArmRotation)
    .multiply(liftRotation)
    .multiply(spreadRotation)
    .multiply(twistRotation);
  rightArmRig.lowerArm.quaternion
    .copy(rightArmRig.baseLowerArmRotation)
    .multiply(elbowRotation);
}

function resetRightArmPose() {
  if (!rightArmRig.upperArm || !rightArmRig.lowerArm) return;

  rightArmUi.lift.value = '0';
  rightArmUi.spread.value = '0';
  rightArmUi.twist.value = '0';
  rightArmUi.elbow.value = '0';
  rightArmRig.upperArm.quaternion.copy(rightArmRig.baseUpperArmRotation);
  rightArmRig.lowerArm.quaternion.copy(rightArmRig.baseLowerArmRotation);
}

for (const slider of [rightArmUi.lift, rightArmUi.spread, rightArmUi.twist, rightArmUi.elbow]) {
  slider.addEventListener('input', applyRightArmPose);
}
rightArmUi.reset.addEventListener('click', resetRightArmPose);

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

    rightArmRig.upperArm = mannequinRig.bones.get('upperarm_r');
    rightArmRig.lowerArm = mannequinRig.bones.get('lowerarm_r');
    if (!rightArmRig.upperArm || !rightArmRig.lowerArm) {
      throw new Error('The loaded GLB is missing a required right arm bone.');
    }
    rightArmRig.baseUpperArmRotation = rightArmRig.upperArm.quaternion.clone();
    rightArmRig.baseLowerArmRotation = rightArmRig.lowerArm.quaternion.clone();

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
    console.table([
      { bone: 'upperarm_r', bindRotation: rightArmRig.baseUpperArmRotation.toArray() },
      { bone: 'lowerarm_r', bindRotation: rightArmRig.baseLowerArmRotation.toArray() },
    ]);
    for (const control of Object.values(rightArmUi)) control.disabled = false;
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
