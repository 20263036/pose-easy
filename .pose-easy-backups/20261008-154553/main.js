import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FilesetResolver, PoseLandmarker } from 'https://unpkg.com/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#scene-canvas');
const viewport = $('.viewport');
const modelStatus = $('#model-status');
const poseStatus = $('#pose-status');
const imageInput = $('#pose-image-input');
const extractButton = $('#extract-pose');
const workspace = $('.workspace');
const referenceCard = $('#reference-card');
const referencePreview = $('#reference-preview');
const referenceLandmarks = $('#reference-landmarks');
const landmarkToggle = $('#landmark-toggle');
const referenceCaption = $('#reference-caption');
const hideReferenceButton = $('#hide-reference');
const showReferenceButton = $('#show-reference');
const jointSelect = $('#joint-select');
const poseControls = $('.pose-controls');
const hideControlsButton = $('#hide-controls');
const showControlsButton = $('#show-controls');
const resetJointButton = $('#reset-joint');
const resetPoseButton = $('#reset-pose');
const selectedJointName = $('#selected-joint-name');
const sliders = ['x', 'y', 'z'].map((axis) => ({ axis, input: $('#rotation-' + axis), output: $('#rotation-' + axis + '-value') }));
const simpleSliders = ['x', 'y'].map((axis) => ({
  axis,
  input: $('#primary-' + axis),
  output: $('#primary-' + axis + '-value'),
  label: $('#primary-' + axis + '-label'),
}));

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
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

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
scene.add(new THREE.HemisphereLight(0xddeeff, 0x283040, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(4, 9, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);
const ground = new THREE.Mesh(new THREE.CircleGeometry(8, 64), new THREE.MeshStandardMaterial({ color: 0x303b4c, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const rig = { scene: null, skeleton: null, bones: new Map() };
const editable = [
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r',
];
const labels = {
  pelvis: '골반', spine_01: '허리 아래', spine_02: '허리 위', spine_03: '가슴', neck_01: '목', head: '머리',
  upperarm_l: '왼쪽 위팔', lowerarm_l: '왼쪽 아래팔', hand_l: '왼손', upperarm_r: '오른쪽 위팔', lowerarm_r: '오른쪽 아래팔', hand_r: '오른손',
  thigh_l: '왼쪽 허벅지', calf_l: '왼쪽 종아리', foot_l: '왼발', thigh_r: '오른쪽 허벅지', calf_r: '오른쪽 종아리', foot_r: '오른발',
};
const children = {
  pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'head',
  upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r',
  thigh_l: 'calf_l', calf_l: 'foot_l', thigh_r: 'calf_r', calf_r: 'foot_r',
};
const bind = new Map();
const automatic = new Map();
const offsets = new Map();
const restDirections = new Map();
const proxies = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tempQuaternion = new THREE.Quaternion();
let selectedBone = null;
let poseLandmarker = null;
let selectedImage = null;
let selectedImageUrl = null;
let lastImageLandmarks = null;
let showLandmarks = true;
let referenceCollapsed = false;
let controlsCollapsed = false;
let manualEditActive = false;
const undoStack = [];
const MAX_UNDO = 40;

window.poseEasyMannequin = { get scene() { return rig.scene; }, get skeleton() { return rig.skeleton; }, getBone(name) { return rig.bones.get(name) || null; } };
function setModelStatus(message, error = false) { modelStatus.textContent = message; modelStatus.classList.toggle('error', error); }
function setPoseStatus(message, error = false) { poseStatus.textContent = message; poseStatus.classList.toggle('error', error); }
function updatePanelLayout() {
  const canShowReference = !referenceCard.hidden;
  workspace.classList.toggle('reference-collapsed', canShowReference && referenceCollapsed);
  poseControls.hidden = controlsCollapsed;
  showReferenceButton.hidden = !(canShowReference && referenceCollapsed);
  showControlsButton.hidden = !controlsCollapsed;
  // Let the grid settle before updating only the renderer dimensions. Neither
  // camera position nor OrbitControls target is touched, so the user's view
  // and zoom remain intact while the drawing surface expands or contracts.
  requestAnimationFrame(() => {
    resizeRenderer();
    if (canShowReference && !referenceCollapsed) drawReferenceLandmarks();
  });
}
hideReferenceButton.addEventListener('click', () => {
  referenceCollapsed = true;
  updatePanelLayout();
});
showReferenceButton.addEventListener('click', () => {
  referenceCollapsed = false;
  updatePanelLayout();
});
hideControlsButton.addEventListener('click', () => {
  controlsCollapsed = true;
  updatePanelLayout();
});
showControlsButton.addEventListener('click', () => {
  controlsCollapsed = false;
  updatePanelLayout();
});
function offsetOf(name) {
  if (!offsets.has(name)) offsets.set(name, new THREE.Euler(0, 0, 0, 'XYZ'));
  return offsets.get(name);
}
function applyPose() {
  editable.forEach((name) => {
    const bone = rig.bones.get(name);
    const base = automatic.get(name) || bind.get(name);
    if (bone && base) bone.quaternion.copy(base).multiply(tempQuaternion.setFromEuler(offsetOf(name)));
  });
  if (rig.scene) rig.scene.updateMatrixWorld(true);
}
function snapshotOffsets() {
  return Object.fromEntries(editable.map((name) => {
    const offset = offsetOf(name);
    return [name, [offset.x, offset.y, offset.z]];
  }));
}
function restoreOffsets(snapshot) {
  editable.forEach((name) => {
    const value = snapshot[name];
    if (value) offsetOf(name).set(value[0], value[1], value[2], 'XYZ');
  });
  applyPose();
  refreshSliders();
}
function beginManualEdit() {
  if (manualEditActive || !selectedBone) return;
  undoStack.push(snapshotOffsets());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  manualEditActive = true;
}
function finishManualEdit() { manualEditActive = false; }
function undoLastEdit() {
  const previous = undoStack.pop();
  if (!previous) {
    setPoseStatus('되돌릴 보정이 없습니다.');
    return;
  }
  restoreOffsets(previous);
  // Some browsers finish their native range-input key handling after the
  // document keydown listener. Apply the same snapshot on the next frame so
  // Ctrl+Z always wins over that deferred input update.
  requestAnimationFrame(() => restoreOffsets(previous));
  setPoseStatus('마지막 관절 보정을 되돌렸습니다.');
}
function simpleLabelsFor(name) {
  if (/^(pelvis|spine|neck|head)/.test(name)) return ['기울기 보정', '방향 보정'];
  // The GLB has different local axes on mirrored limbs. Do not label an
  // unverified local axis as "bend"; keep the simple wording truthful and
  // expose exact X/Y/Z only in the advanced panel.
  if (/^(lowerarm|calf)/.test(name)) return ['관절 각도 보정', '보조 방향'];
  if (/^(hand|foot)/.test(name)) return ['방향 보정', '방향 전환'];
  return ['방향 보정', '보조 방향'];
}
function updateProxyStyles() {
  proxies.forEach((proxy) => {
    const selected = proxy.userData.boneName === selectedBone;
    proxy.material.opacity = selected ? 0.9 : 0.18;
    proxy.material.color.set(selected ? 0xfbbf24 : 0x38bdf8);
    proxy.scale.setScalar(selected ? 1.55 : 0.88);
  });
}
function refreshSliders() {
  const offset = selectedBone ? offsetOf(selectedBone) : new THREE.Euler();
  sliders.forEach(({ axis, input, output }) => {
    const degrees = Math.round(THREE.MathUtils.radToDeg(offset[axis]));
    input.value = degrees;
    output.value = degrees + '°';
  });
  const [firstLabel, secondLabel] = selectedBone ? simpleLabelsFor(selectedBone) : ['방향 보정', '보조 방향'];
  simpleSliders.forEach(({ axis, input, output, label }, index) => {
    const degrees = Math.round(THREE.MathUtils.radToDeg(offset[axis]));
    input.value = degrees;
    output.value = degrees + '°';
    label.textContent = index === 0 ? firstLabel : secondLabel;
  });
}
function selectBone(name) {
  selectedBone = name;
  if (name) jointSelect.value = name;
  selectedJointName.textContent = name ? labels[name] : '관절을 선택하세요';
  updateProxyStyles();
  refreshSliders();
}
function setControlsEnabled(enabled) {
  jointSelect.disabled = !enabled;
  resetJointButton.disabled = !enabled;
  resetPoseButton.disabled = !enabled;
  sliders.forEach(({ input }) => { input.disabled = !enabled; });
  simpleSliders.forEach(({ input }) => { input.disabled = !enabled; });
}
function resetPose(announce = true) {
  editable.forEach((name) => {
    automatic.set(name, bind.get(name).clone());
    offsetOf(name).set(0, 0, 0, 'XYZ');
  });
  applyPose();
  refreshSliders();
  undoStack.length = 0;
  if (announce) setPoseStatus('기본 포즈로 되돌렸습니다.');
}
jointSelect.addEventListener('change', () => selectBone(jointSelect.value));
resetJointButton.addEventListener('click', () => {
  if (!selectedBone) return;
  beginManualEdit();
  offsetOf(selectedBone).set(0, 0, 0, 'XYZ');
  applyPose();
  refreshSliders();
  finishManualEdit();
  setPoseStatus(labels[selectedBone] + '을(를) 자동 생성 직후 상태로 되돌렸습니다.');
});
resetPoseButton.addEventListener('click', () => resetPose());
function connectRotationSlider({ axis, input, output }) {
  input.addEventListener('pointerdown', beginManualEdit);
  input.addEventListener('keydown', (event) => {
    // Do not create a new history entry for the Ctrl/Cmd+Z shortcut itself.
    if (!event.ctrlKey && !event.metaKey) beginManualEdit();
  });
  input.addEventListener('input', () => {
    if (!selectedBone) return;
    beginManualEdit();
    offsetOf(selectedBone)[axis] = THREE.MathUtils.degToRad(Number(input.value));
    output.value = input.value + '°';
    applyPose();
  });
  input.addEventListener('change', finishManualEdit);
}
sliders.forEach(connectRotationSlider);
simpleSliders.forEach(connectRotationSlider);
document.addEventListener('pointerup', finishManualEdit);
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    finishManualEdit();
    undoLastEdit();
  }
});

function addProxy(bone) {
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(0.052, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55, depthTest: false }),
  );
  proxy.userData.boneName = bone.name;
  proxy.renderOrder = 2;
  bone.add(proxy);
  proxies.push(proxy);
}
function jointAtPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  if (rig.scene) rig.scene.updateMatrixWorld(true);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(proxies, false)[0];
  return hit ? hit.object.userData.boneName : null;
}
let pointerDown = null;
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  const jointName = jointAtPointer(event);
  pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId, jointName };
  // Consume a press on a joint marker. A click chooses the joint; a drag on
  // empty canvas remains reserved for OrbitControls camera movement.
  if (jointName) event.stopImmediatePropagation();
}, true);
canvas.addEventListener('pointerup', (event) => {
  if (!pointerDown || pointerDown.id !== event.pointerId) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  const jointName = pointerDown.jointName;
  pointerDown = null;
  if (jointName && moved < 6) selectBone(jointName);
}, true);
canvas.addEventListener('pointercancel', () => { pointerDown = null; });

function captureRestDirections() {
  rig.scene.updateMatrixWorld(true);
  Object.entries(children).forEach(([name, childName]) => {
    const bone = rig.bones.get(name);
    const child = rig.bones.get(childName);
    if (bone && child) restDirections.set(name, bone.worldToLocal(child.getWorldPosition(new THREE.Vector3())).normalize());
  });
}
function makeBasis(left, up) {
  const x = left.clone().normalize();
  const y = up.clone().sub(x.clone().multiplyScalar(up.dot(x))).normalize();
  const z = x.clone().cross(y).normalize();
  if (!Number.isFinite(z.lengthSq()) || z.lengthSq() < 0.9) throw new Error('포즈의 몸통 방향을 계산할 수 없습니다. 전신이 보이는 이미지를 사용하세요.');
  return { x, y, z };
}
function midpoint(a, b) { return a.clone().add(b).multiplyScalar(0.5); }
const aimLimits = {
  pelvis: 24, neck_01: 36,
  upperarm_l: 142, upperarm_r: 142,
  lowerarm_l: 150, lowerarm_r: 150,
  thigh_l: 118, thigh_r: 118,
  calf_l: 138, calf_r: 138,
  foot_l: 62, foot_r: 62,
};

function worldBoneDirection(name) {
  const bone = rig.bones.get(name);
  const restDirection = restDirections.get(name);
  return bone && restDirection
    ? restDirection.clone().transformDirection(bone.matrixWorld).normalize()
    : new THREE.Vector3(0, 1, 0);
}

function clampRotation(quaternion, maxDegrees) {
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(quaternion.w, -1, 1));
  if (angle <= THREE.MathUtils.degToRad(maxDegrees)) return quaternion;
  return new THREE.Quaternion().identity().slerp(quaternion, THREE.MathUtils.degToRad(maxDegrees) / angle);
}

function blendDirections(from, to, weight) {
  return from.clone().lerp(to.clone().normalize(), weight).normalize();
}

function capHingeBend(upperBoneName, desiredDirection, maxDegrees) {
  const upperDirection = worldBoneDirection(upperBoneName);
  const bendAngle = upperDirection.angleTo(desiredDirection);
  const maximum = THREE.MathUtils.degToRad(maxDegrees);
  return bendAngle > maximum
    ? blendDirections(upperDirection, desiredDirection, maximum / bendAngle)
    : desiredDirection;
}

function keepLegOnItsSide(direction, side, bodyLeft) {
  const result = direction.clone().normalize();
  const lateralAmount = result.dot(bodyLeft);
  const minimum = 0.08;
  const sign = side === 'l' ? 1 : -1;
  // A 2D estimate can accidentally place a knee on the opposite side of the
  // pelvis. Preserve lifting motions, but never let a thigh strongly cross it.
  if (sign * lateralAmount < -minimum) {
    result.addScaledVector(bodyLeft, sign * minimum - lateralAmount).normalize();
  }
  return result;
}

function preserveScreenSpaceThighElevation(target, hipIndex, kneeIndex, imageLandmarks, modelBasis) {
  if (!imageLandmarks?.[hipIndex] || !imageLandmarks?.[kneeIndex]) {
    return { direction: target, applied: false };
  }
  const imageDx = imageLandmarks[kneeIndex].x - imageLandmarks[hipIndex].x;
  const imageDy = imageLandmarks[kneeIndex].y - imageLandmarks[hipIndex].y;
  const horizontalImageDistance = Math.abs(imageDx);
  const screenSlope = Math.abs(imageDy) / Math.max(horizontalImageDistance, 1e-4);
  // Only intervene when the visible thigh is clearly near-horizontal. This is
  // a screen-space constraint, not an invented depth estimate.
  if (horizontalImageDistance < 0.04 || screenSlope > 0.55) {
    return { direction: target, applied: false, screenSlope };
  }
  const vertical = target.dot(modelBasis.y);
  const horizontal = target.clone().addScaledVector(modelBasis.y, -vertical);
  if (horizontal.lengthSq() < 1e-6) return { direction: target, applied: false, screenSlope };
  const correctedVertical = Math.sign(vertical || -1) * horizontal.length() * screenSlope;
  // Do not increase an already plausible vertical component; only prevent a
  // world-landmark estimate from erasing a visibly lifted thigh.
  if (Math.abs(vertical) <= Math.abs(correctedVertical)) {
    return { direction: target, applied: false, screenSlope };
  }
  return {
    direction: horizontal.normalize().addScaledVector(modelBasis.y, correctedVertical).normalize(),
    applied: true,
    screenSlope: Number(screenSlope.toFixed(3)),
  };
}

function aimBone(name, desiredWorldDirection, maxDegrees = aimLimits[name] ?? 120) {
  const bone = rig.bones.get(name);
  const restDirection = restDirections.get(name);
  if (!bone || !restDirection || desiredWorldDirection.lengthSq() < 1e-7) return null;
  rig.scene.updateMatrixWorld(true);
  const currentDirection = restDirection.clone().transformDirection(bone.matrixWorld).normalize();
  const requestedDirection = desiredWorldDirection.clone().normalize();
  const requestedDegrees = THREE.MathUtils.radToDeg(currentDirection.angleTo(requestedDirection));
  // setFromUnitVectors is the shortest arc. It deliberately retains the
  // bind-pose roll, which prevents an aim target from adding arbitrary twist.
  const worldDelta = clampRotation(
    new THREE.Quaternion().setFromUnitVectors(currentDirection, requestedDirection),
    maxDegrees,
  );
  const parentRotation = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const localDelta = parentRotation.clone().invert().multiply(worldDelta).multiply(parentRotation);
  bone.quaternion.copy(localDelta).multiply(bind.get(name));
  rig.scene.updateMatrixWorld(true);
  return {
    requestedDegrees: Number(requestedDegrees.toFixed(1)),
    appliedDegrees: Number(Math.min(requestedDegrees, maxDegrees).toFixed(1)),
    target: requestedDirection.toArray().map((value) => Number(value.toFixed(3))),
    actual: worldBoneDirection(name).toArray().map((value) => Number(value.toFixed(3))),
  };
}

const lm = { NOSE: 0, LS: 11, RS: 12, LE: 13, RE: 14, LW: 15, RW: 16, LH: 23, RH: 24, LK: 25, RK: 26, LA: 27, RA: 28, LF: 31, RF: 32 };
const landmarkConnections = [
  [lm.LS, lm.RS], [lm.LS, lm.LE], [lm.LE, lm.LW], [lm.RS, lm.RE], [lm.RE, lm.RW],
  [lm.LS, lm.LH], [lm.RS, lm.RH], [lm.LH, lm.RH],
  [lm.LH, lm.LK], [lm.LK, lm.LA], [lm.LA, lm.LF],
  [lm.RH, lm.RK], [lm.RK, lm.RA], [lm.RA, lm.RF], [lm.LS, lm.NOSE], [lm.RS, lm.NOSE],
];
function drawReferenceLandmarks() {
  const context = referenceLandmarks.getContext('2d');
  const rect = referenceLandmarks.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  referenceLandmarks.width = Math.max(1, Math.round(rect.width * ratio));
  referenceLandmarks.height = Math.max(1, Math.round(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  referenceLandmarks.hidden = !showLandmarks;
  if (!showLandmarks || !lastImageLandmarks || rect.width < 2 || rect.height < 2) return;
  const pointAt = (index) => lastImageLandmarks[index] && {
    x: lastImageLandmarks[index].x * rect.width,
    y: lastImageLandmarks[index].y * rect.height,
    confidence: confidence(lastImageLandmarks[index]),
  };
  context.lineWidth = 2.4;
  context.strokeStyle = 'rgba(34, 211, 238, .88)';
  landmarkConnections.forEach(([start, end]) => {
    const a = pointAt(start);
    const b = pointAt(end);
    if (!a || !b || Math.min(a.confidence, b.confidence) < 0.35) return;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  });
  Object.values(lm).forEach((index) => {
    const point = pointAt(index);
    if (!point || point.confidence < 0.35) return;
    context.beginPath();
    context.fillStyle = '#fbbf24';
    context.arc(point.x, point.y, 4.4, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 1.2;
    context.strokeStyle = '#172033';
    context.stroke();
  });
}
landmarkToggle.addEventListener('click', () => {
  showLandmarks = !showLandmarks;
  landmarkToggle.textContent = '관절 표시: ' + (showLandmarks ? '켜짐' : '꺼짐');
  landmarkToggle.setAttribute('aria-pressed', String(showLandmarks));
  drawReferenceLandmarks();
});
referencePreview.addEventListener('load', drawReferenceLandmarks);
new ResizeObserver(drawReferenceLandmarks).observe(referenceLandmarks.parentElement);
function confidence(point) { return point && (point.visibility ?? point.presence ?? 1); }
function applyLandmarks(landmarks, {
  depthWeight = 0.45,
  hasMetricDepth = false,
  thighDepthMode = 'preserve',
  imageLandmarks = null,
} = {}) {
  if (Object.values(lm).some((index) => !landmarks[index] || confidence(landmarks[index]) < 0.35)) {
    throw new Error('몸 전체가 선명하게 보이는 이미지를 사용하세요.');
  }
  const point = (index) => new THREE.Vector3(landmarks[index].x, landmarks[index].y, landmarks[index].z);
  const leftShoulder = point(lm.LS);
  const rightShoulder = point(lm.RS);
  const leftHip = point(lm.LH);
  const rightHip = point(lm.RH);
  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const sourceBasis = makeBasis(leftShoulder.clone().sub(rightShoulder), shoulderCenter.clone().sub(hipCenter));

  resetPose(false);
  rig.scene.updateMatrixWorld(true);
  const modelLeft = rig.bones.get('upperarm_l').getWorldPosition(new THREE.Vector3())
    .sub(rig.bones.get('upperarm_r').getWorldPosition(new THREE.Vector3()));
  const modelUp = rig.bones.get('head').getWorldPosition(new THREE.Vector3())
    .sub(rig.bones.get('pelvis').getWorldPosition(new THREE.Vector3()));
  const modelBasis = makeBasis(modelLeft, modelUp);
  const mapVector = (vector, selectedDepthWeight = depthWeight) => modelBasis.x.clone().multiplyScalar(vector.dot(sourceBasis.x))
    .addScaledVector(modelBasis.y, vector.dot(sourceBasis.y))
    // A single image has weaker depth evidence than screen-plane evidence.
    .addScaledVector(modelBasis.z, vector.dot(sourceBasis.z) * selectedDepthWeight);
  const toward = (start, end, localDepthWeight = 1, selectedDepthWeight = depthWeight) => {
    const mapped = mapVector(point(end).sub(point(start)), selectedDepthWeight);
    if (localDepthWeight === 1) return mapped;
    const inPlane = modelBasis.x.clone().multiplyScalar(mapped.dot(modelBasis.x))
      .addScaledVector(modelBasis.y, mapped.dot(modelBasis.y));
    return inPlane.addScaledVector(modelBasis.z, mapped.dot(modelBasis.z) * localDepthWeight).normalize();
  };

  // Keep the centre of mass above the feet. The root follows a clear lean or
  // turn, but it does not chase every uncertain depth estimate.
  const torsoDirection = mapVector(shoulderCenter.clone().sub(hipCenter));
  aimBone('pelvis', blendDirections(worldBoneDirection('pelvis'), torsoDirection, 0.48));
  aimBone('neck_01', toward(lm.LS, lm.NOSE, 0.42).add(toward(lm.RS, lm.NOSE, 0.42)));

  aimBone('upperarm_l', toward(lm.LS, lm.LE, 0.78));
  aimBone('lowerarm_l', capHingeBend('upperarm_l', toward(lm.LE, lm.LW, 0.62), 150));
  aimBone('upperarm_r', toward(lm.RS, lm.RE, 0.78));
  aimBone('lowerarm_r', capHingeBend('upperarm_r', toward(lm.RE, lm.RW, 0.62), 150));

  // The hip-to-knee vector is the pose's primary action. Metric world
  // landmarks can legitimately encode a lifted knee almost entirely in depth,
  // so do not damp that component a second time. A 2D-only fallback remains
  // conservative because it does not have reliable metric depth.
  const thighDepthWeight = thighDepthMode === 'legacy'
    ? depthWeight
    : hasMetricDepth ? 1 : Math.min(depthWeight, 0.12);
  const thighLocalDepthWeight = thighDepthMode === 'legacy' ? 0.42 : 1;
  const leftThighRawTarget = keepLegOnItsSide(
    toward(lm.LH, lm.LK, thighLocalDepthWeight, thighDepthWeight),
    'l',
    modelBasis.x,
  );
  const rightThighRawTarget = keepLegOnItsSide(
    toward(lm.RH, lm.RK, thighLocalDepthWeight, thighDepthWeight),
    'r',
    modelBasis.x,
  );
  const leftScreenCorrection = thighDepthMode === 'preserve'
    ? preserveScreenSpaceThighElevation(leftThighRawTarget, lm.LH, lm.LK, imageLandmarks, modelBasis)
    : { direction: leftThighRawTarget, applied: false };
  const rightScreenCorrection = thighDepthMode === 'preserve'
    ? preserveScreenSpaceThighElevation(rightThighRawTarget, lm.RH, lm.RK, imageLandmarks, modelBasis)
    : { direction: rightThighRawTarget, applied: false };
  const leftThighTarget = leftScreenCorrection.direction;
  const rightThighTarget = rightScreenCorrection.direction;
  const leftThighAim = aimBone('thigh_l', leftThighTarget);
  aimBone('calf_l', capHingeBend('thigh_l', toward(lm.LK, lm.LA, 0.3), 138));
  aimBone('foot_l', toward(lm.LA, lm.LF, 0.25));
  const rightThighAim = aimBone('thigh_r', rightThighTarget);
  aimBone('calf_r', capHingeBend('thigh_r', toward(lm.RK, lm.RA, 0.3), 138));
  aimBone('foot_r', toward(lm.RA, lm.RF, 0.25));
  editable.forEach((name) => automatic.set(name, rig.bones.get(name).quaternion.clone()));
  applyPose();
  refreshSliders();
  return {
    source: {
      left: { hip: point(lm.LH).toArray(), knee: point(lm.LK).toArray(), ankle: point(lm.LA).toArray() },
      right: { hip: point(lm.RH).toArray(), knee: point(lm.RK).toArray(), ankle: point(lm.RA).toArray() },
    },
    target: {
      leftThighRaw: leftThighRawTarget.toArray().map((value) => Number(value.toFixed(3))),
      rightThighRaw: rightThighRawTarget.toArray().map((value) => Number(value.toFixed(3))),
      leftThigh: leftThighTarget.toArray().map((value) => Number(value.toFixed(3))),
      rightThigh: rightThighTarget.toArray().map((value) => Number(value.toFixed(3))),
    },
    screenCorrection: { left: leftScreenCorrection, right: rightScreenCorrection },
    applied: { leftThigh: leftThighAim, rightThigh: rightThighAim },
  };
}

function compareThighDepthStrategies(landmarks, options, imageLandmarks) {
  const legacy = applyLandmarks(landmarks, { ...options, thighDepthMode: 'legacy' });
  const metricOnly = applyLandmarks(landmarks, { ...options, thighDepthMode: 'preserve' });
  const improved = applyLandmarks(landmarks, { ...options, thighDepthMode: 'preserve', imageLandmarks });
  const report = { legacy, metricOnly, improved };
  console.info('Pose Easy actual-image thigh comparison: ' + JSON.stringify(report));
  return report;
}

function makeSyntheticLandmarks(asymmetric = false) {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const set = (index, x, y, z = 0) => { points[index] = { x, y, z, visibility: 1 }; };
  set(lm.NOSE, 0, -1.52);
  set(lm.LS, 0.55, -1.0); set(lm.RS, -0.55, -1.0);
  set(lm.LH, 0.30, 0); set(lm.RH, -0.30, 0);
  set(lm.LE, 1.18, -1.0); set(lm.LW, 1.72, -0.98);
  set(lm.RE, -1.18, -1.0); set(lm.RW, -1.72, -0.98);
  set(lm.LK, 0.30, 0.94); set(lm.LA, 0.30, 1.86); set(lm.LF, 0.30, 1.98, -0.20);
  set(lm.RK, -0.30, 0.94); set(lm.RA, -0.30, 1.86); set(lm.RF, -0.30, 1.98, -0.20);
  if (asymmetric) {
    set(lm.RE, -0.88, -1.68, 0.16); set(lm.RW, -0.42, -2.18, 0.22);
    set(lm.LK, 0.34, -0.30, 0.16); set(lm.LA, 0.36, 0.42, 0.25); set(lm.LF, 0.36, 0.58, 0.02);
  }
  return points;
}

function makeForwardRaisedKneeLandmarks() {
  const points = makeSyntheticLandmarks(false);
  // The knee is high mostly because it comes toward the camera. This mirrors
  // the failure mode that a front-facing 2D image can produce.
  points[lm.LK] = { x: 0.34, y: 0.20, z: -0.75, visibility: 1 };
  points[lm.LA] = { x: 0.36, y: 0.82, z: -0.98, visibility: 1 };
  points[lm.LF] = { x: 0.36, y: 0.98, z: -1.06, visibility: 1 };
  return points;
}

function validateRetargeting() {
  const reports = [];
  for (const test of [
    { name: 'T-pose', points: makeSyntheticLandmarks(false) },
    { name: 'asymmetric raised arm and leg', points: makeSyntheticLandmarks(true) },
    { name: 'forward-raised knee', points: makeForwardRaisedKneeLandmarks() },
  ]) {
    applyLandmarks(test.points, { depthWeight: 0.42, hasMetricDepth: true });
    rig.scene.updateMatrixWorld(true);
    const rotationsAreFinite = editable.every((name) => rig.bones.get(name).quaternion.toArray().every(Number.isFinite));
    const leftFoot = rig.bones.get('foot_l').getWorldPosition(new THREE.Vector3());
    const rightFoot = rig.bones.get('foot_r').getWorldPosition(new THREE.Vector3());
    reports.push({ test: test.name, rotationsAreFinite, feetSeparated: leftFoot.distanceTo(rightFoot) > 0.12 });
  }
  resetPose(false);
  console.info('Pose Easy retarget validation: ' + JSON.stringify(reports));
  return reports;
}

async function initialisePoseLandmarker() {
  try {
    const vision = await FilesetResolver.forVisionTasks('https://unpkg.com/@mediapipe/tasks-vision@0.10.35/wasm');
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task' },
      runningMode: 'IMAGE',
      numPoses: 1,
    });
    extractButton.disabled = !selectedImage;
    setPoseStatus('참고 이미지를 선택하면 포즈를 추출할 수 있습니다.');
  } catch (error) {
    console.error('Pose Landmarker initialisation failed.', error);
    setPoseStatus('포즈 분석기를 불러오지 못했습니다. 인터넷 연결을 확인하세요.', true);
  }
}
imageInput.addEventListener('change', () => {
  const file = imageInput.files && imageInput.files[0];
  if (!file) return;
  if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl);
  selectedImage = new Image();
  selectedImageUrl = URL.createObjectURL(file);
  selectedImage.onload = () => {
    referencePreview.src = selectedImageUrl;
    referenceCard.hidden = false;
    updatePanelLayout();
    lastImageLandmarks = null;
    referenceCaption.textContent = '사진을 분석하면 인식된 주요 관절을 표시합니다.';
    drawReferenceLandmarks();
    extractButton.disabled = !poseLandmarker;
    setPoseStatus('이미지를 불러왔습니다. “이미지에서 포즈 추출”을 누르세요.');
  };
  selectedImage.onerror = () => setPoseStatus('이미지를 읽을 수 없습니다.', true);
  selectedImage.src = selectedImageUrl;
});
extractButton.addEventListener('click', () => {
  if (!poseLandmarker || !selectedImage) return;
  try {
    extractButton.disabled = true;
    setPoseStatus('이미지에서 관절을 찾는 중…');
    const result = poseLandmarker.detect(selectedImage);
    const worldPoints = result.worldLandmarks && result.worldLandmarks[0];
    const points = worldPoints || (result.landmarks && result.landmarks[0]);
    if (!points) throw new Error('인물의 포즈를 찾지 못했습니다.');
    const imagePoints = result.landmarks && result.landmarks[0];
    compareThighDepthStrategies(points, {
      depthWeight: worldPoints ? 0.52 : 0.18,
      hasMetricDepth: Boolean(worldPoints),
    }, imagePoints);
    if (imagePoints) {
      lastImageLandmarks = imagePoints;
      referenceCaption.textContent = '노란 점과 청록 선은 사진에서 인식한 주요 관절입니다.';
      drawReferenceLandmarks();
      const imageJoint = (index) => [imagePoints[index].x, imagePoints[index].y, imagePoints[index].z]
        .map((value) => Number(value.toFixed(4)));
      console.info('Pose Easy actual-image 2D joints: ' + JSON.stringify({
        left: { hip: imageJoint(lm.LH), knee: imageJoint(lm.LK), ankle: imageJoint(lm.LA) },
        right: { hip: imageJoint(lm.RH), knee: imageJoint(lm.RK), ankle: imageJoint(lm.RA) },
      }));
    }
    setPoseStatus('포즈를 적용했습니다. 관절을 클릭하거나 오른쪽 패널에서 보정하세요.');
  } catch (error) {
    console.error('Pose extraction failed.', error);
    setPoseStatus(error.message || '포즈를 적용하지 못했습니다.', true);
  } finally {
    extractButton.disabled = false;
  }
});

new GLTFLoader().load('./assets/models/human-base-rigged.glb', (gltf) => {
  const skinnedMesh = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
  if (!skinnedMesh || !skinnedMesh.skeleton) throw new Error('The loaded GLB does not contain a skinned skeleton.');
  rig.scene = gltf.scene;
  rig.skeleton = skinnedMesh.skeleton;
  rig.bones = new Map(rig.skeleton.bones.map((bone) => [bone.name, bone]));
  const missing = editable.filter((name) => !rig.bones.has(name));
  if (missing.length) throw new Error('The GLB is missing bones: ' + missing.join(', '));
  editable.forEach((name) => {
    const bone = rig.bones.get(name);
    bind.set(name, bone.quaternion.clone());
    automatic.set(name, bone.quaternion.clone());
    offsets.set(name, new THREE.Euler(0, 0, 0, 'XYZ'));
    addProxy(bone);
    jointSelect.add(new Option(labels[name], name));
  });
  rig.scene.scale.setScalar(3.5);
  rig.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(rig.scene);
  const center = bounds.getCenter(new THREE.Vector3());
  rig.scene.position.set(-center.x, -bounds.min.y, -center.z);
  rig.scene.traverse((object) => {
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
  });
  scene.add(rig.scene);
  rig.scene.updateMatrixWorld(true);
  captureRestDirections();
  const validationResults = validateRetargeting();
  if (!validationResults.every((result) => result.rotationsAreFinite && result.feetSeparated)) {
    console.warn('Pose Easy retarget validation needs attention.', validationResults);
  }
  selectBone('upperarm_r');
  setControlsEnabled(true);
  setModelStatus('인체 모델 로드 완료 · ' + rig.skeleton.bones.length + ' bones');
  // Internal visual QA hook: it is inert in normal use, but lets us inspect
  // the exact same retargeting path with deterministic landmark fixtures.
  const previewPose = new URLSearchParams(window.location.search).get('previewPose');
  if (previewPose === 't' || previewPose === 'asymmetric' || previewPose === 'forward-knee') {
    const points = previewPose === 'forward-knee'
      ? makeForwardRaisedKneeLandmarks()
      : makeSyntheticLandmarks(previewPose === 'asymmetric');
    applyLandmarks(points, { depthWeight: 0.42, hasMetricDepth: true });
    const label = previewPose === 't' ? 'T자' : previewPose === 'asymmetric' ? '비대칭' : '카메라 방향 무릎 상승';
    setPoseStatus('검증용 ' + label + ' 포즈를 표시하고 있습니다.');
  }
}, (progress) => {
  if (progress.total > 0) setModelStatus('3D 인체 모델을 불러오는 중… ' + Math.round((progress.loaded / progress.total) * 100) + '%');
}, (error) => {
  console.error('Unable to load the local GLB model.', error);
  setModelStatus('3D 인체 모델을 불러오지 못했습니다. 모델 파일을 확인하세요.', true);
});

function resizeRenderer() {
  const { width, height } = viewport.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);
resizeRenderer();
new ResizeObserver(resizeRenderer).observe(viewport);
let moveAnimation = null;
function moveCamera(name) {
  const view = cameraViews[name];
  if (!view) return;
  const fromPosition = camera.position.clone();
  const fromTarget = controls.target.clone();
  const startedAt = performance.now();
  moveAnimation = (now) => {
    const progress = Math.min((now - startedAt) / 520, 1);
    const eased = 1 - (1 - progress) ** 3;
    camera.position.lerpVectors(fromPosition, view.position, eased);
    controls.target.lerpVectors(fromTarget, view.target, eased);
    if (progress === 1) moveAnimation = null;
  };
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name && name !== 'reset'));
}
$('.camera-controls').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]');
  if (button) moveCamera(button.dataset.view);
});
function render(now) {
  requestAnimationFrame(render);
  if (moveAnimation) moveAnimation(now);
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(render);
initialisePoseLandmarker();
