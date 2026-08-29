// 타격 피 파편 미리보기 — Stage.spawnHitBlood 와 같은 공식(원뿔 분사·포물선·착지 얼룩)을
// 고정 시드로 재현한다. 공중 방울은 0.22초 시점, 얼룩은 전부 착지시킨 결과를 함께 그린다.
import * as THREE from 'three';
import { bloodColorOf } from '../src/render/Stage';
import balance from '../data/balance.json';
import entities from '../data/entities.json';

const cfg = balance.hitBlood;
const defs = (entities as { enemies: Record<string, { height: number; radius: number }> })
  .enemies;

// 고정 시드 난수 — 스크린샷이 매번 같게
let seed = 42;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100d);
scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const key = new THREE.PointLight(0xffe0b0, 1.1, 40, 0);
key.position.set(0, 4, 5);
scene.add(key);

// 바닥 — 던전 돌빛 (얼룩 대비 확인용)
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 10),
  new THREE.MeshLambertMaterial({ color: 0x3a3f46 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const ENEMY_TINT: Record<string, number> = {
  ghoul: 0x8f9a86,
  spider_large: 0xd8d8cf,
  slime: 0x3fae62,
};

function specimen(
  offsetX: number,
  type: string,
  hit: { damage: number; headshot?: boolean; heavy?: boolean },
  heightFrac: number,
): void {
  const def = defs[type]!;
  // 적 실루엣 — 파편 위치 가늠용 기둥
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(def.radius * 1.4, def.height, def.radius * 1.4),
    new THREE.MeshLambertMaterial({ color: ENEMY_TINT[type] ?? 0x8f3c3c, transparent: true, opacity: 0.45 }),
  );
  body.position.set(offsetX, def.height / 2, 0);
  scene.add(body);

  // ── spawnHitBlood 와 동일한 공식 ──
  const color = bloodColorOf(type);
  const y0 = def.height * heightFrac;
  let count = cfg.countMin + hit.damage * cfg.countPerDamage;
  if (hit.headshot) count *= cfg.headshotMul;
  if (hit.heavy) count *= cfg.heavyMul;
  const baseAng = Math.atan2(-1, 0.15); // 카메라 반대(-Z)로 뚫고 나간다 (분사가 보이는 각)
  const coneRad = (cfg.coneDeg * Math.PI) / 180;
  const GRAVITY = 9.8; // Stage DEATH_GRAVITY 와 같은 값
  const T = 0.22; // 공중 프레임 시점

  for (let i = 0; i < Math.min(cfg.countMax, Math.round(count)); i++) {
    const size = cfg.sizeMin + rand() * cfg.sizeSpan;
    const ang = baseAng + (rand() - 0.5) * coneRad;
    const speed = cfg.speedMin + rand() * cfg.speedSpan;
    const vx = Math.cos(ang) * speed;
    const vy = cfg.upKickMin + rand() * cfg.upKickSpan;
    const vz = Math.sin(ang) * speed;
    const oy = y0 + (rand() - 0.5) * 0.24;

    // 공중 방울 — T 시점 위치
    const yT = oy + vy * T - 0.5 * GRAVITY * T * T;
    if (yT > size / 2) {
      const drop = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshLambertMaterial({ color }),
      );
      drop.position.set(offsetX + vx * T, yT, vz * T);
      drop.rotation.set(rand() * 3, rand() * 3, 0);
      scene.add(drop);
    }
    // 착지 얼룩 — 포물선을 끝까지 풀어 착지점에 (chance 적용)
    if (rand() < cfg.stain.chance) {
      const tLand = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * oy)) / GRAVITY;
      const r = cfg.stain.radiusMin + rand() * cfg.stain.radiusSpan;
      const stain = new THREE.Mesh(
        new THREE.CircleGeometry(r, 10),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }),
      );
      stain.rotation.set(-Math.PI / 2, 0, rand() * Math.PI * 2);
      stain.scale.x = 0.65 + rand() * 0.7;
      stain.position.set(offsetX + vx * tLand, 0.012 + rand() * 0.004, vz * tLand);
      scene.add(stain);
    }
  }
}

specimen(-6.6, 'ghoul', { damage: 14 }, 0.55); // 권총 몸통
specimen(-2.2, 'ghoul', { damage: 14, headshot: true }, 0.85); // 헤드샷
specimen(2.2, 'spider_large', { damage: 30, heavy: true }, 0.55); // 해머 강타
specimen(6.6, 'slime', { damage: 14 }, 0.55); // 슬라임 점액

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 2.6, 7.5);
camera.lookAt(0, 0.8, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
