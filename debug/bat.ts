// 박쥐 미리보기 — Stage buildBatBody 공식 재현 (안광은 간이 구체로 대체).
// 순항 / 급강하 예고(청색) / 바닥 기절(뒤집힘) 세 프레임.
import * as THREE from 'three';
import entities from '../data/entities.json';

const def = (entities as { enemies: Record<string, { radius: number; height: number }> })
  .enemies['bat']!;
const BASE = 0x4a3550; // Stage ENEMY_COLORS.bat

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100d);
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const key = new THREE.PointLight(0xffe0b0, 1.2, 40, 0);
key.position.set(1.5, 3, 5);
scene.add(key);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

function makeBat(emissive: number): THREE.Group {
  const torso = new THREE.Group();
  const r = def.radius;
  const bodyY = def.height * 0.55;
  const bodyMat = new THREE.MeshLambertMaterial({ color: BASE, emissive, emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 10, 8), bodyMat);
  body.scale.set(1, 0.85, 1.2);
  body.position.y = bodyY;
  torso.add(body);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(r * 0.14, r * 0.5, 5), bodyMat);
    ear.position.set(side * r * 0.22, bodyY + r * 0.55, -r * 0.1);
    torso.add(ear);
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.09, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xff4030 }),
    );
    eye.position.set(side * r * 0.18, bodyY + r * 0.1, -r * 0.55);
    torso.add(eye);
  }
  const wingMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(BASE).multiplyScalar(0.75),
    emissive,
    emissiveIntensity: 0.4,
  });
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? 'batWingL' : 'batWingR';
    pivot.position.set(side * r * 0.4, bodyY + r * 0.15, 0);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(r * 1.7, r * 0.08, r * 0.9), wingMat);
    wing.position.x = side * r * 0.95;
    pivot.add(wing);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(r * 0.8, r * 0.07, r * 0.6), wingMat);
    tip.position.set(side * r * 1.75, r * 0.08, 0);
    pivot.add(tip);
    torso.add(pivot);
  }
  scene.add(torso);
  return torso;
}

function flap(torso: THREE.Group, angle: number): void {
  torso.getObjectByName('batWingL')!.rotation.z = angle;
  torso.getObjectByName('batWingR')!.rotation.z = -angle;
}

// 순항 — 고도 2.4, 날개 중간 각
const cruise = makeBat(0x000000);
cruise.position.set(-2.6, 2.4, 0);
flap(cruise, 0.45);

// 급강하 예고 — 청색 발광 (telegraph 규약), 저공으로 내려앉는 중
const wind = makeBat(0x1040c0);
wind.position.set(0, 1.1, 0);
flap(wind, -0.3);

// 바닥 기절 — 뒤집혀 뻗어 퍼덕 (Stage: torso.rotation.x = π*0.92)
const downed = makeBat(0x000000);
downed.position.set(2.6, 0.15, 0);
downed.rotation.x = Math.PI * 0.92;
flap(downed, 0.9);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 1.7, 4.6);
camera.lookAt(0, 1.2, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
