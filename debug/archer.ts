// 궁수 활 리그 미리보기 — 게임과 같은 buildBowRig/updateBowDraw 코드로 짓는다.
// 왼쪽부터 당김 0(대기) / 0.55 / 1.0(만작). 화살은 당기는 중에만 보인다.
import * as THREE from 'three';
import { buildBowRig, updateBowDraw } from '../src/render/Stage';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101014);
scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const key = new THREE.PointLight(0xffe0b0, 1.4, 30, 0);
key.position.set(2, 3, -4);
scene.add(key);

// 게임의 궁수 치수 (entities.json goblin_archer)
const RADIUS = 0.5;
const HEIGHT = 1.7;
const BODY = 0x8a8a3a;

function specimen(offsetX: number, draw: number): void {
  const torso = new THREE.Group();
  torso.position.x = offsetX;
  scene.add(torso);

  // 몸통·머리 근사 (Stage 휴머노이드와 비슷한 비율 — 리그 위치 확인용)
  const bodyMat = new THREE.MeshLambertMaterial({ color: BODY });
  const body = new THREE.Mesh(new THREE.BoxGeometry(RADIUS * 1.5, HEIGHT * 0.62, RADIUS), bodyMat);
  body.position.y = HEIGHT * 0.31 + HEIGHT * 0.3;
  torso.add(body);
  const headSize = RADIUS * 0.9;
  const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), bodyMat);
  head.position.set(0, HEIGHT - headSize / 2, -RADIUS * 0.2);
  torso.add(head);

  // 양팔 — Stage 의 포즈 식과 같은 각
  const armLen = HEIGHT * 0.34;
  const armMat = new THREE.MeshLambertMaterial({ color: 0x6e6e2e });
  const makeArm = (side: number, rotX: number): void => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * RADIUS * 0.92, HEIGHT * 0.72, 0);
    const limb = new THREE.Mesh(new THREE.BoxGeometry(RADIUS * 0.3, armLen, RADIUS * 0.3), armMat);
    limb.position.y = -armLen / 2;
    shoulder.add(limb);
    shoulder.rotation.x = rotX;
    torso.add(shoulder);
  };
  makeArm(-1, 0.7 + 0.85 * draw); // 활 손
  makeArm(1, 0.55 + 0.85 * Math.min(1, draw * 2.5) - 0.45 * draw); // 시위 손

  // 활 리그 — Stage 생성부와 같은 위치
  const rig = buildBowRig();
  rig.group.position.set(-RADIUS * 0.55, HEIGHT * 0.62, -RADIUS - 0.15 - 0.12 * draw);
  updateBowDraw(rig, draw, draw > 0);
  torso.add(rig.group);
}

specimen(-2.2, 0);
specimen(0, 0.55);
specimen(2.2, 1);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 100);
const view = new URLSearchParams(location.search).get('view') ?? 'front';
if (view === 'side') {
  camera.position.set(5.2, 1.3, -1.2);
  camera.lookAt(0, 1.0, -0.4);
} else {
  // 표적 쪽(활 앞)에서 비스듬히 본다 — 화살이 카메라 쪽을 향한다
  camera.position.set(1.6, 1.5, -4.4);
  camera.lookAt(0, 1.0, 0);
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
