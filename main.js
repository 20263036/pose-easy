// Keep all Three.js imports on the same fixed CDN version (see index.html import map).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.querySelector('#scene-canvas');
const viewport = document.querySelector('.viewport');
const modelStatus = document.querySelector('#model-status');
const rightArmUi = {
  shoulderHandles: document.querySelector('#shoulder-handles'),
  elbowHandles: document.querySelector('#elbow-handles'),
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
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const overlayPosition = new THREE.Vector3();
const jointProxies = [];
const rightArmPose = { lift: 0, spread: 0, twist: 0, elbow: 0 };
let selectedJoint = null;
let directDrag = null;

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
  const liftValue = rightArmPose.lift / 100;
  const liftDegrees = liftValue < 0 ? liftValue * 35 : liftValue * 120;
  const liftAngle = THREE.MathUtils.degToRad(liftDegrees);
  const spreadAngle = THREE.MathUtils.degToRad(-rightArmPose.spread);
  const twistAngle = THREE.MathUtils.degToRad(rightArmPose.twist);
  const elbowAngle = THREE.MathUtils.degToRad((rightArmPose.elbow / 100) * 150);

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

  Object.assign(rightArmPose, { lift: 0, spread: 0, twist: 0, elbow: 0 });
  rightArmRig.upperArm.quaternion.copy(rightArmRig.baseUpperArmRotation);
  rightArmRig.lowerArm.quaternion.copy(rightArmRig.baseLowerArmRotation);
}

function createJointProxy(bone, joint, geometry, position) {
  const proxy = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  proxy.name = `${joint}-click-proxy`;
  proxy.userData.joint = joint;
  proxy.position.copy(position);
  bone.add(proxy);
  jointProxies.push(proxy);
}

function setSelectedJoint(joint) {
  selectedJoint = joint;
  rightArmUi.shoulderHandles.hidden = joint !== 'shoulder';
  rightArmUi.elbowHandles.hidden = joint !== 'elbow';
}

function setPointerFromEvent(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
}

function selectJointAtPointer(event) {
  setPointerFromEvent(event);
  mannequinRig.scene?.updateMatrixWorld(true);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(jointProxies, false)[0];
  setSelectedJoint(hit?.object.userData.joint ?? null);
}

function updateHandlePosition() {
  if (!selectedJoint) return;
  const bone = selectedJoint === 'shoulder' ? rightArmRig.upperArm : rightArmRig.lowerArm;
  const handles = selectedJoint === 'shoulder' ? rightArmUi.shoulderHandles : rightArmUi.elbowHandles;
  if (!bone) return;

  bone.getWorldPosition(overlayPosition);
  overlayPosition.project(camera);
  const isVisible = overlayPosition.z >= -1 && overlayPosition.z <= 1;
  handles.hidden = !isVisible;
  if (!isVisible) return;

  const x = (overlayPosition.x * 0.5 + 0.5) * viewport.clientWidth;
  const y = (-overlayPosition.y * 0.5 + 0.5) * viewport.clientHeight;
  handles.style.left = `${THREE.MathUtils.clamp(x + 18, 8, viewport.clientWidth - 124)}px`;
  handles.style.top = `${THREE.MathUtils.clamp(y - 24, 8, viewport.clientHeight - 128)}px`;
}

function beginDirectDrag(event) {
  if (!rightArmRig.upperArm || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const motion = event.currentTarget.dataset.motion;
  directDrag = {
    motion,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startValue: rightArmPose[motion],
    handle: event.currentTarget,
  };
  controls.enabled = false;
  directDrag.handle.classList.add('dragging');
  directDrag.handle.setPointerCapture(event.pointerId);
}

function updateDirectDrag(event) {
  if (!directDrag || event.pointerId !== directDrag.pointerId) return;
  const deltaX = event.clientX - directDrag.startX;
  const deltaY = event.clientY - directDrag.startY;
  const { motion, startValue } = directDrag;
  if (motion === 'lift') rightArmPose.lift = THREE.MathUtils.clamp(startValue - deltaY * 0.7, -100, 100);
  if (motion === 'spread') rightArmPose.spread = THREE.MathUtils.clamp(startValue + deltaX * 0.7, -70, 105);
  if (motion === 'twist') rightArmPose.twist = THREE.MathUtils.clamp(startValue + deltaX * 0.7, -75, 90);
  if (motion === 'elbow') rightArmPose.elbow = THREE.MathUtils.clamp(startValue + deltaY * 0.8, 0, 100);
  applyRightArmPose();
}

function endDirectDrag(event) {
  if (!directDrag || event.pointerId !== directDrag.pointerId) return;
  directDrag.handle.classList.remove('dragging');
  if (directDrag.handle.hasPointerCapture(event.pointerId)) directDrag.handle.releasePointerCapture(event.pointerId);
  directDrag = null;
  controls.enabled = true;
}

for (const handle of document.querySelectorAll('.direct-handle')) {
  handle.addEventListener('pointerdown', beginDirectDrag);
  handle.addEventListener('pointermove', updateDirectDrag);
  handle.addEventListener('pointerup', endDirectDrag);
  handle.addEventListener('pointercancel', endDirectDrag);
  handle.addEventListener('lostpointercapture', endDirectDrag);
}

let canvasPointerDown = null;
canvas.addEventListener('pointerdown', (event) => {
  if (event.button === 0) canvasPointerDown = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener('pointerup', (event) => {
  if (event.button !== 0 || !canvasPointerDown) return;
  const moved = Math.hypot(event.clientX - canvasPointerDown.x, event.clientY - canvasPointerDown.y);
  canvasPointerDown = null;
  if (moved < 6) selectJointAtPointer(event);
});
canvas.addEventListener('pointercancel', () => {
  canvasPointerDown = null;
});

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

    createJointProxy(
      rightArmRig.upperArm,
      'shoulder',
      new THREE.CapsuleGeometry(0.08, 0.12, 4, 10),
      new THREE.Vector3(0, 0.1, 0),
    );
    createJointProxy(
      rightArmRig.lowerArm,
      'elbow',
      new THREE.SphereGeometry(0.11, 16, 12),
      new THREE.Vector3(),
    );

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
    rightArmUi.reset.disabled = false;
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
  camera.updateMatrixWorld();
  mannequinRig.scene?.updateMatrixWorld(true);
  updateHandlePosition();
  renderer.render(scene, camera);
}

requestAnimationFrame(render);
