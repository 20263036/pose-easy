// Keep all Three.js imports on the same fixed CDN version (see index.html import map).
import * as THREE from 'three';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/controls/OrbitControls.js';

const canvas = document.querySelector('#scene-canvas');
const viewport = document.querySelector('.viewport');

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

// Temporary mannequin: each limb has explicit endpoints, making a future
// VRM skeleton adapter or joint manipulation layer easy to introduce here.
const mannequin = new THREE.Group();
mannequin.name = 'temporary-mannequin';
scene.add(mannequin);

const skin = new THREE.MeshStandardMaterial({ color: 0x9eb5ca, roughness: 0.72, metalness: 0.02 });
const jointMaterial = new THREE.MeshStandardMaterial({ color: 0x6d88a2, roughness: 0.66 });

function addJoint(position, radius = 0.18) {
  const joint = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 16), jointMaterial);
  joint.position.copy(position);
  joint.castShadow = true;
  mannequin.add(joint);
}

function addLimb(start, end, radius = 0.16) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const limb = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 16), skin);
  limb.position.copy(center);
  limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  limb.castShadow = true;
  mannequin.add(limb);
}

function buildTemporaryMannequin() {
  // Coordinate data is deliberately isolated from rendering for later pose controls.
  const points = {
    pelvis: new THREE.Vector3(0, 2.7, 0), chest: new THREE.Vector3(0, 4.25, 0), neck: new THREE.Vector3(0, 5.05, 0),
    leftShoulder: new THREE.Vector3(-0.72, 4.7, 0), leftElbow: new THREE.Vector3(-1.25, 3.82, 0), leftWrist: new THREE.Vector3(-1.45, 2.95, 0),
    rightShoulder: new THREE.Vector3(0.72, 4.7, 0), rightElbow: new THREE.Vector3(1.25, 3.82, 0), rightWrist: new THREE.Vector3(1.45, 2.95, 0),
    leftHip: new THREE.Vector3(-0.43, 2.62, 0), leftKnee: new THREE.Vector3(-0.48, 1.32, 0.08), leftAnkle: new THREE.Vector3(-0.48, 0.2, 0),
    rightHip: new THREE.Vector3(0.43, 2.62, 0), rightKnee: new THREE.Vector3(0.48, 1.32, 0.08), rightAnkle: new THREE.Vector3(0.48, 0.2, 0),
  };
  addLimb(points.pelvis, points.chest, 0.47);
  addLimb(points.chest, points.neck, 0.19);
  for (const side of ['left', 'right']) {
    addLimb(points[`${side}Shoulder`], points[`${side}Elbow`]);
    addLimb(points[`${side}Elbow`], points[`${side}Wrist`], 0.13);
    addLimb(points[`${side}Hip`], points[`${side}Knee`], 0.22);
    addLimb(points[`${side}Knee`], points[`${side}Ankle`], 0.18);
  }
  Object.values(points).forEach((point) => addJoint(point));

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.48, 24, 20), skin);
  head.scale.set(0.9, 1.15, 0.9);
  head.position.set(0, 5.62, 0);
  head.castShadow = true;
  mannequin.add(head);
}

buildTemporaryMannequin();

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
