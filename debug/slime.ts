// 슬라임 비주얼 미리보기 — Stage.buildEnemyVisual 의 슬라임 분기와
// syncEnemies 의 꿀렁임 공식을 그대로 옮겨 확인한다 (치수·색·불투명도 동일).
// 왼쪽부터: 대기(꿀렁 최대치) / 예고 만작(부풀기) / 도약 스트레치 / 새끼 슬라임.
// 바닥에 점액 장판 샘플 두 장 (갓 떨군 것 / 반쯤 마른 것).
import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101014);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const key = new THREE.PointLight(0xffe0b0, 1.5, 30, 0);
key.position.set(2, 3.5, -4);
scene.add(key);

// 돌바닥 느낌의 어두운 판 — 반투명이 배경에 묻히지 않는지 본다
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 8),
  new THREE.MeshLambertMaterial({ color: 0x2e2a26 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const SLIME = { radius: 0.55, height: 0.9, color: 0x3fae62 };
const MOTHER = { radius: 1.1, height: 1.7, color: 0x2e8f52 };
const SMALL = { radius: 0.34, height: 0.55, color: 0x63c97e };

function specimen(
  offsetX: number,
  def: { radius: number; height: number; color: number },
  pose: 'rest' | 'windup' | 'leap',
  fed = false, // 삼킨 아이템 있음 — 핵이 노랗다 (Stage SLIME_CORE_FULL 과 동일 색)
): void {
  const torso = new THREE.Group();
  torso.position.x = offsetX;
  scene.add(torso);
  // ── Stage 슬라임 분기와 동일 ──
  const bodyMat = new THREE.MeshLambertMaterial({ color: def.color });
  bodyMat.transparent = true;
  bodyMat.opacity = 0.82;
  const jelly = new THREE.Mesh(
    new THREE.CylinderGeometry(def.radius * 0.8, def.radius * 1.3, def.height, 8),
    bodyMat,
  );
  jelly.position.y = def.height / 2;
  torso.add(jelly);
  const coreMat = new THREE.MeshLambertMaterial({
    color: fed ? new THREE.Color(0xe8c53f) : new THREE.Color(def.color).multiplyScalar(0.28),
  });
  if (fed) {
    // Stage 와 동일 — 핵을 젤 위에 덧그린다 (뒤에서 비추면 젤 알파에 녹색으로 먹힌다)
    coreMat.transparent = true;
    coreMat.emissive.setHex(0xe8c53f);
    coreMat.emissiveIntensity = 0.85;
    bodyMat.depthWrite = false;
  }
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(def.radius * 0.8, def.height * 0.45, def.radius * 0.8),
    coreMat,
  );
  core.position.y = def.height * 0.42;
  if (fed) core.renderOrder = 2;
  torso.add(core);
  // ── syncEnemies 꿀렁임 공식과 동일 ──
  const inflate = pose === 'windup' ? 0.3 : pose === 'leap' ? 0.18 : 0;
  const wobble = pose === 'rest' ? 0.05 : 0; // 대기 견본은 꿀렁 최대 진폭으로 고정
  const sy = 1 + inflate + wobble;
  const sxz = 1 - inflate * 0.35 - wobble * 0.6;
  torso.scale.set(sxz, sy, sxz);
  if (pose === 'leap') torso.position.y = 0.9; // 도약 정점 (jumpY 근사)
}

// 어미 — 젤 속 눈알 (Stage 어미 분기와 동일 좌표·크기 공식)
{
  const torso = new THREE.Group();
  torso.position.x = -5.6;
  scene.add(torso);
  const bodyMat = new THREE.MeshLambertMaterial({ color: MOTHER.color });
  bodyMat.transparent = true;
  bodyMat.opacity = 0.82;
  const jelly = new THREE.Mesh(
    new THREE.CylinderGeometry(MOTHER.radius * 0.8, MOTHER.radius * 1.3, MOTHER.height, 8),
    bodyMat,
  );
  jelly.position.y = MOTHER.height / 2;
  torso.add(jelly);
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(MOTHER.radius * 0.8, MOTHER.height * 0.45, MOTHER.radius * 0.8),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(MOTHER.color).multiplyScalar(0.28) }),
  );
  core.position.y = MOTHER.height * 0.42;
  torso.add(core);
  const scleraMat = new THREE.MeshLambertMaterial({ color: 0xe9e6c4 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x18240f });
  for (const [ex, ey, es] of [
    [-0.42, 0.66, 0.2],
    [0.3, 0.82, 0.27],
    [0.02, 0.5, 0.15],
    [-0.14, 0.94, 0.12],
    [0.52, 0.55, 0.11],
  ] as const) {
    const eye = new THREE.Group();
    const er = MOTHER.radius * es;
    eye.add(new THREE.Mesh(new THREE.SphereGeometry(er, 10, 8), scleraMat));
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(er * 0.45, 8, 6), pupilMat);
    pupil.position.z = -er * 0.72;
    eye.add(pupil);
    eye.position.set(MOTHER.radius * ex, MOTHER.height * ey, -MOTHER.radius * (1.3 - 0.5 * ey) * 0.8);
    // 카메라 쪽(-z 뒤쪽에서 본다)으로 살짝 돌린 동공 — 실전의 '따라오는 눈' 근사
    eye.rotation.y = 0.15;
    torso.add(eye);
  }
}

specimen(-3.2, SLIME, 'rest');
specimen(-1.1, SLIME, 'windup');
specimen(1.0, SLIME, 'leap');
specimen(2.8, SMALL, 'rest');
// 배부른 놈 — 핵이 노랗게 빛난다. ?view=fed 가 빈 놈(왼쪽)과 나란히 비춘다
specimen(5.2, SLIME, 'rest');
specimen(6.8, SLIME, 'rest', true);

// 점액 장판 — Stage.syncGoo 와 동일 (radius 1.1, 기본 0.28, 마르면 옅어짐)
for (const [x, frac] of [
  [-2.2, 1],
  [0.2, 0.4],
] as const) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x49c06a,
    transparent: true,
    opacity: 0.28 * Math.min(1, frac / 0.35),
    depthWrite: false,
  });
  const goo = new THREE.Mesh(new THREE.CircleGeometry(1, 12), mat);
  goo.rotation.x = -Math.PI / 2;
  goo.position.set(x, 0.02, 1.6);
  goo.scale.set(1.1, 1.1, 1);
  scene.add(goo);
}

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.05, 100);
const view = new URLSearchParams(location.search).get('view') ?? 'front';
if (view === 'mother') {
  // 어미 눈 검증 — 표본을 정면 눈높이에서 본다
  camera.position.set(-5.6, 1.7, -4.2);
  camera.lookAt(-5.6, 1.0, 0);
} else if (view === 'fed') {
  // 식탐 비교 — 빈 배(왼쪽) vs 아이템 삼킨 배(오른쪽, 노란 핵)
  camera.position.set(6.0, 1.5, -3.4);
  camera.lookAt(6.0, 0.5, 0);
} else if (view === 'low') {
  // 플레이어 눈높이 근사 — 실전에서 보이는 각
  camera.position.set(0, 1.6, -4.6);
  camera.lookAt(0, 0.5, 0);
} else {
  camera.position.set(1.2, 2.4, -5.2);
  camera.lookAt(0, 0.5, 0.4);
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
