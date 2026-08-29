// 벽거미 자세 미리보기 — Stage syncEnemies 의 벽 굴림 공식을 간이 거미로 재현.
// 검증 포인트: 다리끝(아래 뾰족이)이 벽면을 딛고, 배가 방 쪽을 보는가.
import * as THREE from 'three';
import entities from '../data/entities.json';

const def = (entities as { enemies: Record<string, { radius: number; height: number; wallCrawl?: { height: number } }> })
  .enemies['spider_small']!;
const WALL_H = def.wallCrawl!.height;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100d);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const key = new THREE.PointLight(0xffe0b0, 1.1, 40, 0);
key.position.set(2, 3, 6);
scene.add(key);

// 바닥 + 벽 (벽면은 z = -1.6, 법선은 +z — 방 쪽)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const wall = new THREE.Mesh(new THREE.BoxGeometry(16, 4, 0.8), new THREE.MeshLambertMaterial({ color: 0x4a4f58 }));
wall.position.set(0, 2, -2);
scene.add(wall);

/** 간이 거미 — 몸통 타원 + 아래로 뻗은 다리 4개 + 앞쪽 눈. 자세 검증용 최소 형태 */
function makeSpider(tint: number): { group: THREE.Group; torso: THREE.Group } {
  const group = new THREE.Group();
  const torso = new THREE.Group();
  group.add(torso);
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(def.radius * 0.85, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0x14141a, emissive: tint, emissiveIntensity: 0.5 }),
  );
  body.scale.set(1, 0.62, 1.25);
  body.position.y = def.height * 0.55;
  torso.add(body);
  // 다리 — 몸에서 바닥으로. 이 끝이 벽을 딛어야 한다
  for (const [sx, sz] of [[-1, -0.6], [1, -0.6], [-1, 0.6], [1, 0.6]] as const) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, def.height * 0.62, 0.05),
      new THREE.MeshLambertMaterial({ color: 0x0c0c10 }),
    );
    leg.position.set(sx * def.radius * 0.75, def.height * 0.3, sz * def.radius * 0.5);
    torso.add(leg);
  }
  // 눈 — 정면(-z 로컬)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff4030 }));
  eye.position.set(0, def.height * 0.6, -def.radius * 0.9);
  torso.add(eye);
  scene.add(group);
  return { group, torso };
}

// ── Stage 와 동일한 자세 공식 ──
function pose(
  s: { group: THREE.Group; torso: THREE.Group },
  x: number, jumpY: number, yaw: number,
  wallNX: number, wallNZ: number, onWall: boolean, windup: boolean,
): void {
  s.group.position.set(x, jumpY, -1.6 + def.radius); // 벽면에 눌러 붙은 XZ
  s.group.rotation.y = yaw;
  let roll = 0;
  if (onWall) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const sideSign = fx * wallNZ - fz * wallNX >= 0 ? 1 : -1;
    const lift = Math.min(1, jumpY / (WALL_H * 0.8));
    roll = -sideSign * (Math.PI / 2) * lift; // Stage 와 동일 — 다리가 벽을 딛는 부호
    s.group.position.x -= wallNX * def.radius * 0.55 * lift;
    s.group.position.z -= wallNZ * def.radius * 0.55 * lift;
  }
  s.torso.rotation.z = roll;
  s.torso.scale.y = windup ? 0.7 : 1;
}

// 지상 (기준)
const ground = makeSpider(0x000000);
pose(ground, -4, 0, -Math.PI / 2, 0, 1, false, false);
ground.group.position.z = 1.5;

// 벽에 붙어 +x 로 기는 중 — yaw 는 +x 진행 방향, 벽 법선 (0, +1)
const cling = makeSpider(0x000000);
pose(cling, 0, WALL_H, -Math.PI / 2, 0, 1, true, false);

// 도약 예고 — 웅크림 + 적색 발광
const wind = makeSpider(0xa02020);
pose(wind, 4, WALL_H, -Math.PI / 2, 0, 1, true, true);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 2.0, 6.5);
camera.lookAt(0, 1.4, -1.6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
