// Three.js 렌더 셋업 전용. 게임 로직 금지.
// World 상태(플레이어, 랜턴, 무기, 적)를 읽어 씬에 반영만 한다.

import * as THREE from 'three';
import { balance } from '../core/Balance';
import { itemColor } from '../core/Inventory';
import { currentAttack, enemyDef, healthBarState, shieldLowered } from '../core/Entities';
import { sigilColor } from '../core/SigilData';
import { COLOR_EXIT_LOCKED, COLOR_EXIT_OPEN } from '../level/GridLoader';
import type {
  BarrelState,
  ChestState,
  EnemyState,
  GroundItemState,
  LifeMoteState,
  ProjectileState,
} from '../core/World';
import { FINISHER_CONTACT_MS, HandModel } from './HandModel';
import { animateTrap, buildTrapGroup, type TrapView } from './TrapVisuals';

// 적 타입별 몸통 색 (시각 팔레트 — 튜닝값 아님)
const ENEMY_COLORS: Record<string, number> = {
  goblin_runner: 0x4a8f3c,
  goblin_spear: 0x3c7a8f,
  goblin_archer: 0x8a8a3a,
  warden: 0x5a4470,
  goblin_chieftain: 0x8f5a30,
  bat: 0x4a3550,
  spider_small: 0x14141a,
  spider_large: 0xd8d8cf,
  slime: 0x3fae62,
  slime_mother: 0x2e8f52,
  ghoul: 0x8f9a86,
  leech: 0x7a4b6e,
  slime_small: 0x63c97e,
};
/** 거미는 기둥+머리가 아니라 몸통·배·다리로 만든다 */
const SPIDER_TYPES = new Set(['spider_small', 'spider_large']);
/** 슬라임 — 반투명 젤 덩어리. 다리·팔·머리·눈이 없다 (무정형) */
const SLIME_TYPES = new Set(['slime', 'slime_small', 'slime_mother']);
// 배부른 슬라임의 핵 — 삼킨 아이템이 있으면 노랗게 비친다 (겉 젤은 그대로 녹색).
// 죽이면 게워 낸다는 신호라, 플레이어가 '저 놈이 내 물건을 먹었다'를 한눈에 안다
const SLIME_CORE_FULL = 0xe8c53f;
const ENEMY_COLOR_FALLBACK = 0x8f3c3c;
/** 타격 피 색 — 인간형은 검붉게, 특수 체액은 따로. 슬라임류는 몸 색 점액을 그대로 쓴다 */
const BLOOD_RED = 0x7d1014;
const BLOOD_COLORS: Record<string, number> = {
  ghoul: 0x5c0d10, // 시체의 검은 피
  spider_small: 0x3e9b2c, // 녹색 체액 — 흰 몸·돌바닥과 대비
  spider_large: 0x3e9b2c,
  leech: 0x4a1030, // 검자줏빛
  slime: 0x328b4e, // 슬라임 점액 — 세 종 공통 한 색
  slime_small: 0x328b4e,
  slime_mother: 0x328b4e,
};
export function bloodColorOf(enemyType: string): number {
  return BLOOD_COLORS[enemyType] ?? BLOOD_RED;
}

/** 거미 몸 — 낮게 깔린 몸통 + 뒤로 부푼 배 + 사방으로 뻗은 다리 8개.
 *  키(def.height)가 낮아 기둥+머리로 만들면 그냥 통조림처럼 보인다 */
/** 박쥐 — 작은 몸통 + 피막 날개 둘(batWingL/R — syncEnemies 가 퍼덕인다) + 귀·안광 */
function buildBatBody(
  torso: THREE.Group,
  def: { radius: number; height: number },
  bodyMat: THREE.MeshLambertMaterial,
  eyes: EyeKit,
  baseColor: number,
  flashMaterials: THREE.MeshLambertMaterial[],
): void {
  const r = def.radius;
  const bodyY = def.height * 0.55;
  const body = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 10, 8), bodyMat);
  body.scale.set(1, 0.85, 1.2);
  body.position.y = bodyY;
  torso.add(body);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(r * 0.14, r * 0.5, 5), bodyMat);
    ear.position.set(side * r * 0.22, bodyY + r * 0.55, -r * 0.1);
    torso.add(ear);
  }
  const eyeR = r * balance.lighting.enemyEyes.radiusMul;
  for (const side of [-1, 1]) {
    addGlowEye(torso, side * r * 0.18, bodyY + r * 0.1, -r * 0.55, eyeR, eyes.eyeMat, eyes.haloMat, eyes.halos);
  }
  const wingMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(baseColor).multiplyScalar(0.75),
  });
  flashMaterials.push(wingMat);
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
}

function buildSpiderBody(
  torso: THREE.Group,
  def: { radius: number; height: number },
  bodyMat: THREE.MeshLambertMaterial,
  eyes: EyeKit,
  baseColor: number,
  flashMaterials: THREE.MeshLambertMaterial[],
): void {
  const r = def.radius;
  const bodyY = def.height * 0.62; // 다리 위에 얹힌 높이

  // 머리가슴 — 앞쪽의 작고 단단한 덩어리
  const cephalo = new THREE.Mesh(new THREE.SphereGeometry(r * 0.52, 10, 8), bodyMat);
  cephalo.scale.set(1, 0.8, 1.05);
  cephalo.position.set(0, bodyY, -r * 0.45);
  torso.add(cephalo);

  // 배 — 뒤로 크게 부푼다. 살짝 어둡게 해 덩어리가 갈려 보이게
  const abdMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(baseColor).multiplyScalar(0.82),
  });
  flashMaterials.push(abdMat);
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(r * 0.78, 10, 8), abdMat);
  abdomen.scale.set(1, 0.86, 1.15);
  abdomen.position.set(0, bodyY + r * 0.06, r * 0.6);
  torso.add(abdomen);

  // 눈 — 앞을 향한 안광 넷. 어둠 속에서 이것만 보여도 거미인 줄 안다
  const eyeR = r * balance.lighting.enemyEyes.radiusMul;
  for (const ex of [-0.55, -0.2, 0.2, 0.55]) {
    addGlowEye(torso, ex * r * 0.5, bodyY + r * 0.14, -r * 0.9, eyeR, eyes.eyeMat, eyes.haloMat, eyes.halos);
  }

  // 다리 8개 — 무릎에서 꺾여 위로 솟았다 바닥으로 내려온다.
  // 각 다리는 "바깥(+X)·위(+Y)" 평면에서 각도로 직접 계산한 뒤 통째로 Y축 회전시킨다.
  // lookAt 으로 맞추면 부모 월드행렬이 아직 갱신 전이라 엉뚱한 데를 향한다 (실측으로 확인)
  const legMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(baseColor).multiplyScalar(0.7),
  });
  flashMaterials.push(legMat);
  const legW = r * 0.12;
  const hipOut = r * 0.4;
  const upLen = r * 0.85;
  const upAng = 0.85; // 위로 솟는 각
  const lowLen = r * 1.9;
  const lowAng = -1.0; // 바닥으로 내려오는 각

  /** (0,0)에서 각도 ang 로 len 만큼 뻗는 마디 — 중심에 놓고 Z축으로 돌린다 */
  const segment = (len: number, ang: number, fromX: number, fromY: number): THREE.Mesh => {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len, legW, legW), legMat);
    seg.position.set(fromX + (len / 2) * Math.cos(ang), fromY + (len / 2) * Math.sin(ang), 0);
    seg.rotation.z = ang;
    return seg;
  };

  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Group();
      leg.position.y = bodyY;
      // 앞(−Z)에서 뒤(+Z)로 벌어지게. side 로 좌우 대칭
      leg.rotation.y = side * (Math.PI / 2) + side * (-0.62 + i * 0.42);
      torso.add(leg);

      const kneeX = hipOut + upLen * Math.cos(upAng);
      const kneeY = upLen * Math.sin(upAng);
      leg.add(segment(upLen, upAng, hipOut, 0));
      leg.add(segment(lowLen, lowAng, kneeX, kneeY));
      // 무릎 관절 — 마디 사이가 벌어져 보이지 않게 채운다
      const joint = new THREE.Mesh(new THREE.SphereGeometry(legW * 0.8, 5, 4), legMat);
      joint.position.set(kneeX, kneeY, 0);
      leg.add(joint);
    }
  }
}
const BARRIER_COLOR = 0x9db8e8;
const WEB_COLOR = 0xe6e9e0; // 거미줄 — 희끄무레한 실뭉치
const WEB_TEAR_SHARDS = 14; // 해머로 걷어낼 때 흩어지는 실 조각
const WEB_TEAR_MS = 520;
const ENEMY_BOLT_COLOR = 0xa855f7; // 마법 투사체 색 규약 (balance.telegraph.colorProjectile)
const IMPLODE_MS = 560; // 내파 연출 길이 (당김 지속 22틱 ≒ 367ms보다 길게 남는다)
const IMPLODE_SHARDS = 16;

// 텔레그래프 이외 상태 표시색 (텔레그래프 3색과 겹치지 않게 — 색이 곧 문법)
const STAGGER_COLOR = 0xcc9922; // 스태거 = 처형 가능 표시
const HIT_FLASH_COLOR = 0xffffff; // 해머 적중 — 새하얗게 명멸
const HIT_FLASH_MS = 240;
const HIT_FLASH_HZ = 26; // 초당 명멸 횟수 (아주 빠르게)
const WINDUP_TINT = 0x0e2440; // 예비 동작의 옅은 예고 (본 섬광은 종료 4t 전)
const BURN_TINT = 0x8f3300; // 화상 중
/** 서리에 얼어붙은 적 — 차가운 푸른 발광. 불(BURN_TINT)이 붙어 있으면 불이 이긴다 */
const FROST_TINT = 0x2f7fc4; // 둔화 단계
const FREEZE_TINT = 0x6fc2ff; // 완전 빙결 — 더 밝고 차갑다
const ICE_COLOR = 0xbfe8ff;
/** 서리 자국 — 반지름(m)·수명(ms)·면에서 띄우는 거리(m) */
const FROST_DECAL_RADIUS = 1.3; // 2.2 는 너무 컸다 — 1타 크기(×0.6)로 전부 통일
const FROST_DECAL_MS = 5200;
const FROST_DECAL_LIFT = 0.03;
// 화상 표시 — 발광은 텔레그래프·스태거 색에 가려지므로 불티로 따로 알린다
const BURN_EMBER_MS = 85; // 적 하나당 불티 생성 간격
const BURN_EMBER_LIFE_MS = 520;
const BURN_EMBER_COLORS = [0xff8a2a, 0xffc04a, 0xff5a1a];
const FIREBALL_COLOR = 0xff7733;
const GROUND_ITEM_COLOR = 0xe8c76a; // 바닥 각인 — 어둠 속 금색 발광
// 바닥 모형 색 — HUD 아이콘과 어긋나지 않게 balance.items.kinds 를 그대로 읽는다
const POTION_COLOR = itemColor('potion'); // HP 포션 — 붉은 약병
const MANA_POTION_COLOR = itemColor('mana'); // 마나 물약 — 푸른 약병
const POTION_GLASS = 0xbfe6ff;
const GOLD_COLOR = 0xffcc3a; // 골드 더미
const FOOD_COLOR = itemColor('food'); // 음식 — 구운 고기
const FOOD_BONE = 0xe8ddc0;

// 트레이서 시각 상수 (튜닝값 아님 — 순수 연출)
const TRACER_COLOR = 0xffe9b8;
const MUZZLE_OFFSET = { x: -0.17, y: -0.1, z: -0.72 }; // 카메라 로컬: 왼손 권총 총구 끝

// 적 부속물 색
/** 벽 잔존물 수명 — 화살은 좀 더 오래 남는다 (눈에 띄는 물건이라). 끝 DECAL_FADE_MS 동안 옅어진다 */
const STUCK_ARROW_MS = 14000;
/** 바닥에 눕힌 회수 화살의 높이 (시각 상수 — 줍는 판정은 Pickups 가 따로 본다) */
const GROUND_ARROW_Y = 0.1;
const BULLET_MARK_MS = 10000;
const DECAL_FADE_MS = 2000;

const EXIT_FLASH_MS = 900; // 출구가 열리는 순간의 섬광

/** 지면 강타 범위 원 — 예고 중 바닥에 그려진다. 안쪽 반지름은 바깥 대비 비율 */
const AOE_RING_COLOR = 0xff5a3c;
const AOE_RING_INNER = 0.9;

const SHIELD_COLOR = 0x6f7480;
const SHIELD_CRACKED_COLOR = 0x4a4238; // 반파 — 그을리고 쪼개진 판
const SHIELD_BASE_X = -0.08;
/** 가드가 풀렸을 때 방패 — 팔이 옆으로 툭 늘어진 그림 (낮게 + 옆으로 + 뉘어서) */
const SHIELD_DOWN_Y = 0.16;
const SHIELD_DOWN_X = -0.42;
const SHIELD_DOWN_TILT = -0.55;
const SPEAR_TIP = 0x9aa2ad;
const HEAD_DARKEN = 0.72;
/** 공격 연출로 전진할 때 적 몸통 표면과 카메라 사이에 남길 여유.
 *  적 반경은 별도로 빼므로 큰 적도 같은 여유를 갖는다 */
const VISUAL_BODY_GAP = 0.35;

// 근접 무기 규격 (시각 — 실제 사거리는 entities.json attackRange가 결정)
// style: smash = 치켜들었다 내리침 / thrust = 수평 견착 후 내지름
const MELEE_WEAPONS: Record<
  string,
  {
    length: number;
    width: number;
    color: number;
    style: 'smash' | 'thrust';
    tip?: boolean;
    headSize?: number;
  }
> = {
  goblin_runner: { length: 1.0, width: 0.11, color: 0x6b5233, style: 'smash' },
  goblin_spear: { length: 2.0, width: 0.07, color: 0x5c4a33, style: 'thrust', tip: true },
  // tip 이 있으면 창끝이 length + 0.23 지점까지 나온다 (아래 tipLocal 계산)
  goblin_chieftain: { length: 2.0, width: 0.26, color: 0x4a3826, style: 'smash', headSize: 0.5 },
};
/** smash 팔 각도: 휴식/치켜듦/내리침.
 *  무기는 팔 피벗에서 -z로 뻗으므로 +회전이 무기 끝을 위로 올린다 */
const ARM_REST = -0.45; // 무기를 내려 든 대기
const ARM_RAISED = 2.0; // 머리 위로 치켜듦
const ARM_SMASH = -1.15; // 앞아래로 내리찍음
/** 화살 세례 — 무기를 몸 앞으로 가로질러 당겼다(예고) 한 발마다 앞으로 튕긴다.
 *  높이 치켜들면(1.4대) 랜턴 조명 밖으로 나가 캄캄해서 안 보인다 — 몸통 높이로 잡는다 */
const ARM_VOLLEY_DRAW = 0.42; // 거의 수평
const ARM_VOLLEY_SWING = 1.05; // 몸을 가로지르게 옆으로 (rotation.y)
const VOLLEY_PULL = 0.5; // 팔을 뒤로 당김 (armZ)
const VOLLEY_LEAN = 0.34; // 상체 젖힘
const VOLLEY_SNAP = 0.25; // 발사 직후 앞으로 튕기는 구간 비율
/** 돌격 예비동작 — 스프린터처럼 웅크려 앞으로 기울이고 무게를 뒤로 싣는다.
 *  내리치기 예비동작(뒤로 젖히며 무기를 치켜듦)과 정반대라 한눈에 구분된다 */
const CHARGE_COIL_CROUCH = 0.15; // def.height 배
const CHARGE_COIL_LEAN = -0.32; // − = 앞으로 숙임
const CHARGE_COIL_ROCK = 0.3; // + = 뒤로 무게 싣기
const ARM_CHARGE_COIL = -1.0; // 무기를 뒤아래로 끌어 내린다
/** thrust: 창끝은 항상 수평(플레이어를 겨눔). 움츠렸다 진격하며 내지른다.
 *  몸통 rotation.x는 + 가 뒤로 젖힘 / - 가 앞으로 숙임 (피벗이 발밑) */
const THRUST_LEVEL = 0.02;
const THRUST_PULL = 0.8; // windup: 창을 뒤로 당김
const THRUST_CROUCH = 0.22; // windup: 몸을 낮춰 움츠림
const THRUST_COIL = 0.25; // windup: 몸을 뒤로 뺌
const THRUST_COIL_LEAN = 0.1; // windup: 뒤로 살짝 젖힘 (뒷발에 체중)
const THRUST_ADVANCE = -1.0; // 타격: 몸통째 진격
const THRUST_LEAN = -0.18; // 타격: 앞으로 숙임

interface EnemyVisual {
  group: THREE.Group;
  /** 안광 후광 재질 — 어그로가 잡히면 밝아진다 */
  eyeHalo: THREE.SpriteMaterial;
  /** 후광 스프라이트들 — 거리에 따라 매 프레임 크기를 키운다 (원거리 글린트) */
  eyeHalos: THREE.Sprite[];
  /** 가까이서의 후광 기본 크기 (m) */
  eyeHaloBase: number;
  /** 얼음 결정 — 얼어 있는 동안만 보인다 (처음 얼 때 만든다) */
  ice?: THREE.Group;
  /** 결정이 이번에 나타난 시각 — 나타나며 크게 잡혔다 제 크기로 줄어드는 팝 */
  iceShownMs?: number;
  /** 거미줄 고치 — 그물에 걸린 동안만 보인다 (처음 걸릴 때 만든다) */
  web?: THREE.Mesh;
  /** 몸통+머리 서브그룹 — 공격 모션(기울임/내지름)의 피벗 (발 기준) */
  torso: THREE.Group;
  /** 머리 상자 — 헤드샷 때 젖혀진다 (거미는 머리가 따로 없어 undefined) */
  head?: THREE.Mesh;
  /** 헤드샷 젖힘이 끝나는 시각 */
  headShakeUntil?: number;
  /** 다리(골반 피벗) — 인간형만. 이동 거리에 비례해 젓는다 */
  legs?: { left: THREE.Group; right: THREE.Group };
  /** 맨팔(어깨 피벗) — 무기 팔이 아닌 팔. 걸을 때 다리와 반대 위상으로 젓는다 */
  plainArms?: THREE.Group[];
  legPhase?: number;
  legBlend?: number;
  legLastX?: number;
  legLastZ?: number;
  /** 텔레그래프 발광을 적용할 머티리얼들 (몸통/머리/창끝) */
  flashMaterials: THREE.MeshLambertMaterial[];
  shield?: THREE.Mesh;
  shieldMaterial?: THREE.MeshLambertMaterial;
  /** 방패의 기준 z — 몸통 전진에 오프셋으로 더한다 */
  shieldBaseZ: number;
  /** 직전 프레임에 방패가 내려가 있었는가 — 올릴 때 즉시 복귀시키려고 본다 */
  shieldDown?: boolean;
  /** 방패 균열 (마무리 타를 받아내면 드러난다) */
  shieldCracks?: THREE.Group;
  /** 방패에 꽂힌 화살 슬롯 — 평소엔 숨김, 막을 때마다 순환해 드러난다.
   *  방패의 자식이라 방패가 부서지면 화살도 같이 사라진다 (판에 박혀 있었으니까) */
  shieldArrows?: THREE.Mesh[];
  shieldArrowSlot?: number;
  /** 어미 슬라임 눈알들 — 동공이 플레이어를 따라 도는 눈 그룹 (syncEnemies) */
  motherEyes?: THREE.Group[];
  /** 슬라임 핵 — 삼킨 게 있으면 syncEnemies 가 노랗게 (핵을 젤 위에 덧그린다) */
  slimeCore?: {
    mat: THREE.MeshLambertMaterial;
    base: number;
    core: THREE.Mesh;
    jellyMat: THREE.MeshLambertMaterial;
  };
  /** 다음 화상 불티를 낼 시각 */
  nextEmberMs: number;
  /** 해머 적중 명멸이 끝나는 시각 */
  hitFlashUntil: number;
  /** 감전 — 이 시각까지 몸에 전류가 흐른다 (뇌창에 맞을 때마다 갱신) */
  zapUntil?: number;
  /** 근접 피격 셰이크 — 이 시각까지 매 프레임 무작위로 몸이 튄다 (연출 전용) */
  hitShakeUntil?: number;
  hitShakeAmp?: number;
  /** 전류 마디 — 매 프레임 몸 위 아무 데나 다시 놓아 지직거리게 만든다 */
  zap?: { group: THREE.Group; mat: THREE.MeshBasicMaterial; segs: THREE.Mesh[] };
  /** 근접 무기 팔 피벗 — 치켜들었다 내리찍는다 */
  arm?: THREE.Group;
  shieldFlashUntil: number;
  /** warden 방어막 셸 */
  barrier?: THREE.Mesh;
  barrierMaterial?: THREE.MeshLambertMaterial;
  barrierFlashUntil: number;
  /** 지면 강타 범위 표시 — 예고 중 바닥에 그려지는 원 */
  aoeRing?: THREE.Mesh;
  aoeRingMaterial?: THREE.MeshBasicMaterial;
  /** 시전 충전 구체 (warden) */
  chargeOrb?: THREE.Mesh;
  chargeOrbLight?: THREE.PointLight;
  /** 거머리 위장 재질 — 매달린 동안 천장 돌빛, 랜턴에 잡히거나 내려오면 제 색 (mul 은 부위 명암) */
  leechMats?: { mat: THREE.MeshLambertMaterial; mul: number }[];
  /** 활 (archer) — 활대·시위·재어 둔 화살 리그. 당김은 syncEnemies 가 매 프레임 갱신 */
  bowRig?: BowRig;
  /** 시위 당김 0~1 — 놓는 순간 0으로 스냅해 시위가 튕겨 돌아간다 */
  bowDraw?: number;
  /** 머리 위 이름표 + HP 바 */
  plate: THREE.Sprite;
  plateTexture: THREE.CanvasTexture;
  plateCanvas: HTMLCanvasElement;
  /** 마지막으로 그린 상태 키 — 변화 시에만 다시 그린다 */
  plateKey: string;
  /** 인지 표시 (!) — 알아챈 순간 머리 위에서 튀어오르며 뜬다.
   *  언제 떴는지는 Stage.alertAt 이 적 id 로 따로 들고 있다 (아래 markAlert 주석) */
  alert: THREE.Sprite;
}

const PLATE_W = 256;
const PLATE_H = 72;

/** 인지 표시가 떠 있는 시간(ms)과 튀어오르는 구간 */
const ALERT_MS = 1100;
const ALERT_POP_MS = 160;

/** 느낌표 텍스처 — 모든 적이 같은 그림을 쓰므로 한 번만 만든다 */
let alertTexture: THREE.CanvasTexture | null = null;
let glowTexture: THREE.CanvasTexture | null = null;
let frostTexture: THREE.CanvasTexture | null = null;

/** 서리 자국 텍스처 — 가운데가 짙고 가장자리로 스러지는 얼음막 위에 결정 줄기가 사방으로 뻗는다.
 *  한 장을 만들어 모든 자국이 돌려 쓴다 (회전을 달리해 같은 무늬로 안 보이게) */
let scorchTexture: THREE.CanvasTexture | null = null;
/** 그을음 — 가운데가 새까맣고 가장자리로 흩어지는 검댕. 얼룩을 몇 개 얹어 원이 아니게 만든다 */
/** 감전 마디 — 길이 1 짜리 얇은 상자 몇 개. 자리는 매 프레임 다시 잡는다 */
function makeBodyZap(parent: THREE.Object3D): {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  segs: THREE.Mesh[];
} {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: ZAP_BODY_COLOR,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const segs: THREE.Mesh[] = [];
  for (let i = 0; i < ZAP_BODY_SEGMENTS; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 1), mat);
    group.add(seg);
    segs.push(seg);
  }
  parent.add(group);
  return { group, mat, segs };
}

function getScorchTexture(): THREE.CanvasTexture {
  if (scorchTexture) return scorchTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const soot = ctx.createRadialGradient(c, c, 0, c, c, c);
  soot.addColorStop(0, 'rgba(6,5,6,1)');
  soot.addColorStop(0.4, 'rgba(12,10,12,0.82)');
  soot.addColorStop(0.75, 'rgba(20,17,20,0.32)');
  soot.addColorStop(1, 'rgba(24,20,24,0)');
  ctx.fillStyle = soot;
  ctx.fillRect(0, 0, size, size);
  // 검댕 얼룩 — 가장자리를 울퉁불퉁하게
  for (let i = 0; i < 10; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = c * (0.3 + Math.random() * 0.45);
    const blob = ctx.createRadialGradient(
      c + Math.cos(ang) * r, c + Math.sin(ang) * r, 0,
      c + Math.cos(ang) * r, c + Math.sin(ang) * r, c * (0.12 + Math.random() * 0.2),
    );
    blob.addColorStop(0, 'rgba(8,6,8,0.55)');
    blob.addColorStop(1, 'rgba(8,6,8,0)');
    ctx.fillStyle = blob;
    ctx.fillRect(0, 0, size, size);
  }
  scorchTexture = new THREE.CanvasTexture(canvas);
  return scorchTexture;
}

function getFrostTexture(): THREE.CanvasTexture {
  if (frostTexture) return frostTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const film = ctx.createRadialGradient(c, c, 0, c, c, c);
  film.addColorStop(0, 'rgba(214,240,255,0.85)');
  film.addColorStop(0.45, 'rgba(180,222,250,0.5)');
  film.addColorStop(0.8, 'rgba(160,210,245,0.18)');
  film.addColorStop(1, 'rgba(160,210,245,0)');
  ctx.fillStyle = film;
  ctx.fillRect(0, 0, size, size);
  // 결정 줄기 — 중심에서 뻗는 가지들, 끝으로 갈수록 가늘고 옅다
  ctx.strokeStyle = 'rgba(235,248,255,0.9)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
    const len = c * (0.45 + Math.random() * 0.5);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(ang) * len, c + Math.sin(ang) * len);
    ctx.stroke();
    // 곁가지
    for (let j = 0; j < 3; j++) {
      const t = 0.3 + Math.random() * 0.5;
      const bx = c + Math.cos(ang) * len * t;
      const by = c + Math.sin(ang) * len * t;
      const side = ang + (Math.random() < 0.5 ? 0.7 : -0.7);
      const bl = len * (0.15 + Math.random() * 0.2);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(side) * bl, by + Math.sin(side) * bl);
      ctx.stroke();
    }
  }
  frostTexture = new THREE.CanvasTexture(canvas);
  return frostTexture;
}

/** 얼음 결정 — 몸통 둘레에 박힌 뾰족한 조각들. 빛을 안 받는 재질이라 어둠에서도 얼음빛이다 */
function makeIceShards(def: { radius: number; height: number }): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: ICE_COLOR, transparent: true, opacity: 0.85 });
  const count = 7;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const h = 0.18 + Math.random() * 0.26; // 실측: 0.12~0.32 는 3m 에서 점으로 보였다
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.05 + Math.random() * 0.04, h, 4), mat);
    const r = def.radius * 0.95;
    const y = def.height * (0.25 + Math.random() * 0.55);
    shard.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r);
    // 바깥·위쪽으로 삐죽 — 몸에서 자라난 결정처럼
    shard.lookAt(Math.cos(ang) * r * 3, y + 1.2, Math.sin(ang) * r * 3);
    shard.rotateX(Math.PI / 2);
    group.add(shard);
  }
  return group;
}

/** 부드러운 발광 원 — 안광 후광과 생명 입자가 공유한다. 가운데가 밝고 가장자리로 사라지는 원. 가산 혼합으로 얹어
 *  "빛이 번진다"를 만든다. 한 장을 모든 적이 공유한다 */
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

/** 안광 하나 — unlit 구(가까이서 보이는 알맹이) + 후광 스프라이트(멀리서 보이는 점).
 *  재질은 적 하나가 눈 여러 개에 공유한다 — 어그로 밝기를 한 번에 바꾸려고 */
function addGlowEye(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  eyeMat: THREE.MeshBasicMaterial,
  haloMat: THREE.SpriteMaterial,
  halos: THREE.Sprite[],
): void {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(radius, 6, 5), eyeMat);
  eye.position.set(x, y, z);
  parent.add(eye);
  const halo = new THREE.Sprite(haloMat);
  const size = radius * balance.lighting.enemyEyes.haloScaleMul;
  halo.scale.set(size, size, 1);
  halo.position.set(x, y, z);
  parent.add(halo);
  halos.push(halo);
}

/** 적 하나의 안광 재질 한 벌 */
interface EyeKit {
  eyeMat: THREE.MeshBasicMaterial;
  haloMat: THREE.SpriteMaterial;
  halos: THREE.Sprite[];
}
function makeEyeMaterials(): EyeKit {
  const cfg = balance.lighting.enemyEyes;
  const color = new THREE.Color(cfg.color);
  return {
    halos: [],
    eyeMat: new THREE.MeshBasicMaterial({ color }),
    haloMat: new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color,
      transparent: true,
      opacity: cfg.haloOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false, // 뒤의 것을 가리지 않는다. depthTest 는 켜 둔다 — 벽 너머로 안 비친다
    }),
  };
}
let lockTexture: THREE.CanvasTexture | null = null;
/** 락온 마름모 — 소울라이크 관례의 표적 표시. 어두운 테두리로 어느 배경에서도 남는다 */
function getLockTexture(): THREE.CanvasTexture {
  if (lockTexture) return lockTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.lineTo(56, 32);
  ctx.lineTo(32, 56);
  ctx.lineTo(8, 32);
  ctx.closePath();
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffd24a';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 210, 74, 0.25)';
  ctx.fill();
  lockTexture = new THREE.CanvasTexture(canvas);
  return lockTexture;
}

function getAlertTexture(): THREE.CanvasTexture {
  if (alertTexture) return alertTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 54px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 어두운 테두리를 먼저 깔아 벽·적 몸통 어느 쪽 앞에서도 형태가 남게 한다
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText('!', 32, 34);
  ctx.fillStyle = '#ffd24a';
  ctx.fillText('!', 32, 34);
  alertTexture = new THREE.CanvasTexture(canvas);
  return alertTexture;
}

/** 남은 칸 수별 바 색. 마지막 칸(1)만 잔량에 따라 초록→노랑→빨강으로 변한다 */
const PLATE_BAR_COLORS = ['#b070e8', '#4fc3ff']; // 2칸째 보라, 3칸째 하늘 (여유분)
function barColor(index: number, frac: number): string {
  if (index > 1) return PLATE_BAR_COLORS[Math.min(index - 2, PLATE_BAR_COLORS.length - 1)]!;
  return frac > 0.5 ? '#3fae5a' : frac > 0.25 ? '#c9a227' : '#e04444';
}

/** 패링 카운터 — 체력 바 오른쪽에 붙는 칸. 채워질수록 스태거가 가깝다 */
interface ParryPips {
  streak: number;
  total: number;
  /** 스태거 중 — 전부 금색으로 켜서 "지금 처형" 을 알린다 */
  staggered: boolean;
}
const PIP_ON = '#bfe0ff'; // 패링 청백색 (격돌 불꽃과 같은 계열)
const PIP_STAGGER = '#ffb648';

function drawPlate(
  canvas: HTMLCanvasElement,
  name: string,
  healthFrac: number,
  barIndex = 1,
  barCount = 1,
  parry: ParryPips | null = null,
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, PLATE_W, PLATE_H);

  const label = barCount > 1 ? `${name} ×${barIndex}` : name;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(label, 129, 19);
  ctx.fillStyle = '#e8e8ee';
  ctx.fillText(label, 128, 18);

  // HP 바 — 패링 카운터가 붙으면 그만큼 자리를 내준다
  const barX = 28;
  const barY = 40;
  const barH = 16;
  const pipW = 14;
  const pipGap = 5;
  const pipsW = parry ? parry.total * pipW + (parry.total - 1) * pipGap : 0;
  const barW = parry ? 200 - pipsW - 10 : 200;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  const frac = Math.max(0, Math.min(1, healthFrac));
  ctx.fillStyle = barColor(barIndex, frac);
  ctx.fillRect(barX, barY, barW * frac, barH);
  // 남은 칸 표시 — 뒤에 칸이 더 있으면 바 아래 얇은 선으로 몇 칸인지 알려 준다
  if (barIndex > 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(barX - 2, barY + barH + 3, barW + 4, 5);
    ctx.fillStyle = barColor(barIndex - 1, 1);
    ctx.fillRect(barX, barY + barH + 4, barW, 3);
  }

  // 패링 카운터 — 바 오른쪽에 total 칸. 연속 성공한 만큼 켜지고, 스태거면 전부 금색.
  // HUD 구석의 [패링 n/3] 을 안 보고도 머리 위에서 바로 읽히게 한다
  if (parry) {
    const pipX = barX + barW + 10;
    for (let i = 0; i < parry.total; i++) {
      const x = pipX + i * (pipW + pipGap);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x - 1, barY - 1, pipW + 2, barH + 2);
      const on = parry.staggered || i < parry.streak;
      ctx.fillStyle = on ? (parry.staggered ? PIP_STAGGER : PIP_ON) : '#39424d';
      ctx.fillRect(x, barY, pipW, barH);
    }
  }
}
const TRACER_START_PUSH = 0.5; // 총구에서 이만큼 전진한 지점부터 그린다 (근접부 왜곡 방지)
// 뇌창 빔 — 마디 수·흔들림 폭·한 타 섬광이 남는 시간
const BEAM_SEGMENTS = 12;
const BEAM_JITTER = 0.32;
const BEAM_PULSE_MS = 90;
/** 문이 열리는 각도 — 100도. 90도면 문틀에 딱 붙어 벽에 묻혀 보인다 */
const DOOR_SWING_RAD = (100 * Math.PI) / 180;
// 층 이동 연출 — 내려갈 때 카메라가 가라앉는 폭 (올라갈 때는 반대로 떠오른다)
const STAIR_STEPS_DROP = 2.6;
/** 전진 거리 — 계단을 향해 걸어 들어간다. 등속이라 누른 순간부터 발이 나간다 */
const DESCENT_FORWARD = 3.0;
/** 궁수 활 리그 치수 — 렌더 전용 (활대 반높이 / 시위 최대 당김 거리) */
const BOW_HALF = 0.55;
const BOW_DRAW_DIST = 0.42;

/** 궁수 활 리그 — 디버그 미리보기(debug/archer.ts)와 같은 코드를 쓰도록 밖으로 뺐다.
 *  로컬 좌표: 활대는 ±y 세로, 등(불룩한 쪽)이 -x, 시위는 +x 쪽으로 당겨진다.
 *  그룹을 y축 -90° 돌려 두므로 부모(torso) 기준 -z(표적 쪽)로 화살이 향한다 */
export interface BowRig {
  group: THREE.Group;
  stringTop: THREE.Mesh;
  stringBottom: THREE.Mesh;
  arrow: THREE.Group;
}

export function buildBowRig(): BowRig {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4a24 });
  // 활대 — 반원 호. z축 90° 돌려 세로로 세우면 호의 배가 -x(표적 쪽)를 본다
  const limb = new THREE.Mesh(new THREE.TorusGeometry(BOW_HALF, 0.035, 6, 16, Math.PI), woodMat);
  limb.rotation.z = Math.PI / 2;
  group.add(limb);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.1), woodMat);
  grip.position.x = -BOW_HALF; // 호의 배 가운데 — 손잡이
  group.add(grip);
  const stringMat = new THREE.MeshBasicMaterial({ color: 0xd8d2c0 });
  const makeString = (): THREE.Mesh => {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.016, 1, 0.016), stringMat);
    group.add(seg);
    return seg;
  };
  const stringTop = makeString();
  const stringBottom = makeString();
  // 재어 둔 화살 — 오늬(꼬리)가 리그 원점에 와서 시위에 걸린다. 촉은 -x(표적 쪽)
  const arrow = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.03, 0.03),
    new THREE.MeshLambertMaterial({ color: 0x9a7d4e }),
  );
  shaft.position.x = -0.425;
  arrow.add(shaft);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.05, 0.05),
    new THREE.MeshLambertMaterial({ color: 0xb9c2cc }),
  );
  head.position.x = -0.88;
  arrow.add(head);
  const fletch = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.11, 0.015),
    new THREE.MeshLambertMaterial({ color: 0xc94f42 }),
  );
  fletch.position.x = -0.07;
  arrow.add(fletch);
  arrow.visible = false;
  group.add(arrow);
  group.rotation.y = -Math.PI / 2; // 로컬 -x → 부모 -z (표적 쪽)
  const rig = { group, stringTop, stringBottom, arrow };
  updateBowDraw(rig, 0, false);
  return rig;
}

/** 당김 0~1 에 맞춰 시위 두 가닥과 재어 둔 화살을 옮긴다 */
export function updateBowDraw(rig: BowRig, draw: number, showArrow: boolean): void {
  const nockX = draw * BOW_DRAW_DIST;
  const segLen = Math.hypot(BOW_HALF, nockX);
  const segTilt = Math.atan2(nockX, BOW_HALF);
  rig.stringTop.scale.y = segLen;
  rig.stringBottom.scale.y = segLen;
  rig.stringTop.position.set(nockX / 2, BOW_HALF / 2, 0);
  rig.stringBottom.position.set(nockX / 2, -BOW_HALF / 2, 0);
  rig.stringTop.rotation.z = segTilt;
  rig.stringBottom.rotation.z = -segTilt;
  rig.arrow.visible = showArrow;
  rig.arrow.position.x = nockX;
  rig.group.rotation.z = -0.18 * draw; // 당길수록 살짝 들려 조준한다
}

/** 얼굴에 붙은 거머리 리그 — 카메라 정면 0.3m 에 매달린 실물. 몸통이 화면 가운데를
 *  덮고 촉수가 화면 밖으로 뻗는다. 디버그 미리보기(debug/leechface.ts)와 코드를 공유한다 */
export function buildFaceLeechRig(): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({
    color: 0x7a4b6e,
    emissive: 0x2a1030, // 어두운 던전에서도 실루엣이 읽히게 은은히 자체 발광
    emissiveIntensity: 0.55,
  });
  // 몸통 — 시야 가운데를 덮는 젖은 살덩이
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.12), bodyMat);
  body.name = 'flbody';
  group.add(body);
  // 빨판 입 — 화면 정중앙, 검은 원통이 다가온다
  const mouth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.1, 0.05, 12),
    new THREE.MeshBasicMaterial({ color: 0x12060e }),
  );
  mouth.rotation.x = Math.PI / 2;
  mouth.position.z = 0.07;
  mouth.name = 'flmouth';
  group.add(mouth);
  // 촉수 — 화면 네 귀퉁이 밖으로 뻗어 '감싸 쥔' 그림을 만든다
  const tentMat = new THREE.MeshLambertMaterial({
    color: 0x5c3853,
    emissive: 0x1c0a18,
    emissiveIntensity: 0.5,
  });
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI * 2 * i) / 6 + 0.35;
    const tent = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.05), tentMat);
    tent.name = `fltent${i}`;
    tent.position.set(Math.cos(ang) * 0.24, Math.sin(ang) * 0.19, -0.01);
    tent.rotation.z = ang - Math.PI / 2;
    // 피벗을 몸통 쪽 끝으로 — 끝이 꿈틀거려야 살아 있다
    tent.geometry.translate(0, 0.25, 0);
    group.add(tent);
  }
  // 눈 — 나를 보고 있다
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff5030 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), eyeMat);
    eye.position.set(side * 0.09, 0.09, 0.06);
    group.add(eye);
  }
  return group;
}

/** 리그 꿈틀거림 — 맥동(빨기 박자)과 촉수 물결. pulse 는 최근 흡혈 후 경과(ms) */
export function animateFaceLeechRig(group: THREE.Group, nowMs: number, msSinceSuck: number): void {
  // 흡혈 순간 훅 조였다가 풀린다 + 느린 숨쉬기
  const suckSqueeze = msSinceSuck < 260 ? (1 - msSinceSuck / 260) * 0.16 : 0;
  const breath = Math.sin(nowMs / 420) * 0.04;
  const s = 1 + breath + suckSqueeze;
  const body = group.getObjectByName('flbody');
  if (body) body.scale.set(s, 1 / s + suckSqueeze * 0.5, s);
  const mouth = group.getObjectByName('flmouth');
  if (mouth) mouth.position.z = 0.07 + suckSqueeze_z(msSinceSuck);
  for (let i = 0; i < 6; i++) {
    const tent = group.getObjectByName(`fltent${i}`);
    if (tent) tent.rotation.z += Math.sin(nowMs / 300 + i * 1.7) * 0.0035;
  }
}
function suckSqueeze_z(msSinceSuck: number): number {
  return msSinceSuck < 260 ? (1 - msSinceSuck / 260) * 0.05 : 0;
}

/** 거머리 위장색 — GridLoader 의 천장 돌빛(COLOR_CEILING)과 같은 값 */
const LEECH_CAMO_COLOR = 0x342f28;
const LEECH_TMP_DIR = new THREE.Vector3();
const LEECH_TMP_COLOR = new THREE.Color();

/** 구울 팔 각도 — 두 팔을 앞으로 나란히 (수평보다 살짝 처져 스산하게) */
const GHOUL_ARMS_FORWARD = 1.45;
/** 할퀴기 치켜들기 / 밀쳐냈을 때 — 머리 위로 들린다 */
const GHOUL_ARMS_RAISED = 2.65;
/** 내려찍기 끝 각 — 앞으로 나란히보다 아래까지 후려친다 */
const GHOUL_ARMS_SLAM = 0.7;
/** 헤드샷 머리 젖힘 지속(ms) */
const HEADSHOT_SHAKE_MS = 320;
/** 적 다리 위상 속도 — 보폭 1.4m 에 한 사이클 (rad/m) */
const ENEMY_LEG_FREQ = (Math.PI * 2) / 1.4;
/** 족장의 열쇠 표시색 — 금빛 */
const KEY_COLOR = 0xf0c34a;
/** 처음엔 천천히, 끝에서 훅 — 계단을 딛다 마지막에 어둠으로 잠기는 느낌 */
const easeInCubic = (t: number): number => t * t * t;
/** 각도 보간 — 최단 호를 따라 돈다 (2π 경계를 넘어 한 바퀴 돌지 않게) */
const lerpAngle = (a: number, b: number, k: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};
// 뇌창 그을림 — 빔이 머무는 자리가 검게 탄다. 한 타마다 새 데칼을 찍으면 초당 10장이
// 쌓이므로, 가까운 자국은 새로 찍지 않고 더 짙게 태운다
const SCORCH_RADIUS = 0.5;
const SCORCH_MS = 16000; // 그을음은 서리보다 오래 남는다
const SCORCH_FADE_T = 0.25; // 마지막 이 비율에서만 옅어진다
const SCORCH_LIFT = 0.02;
const SCORCH_MERGE_DIST = 0.65;
const SCORCH_HEAT_STEP = 0.24; // 한 타마다 이만큼 짙어진다 — 4~5타면 새까맣다
const SCORCH_MAX = 56;
// 연쇄 번개 — 적과 적 사이를 잇는 짧은 호. 타 간격(100ms)보다 조금 오래 남아 이어져 보인다
const CHAIN_ARC_MS = 150;
const CHAIN_ARC_SEGMENTS = 5;
const CHAIN_ARC_JITTER = 0.3;
/** 화염구가 지팡이 끝에서 판정 위치로 합쳐지는 시간 */
const LAUNCH_BLEND_MS = 260;
const TRACER_WIDTH = 0.022;

// 사망 파편 (시각 상수)
const DEATH_PARTICLE_COUNT = 14;
const CHEST_WOOD = 0x6b4a2a;
const CHEST_TRIM = 0xe8c76a; // 금속 띠 — 바닥 각인과 같은 금색 계열
const CHEST_W = 1.05;
const CHEST_D = 0.7;
const CHEST_H = 0.62;
const CHEST_LID_OPEN = 1.9; // rad — 뒤로 완전히 젖힌다
const BARREL_COLOR = 0x5a4436; // 나무통 — 어두운 갈색
const BARREL_BAND_COLOR = 0x8a3b2a;
const BARREL_BAND_IDLE = 0x2a0f0a;
const BARREL_BAND_LIT = 0xff5a2a;
const BARREL_FUSE_REF_TICKS = 180; // 가장 긴 도화선(3초) 기준으로 깜빡임 속도를 잡는다
const BARREL_BAND_ZAP = 0x7fd4ff; // 뇌창에 지져지는 중 — 띠가 전기색으로 물든다
const BARREL_ZAP_ACTIVE_MS = 120; // 이 시간 안에 지져졌으면 "지금 지지는 중"으로 본다
// 감전 — 뇌창에 맞은 적의 몸을 타고 흐르는 전류
const ZAP_BODY_MS = 260; // 타 간격(100ms)보다 길어 붙들고 있으면 끊기지 않는다
const ZAP_BODY_SEGMENTS = 7;
const ZAP_BODY_COLOR = 0x9fd8ff;
// 감전 경직 — 자세는 그대로 두고 몸만 좌우로 떤다
const SHOCK_SHAKE_AMP = 0.055; // 좌우 흔들림 폭 (m)
const SHOCK_SHAKE_HZ = 26;
const SHOCK_ROLL = 0.055; // 몸통이 같이 기우뚱하는 각 (rad)
const BARRIER_SHARD_COUNT = 26;
const PROJECTILE_DEBRIS_COUNT = 16; // 공중에서 깨진 투사체 파편 // 방어막 파편 — 사망 파편보다 많게 (막이 통째로 터진다)
const DEATH_PARTICLE_LIFE_MS = 650;
const DEATH_GRAVITY = 14;

interface Particle {
  mesh: THREE.Mesh;
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
  bornMs: number;
  /** 없으면 DEATH_PARTICLE_LIFE_MS */
  lifeMs?: number;
  /** 참 = 얼굴(-Z, 눈 쪽)을 매 프레임 카메라로 돌린다 — 떨어져 나간 머리용 */
  faceCamera?: boolean;
  /** 초당 회전 (파편이 돌면서 날아간다) */
  spinX?: number;
  spinY?: number;
  spinZ?: number;
  /** 없으면 DEATH_GRAVITY */
  gravity?: number;
  /** 이 높이에 닿으면 착지해 눕는다 — 날아간 머리가 바닥에 머물다 사라지게 */
  restY?: number;
  /** 착지하면 이 색의 핏자국(spawnBloodStain)을 남긴다 — 타격 피 방울용 */
  stainColor?: number;
  landedAtAge?: number;
  landedX?: number;
  landedZ?: number;
}

interface Tracer {
  group: THREE.Group;
  beam: THREE.Mesh;
  spark: THREE.Mesh;
  bornMs: number;
  lifeMs: number;
}

export class Stage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly lantern: THREE.SpotLight;
  private lanternSpill!: THREE.PointLight;
  /** 랜턴이 켜져 있는가 — 거머리 위장 해제 판정에 쓴다 (setLanternOn 이 갱신) */
  private lanternIsOn = true;
  /** 얼굴에 붙은 거머리 실물 — 카메라 자식. 흡혈 순간(pulse) 훅 조인다 */
  private faceLeechRig: THREE.Group | null = null;
  private faceLeechSuckAt = 0;
  /** 바닥 핏자국 — 타격 피 방울이 착지한 자리. 상한·수명은 balance.hitBlood.stain */
  private bloodStains: { mesh: THREE.Mesh; bornMs: number }[] = [];
  /** 초음파 파문 — 박쥐 입에서 먹이 쪽으로 퍼져 나가는 고리들 */
  private sonicWaves: {
    mesh: THREE.Mesh;
    bornMs: number;
    dirX: number;
    dirZ: number;
    ox: number;
    oy: number;
    oz: number;
  }[] = [];
  private readonly muzzleLight: THREE.PointLight;
  private readonly eyeHeight = balance.player.eyeHeight;
  private readonly enemyVisuals = new Map<number, EnemyVisual>();
  /** 처형 연출 중 붙잡아 둔 시체 — id → 해제 시각(ms) */
  private readonly heldVictims = new Map<number, number>();
  /** 플레이어 화염구의 시각 출발점 — 지팡이 끝에서 나와 판정 위치로 수렴한다 */
  private readonly projectileLaunch = new Map<number, { ms: number; from: THREE.Vector3 }>();
  private readonly projectileVisuals = new Map<number, THREE.Group>();
  private readonly lifeMoteVisuals = new Map<number, THREE.Sprite>();
  /** 서리 자국 — 얼음 화살이 닿은 벽·바닥·천장. 녹아 사라질 때까지 산다 */
  private readonly frostDecals: {
    group: THREE.Group;
    film: THREE.MeshBasicMaterial;
    crystals: THREE.Group;
    bornMs: number;
  }[] = [];
  private readonly groundItemVisuals = new Map<number, THREE.Group>();
  private readonly chestVisuals = new Map<number, { group: THREE.Group; lid: THREE.Object3D }>();
  /** 기믹(파괴물) 시각 — 배열에서 빠지면(파괴) 걷는다 (syncBarrels 와 같은 규약) */
  private readonly propVisuals = new Map<number, THREE.Group>();
  private readonly trapVisuals = new Map<number, THREE.Group>();
  /** 심지 불빛 — 폭발 당첨 기믹의 치익 반짝임 */
  private fuseGlows: { light: THREE.PointLight; bornMs: number; ttlMs: number }[] = [];
  private readonly barrelVisuals = new Map<
    number,
    { group: THREE.Group; band: THREE.MeshLambertMaterial; light: THREE.PointLight }
  >();
  /** 지금 씬에 올라가 있는 층 지오메트리 — 다음 층으로 갈 때 걷어낸다 */
  private levelGroup: THREE.Group | null = null;
  /** 출구 계단을 막은 쇠사슬·자물쇠 — 자물쇠를 따면 사라진다 */
  private exitBars: THREE.Object3D | undefined;
  private barsAnimStart = 0; // 쇠창살 시네마틱 시작 시각 (0 = 없음)
  private barsAnimDur = 1;
  /** 쇠창살 상승 진행 0(내려옴)~1(올라감) — 매 프레임 목표로 감긴다 */
  private exitBarsRise = 0;
  /** 내려가는 연출 — 시작 시각(0 이면 안 도는 중) */
  private descentStart = 0;
  private descentMs = 1;
  /** +1 = 내려간다, −1 = 올라간다 */
  private descentDir = 1;
  /** 1인칭 다리 — 아래를 내려다보면 보인다. 걸음(bobPhase)과 같은 위상으로 젓는다 */
  private playerLegs: { group: THREE.Group; left: THREE.Group; right: THREE.Group } | null = null;
  /** 걷기 흔들림 — 위상은 이동 거리로 돌고, blend 로 멈출 때 부드럽게 빠진다 */
  private bobPhase = 0;
  private bobBlend = 0;
  private lastCamX = 0;
  private lastCamZ = 0;
  /** 이동 중 몸을 돌릴 방향 — 계단 입을 향한다. null 이면 보던 쪽 그대로 */
  private descentYaw: number | null = null;
  private readonly tracers: Tracer[] = [];
  private readonly particles: Particle[] = [];
  /** 피해 숫자·처치 XP — 맞은 자리 위로 떠올랐다 사라지는 캔버스 스프라이트 */
  private readonly damagePops: {
    sprite: THREE.Sprite; y0: number; bornMs: number; ms: number;
  }[] = [];
  private readonly hands = new HandModel();
  /** 카메라 충격 (처형 등) — 남은 시간과 세기 */
  private camKickUntil = 0;
  private camKickMs = 1;
  private camKickPower = 0;
  /** 처형 섬광 — 짧게 터지는 점광 */
  private readonly executeFlash: THREE.PointLight;
  private executeFlashUntil = 0;
  private executeFlashMs = 200;
  private executeFlashPower = 5;
  private ambientLight: THREE.AmbientLight | null = null;
  private levelAmbient = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // 랜턴 스포트라이트 — 카메라에 부착해 시선을 따라간다.
    // decay 0: distance 컷오프 감쇠만 사용 (balance intensity 스케일 유지)
    const lp = balance.lantern;
    this.lantern = new THREE.SpotLight(
      0xffffff,
      lp.intensity,
      lp.radius,
      (lp.angleDeg * Math.PI) / 180,
      lp.penumbra,
      0,
    );
    this.lantern.position.set(0, 0, 0);
    this.lantern.target.position.set(0, 0, -1);
    this.camera.add(this.lantern);
    this.camera.add(this.lantern.target);

    // 랜턴 잔광 — 좁은 빔 밖 발밑 주변의 약한 빛 (완전 암흑 방지)
    this.lanternSpill = new THREE.PointLight(0xffffff, lp.spillIntensity, lp.spillRadius, 0);
    this.camera.add(this.lanternSpill);

    // 플레이어 미광 — 랜턴과 무관하게 항상 켜져 있는 편의 조명.
    // 렌더에만 존재한다: 적 인지는 world.lantern.on 만 보므로 이 빛엔 안 들킨다.
    // 살짝 차가운 색 — 따뜻한 랜턴 빛과 구분돼 "랜턴이 꺼져 있다"가 색으로 읽힌다
    const glow = balance.lighting.playerGlow;
    const playerGlow = new THREE.PointLight(
      new THREE.Color(glow.color),
      glow.intensity,
      glow.radius,
      0,
    );
    this.camera.add(playerGlow);

    // 총구 화염 — 강도/반경은 랜턴의 배율 (combat.md §6: 실질적 정찰 수단, 미묘하게 만들지 말 것)
    const mf = balance.weapons.pistol.muzzleFlash;
    this.muzzleLight = new THREE.PointLight(
      0xffd9a0,
      lp.intensity * mf.intensity,
      lp.radius * mf.radiusMul,
      0,
    );
    this.muzzleLight.visible = false;
    this.muzzleLight.position.set(MUZZLE_OFFSET.x, MUZZLE_OFFSET.y, MUZZLE_OFFSET.z);
    this.camera.add(this.muzzleLight);

    // 처형 섬광 — 강타 지점에서 순간적으로 터지는 빛 (씬 소속: 적 위치에 놓는다)
    this.executeFlash = new THREE.PointLight(0xffe6b0, 0, balance.lighting.flashDistance, 0);
    this.executeFlash.visible = false;
    this.scene.add(this.executeFlash);

    // 1인칭 뷰모델
    this.camera.add(this.hands.group);

    window.addEventListener('resize', this.onResize);
  }

  triggerRecoil(): void {
    this.hands.triggerRecoil();
  }

  setHandWeapon(kind: 'hammer' | 'grenade' | 'pistol' | 'bow'): void {
    this.hands.setWeapon(kind);
  }

  /** step: 연속타 단계 (1·2·3) — 단계마다 궤적이 다르다 */
  triggerHammerSwing(step = 1, speedMul = 1): void {
    this.hands.triggerHammerSwing(step, speedMul);
  }

  /** 불발 — 총이 딸깍 들썩이고 탄약 표시가 붉어진다 */
  triggerDryFire(): void {
    this.hands.triggerDryFire();
  }

  /** 방어 성공 — 방패 섬광 + 화살이면 방패에 꽂힘 */
  triggerBlockHit(kind?: string): void {
    this.hands.triggerBlockHit(kind);
  }

  /** 처형 마무리 — 해머 분쇄. 해머가 닿기까지의 시간(ms)을 돌려준다.
   *  호출자는 이 값으로 섬광·카메라 킥·사망 연출을 타격 순간에 맞춘다 */
  triggerExecuteFinisher(): number {
    this.hands.triggerExecuteFinisher();
    return FINISHER_CONTACT_MS;
  }

  /** 처형당한 적의 모습을 해머가 닿을 때까지 그 자리에 붙잡아 둔다.
   *  로직상 이미 죽었지만, 내려찍기 전에 사라지면 허공을 치는 그림이 된다 */
  holdExecutionVictim(enemyId: number, holdMs: number): void {
    this.heldVictims.set(enemyId, performance.now() + holdMs);
  }

  triggerGrenadeThrow(): void {
    this.hands.triggerGrenadeThrow();
  }

  /** 시전 — 해머를 지팡이처럼 내밀고 머리에서 스킬 색 마력이 터진다 */
  /** 뻗어 있는 뇌창 빔 — 채널이 끝날 때까지 살아 있다 */
  private beam: {
    group: THREE.Group;
    mat: THREE.MeshBasicMaterial;
    segs: THREE.Mesh[];
    spark: THREE.Mesh;
    light: THREE.PointLight;
  } | null = null;
  private beamEnd: THREE.Vector3 | null = null;
  private beamPulseAt = 0;
  /** 통 id → 마지막으로 뇌창에 지져진 시각 (지직거림을 켤지 판단) */
  private readonly barrelZapAt = new Map<number, number>();
  /** 뇌창이 지진 자국 — 위치와 "얼마나 태웠는가"를 들고 있다가 같은 자리면 더 태운다 */
  private readonly scorches: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    x: number; y: number; z: number;
    heat: number;
    bornMs: number;
  }[] = [];

  triggerCast(color: number): void {
    this.hands.triggerCast(color);
  }

  /** 채널 시전 — 붙들고 있는 동안 지팡이를 내민 채로 둔다 */
  setChannel(on: boolean, color = 0xffffff): void {
    this.hands.setChannel(on, color);
  }

  /** 지팡이 끝(해머 머리) 월드 좌표 — 마법의 시각적 출발점 */
  staffTip(): THREE.Vector3 {
    this.camera.updateMatrixWorld();
    return this.hands.staffTipWorld(new THREE.Vector3());
  }

  triggerParry(result: string): void {
    this.hands.triggerParry(result);
  }

  /** 알아챈 시각 — 적 id 로 들고 있다.
   *  시각 객체(EnemyVisual)에 직접 적으면, 아직 한 번도 그려지지 않은 적이
   *  그 프레임에 알아채는 경우 표시가 통째로 사라진다 (실측으로 확인).
   *  여기 적어 두면 다음 동기화 때 시각 객체가 생기면서 그대로 이어 붙는다 */
  private readonly alertAt = new Map<number, number>();
  /** 조준(ADS) 줌 진행도 0~1 — setAimZoom 이 매 프레임 목표로 수렴시킨다 */
  private aimZoomFrac = 0;

  /** 조준 줌 — FOV 를 좁혀 "겨눴다"가 몸에 온다. 떼면 스르르 돌아온다 */
  setAimZoom(aiming: boolean, fovScale: number, lerp: number): void {
    const target = aiming ? 1 : 0;
    this.aimZoomFrac += (target - this.aimZoomFrac) * lerp;
    if (Math.abs(this.aimZoomFrac - target) < 0.002) this.aimZoomFrac = target;
    const fov = 75 * (1 - (1 - fovScale) * this.aimZoomFrac);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
  /** 타겟 락온 — 잡힌 적 id 와 머리 위 마름모 스프라이트 */
  private lockOnTargetId: number | null = null;
  private lockSprite: THREE.Sprite | null = null;

  /** 락온 마커 대상 지정 — null 이면 숨긴다 (main 이 매 프레임 부른다) */
  setLockOn(enemyId: number | null): void {
    this.lockOnTargetId = enemyId;
    if (enemyId === null && this.lockSprite) this.lockSprite.visible = false;
  }

  private ensureLockSprite(): THREE.Sprite {
    if (this.lockSprite) return this.lockSprite;
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getLockTexture(),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false, // 몸통·벽 뒤에서도 마커는 보인다 — "잡고 있다"는 확답
      }),
    );
    spr.renderOrder = 999;
    spr.visible = false;
    this.scene.add(spr);
    this.lockSprite = spr;
    return spr;
  }

  /** 인지 표시 — 알아챈 순간 머리 위에서 튀어올랐다 옅어진다 */
  markAlert(enemyId: number): void {
    this.alertAt.set(enemyId, performance.now());
  }

  /** 방패에 화살을 꽂는다 — 슬롯을 순환해 쓴다 (다 차면 오래된 것부터 갈아 끼운다).
   *  방패가 이미 부서졌으면 꽂을 판이 없으므로 아무 일도 하지 않는다 */
  stickArrowInShield(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    const slots = visual?.shieldArrows;
    if (!visual || !slots || slots.length === 0 || !visual.shield) return;
    const i = (visual.shieldArrowSlot ?? 0) % slots.length;
    slots[i]!.visible = true;
    visual.shieldArrowSlot = i + 1;
  }

  flashShield(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (visual) visual.shieldFlashUntil = performance.now() + 120;
  }

  /** 근접 피격 셰이크 — 0.1초 동안 몸이 무작위로 튄다 (판정 좌표는 그대로) */
  shakeEnemyHit(enemyId: number, heavy: boolean): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (!visual) return;
    const cfg = balance.hitShake;
    visual.hitShakeUntil = performance.now() + cfg.durationMs;
    visual.hitShakeAmp = cfg.amp * (heavy ? cfg.heavyMul : 1);
  }

  /** 방어막 튕김 번쩍 (7.2 피드백) */
  flashBarrier(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (visual) visual.barrierFlashUntil = performance.now() + 160;
  }

  updateHands(state: {
    ammoText?: string;
    reloading: boolean;
    stunned: boolean;
    blocking?: boolean;
    chargeFrac?: number;
    /** 문 잠금을 푸는 중 진행률 0~1 — 0 이면 손을 대지 않은 상태 */
    doorFrac?: number;
    /** 활 시위를 당긴 정도 0~1 */
    bowDrawFrac?: number;
    /** 소모품을 마시는 중 진행률 0~1 과 그 아이템 색 */
    drinkFrac?: number;
    drinkColor?: number;
    /** 참 = 총을 내려 쥔다 (패드에서 조준 버튼을 안 붙든 상태) */
    gunLowered?: boolean;
  }): void {
    this.hands.update(state);
  }

  setLevel(group: THREE.Group, ambientIntensity: number): void {
    // 층을 갈아 끼울 때 앞 층이 남아 있으면 지오메트리와 환경광이 겹쳐 쌓인다
    if (this.levelGroup) this.disposeGroup(this.levelGroup);
    if (this.ambientLight) this.scene.remove(this.ambientLight);
    this.clearLevelFx();
    this.levelGroup = group;
    this.scene.add(group);
    this.levelAmbient = ambientIntensity;
    this.ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
    this.scene.add(this.ambientLight);
    this.exitPad = group.getObjectByName('exitPad') as THREE.Mesh | undefined;
    this.exitLight = group.getObjectByName('exitLight') as THREE.PointLight | undefined;
    this.exitBars = group.getObjectByName('exitBars') ?? undefined;
    this.exitBarsRise = 0;
    this.barsAnimStart = 0;
    this.exitOpen = null; // 층이 바뀌었다 — 다음 setExitOpen 이 무조건 다시 칠하게
    this.descentStart = 0;
    this.exitOpen = true; // 아래 호출이 실제로 반영되도록 반대값에서 시작
    this.setExitOpen(false);
  }

  private exitPad?: THREE.Mesh;
  private exitOpen: boolean | null = null;
  private exitLight?: THREE.PointLight;
  private exitFlashUntil = 0;

  /** 출구 개방 — 봉인 중엔 꺼진 돌바닥, 열리면 초록으로 켜진다.
   *  "늘 열려 있는 초록 바닥"으로 보이던 문제를 여기서 잡는다 */
  /** 층에 남은 흔적을 걷는다 — 자국·파편·빔은 그 층의 것이라 다음 층으로 따라가면 안 된다.
   *  적·통·상자·바닥 아이템의 모형은 배열이 비면 다음 동기화에서 저절로 사라진다 */
  private clearLevelFx(): void {
    this.clearLightningBeam();
    for (let i = this.scorches.length - 1; i >= 0; i--) this.removeScorch(i);
    for (let i = this.decals.length - 1; i >= 0; i--) this.removeDecal(this.decals[i]!);
    for (const pool of [this.frostDecals, this.tracers]) {
      for (const item of pool) this.disposeGroup(item.group);
      pool.length = 0;
    }
    for (const e of this.explosions) {
      this.scene.remove(e.light);
      this.scene.remove(e.shell);
      e.shell.geometry.dispose();
      const mat = e.shell.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    }
    this.explosions.length = 0;
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles.length = 0;
    for (const p of this.damagePops) {
      this.scene.remove(p.sprite);
      p.sprite.material.map?.dispose();
      p.sprite.material.dispose();
    }
    this.damagePops.length = 0;
    while (this.bloodStains.length > 0) this.removeBloodStain(0);
    for (const w of this.sonicWaves) {
      this.scene.remove(w.mesh);
      w.mesh.geometry.dispose();
      (w.mesh.material as THREE.Material).dispose();
    }
    this.sonicWaves.length = 0;
    // id 로 캐시된 모형들 — 층이 바뀌면 전부 걷는다. 남겨 두면 새 층에서 같은 id 를
    // 받은 다른 적·통·상자가 앞 층의 외형/자리를 뒤집어쓴다. 빈 배열 동기화가
    // 각 sync 의 제거·해제 경로를 그대로 태운다
    this.heldVictims.clear();
    this.syncEnemies([], 1);
    this.syncBarrels([]);
    this.syncProps([]);
    this.syncTraps([], 4);
    this.syncChests([]);
    this.syncGroundItems([]);
    this.syncLifeMotes([]);
    this.syncProjectiles([], 1);
  }

  /** 씬에서 떼고 그 아래 지오메트리·머티리얼을 전부 반납한다 */
  private disposeGroup(group: THREE.Object3D): void {
    // scene.remove 는 "직계 자식"만 뗀다 — 균열 벽처럼 레벨 그룹 안에 든 노드는
    // 부모에게서 떼야 한다. (부순 균열 벽이 그대로 서 있던 원인)
    group.removeFromParent();
    group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.geometry.dispose();
      const mat = obj.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    });
  }

  /** 쇠창살 시네마틱 — durMs 동안 선형 상승. 이미 다 올라갔으면 아무 일 없다 */
  startBarsRise(durMs: number): void {
    if (!this.exitBars || this.exitBarsRise >= 1) return;
    this.barsAnimStart = performance.now();
    this.barsAnimDur = Math.max(1, durMs);
  }

  /** 연출 없이 즉시 올린다 — 보스 없는 층·이미 딴 층의 로드 직후 */
  snapBarsUp(): void {
    this.exitBarsRise = 1;
    this.barsAnimStart = 0;
    if (this.exitBars) this.exitBars.position.y = 2.55;
  }

  setExitOpen(open: boolean): void {
    if (open === this.exitOpen) return;
    this.exitOpen = open;
    // 다시 잠긴다(부활 재봉인) — 창살은 즉시 내려온다 (연출은 상승에만 쓴다)
    if (!open) {
      this.exitBarsRise = 0;
      this.barsAnimStart = 0;
    }
    // 잠김 = 붉게 달아오른 쇠창살, 열림 = 녹색 — '내려갈 수 있다/없다'가 색으로 읽힌다
    const mat = this.exitPad?.material as THREE.MeshLambertMaterial | undefined;
    if (mat) {
      mat.color.setHex(open ? COLOR_EXIT_OPEN : COLOR_EXIT_LOCKED);
      mat.emissive.setHex(open ? COLOR_EXIT_OPEN : COLOR_EXIT_LOCKED);
      mat.emissiveIntensity = 0.5;
      mat.opacity = 0.85;
    }
    if (this.exitLight) {
      this.exitLight.color.setHex(open ? COLOR_EXIT_OPEN : COLOR_EXIT_LOCKED);
      this.exitLight.intensity = 0.9;
    }
    // 창살 발광 — 잠긴 동안만 벌겋게 달아 있다. 열리면 식은 쇠로 매달려 있는다
    const barMesh = this.exitBars?.children[0] as THREE.Mesh | undefined;
    const barMat = barMesh?.material as THREE.MeshLambertMaterial | undefined;
    if (barMat) barMat.emissiveIntensity = open ? 0.06 : 0.4;
    // 열리는 순간 한 번 크게 번쩍인다 — 멀리서도 보이도록. 창살 상승은 매 프레임 감긴다
    if (open) this.exitFlashUntil = performance.now() + EXIT_FLASH_MS;
  }

  /** 매 프레임 — 석판이 옆으로 밀려 계단을 드러내고, 내려가는 중이면 카메라가 가라앉는다 */
  private updateExitStairs(now: number): void {
    if (this.descentStart === 0) return;
    const t = Math.min(1, (now - this.descentStart) / this.descentMs);
    // 계단 입 쪽으로 몸을 돌린다 — 앞 30% 동안 다 돌고, 그 방향으로 걸어 들어간다.
    // 어디를 보고 E 를 눌렀든 계단으로 들어가는 그림이 된다
    if (this.descentYaw !== null) {
      this.camera.rotation.y = lerpAngle(
        this.camera.rotation.y,
        this.descentYaw,
        Math.min(1, t / 0.3),
      );
    }
    // 전진은 등속 — 누른 순간부터 계단을 향해 걸어 들어간다.
    // (전에는 가속 이징이라 전진이 후반에 몰려 "제자리에서 가라앉는" 느낌이었다)
    this.camera.translateZ(-t * DESCENT_FORWARD);
    // 하강은 뒤로 갈수록 훅 — 계단을 밟다 마지막에 어둠으로 잠긴다.
    // 내려갈 땐(+1) 가라앉고 올라갈 땐(−1) 떠오른다
    this.camera.position.y -= this.descentDir * easeInCubic(t) * STAIR_STEPS_DROP;
    this.camera.rotation.x -= this.descentDir * t * 0.35; // 발밑(위)을 본다
    if (t >= 1) this.descentStart = 0;
  }

  /** 계단을 내려간다 — durationMs 동안 카메라가 앞으로 밀리며 가라앉는다.
   *  층을 갈아 끼우는 건 부르는 쪽 몫이다 (연출이 끝날 즈음에 부른다) */
  startDescent(durationMs: number, dir = 1, faceYaw: number | null = null): void {
    this.descentStart = performance.now();
    this.descentMs = Math.max(1, durationMs);
    this.descentDir = dir;
    this.descentYaw = faceYaw;
  }

  private updateExitLight(now: number): void {
    // 쇠창살 — 시네마틱(startBarsRise)이 걸리면 그 시간 동안 선형으로 감아올린다.
    // 다 올라가도 숨기지 않는다 — 상인방(2.9m) 아래로 촉이 매달려 '올라간 쇠창살'로 읽힌다
    if (this.exitBars) {
      if (this.barsAnimStart > 0) {
        this.exitBarsRise = Math.min(1, (now - this.barsAnimStart) / this.barsAnimDur);
        if (this.exitBarsRise >= 1) this.barsAnimStart = 0;
      }
      this.exitBars.position.y = this.exitBarsRise * 2.55;
    }
    if (!this.exitLight || !this.exitOpen) return;
    const left = this.exitFlashUntil - now;
    this.exitLight.intensity = left > 0 ? 0.9 + 5 * (left / EXIT_FLASH_MS) : 0.9;
  }

  /** 화면에 실제로 들어와 있는가 — 카메라 절두체 판정.
   *  yaw 기준 부채꼴 근사가 아니라 진짜 프러스텀이라 화면 가장자리까지 정확하다.
   *  (디버그 킬 키가 "보고 있는 적"을 고르는 데 쓴다) */
  isInView(x: number, y: number, z: number, radius: number): boolean {
    this.camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    this.viewSphere.center.set(x, y, z);
    this.viewSphere.radius = radius;
    return this.frustum.intersectsSphere(this.viewSphere);
  }

  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly viewSphere = new THREE.Sphere();

  /** 암시야 각인 — ambient 가산. boost 0 = 레벨 기본값 */
  setAmbientBoost(boost: number): void {
    if (this.ambientLight) this.ambientLight.intensity = this.levelAmbient + boost * 0.22;
  }

  /** 오염 25 임계 — 벽 문자를 원문으로 교체 */
  setGlyphsReadable(readable: boolean): void {
    // 해독 전 글리프는 룬 대신 아예 숨긴다 — 벽의 '알 수 없는 글자'를 없앴다.
    // 텍스처는 처음부터 원문으로 구워져 있어 여기선 보이기만 켠다
    this.scene.traverse((obj) => {
      if (obj.name === 'glyph') obj.visible = readable;
    });
  }

  /** 오염 시각 단계를 뷰모델에 전달 */
  setCorruptionStage(stage: number): void {
    this.hands.setCorruptionStage(stage);
  }

  /** 미닫이 — 문 판을 원래 자리에서 offset 만큼 옆으로 밀어 놓는다.
   *  셀 하나만큼 밀면 이웃 벽 셀에 정확히 가려져 사라진 것처럼 보인다.
   *  얼마나 밀지(진행률 × 셀 크기)는 부르는 쪽이 계산한다 — 여기는 그리기만 한다 */
  /** 문을 경첩에서 연다 — frac 0(닫힘) ~ 1(활짝). 문틀은 벽의 일부라 그대로 서 있고
   *  문짝만 돌아간다. 열린 뒤에도 사라지지 않고 열린 채로 남는다 */
  setDoorSwing(row: number, col: number, frac: number): void {
    // 경첩은 방향(mount)의 자식이라 제 회전은 순수한 여닫힘이다 — 0 이 닫힘
    const hinge = this.scene.getObjectByName(`door-${row}-${col}`);
    if (!hinge) return;
    // 음수 frac = 반대쪽으로 젖힘 (여는 사람 반대편으로 민다)
    hinge.rotation.y = Math.min(1, Math.max(-1, frac)) * DOOR_SWING_RAD;
  }

  /** 레버 당김 — 손잡이를 반대쪽으로 넘긴다 */
  pullLever(row: number, col: number): void {
    const handle = this.scene.getObjectByName(`lever-${row}-${col}`);
    if (handle) handle.rotation.z = -0.5;
  }

  /** 재사용 레버 — 당긴 손잡이가 제자리로 돌아온다 */
  resetLever(row: number, col: number): void {
    const handle = this.scene.getObjectByName(`lever-${row}-${col}`);
    if (handle) handle.rotation.z = 0;
  }

  /** 문 개방 — 다 밀린 판을 씬에서 걷어낸다 (이미 벽 속이라 화면은 그대로) */
  /** 다 열렸다 — 문짝은 활짝 열린 채로 남는다 (사라지면 문을 연 느낌이 안 난다) */
  openDoor(row: number, col: number, dir = 1): void {
    this.setDoorSwing(row, col, dir);
  }


  /** 균열 벽 파괴 */
  breakCrack(row: number, col: number): void {
    this.removeNamedCell(`crack-${row}-${col}`);
  }

  /** 균열 벽 붕괴 — 돌 파편이 사방으로 튀고 흙먼지가 인다 */
  spawnWallCrumble(x: number, z: number): void {
    const now = performance.now();
    // 48개 — 큰 덩이 소수 + 잔부스러기 다수. 적다는 피드백에 늘렸다 (2026-08-27)
    for (let i = 0; i < 48; i++) {
      const big = i < 10; // 앞 몇 개는 눈에 띄는 큰 덩이
      const w = big ? 0.24 + Math.random() * 0.3 : 0.08 + Math.random() * 0.2;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, w * (0.6 + Math.random() * 0.6), w),
        new THREE.MeshLambertMaterial({ color: i % 3 === 0 ? 0x3c3630 : 0x55555f }),
      );
      const ang = Math.random() * Math.PI * 2;
      const ox = x + Math.cos(ang) * (Math.random() * 2.0);
      const oy = 0.3 + Math.random() * 3.4; // 벽 전체 높이에서 떨어져 나온다
      const oz = z + Math.sin(ang) * (Math.random() * 2.0);
      mesh.position.set(ox, oy, oz);
      this.particles.push({
        mesh,
        ox, oy, oz,
        vx: Math.cos(ang) * (1.8 + Math.random() * 3.2),
        vy: 0.5 + Math.random() * 2.4,
        vz: Math.sin(ang) * (1.8 + Math.random() * 3.2),
        gravity: 9,
        lifeMs: 1000 + Math.random() * 700,
        bornMs: now,
        spinX: 4 + Math.random() * 6,
        spinZ: 4 + Math.random() * 6,
      });
      this.scene.add(mesh);
    }
  }

  private removeNamedCell(name: string): void {
    // 균열 벽은 문 리팩터 이후 Group(벽면+잔해)이다 — Mesh 로 좁히면 안 사라진다
    const node = this.scene.getObjectByName(name);
    if (node) this.disposeGroup(node);
  }

  /** 벽 잔존물 (화살·탄흔) — 수명이 다하면 옅어지며 사라진다.
   *  개수 상한은 짧은 시간에 몰아칠 때를 위한 안전장치로 남겨 둔다 */
  private readonly decals: {
    kind: 'arrow' | 'mark';
    object: THREE.Object3D;
    material: THREE.Material & { opacity: number };
    bornMs: number;
    lifeMs: number;
  }[] = [];

  private addDecal(
    kind: 'arrow' | 'mark',
    object: THREE.Object3D,
    material: THREE.Material & { opacity: number },
    lifeMs: number,
    maxCount: number,
  ): void {
    this.scene.add(object);
    this.decals.push({ kind, object, material, bornMs: performance.now(), lifeMs });
    const sameKind = this.decals.filter((d) => d.kind === kind);
    if (sameKind.length > maxCount) this.removeDecal(sameKind[0]!);
  }

  private removeDecal(decal: (typeof this.decals)[number]): void {
    const i = this.decals.indexOf(decal);
    if (i >= 0) this.decals.splice(i, 1);
    this.scene.remove(decal.object);
    decal.object.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }

  private updateDecals(now: number): void {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]!;
      const left = d.lifeMs - (now - d.bornMs);
      if (left <= 0) {
        this.removeDecal(d);
        continue;
      }
      // 마지막 구간에서만 옅어진다 — 그 전에는 또렷하게 남아 있어야 흔적 구실을 한다
      d.material.opacity = Math.min(1, left / DECAL_FADE_MS);
    }
  }

  /** 벽에 꽂힌 화살 — 촉이 벽 안, 꼬리가 밖.
   *  ⚠ 일반 Object3D 의 lookAt 은 카메라와 반대로 **+Z** 가 대상을 향한다
   *  (three.js 가 내부에서 eye/target 을 뒤바꾼다). 그래서 촉을 +Z 에 둔다 —
   *  -Z 에 두면 촉이 벽 밖을 보며 거꾸로 꽂힌다 (실측으로 확인) */
  spawnStuckArrow(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const arrow = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({
      color: 0x6b5233,
      transparent: true,
      opacity: 1,
    });
    arrow.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), material));
    const headMat = new THREE.MeshLambertMaterial({
      color: 0xb9c0c9,
      transparent: true,
      opacity: 1,
    });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.13), headMat);
    head.position.z = 0.33; // +Z = 날아온 방향 = 벽 안쪽
    arrow.add(head);
    // 촉이 박힌 지점에서 꼬리가 튀어나오도록 뒤로 물림
    arrow.position.set(x - dx * 0.26, y - dy * 0.26, z - dz * 0.26);
    arrow.lookAt(x + dx, y + dy, z + dz);
    this.addDecal('arrow', arrow, material, STUCK_ARROW_MS, 30);
  }

  /** 총알 탄흔 */
  spawnBulletMark(x: number, y: number, z: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0x121216,
      transparent: true,
      opacity: 1,
    });
    const mark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), material);
    mark.position.set(x, y, z);
    this.addDecal('mark', mark, material, BULLET_MARK_MS, 40);
  }

  /** 수류탄 차징 궤적 미리보기 — 점선. null이면 숨김 */
  private readonly arcDots: THREE.Mesh[] = [];
  updateThrowArc(points: { x: number; y: number; z: number }[] | null): void {
    const count = points?.length ?? 0;
    while (this.arcDots.length < count) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 6, 6),
        new THREE.MeshBasicMaterial({
          color: 0xffe9a0,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        }),
      );
      this.arcDots.push(dot);
      this.scene.add(dot);
    }
    for (let i = 0; i < this.arcDots.length; i++) {
      const dot = this.arcDots[i]!;
      if (points && i < points.length) {
        dot.visible = true;
        dot.position.set(points[i]!.x, points[i]!.y, points[i]!.z);
      } else {
        dot.visible = false;
      }
    }
  }

  /** 수류탄 폭발 — 섬광 + 팽창 구 + 파편 */
  spawnExplosion(x: number, y: number, z: number, radius: number): void {
    const now = performance.now();
    const flash = new THREE.PointLight(0xffb040, 6, radius * 3, 0);
    flash.position.set(x, Math.max(0.5, y), z);
    this.scene.add(flash);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff8830,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    shell.position.copy(flash.position);
    this.scene.add(shell);
    this.explosions.push({ light: flash, shell, bornMs: now, radius });
    // 파편 재활용 — 폭심에서 사방으로
    this.spawnDeathBurst(x, z, 'goblin_chieftain');
  }

  /** 거미줄을 걷어낼 때 — 눈앞에서 흰 실이 찢겨 흩어진다.
   *  카메라 바로 앞에 뿌려 "내 몸에 붙은 게 뜯긴다"로 읽히게 한다 */
  spawnWebTear(): void {
    const now = performance.now();
    const cam = this.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    for (let i = 0; i < WEB_TEAR_SHARDS; i++) {
      const len = 0.06 + Math.random() * 0.13;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.012, 0.012),
        new THREE.MeshBasicMaterial({ color: WEB_COLOR, transparent: true, opacity: 0.95 }),
      );
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const spread = (Math.random() - 0.5) * 1.2;
      const origin = cam.position
        .clone()
        .addScaledVector(fwd, 0.75)
        .addScaledVector(right, spread)
        .add(new THREE.Vector3(0, (Math.random() - 0.5) * 0.7, 0));
      mesh.position.copy(origin);
      this.particles.push({
        mesh,
        ox: origin.x,
        oy: origin.y,
        oz: origin.z,
        vx: right.x * spread * 3.2 + (Math.random() - 0.5) * 1.4,
        vy: 0.8 + Math.random() * 1.6,
        vz: right.z * spread * 3.2 + (Math.random() - 0.5) * 1.4,
        gravity: 5.5,
        lifeMs: WEB_TEAR_MS,
        bornMs: now,
        spinX: 7,
        spinZ: 5,
      });
      this.scene.add(mesh);
    }
  }

  /** 마법탄 내파 — 폭발의 역재생. 파편이 가장자리에서 폭심으로 빨려들고 셸이 오므라든다.
   *  화염구(주황·팽창)와 한눈에 구분되도록 보라·수축으로 잡았다 */
  spawnImplosion(x: number, y: number, z: number, radius: number): void {
    const now = performance.now();
    const cy = Math.max(0.6, y);
    const light = new THREE.PointLight(ENEMY_BOLT_COLOR, 0, radius * 3, 0);
    light.position.set(x, cy, z);
    this.scene.add(light);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({
        color: ENEMY_BOLT_COLOR,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      }),
    );
    shell.position.copy(light.position);
    this.scene.add(shell);
    this.explosions.push({ light, shell, bornMs: now, radius, implode: true });

    // 파편 — 반경 가장자리에서 폭심으로. 중력 없이 직선으로 빨려든다
    for (let i = 0; i < IMPLODE_SHARDS; i++) {
      const angle = (i / IMPLODE_SHARDS) * Math.PI * 2 + Math.random() * 0.4;
      const size = 0.07 + Math.random() * 0.08;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshLambertMaterial({
          color: ENEMY_BOLT_COLOR,
          emissive: ENEMY_BOLT_COLOR,
          emissiveIntensity: 0.9,
          transparent: true,
          opacity: 1,
        }),
      );
      const r = radius * (0.7 + Math.random() * 0.3);
      const ox = x + Math.cos(angle) * r;
      const oz = z + Math.sin(angle) * r;
      const oy = 0.25 + Math.random() * 1.5;
      const secs = IMPLODE_MS / 1000;
      mesh.position.set(ox, oy, oz);
      this.particles.push({
        mesh,
        ox,
        oy,
        oz,
        vx: (x - ox) / secs,
        vy: (cy - oy) / secs,
        vz: (z - oz) / secs,
        gravity: 0,
        lifeMs: IMPLODE_MS,
        bornMs: now,
        spinX: 5,
        spinY: 4,
      });
      this.scene.add(mesh);
    }
  }

  private readonly explosions: {
    light: THREE.PointLight;
    shell: THREE.Mesh;
    bornMs: number;
    radius: number;
    /** 내파 — 셸이 커지는 대신 오므라든다 */
    implode?: boolean;
  }[] = [];

  private updateExplosions(): void {
    const now = performance.now();
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i]!;
      const age = (now - ex.bornMs) / (ex.implode ? IMPLODE_MS : 380);
      if (age >= 1) {
        this.scene.remove(ex.light);
        this.scene.remove(ex.shell);
        ex.shell.geometry.dispose();
        (ex.shell.material as THREE.Material).dispose();
        this.explosions.splice(i, 1);
        continue;
      }
      if (ex.implode) {
        // 오므라들수록 진해지고 마지막에 번쩍 — 빨려드는 인상
        const s = Math.max(0.15, ex.radius * (1 - age));
        ex.shell.scale.set(s, s, s);
        // 초반엔 옅게 — 크게 퍼져 있을 때 진하면 빨려드는 적이 안 보인다
        (ex.shell.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.4 * age;
        ex.light.intensity = 5 * age * age;
        continue;
      }
      const s = 0.4 + age * ex.radius;
      ex.shell.scale.set(s, s, s);
      (ex.shell.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - age);
      ex.light.intensity = 6 * (1 - age);
    }
  }

  /** 카메라 충격 — 앞으로 훅 밀리며 짧게 흔들린다 (연출 전용, 조준에는 영향 없음) */
  triggerCameraKick(power = 1, durationMs = 260): void {
    this.camKickUntil = performance.now() + durationMs;
    this.camKickMs = durationMs;
    this.camKickPower = power;
  }

  /** 처형 섬광 — 지정 위치에서 짧게 터진다 */
  triggerExecuteFlash(x: number, z: number, height = 1.2): void {
    this.triggerFlash(x, height, z, 0xffe6b0, 200, 5);
  }

  /** 범용 섬광 — 위치·색·지속·세기 */
  triggerFlash(
    x: number,
    y: number,
    z: number,
    color: number,
    durationMs: number,
    power: number,
  ): void {
    this.executeFlash.position.set(x, y, z);
    this.executeFlash.color.setHex(color);
    this.executeFlashMs = durationMs;
    this.executeFlashPower = power;
    this.executeFlashUntil = performance.now() + durationMs;
  }

  /** 보간된 플레이어 상태를 카메라에 반영 */
  updateCamera(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y + this.eyeHeight, z);
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;

    // 걷기 흔들림 — 이동한 거리만큼 위상이 돌아 발걸음과 박자가 맞고,
    // 빨리 뛸수록 저절로 빨라진다. 순간이동(층 이동·부활)은 위상에 안 얹는다
    const bob = balance.player.bob;
    const stepDist = Math.hypot(x - this.lastCamX, z - this.lastCamZ);
    this.lastCamX = x;
    this.lastCamZ = z;
    const moving = stepDist > 0.001 && stepDist < 1;
    if (moving) this.bobPhase += (stepDist / bob.strideMeters) * Math.PI * 2;
    this.bobBlend += ((moving ? 1 : 0) - this.bobBlend) * 0.12;
    if (this.bobBlend > 0.01) {
      this.camera.position.y += Math.sin(this.bobPhase) * bob.amp * this.bobBlend;
    }
    this.updatePlayerLegs(x, z, yaw);

    const now = performance.now();
    if (now < this.camKickUntil) {
      // 초반에 크게 튀고 빠르게 잦아든다 + 고주파 진동
      const k = ((this.camKickUntil - now) / this.camKickMs) * this.camKickPower;
      const shake = Math.sin(now / 9) * 0.5 + Math.sin(now / 5.5) * 0.5;
      this.camera.rotation.x += k * (0.09 + 0.035 * shake);
      this.camera.rotation.z = k * 0.05 * shake;
      this.camera.rotation.y += k * 0.02 * shake;
      // 앞으로 밀려나는 느낌 (시선 방향으로 살짝 전진)
      this.camera.translateZ(-k * 0.22);
    } else if (this.camera.rotation.z !== 0) {
      this.camera.rotation.z = 0;
    }

    this.updateExitStairs(now);

    const flashLeft = this.executeFlashUntil - now;
    this.executeFlash.visible = flashLeft > 0;
    if (flashLeft > 0) {
      const f = flashLeft / this.executeFlashMs;
      this.executeFlash.intensity = balance.lighting.flashIntensity * this.executeFlashPower * f * f;
    }
  }

  /** 1인칭 다리 — 골반 피벗에 허벅지·장화 상자. 발소리·카메라 밥과 위상이 같아
   *  내려다보면 걸음에 맞춰 다리가 갈마들며 나간다. 멈추면 blend 로 곧게 선다 */
  private updatePlayerLegs(x: number, z: number, yaw: number): void {
    if (!this.playerLegs) {
      const cloth = new THREE.MeshLambertMaterial({ color: 0x2a2620 });
      const boot = new THREE.MeshLambertMaterial({ color: 0x17140f });
      const group = new THREE.Group();
      const makeLeg = (): THREE.Group => {
        const hip = new THREE.Group();
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.86, 0.17), cloth);
        leg.position.y = -0.43;
        hip.add(leg);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.28), boot);
        foot.position.set(0, -0.87, -0.06); // 발끝이 앞(-Z)으로
        hip.add(foot);
        return hip;
      };
      const left = makeLeg();
      left.position.x = -0.11;
      const right = makeLeg();
      right.position.x = 0.11;
      group.add(left, right);
      this.scene.add(group);
      this.playerLegs = { group, left, right };
    }
    const legs = this.playerLegs;
    // 몸은 눈보다 살짝 뒤 — 내려다보면 가슴 아래로 다리가 보이는 자리
    legs.group.position.set(x + Math.sin(yaw) * 0.14, 0.92, z + Math.cos(yaw) * 0.14);
    legs.group.rotation.y = yaw;
    // 걸음과 같은 위상 — 빨리 뛰면 젓는 것도 빨라진다. 멈추면 곧게 선다
    const swing = Math.sin(this.bobPhase) * 0.62 * this.bobBlend;
    legs.left.rotation.x = swing;
    legs.right.rotation.x = -swing;
  }

  setLanternOn(on: boolean): void {
    this.lanternIsOn = on;
    this.lantern.visible = on;
    this.lanternSpill.visible = on;
  }

  setMuzzleFlash(on: boolean): void {
    this.muzzleLight.visible = on;
  }

  /** 발사 궤적 — 총구(카메라 오른쪽 아래)에서 착탄점까지, tracerTicks 동안 페이드 아웃 */
  /** 관통 뇌창 — 붙들고 있는 동안 계속 붙어 있는 빔. 끝점만 갱신하고,
   *  마디의 지직거림은 매 프레임 새로 흔든다 (틱마다 다시 만들면 한 발씩 쏘는 것처럼 보인다) */
  setLightningBeam(ex: number, ey: number, ez: number, pulse: boolean): void {
    this.beamEnd ??= new THREE.Vector3();
    this.beamEnd.set(ex, ey, ez);
    if (pulse) this.beamPulseAt = performance.now();
    if (this.beam) return;

    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbfe6ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const segs: THREE.Mesh[] = [];
    for (let i = 0; i < BEAM_SEGMENTS; i++) {
      // 길이 1 짜리 상자를 매 프레임 늘였다 줄인다 — 지오메트리를 다시 만들지 않는다
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1), mat);
      group.add(seg);
      segs.push(seg);
    }
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    group.add(spark);
    const light = new THREE.PointLight(0x9fd8ff, 4, 10, 0);
    group.add(light);
    this.scene.add(group);
    this.beam = { group, mat, segs, spark, light };
  }

  /** 연쇄 번개 — 적에서 적으로 옮겨붙은 호. 마디마다 튀고 짧게 남았다 사라진다.
   *  한 타마다 새로 뿌리지만 타 간격보다 조금 오래 살아 끊겨 보이지 않는다 */
  spawnChainArc(
    links: { ax: number; ay: number; az: number; bx: number; by: number; bz: number }[],
  ): void {
    if (links.length === 0) return;
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xdff0ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const up = new THREE.Vector3(0, 1, 0);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    let first: THREE.Mesh | null = null;
    for (const link of links) {
      start.set(link.ax, link.ay, link.az);
      end.set(link.bx, link.by, link.bz);
      const side = new THREE.Vector3(end.z - start.z, 0, start.x - end.x).normalize();
      a.copy(start);
      for (let i = 0; i < CHAIN_ARC_SEGMENTS; i++) {
        const t = (i + 1) / CHAIN_ARC_SEGMENTS;
        const amp = CHAIN_ARC_JITTER * Math.sin(t * Math.PI); // 양 끝은 몸에 붙고 가운데가 튄다
        b.copy(start).lerp(end, t)
          .addScaledVector(side, (Math.random() - 0.5) * 2 * amp)
          .addScaledVector(up, (Math.random() - 0.5) * 2 * amp);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, a.distanceTo(b)), mat);
        seg.position.copy(a).add(b).multiplyScalar(0.5);
        seg.lookAt(b);
        group.add(seg);
        first ??= seg;
        a.copy(b);
      }
      const light = new THREE.PointLight(0x9fd8ff, 2.5, 5, 0);
      light.position.copy(start).lerp(end, 0.5);
      group.add(light);
    }
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const last = links[links.length - 1]!;
    spark.position.set(last.bx, last.by, last.bz);
    group.add(spark);
    this.scene.add(group);
    this.tracers.push({ group, beam: first ?? spark, spark, bornMs: performance.now(), lifeMs: CHAIN_ARC_MS });
  }

  /** 빔이 닿은 면을 그을린다. 같은 자리를 계속 지지면 자국이 늘지 않고 짙어진다 —
   *  한 타마다 데칼을 새로 찍으면 초당 10장이 쌓여 금방 수백 장이 된다 */
  scorchSurface(
    x: number, y: number, z: number,
    surface: 'wall' | 'floor' | 'ceiling',
    axis: 'x' | 'z' | null,
    dirX: number, dirZ: number,
  ): void {
    const now = performance.now();
    for (const s of this.scorches) {
      if (Math.hypot(s.x - x, s.y - y, s.z - z) < SCORCH_MERGE_DIST) {
        s.heat = Math.min(1, s.heat + SCORCH_HEAT_STEP);
        s.bornMs = now; // 계속 지지는 동안은 수명을 다시 센다
        return;
      }
    }
    // 법선 — 빔이 온 방향의 반대쪽. 면에서 살짝 띄워 z-fighting 을 피한다
    let nx = 0, ny = 0, nz = 0;
    if (surface === 'floor') ny = 1;
    else if (surface === 'ceiling') ny = -1;
    else if (axis === 'x') nx = dirX > 0 ? -1 : 1;
    else nz = dirZ > 0 ? -1 : 1;

    const mat = new THREE.MeshBasicMaterial({
      map: getScorchTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SCORCH_RADIUS * 2, SCORCH_RADIUS * 2), mat);
    mesh.position.set(x + nx * SCORCH_LIFT, y + ny * SCORCH_LIFT, z + nz * SCORCH_LIFT);
    // PlaneGeometry 는 +Z 를 본다 — 그 축을 법선에 맞추고 아무렇게나 돌려 무늬를 흩는다
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(nx, ny, nz));
    mesh.rotateZ(Math.random() * Math.PI * 2);
    this.scene.add(mesh);
    this.scorches.push({ mesh, mat, x, y, z, heat: SCORCH_HEAT_STEP, bornMs: now });
    if (this.scorches.length > SCORCH_MAX) this.removeScorch(0);
  }

  private removeScorch(i: number): void {
    const s = this.scorches[i];
    if (!s) return;
    this.scorches.splice(i, 1);
    this.scene.remove(s.mesh);
    s.mesh.geometry.dispose();
    s.mat.dispose();
  }

  /** 그을음은 오래 남았다가 끝에 가서 옅어진다 — 지져 놓은 만큼 짙고 넓다 */
  private updateScorches(now: number): void {
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i]!;
      const age = (now - s.bornMs) / SCORCH_MS;
      if (age >= 1) {
        this.removeScorch(i);
        continue;
      }
      const fade = age > 1 - SCORCH_FADE_T ? (1 - age) / SCORCH_FADE_T : 1;
      s.mat.opacity = 0.92 * s.heat * fade;
      const scale = 0.5 + 0.5 * s.heat;
      s.mesh.scale.set(scale, scale, 1);
    }
  }

  /** 채널이 끊겼다 — 빔을 걷는다 */
  clearLightningBeam(): void {
    this.beamEnd = null;
    const beam = this.beam;
    if (!beam) return;
    this.beam = null;
    this.scene.remove(beam.group);
    for (const seg of beam.segs) seg.geometry.dispose();
    beam.mat.dispose();
    beam.spark.geometry.dispose();
    (beam.spark.material as THREE.Material).dispose();
  }

  /** 매 프레임 — 지팡이 끝에서 끝점까지 마디를 다시 흔든다. 손이 움직이면 빔도 따라온다 */
  private updateLightningBeam(): void {
    const beam = this.beam;
    const end = this.beamEnd;
    if (!beam || !end) return;
    const start = this.staffTip();
    const total = start.distanceTo(end);
    if (total < 0.01) return;
    const side = new THREE.Vector3(end.z - start.z, 0, start.x - end.x).normalize();
    const up = new THREE.Vector3(0, 1, 0);

    const a = start.clone();
    const b = new THREE.Vector3();
    for (let i = 0; i < BEAM_SEGMENTS; i++) {
      const t = (i + 1) / BEAM_SEGMENTS;
      // 양 끝은 붙어 있고 가운데가 가장 크게 튄다
      const amp = BEAM_JITTER * Math.sin(t * Math.PI);
      b.copy(start).lerp(end, t)
        .addScaledVector(side, (Math.random() - 0.5) * 2 * amp)
        .addScaledVector(up, (Math.random() - 0.5) * 2 * amp * 0.6);
      const seg = beam.segs[i]!;
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.lookAt(b);
      seg.scale.z = Math.max(0.001, a.distanceTo(b));
      a.copy(b);
    }
    // 한 타가 들어간 직후에 밝게 튄다 — 계속 흐르는 중에도 박자가 보인다
    const since = performance.now() - this.beamPulseAt;
    const punch = since < BEAM_PULSE_MS ? 1 - since / BEAM_PULSE_MS : 0;
    beam.mat.opacity = 0.72 + 0.28 * punch;
    beam.spark.position.copy(end);
    beam.spark.scale.setScalar(0.85 + 0.5 * punch);
    (beam.spark.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.3 * punch;
    beam.light.position.copy(start).lerp(end, 0.5);
    beam.light.intensity = 3 + 3 * punch;
  }

  /** 서리 볼트 — 푸른 껍질이 반경까지 부풀며 옅어진다 (폭발 연출의 색 다른 형제) */
  spawnNova(x: number, z: number, radius: number): void {
    const now = performance.now();
    const light = new THREE.PointLight(0x9fe0ff, 5, radius * 2.5, 0);
    light.position.set(x, 1.0, z);
    this.scene.add(light);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    shell.position.set(x, 0.6, z);
    this.scene.add(shell);
    this.explosions.push({ light, shell, bornMs: now, radius });
  }

  /** 얼음이 깨진다 — 섬광 + 부푸는 서리 껍질 + 파편 여럿(큰 덩이·잔 조각) + 피어오르는 냉기.
   *  빙결이 끝나는 순간이 피해가 들어가는 순간이라, 눈에 확 띄어야 "지금 맞았다"가 읽힌다 */
  spawnThaw(x: number, z: number, height: number): void {
    const now = performance.now();
    const cy = height * 0.55;
    // 섬광 — 짧고 세게. 공유 광원(executeFlash)이라 겹치면 마지막 것이 이긴다
    this.triggerFlash(x, cy, z, 0xdff4ff, 150, 2.6);
    // 서리 껍질 — 부풀며 옅어진다 (폭발 연출의 얼음 형제, 작은 반경)
    const shellLight = new THREE.PointLight(0x9fe0ff, 6, 7, 0);
    shellLight.position.set(x, cy, z);
    this.scene.add(shellLight);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: ICE_COLOR, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    shell.position.set(x, cy, z);
    this.scene.add(shell);
    this.explosions.push({ light: shellLight, shell, bornMs: now, radius: 2.4 });

    const shard = (size: number, tall: number, speed: number, up: number, life: number, opacity: number, gravity: number): void => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * tall, size),
        new THREE.MeshBasicMaterial({ color: ICE_COLOR, transparent: true, opacity }),
      );
      const ang = Math.random() * Math.PI * 2;
      const oy = height * (0.2 + Math.random() * 0.7);
      mesh.position.set(x, oy, z);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        ox: x, oy, oz: z,
        vx: Math.cos(ang) * speed,
        vy: up,
        vz: Math.sin(ang) * speed,
        bornMs: now,
        lifeMs: life,
        spinX: (Math.random() - 0.5) * 14,
        spinY: (Math.random() - 0.5) * 14,
        spinZ: (Math.random() - 0.5) * 14,
        gravity,
      });
    };
    // 큰 덩이 — 느리고 무겁게 떨어진다
    for (let i = 0; i < 5; i++) shard(0.14 + Math.random() * 0.1, 1.3, 1.6 + Math.random() * 1.4, 1.8 + Math.random() * 1.2, 820, 0.95, 9);
    // 잔 조각 — 사방으로 빠르게 튄다
    for (let i = 0; i < 22; i++) shard(0.04 + Math.random() * 0.06, 1.8, 2.8 + Math.random() * 3.2, 1.5 + Math.random() * 2.6, 640, 0.9, 8);
    // 냉기 — 천천히 피어오르며 옅어진다 (음의 중력 = 위로)
    for (let i = 0; i < 8; i++) shard(0.1 + Math.random() * 0.12, 0.6, 0.3 + Math.random() * 0.5, 0.6 + Math.random() * 0.6, 950, 0.35, -0.8);
  }

  /** 얼음 화살이 닿은 면이 얼어붙는다 — 얼음막(서리 텍스처)이 면에 붙고 법선 쪽으로 결정이 솟는다.
   *  FROST_DECAL_MS 동안 살다가 마지막 30% 에 녹아 사라진다 */
  spawnFrostDecal(
    x: number, y: number, z: number,
    surface: 'wall' | 'floor' | 'ceiling',
    axis: 'x' | 'z' | null,
    dirX: number, dirY: number, dirZ: number,
    scale = 1,
  ): void {
    const group = new THREE.Group();
    group.userData['fxScale'] = scale; // 첫 타는 작게 — 갱신에서 크기에 곱한다
    // 법선 — 날아온 방향의 반대쪽. 면에서 살짝 띄워 z-fighting 을 피한다
    let nx = 0, ny = 0, nz = 0;
    if (surface === 'floor') ny = 1;
    else if (surface === 'ceiling') ny = -1;
    else if (axis === 'x') nx = dirX > 0 ? -1 : 1;
    else nz = dirZ > 0 ? -1 : 1;
    void dirY;
    group.position.set(x + nx * FROST_DECAL_LIFT, y + ny * FROST_DECAL_LIFT, z + nz * FROST_DECAL_LIFT);
    // 얼음막 — 법선을 향하는 평면. 같은 텍스처라도 돌려 붙여 무늬가 겹쳐 보이지 않게
    const film = new THREE.MeshBasicMaterial({
      map: getFrostTexture(), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(FROST_DECAL_RADIUS * 2, FROST_DECAL_RADIUS * 2), film);
    plane.lookAt(nx, ny, nz);
    plane.rotateZ(Math.random() * Math.PI * 2);
    group.add(plane);
    // 결정 — 자국 안쪽에 법선 방향으로 솟는다. 가운데가 크고 가장자리는 잘다
    const crystals = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: ICE_COLOR, transparent: true, opacity: 0.85 });
    const up = new THREE.Vector3(nx, ny, nz);
    const tangentA = Math.abs(ny) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangentB = new THREE.Vector3().crossVectors(up, tangentA).normalize();
    tangentA.crossVectors(tangentB, up).normalize();
    for (let i = 0; i < 9; i++) {
      const r = (i === 0 ? 0 : 0.25 + Math.random() * 0.6) * FROST_DECAL_RADIUS;
      const ang = Math.random() * Math.PI * 2;
      const h = (i === 0 ? 0.55 : 0.18 + Math.random() * 0.3) * (1 - r / FROST_DECAL_RADIUS * 0.5);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(h * 0.22, h, 5), mat);
      const off = tangentA.clone().multiplyScalar(Math.cos(ang) * r).addScaledVector(tangentB, Math.sin(ang) * r);
      cone.position.copy(off).addScaledVector(up, h / 2);
      // 원뿔의 +Y 를 법선에 맞춘다 (살짝 기울여 자연스럽게)
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up.clone().addScaledVector(tangentA, (Math.random() - 0.5) * 0.5).normalize());
      crystals.add(cone);
    }
    group.add(crystals);
    this.scene.add(group);
    this.frostDecals.push({ group, film, crystals, bornMs: performance.now() });
  }

  private updateFrostDecals(): void {
    const now = performance.now();
    for (let i = this.frostDecals.length - 1; i >= 0; i--) {
      const d = this.frostDecals[i]!;
      const age = (now - d.bornMs) / FROST_DECAL_MS;
      if (age >= 1) {
        this.scene.remove(d.group);
        d.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          }
        });
        this.frostDecals.splice(i, 1);
        continue;
      }
      // 첫 8% 는 퍼지며 나타나고, 마지막 30% 는 녹아 사라진다
      const grow = Math.min(1, age / 0.08);
      const melt = age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1;
      const s = (0.6 + 0.4 * grow) * ((d.group.userData['fxScale'] as number | undefined) ?? 1);
      d.group.scale.set(s, s, s);
      d.film.opacity = 0.95 * grow * melt;
      const cs = grow * (0.2 + 0.8 * melt);
      d.crystals.scale.set(cs, cs, cs);
      d.crystals.visible = cs > 0.02;
    }
  }

  /** 얼어붙는 순간 — 섬광 + 몸을 감싸며 굳는 얼음 껍질 + 튀어 오르는 결정 + 발밑 서리.
   *  깨질 때(spawnThaw)와 짝이 되게 같은 재료를 쓰되, 이쪽은 안으로 조이는 느낌이라 껍질을 작게·짧게 */
  spawnFreeze(x: number, z: number, height: number): void {
    const now = performance.now();
    const cy = height * 0.55;
    this.triggerFlash(x, cy, z, 0xdff4ff, 190, 3.6);
    const light = new THREE.PointLight(0x9fe0ff, 6, 9, 0);
    light.position.set(x, cy, z);
    this.scene.add(light);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: ICE_COLOR, transparent: true, opacity: 0.72, depthWrite: false }),
    );
    shell.position.set(x, cy, z);
    this.scene.add(shell);
    this.explosions.push({ light, shell, bornMs: now, radius: 2.2 });
    // 바닥 충격 링 — 서리가 바닥을 타고 퍼져 나간다
    const ringLight = new THREE.PointLight(0x9fe0ff, 0, 1, 0); // 껍질 규약상 광원이 필요하다 — 빛은 안 낸다
    ringLight.position.set(x, 0.05, z);
    this.scene.add(ringLight);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1, 40),
      new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    this.scene.add(ring);
    this.explosions.push({ light: ringLight, shell: ring, bornMs: now, radius: 3.4 });
    // 결정이 몸에서 튀어 오른다 — 얼음이 "잡히는" 순간
    for (let i = 0; i < 24; i++) {
      const size = 0.04 + Math.random() * 0.06;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * 1.8, size),
        new THREE.MeshBasicMaterial({ color: ICE_COLOR, transparent: true, opacity: 0.9 }),
      );
      const ang = Math.random() * Math.PI * 2;
      const r = 0.2 + Math.random() * 0.35;
      const oy = height * (0.2 + Math.random() * 0.7);
      mesh.position.set(x + Math.cos(ang) * r, oy, z + Math.sin(ang) * r);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        ox: mesh.position.x, oy, oz: mesh.position.z,
        vx: Math.cos(ang) * (0.6 + Math.random() * 0.8),
        vy: 2.2 + Math.random() * 1.6,
        vz: Math.sin(ang) * (0.6 + Math.random() * 0.8),
        bornMs: now,
        lifeMs: 560,
        spinX: (Math.random() - 0.5) * 12,
        spinY: (Math.random() - 0.5) * 12,
        spinZ: (Math.random() - 0.5) * 12,
        gravity: 7,
      });
    }
    // 발밑에 서리 — 직격당하지 않은 적도 얼면 발밑이 언다
    this.spawnFrostDecal(x, 0, z, 'floor', null, 0, -1, 0);
  }

  /** 얼음이 깨진 적 — 몸이 잠깐 하얗게 번쩍인다 (피격 플래시와 같은 경로) */
  flashEnemyShatter(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (visual) visual.hitFlashUntil = performance.now() + 170;
  }

  spawnTracer(ex: number, ey: number, ez: number): void {
    // 시작점은 판정 원점(눈)이 아니라 화면상 총구 위치 (순수 연출)
    const muzzle = new THREE.Vector3(MUZZLE_OFFSET.x, MUZZLE_OFFSET.y, MUZZLE_OFFSET.z);
    this.camera.localToWorld(muzzle);

    const group = new THREE.Group();
    const end = new THREE.Vector3(ex, ey, ez);

    // 총구 바로 앞은 화면에서 지나치게 크게 보이므로 조금 전진한 지점부터 시작
    const dir = end.clone().sub(muzzle);
    const fullLength = dir.length();
    dir.normalize();
    const start = muzzle.add(dir.clone().multiplyScalar(Math.min(TRACER_START_PUSH, fullLength * 0.5)));
    const length = start.distanceTo(end);

    // 굵기 있는 발광 빔 — 1px 라인은 정면 샷에서 보이지 않는다
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(TRACER_WIDTH, TRACER_WIDTH, length),
      new THREE.MeshBasicMaterial({
        color: TRACER_COLOR,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    beam.position.copy(start).add(end).multiplyScalar(0.5);
    beam.lookAt(end);
    group.add(beam);

    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 6),
      new THREE.MeshBasicMaterial({
        color: TRACER_COLOR,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    spark.position.copy(end);
    group.add(spark);

    this.scene.add(group);
    this.tracers.push({
      group,
      beam,
      spark,
      bornMs: performance.now(),
      lifeMs: (balance.weapons.pistol.tracerTicks / balance.loop.tickRate) * 1000,
    });
  }

  private updateTracers(): void {
    const now = performance.now();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i]!;
      const age = (now - tracer.bornMs) / tracer.lifeMs;
      if (age >= 1) {
        this.scene.remove(tracer.group);
        tracer.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          }
        });
        this.tracers.splice(i, 1);
        continue;
      }
      const fade = 1 - age;
      (tracer.beam.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
      (tracer.spark.material as THREE.MeshBasicMaterial).opacity = fade;
      // 번개는 마디가 여럿이고 광원도 달렸다 — 전부 같이 꺼진다
      tracer.group.traverse((obj) => {
        if (obj instanceof THREE.PointLight) obj.intensity = 4 * fade;
      });
    }
  }

  /** 타입별 적 외형 조립 — 몸통+머리, 창병은 방패+창 추가 */
  private buildEnemyVisual(type: string): EnemyVisual {
    const def = enemyDef(type);
    const baseColor = ENEMY_COLORS[type] ?? ENEMY_COLOR_FALLBACK;
    const group = new THREE.Group();
    const flashMaterials: THREE.MeshLambertMaterial[] = [];

    // 몸통 서브그룹 — 발(y=0)을 피벗으로 기울여 공격 모션을 만든다
    const torso = new THREE.Group();
    group.add(torso);

    const bodyMat = new THREE.MeshLambertMaterial({ color: baseColor });
    flashMaterials.push(bodyMat);
    let headMesh: THREE.Mesh | undefined; // 헤드샷 젖힘용 — 거미는 없다
    let leechMats: { mat: THREE.MeshLambertMaterial; mul: number }[] | undefined; // 거머리 위장용
    let motherEyes: THREE.Group[] | undefined; // 어미 슬라임 눈알들 (동공이 플레이어를 따라 돈다)
    let slimeCore: EnemyVisual['slimeCore'];
    let legsPair: { left: THREE.Group; right: THREE.Group } | undefined;
    // 안광 — 조명이 아니라 자체 발광 눈. 어둠 속에서 멀리서도 "저기 뭔가 있다"가 읽힌다
    const eyes = makeEyeMaterials();
    if (type === 'leech') {
      // 거머리 — 납작한 몸 + 늘어진 촉수 넷. 다리·머리가 없다 (천장에 매달리는 몸)
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(def.radius * 1.9, def.height, def.radius * 1.9),
        bodyMat,
      );
      body.position.y = def.height / 2;
      torso.add(body);
      const tentMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(baseColor).multiplyScalar(0.6),
      });
      flashMaterials.push(tentMat);
      leechMats = [
        { mat: bodyMat, mul: 1 },
        { mat: tentMat, mul: 0.6 },
      ];
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const tent = new THREE.Mesh(new THREE.BoxGeometry(0.07, def.height * 0.9, 0.07), tentMat);
        tent.position.set(sx * def.radius * 0.6, def.height * 0.15, sz * def.radius * 0.6);
        torso.add(tent);
      }
      // 아랫면 앞쪽 안광 — 올려다보면 저기 뭔가 있다
      const ec2 = balance.lighting.enemyEyes;
      for (const side of [-1, 1]) {
        addGlowEye(
          torso, side * def.radius * 0.35, def.height * 0.2, -def.radius * 0.9,
          def.radius * ec2.radiusMul, eyes.eyeMat, eyes.haloMat, eyes.halos,
        );
      }
    } else if (SLIME_TYPES.has(type)) {
      // 슬라임 — 반투명 젤 몸체 + 진한 핵. 무정형이라 다리·머리·눈이 없다.
      // 꿀렁임(squash&stretch)은 syncEnemies 가 torso.scale 로 만든다
      bodyMat.transparent = true;
      bodyMat.opacity = 0.82;
      // 아래가 퍼진 8각 방울 — 정육면체는 젤이 아니라 상자로 보였다 (스크린샷 검증)
      const jelly = new THREE.Mesh(
        new THREE.CylinderGeometry(def.radius * 0.8, def.radius * 1.3, def.height, 8),
        bodyMat,
      );
      jelly.position.y = def.height / 2;
      torso.add(jelly);
      const coreMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(baseColor).multiplyScalar(0.28),
      });
      flashMaterials.push(coreMat);
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(def.radius * 0.8, def.height * 0.45, def.radius * 0.8),
        coreMat,
      );
      core.position.y = def.height * 0.42;
      torso.add(core);
      slimeCore = { mat: coreMat, base: coreMat.color.getHex(), core, jellyMat: bodyMat };
      // 어미 — 젤 속에 반쯤 묻힌 눈알들. 핵처럼 떠 있고 크기 제각각, 동공은
      // syncEnemies 가 매 프레임 플레이어 쪽으로 돌린다 (몸은 무정형인데 눈만 따라온다)
      if (type === 'slime_mother') {
        motherEyes = [];
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
          const er = def.radius * es;
          const sclera = new THREE.Mesh(new THREE.SphereGeometry(er, 10, 8), scleraMat);
          eye.add(sclera);
          const pupil = new THREE.Mesh(new THREE.SphereGeometry(er * 0.45, 8, 6), pupilMat);
          pupil.position.z = -er * 0.72;
          eye.add(pupil);
          // 앞면(-z) 젤 표피에 살짝 파고든 자리 — 젤 반지름은 아래로 갈수록 퍼진다
          eye.position.set(
            def.radius * ex,
            def.height * ey,
            -def.radius * (1.3 - 0.5 * ey) * 0.8,
          );
          torso.add(eye);
          motherEyes.push(eye);
        }
      }
    } else if (SPIDER_TYPES.has(type)) {
      buildSpiderBody(torso, def, bodyMat, eyes, baseColor, flashMaterials);
    } else if (type === 'bat') {
      buildBatBody(torso, def, bodyMat, eyes, baseColor, flashMaterials);
    } else {
      // 몸통은 충돌 원과 같은 반경의 8각 기둥 — 박스로 두면 모서리가 반경 밖으로
      // 0.21m 튀어나와(0.5→0.707) 비스듬히 부딪칠 때 뚫고 들어가 보인다
      // 몸통 — 예전엔 바닥까지 통기둥이었다. 아랫도리를 다리 두 개로 바꾼다
      const legH = def.height * 0.3;
      const bodyH = def.height * 0.78 - legH;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(def.radius, def.radius * 0.92, bodyH, 8),
        bodyMat,
      );
      body.position.y = legH + bodyH / 2;
      torso.add(body);
      // 다리 — 골반 피벗. 걸을 때 syncEnemies 가 이동 거리만큼 젓는다
      const legMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(baseColor).multiplyScalar(0.72),
      });
      flashMaterials.push(legMat);
      const makeLeg = (side: number): THREE.Group => {
        const hip = new THREE.Group();
        hip.position.set(side * def.radius * 0.42, legH, 0);
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(def.radius * 0.38, legH, def.radius * 0.44),
          legMat,
        );
        leg.position.y = -legH / 2;
        hip.add(leg);
        torso.add(hip);
        return hip;
      };
      legsPair = { left: makeLeg(-1), right: makeLeg(1) };

      const headMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(baseColor).multiplyScalar(HEAD_DARKEN),
      });
      flashMaterials.push(headMat);
      const headSize = def.radius * 0.9;
      const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), headMat);
      head.position.set(0, def.height - headSize / 2, -def.radius * 0.2);
      torso.add(head);
      headMesh = head;

      // 눈 둘 — 머리 앞면(-Z)에 살짝 박혀 나온다. 눈높이는 얼굴 중앙보다 약간 위
      const ec = balance.lighting.enemyEyes;
      const eyeR = def.radius * ec.radiusMul;
      const eyeY = head.position.y + headSize * 0.08;
      const eyeZ = head.position.z - headSize / 2 - eyeR * 0.4;
      for (const side of [-1, 1]) {
        addGlowEye(torso, side * headSize * ec.spacingMul, eyeY, eyeZ, eyeR, eyes.eyeMat, eyes.haloMat, eyes.halos);
      }
    }

    // 이름표 + HP 바 (빌보드 스프라이트, 어그로 후에만 표시)
    const plateCanvas = document.createElement('canvas');
    plateCanvas.width = PLATE_W;
    plateCanvas.height = PLATE_H;
    const plateTexture = new THREE.CanvasTexture(plateCanvas);
    const plate = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: plateTexture, transparent: true, depthWrite: false }),
    );
    const plateScale = def.boss ? 2.6 : 1.9;
    plate.scale.set(plateScale, plateScale * (PLATE_H / PLATE_W), 1);
    plate.position.y = def.height + (def.boss ? 0.7 : 0.5);
    plate.visible = false;
    group.add(plate);

    // 인지 표시 — 이름표보다 한 뼘 위. 알아챈 순간에만 잠깐 뜬다
    const alert = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getAlertTexture(),
        transparent: true,
        depthWrite: false,
        // depthTest 는 켠 채로 둔다 — 벽 너머로 비치면 "안 보이는 적이 어디 있는지"까지
        // 알려 주는 투시가 된다. 이름표(plate)와 같은 규약
      }),
    );
    alert.position.y = def.height + (def.boss ? 1.5 : 1.15);
    alert.visible = false;
    alert.renderOrder = 5;
    alert.name = 'alert-mark';
    group.add(alert);

    const visual: EnemyVisual = {
      group,
      eyeHalo: eyes.haloMat,
      eyeHalos: eyes.halos,
      eyeHaloBase: eyes.halos[0]?.scale.x ?? 0,
      torso,
      head: headMesh,
      legs: legsPair,
      leechMats,
      motherEyes,
      slimeCore,
      flashMaterials,
      shieldBaseZ: 0,
      hitFlashUntil: 0,
      nextEmberMs: 0,
      shieldFlashUntil: 0,
      barrierFlashUntil: 0,
      plate,
      plateTexture,
      plateCanvas,
      plateKey: '',
      alert,
    };

    // 지면 강타 범위 원 — 예고 중에만 보인다. 반경은 매 프레임 attack.aoeRadius 로 맞춘다.
    // 화면 UI 가 아니라 월드 바닥에 놓인 표식이다 (몸이 기울어도 바닥에 붙어 있게 group 소속)
    if (def.attack.aoeRadius) {
      visual.aoeRingMaterial = new THREE.MeshBasicMaterial({
        color: AOE_RING_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      visual.aoeRing = new THREE.Mesh(
        new THREE.RingGeometry(AOE_RING_INNER, 1, 48),
        visual.aoeRingMaterial,
      );
      visual.aoeRing.rotation.x = -Math.PI / 2;
      visual.aoeRing.position.y = 0.03;
      visual.aoeRing.visible = false;
      group.add(visual.aoeRing);
    }

    // 시전 충전 구체 (마법 투사체 캐스터) —
    // 위치·크기·색을 발사 지점(Enemies.fireProjectile)과 정확히 맞춘다.
    // torso에 달면 시전 중 상체가 기울 때 구체가 끌려가 "다른 데서 튀어나오는" 그림이 된다.
    // 기울지 않는 group에 직접 매단다
    if (def.attack.type === 'projectile' && def.attack.deflectable) {
      const projRadius = def.attack.projectileRadius ?? 0.3;
      visual.chargeOrb = new THREE.Mesh(
        new THREE.SphereGeometry(projRadius, 10, 10),
        new THREE.MeshBasicMaterial({
          color: ENEMY_BOLT_COLOR,
          transparent: true,
          opacity: 1,
        }),
      );
      visual.chargeOrb.position.set(0, def.height * 0.7, -(def.radius + projRadius));
      visual.chargeOrb.visible = false;
      // 투사체와 같은 점광원 — 어둠 속에서 밝기까지 이어져야 끊겨 보이지 않는다
      visual.chargeOrbLight = new THREE.PointLight(ENEMY_BOLT_COLOR, 0, 9, 0);
      visual.chargeOrb.add(visual.chargeOrbLight);
      group.add(visual.chargeOrb);
    }

    // 활 (궁수) — 곡궁 리그. 왼손 쪽에 세로로 들리고, 시위·화살은 매 프레임 갱신된다
    if (type === 'goblin_archer') {
      const rig = buildBowRig();
      rig.group.position.set(-def.radius * 0.55, def.height * 0.62, -def.radius - 0.15);
      torso.add(rig.group);
      visual.bowRig = rig;
      visual.bowDraw = 0;
    }

    if (def.magicBarrier) {
      visual.barrierMaterial = new THREE.MeshLambertMaterial({
        color: BARRIER_COLOR,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      });
      visual.barrier = new THREE.Mesh(
        new THREE.SphereGeometry(def.radius + 0.7, 12, 10),
        visual.barrierMaterial,
      );
      visual.barrier.position.y = def.height * 0.55;
      group.add(visual.barrier);
    }

    if (def.frontalShieldBlocksProjectiles) {
      visual.shieldMaterial = new THREE.MeshLambertMaterial({ color: SHIELD_COLOR });
      // 폭은 충돌 원 안에 들어오도록 — 넓으면 옆구리가 반경 밖으로 삐져나온다
      visual.shield = new THREE.Mesh(
        new THREE.BoxGeometry(def.radius * 1.6, def.height * 0.72, 0.09),
        visual.shieldMaterial,
      );
      // 판 뒷면이 몸통 표면(반경)에 딱 닿게 — 0.92 배로 당겨 두면 판이 몸에
      // 절반쯤 파묻힌 채로 시작한다 (두께의 절반만 더 내민다)
      visual.shieldBaseZ = -(def.radius + 0.045);
      visual.shield.position.set(SHIELD_BASE_X, def.height * 0.5, visual.shieldBaseZ);
      // group 이 아니라 torso 에 매단다 — 찌르기·밀쳐내기에서 상체가 앞으로 기울면
      // (rotation.x) 가슴이 height×sin(각) 만큼 나오는데, group 소속이면 방패는
      // 위치(z)만 따라가고 기울기는 못 따라가 몸이 판을 뚫고 나온다
      torso.add(visual.shield);

      // 균열 — 반파(hammerHitsToCrack 대)부터 드러난다. 방패면(-z) 바깥쪽에 얇게 붙인다
      const crackMat = new THREE.MeshBasicMaterial({ color: 0x14161a });
      const w = def.radius * 1.6;
      const h = def.height * 0.72;
      const cracks = new THREE.Group();
      const seg = (len: number, rot: number, x: number, y: number): void => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.035, 0.02), crackMat);
        m.position.set(x, y, -0.056);
        m.rotation.z = rot;
        cracks.add(m);
      };
      seg(w * 0.55, 0.9, -w * 0.05, h * 0.08);
      seg(w * 0.4, -0.5, w * 0.12, -h * 0.12);
      seg(w * 0.32, 1.7, -w * 0.16, -h * 0.05);
      seg(w * 0.26, 0.2, w * 0.05, h * 0.22);
      cracks.visible = false;
      visual.shieldCracks = cracks;
      visual.shield.add(cracks);

      // 꽂히는 화살 슬롯 — 전투 중에 메시를 만들지 않게 미리 깔아 두고 숨긴다
      // (플레이어 방패의 3슬롯과 같은 방식). 판 바깥면(-z)에서 앞으로 삐져나온다
      visual.shieldArrows = [];
      visual.shieldArrowSlot = 0;
      // 판을 정면으로 보면 앞으로 곧게 꽂힌 화살은 점으로 뭉개진다 —
      // 위·옆으로 확실히 눕혀야 샤프트 길이가 보인다 (실측으로 확인)
      const spots: [number, number, number, number][] = [
        // [좌우, 높이, 위아래 기울기, 좌우 기울기]
        [-w * 0.24, h * 0.14, -0.55, 0.3],
        [w * 0.2, -h * 0.06, 0.4, -0.35],
        [w * 0.04, h * 0.28, -0.75, -0.15],
        [-w * 0.14, -h * 0.24, 0.5, 0.4],
      ];
      for (const [ax, ay, pitch, yawTilt] of spots) {
        const shaft = new THREE.Mesh(
          new THREE.BoxGeometry(0.035, 0.035, 0.62),
          new THREE.MeshLambertMaterial({ color: 0x6b5233 }),
        );
        // 촉이 판에 박히고 꼬리가 앞으로 솟는다 — 판 두께(0.09) 밖으로 내민다
        shaft.position.set(ax, ay, -0.3);
        shaft.rotation.set(pitch, yawTilt, 0);
        shaft.visible = false;
        visual.shieldArrows.push(shaft);
        visual.shield.add(shaft);
      }
    }

    // 팔 살빛 — 무기 팔의 팔뚝과 맨팔이 같은 색을 쓴다
    const armMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(baseColor).multiplyScalar(0.85),
    });
    flashMaterials.push(armMat);

    // 근접 무기 — 어깨 피벗 팔에 쥐고 치켜들었다 내리찍는다
    const weaponSpec = MELEE_WEAPONS[type];
    if (weaponSpec) {
      const arm = new THREE.Group();
      arm.position.set(def.radius * 0.85, def.height * 0.72, 0);
      // 팔뚝 — 어깨에서 손잡이까지. 이게 없으면 몽둥이만 허공에 떠 있다 (실측 피드백)
      const limbLen = Math.min(def.height * 0.28, weaponSpec.length * 0.5);
      const limb = new THREE.Mesh(
        new THREE.BoxGeometry(def.radius * 0.32, def.radius * 0.32, limbLen),
        armMat,
      );
      limb.position.z = -limbLen / 2;
      arm.add(limb);
      // 손 — 자루를 감싸 쥔 뭉치
      const hand = new THREE.Mesh(
        new THREE.BoxGeometry(weaponSpec.width + 0.07, weaponSpec.width + 0.07, 0.14),
        armMat,
      );
      hand.position.z = -limbLen;
      arm.add(hand);
      const shaft = new THREE.Mesh(
        new THREE.BoxGeometry(weaponSpec.width, weaponSpec.width, weaponSpec.length),
        new THREE.MeshLambertMaterial({ color: weaponSpec.color }),
      );
      shaft.position.z = -weaponSpec.length / 2;
      arm.add(shaft);
      if (weaponSpec.tip) {
        const tipMat = new THREE.MeshLambertMaterial({ color: SPEAR_TIP });
        flashMaterials.push(tipMat);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.26), tipMat);
        tip.position.z = -weaponSpec.length - 0.1;
        arm.add(tip);
      }
      if (weaponSpec.headSize) {
        const clubHead = new THREE.Mesh(
          new THREE.BoxGeometry(weaponSpec.headSize, weaponSpec.headSize, weaponSpec.headSize),
          new THREE.MeshLambertMaterial({ color: 0x7a7d84 }),
        );
        clubHead.position.z = -weaponSpec.length + 0.15;
        arm.add(clubHead);
      }
      arm.rotation.x = weaponSpec.style === 'thrust' ? THRUST_LEVEL : ARM_REST;
      visual.arm = arm;
      torso.add(arm);
    }

    // 맨팔 — 인간형은 모두 두 팔이다. 무기 팔(오른쪽)이 있으면 왼팔 하나만,
    // 없으면(궁수·주술사) 양팔을 단다. 궁수는 활을 향해 앞으로 들려 있다
    if (!SPIDER_TYPES.has(type) && !SLIME_TYPES.has(type) && type !== 'leech' && type !== 'bat') {
      const armLen = def.height * 0.34;
      const forward = type === 'goblin_archer' ? 0.55 : type === 'ghoul' ? GHOUL_ARMS_FORWARD : 0;
      const makeArm = (side: number): THREE.Group => {
        const shoulder = new THREE.Group();
        shoulder.position.set(side * def.radius * 0.92, def.height * 0.72, 0);
        const limb = new THREE.Mesh(
          new THREE.BoxGeometry(def.radius * 0.3, armLen, def.radius * 0.3),
          armMat,
        );
        limb.position.y = -armLen / 2;
        shoulder.add(limb);
        shoulder.rotation.x = forward;
        shoulder.userData['restRotX'] = forward; // 걸음 스윙이 이 각을 기준으로 돈다
        torso.add(shoulder);
        return shoulder;
      };
      visual.plainArms = [makeArm(-1)];
      if (!weaponSpec) visual.plainArms.push(makeArm(1));
    }

    return visual;
  }

  /** 적 시각 생성/제거/이동을 world.enemies와 동기화 */
  syncEnemies(enemies: EnemyState[], alpha: number): void {
    const now = performance.now();
    const seen = new Set<number>();
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      seen.add(enemy.id);

      let visual = this.enemyVisuals.get(enemy.id);
      if (!visual) {
        visual = this.buildEnemyVisual(enemy.type);
        if (enemy.shieldBroken && visual.shield) {
          visual.torso.remove(visual.shield);
          visual.shield = undefined;
        }
        this.enemyVisuals.set(enemy.id, visual);
        this.scene.add(visual.group);
      }

      // 도약 중이면 지면에서 뜬다 (검은 거미의 몸통 박치기)
      const jumpY = (enemy.prevJumpY ?? 0) + ((enemy.jumpY ?? 0) - (enemy.prevJumpY ?? 0)) * alpha;
      // 감전 — 제자리에서 좌우로 떤다. 자세(torso 회전)는 AI 가 멈춰 있어 그대로 유지되고,
      // 여기서는 몸을 옆으로 밀고 살짝 기울이기만 한다 — 풀리면 하던 동작이 그대로 이어진다
      const shocked = (enemy.shockTicks ?? 0) > 0;
      const shake = shocked ? Math.sin((now / 1000) * SHOCK_SHAKE_HZ * Math.PI * 2) : 0;
      // 근접 피격 셰이크 — 남은 시간에 비례해 잦아드는 무작위 튐 (해머 손맛. 판정 무관)
      let hitJx = 0;
      let hitJy = 0;
      let hitJz = 0;
      if ((visual.hitShakeUntil ?? 0) > now) {
        const frac = ((visual.hitShakeUntil ?? 0) - now) / balance.hitShake.durationMs;
        const amp = (visual.hitShakeAmp ?? 0) * frac;
        hitJx = (Math.random() - 0.5) * 2 * amp;
        hitJy = (Math.random() - 0.5) * 2 * amp * 0.7; // 발이 땅에서 크게 뜨진 않게
        hitJz = (Math.random() - 0.5) * 2 * amp;
      }
      visual.group.position.set(
        enemy.prevX + (enemy.x - enemy.prevX) * alpha - Math.cos(enemy.yaw) * shake * SHOCK_SHAKE_AMP + hitJx,
        jumpY + hitJy,
        enemy.prevZ + (enemy.z - enemy.prevZ) * alpha + Math.sin(enemy.yaw) * shake * SHOCK_SHAKE_AMP + hitJz,
      );
      visual.group.rotation.y = enemy.yaw;
      if (shocked) visual.zapUntil = Math.max(visual.zapUntil ?? 0, now + 40); // 떠는 내내 전류가 보인다

      // 다리 젓기 — 실제로 움직인 거리만큼 위상이 돈다 (플레이어 걸음과 같은 방식).
      // 감전·빙결 중에는 젓지 않는다 — 감전의 좌우 떨림이 걸음으로 오인되지 않게
      if (visual.legs) {
        const ix = visual.group.position.x;
        const iz = visual.group.position.z;
        const step = Math.hypot(ix - (visual.legLastX ?? ix), iz - (visual.legLastZ ?? iz));
        visual.legLastX = ix;
        visual.legLastZ = iz;
        const stiff = shocked || (enemy.freezeTicks ?? 0) > 0;
        const walking = !stiff && step > 0.0008 && step < 1;
        if (walking) visual.legPhase = (visual.legPhase ?? 0) + step * ENEMY_LEG_FREQ;
        visual.legBlend =
          (visual.legBlend ?? 0) + ((walking ? 1 : 0) - (visual.legBlend ?? 0)) * 0.15;
        const legSwing = Math.sin(visual.legPhase ?? 0) * 0.7 * (visual.legBlend ?? 0);
        visual.legs.left.rotation.x = legSwing;
        visual.legs.right.rotation.x = -legSwing;
        // 맨팔은 다리와 반대 위상 — 사람 걸음의 팔젓기
        if (visual.plainArms && enemy.type !== 'ghoul') {
          // 구울은 제외 — 팔이 언제나 앞으로 나란히라 걸음 스윙이 없다 (아래 포즈 블록 전담)
          for (let a = 0; a < visual.plainArms.length; a++) {
            const shoulder = visual.plainArms[a]!;
            const rest = (shoulder.userData['restRotX'] as number) ?? 0;
            shoulder.rotation.x = rest + (a === 0 ? -legSwing : legSwing) * 0.55;
          }
        }
      }

      // 텔레그래프 — 섬광은 windup 종료 visualLeadTicks 전부터 판정 창 내내.
      // 색은 공격 유형 규약: 청=패링 가능, 적=회피 전용, 보라=마법 투사체.
      // 그 전 windup은 옅은 예고 틴트. 스태거는 처형 가능 표시(황색).
      const def2 = enemyDef(enemy.type);
      const attack = currentAttack(def2, enemy);
      // 벽 도약(벽거미)은 언제나 적색 — 회피 전용 규약
      const wallWind = (enemy.wallWindupTicks ?? 0) > 0;
      const telegraphColor = wallWind
        ? balance.telegraph.colorUnparryable
        : attack.telegraph === 'red'
          ? balance.telegraph.colorUnparryable
          : attack.telegraph === 'purple'
            ? balance.telegraph.colorProjectile
            : balance.telegraph.colorParryable;
      const flashing =
        (enemy.ai === 'windup' && enemy.timer <= balance.telegraph.visualLeadTicks) ||
        (wallWind && (enemy.wallWindupTicks ?? 0) <= balance.telegraph.visualLeadTicks) ||
        enemy.ai === 'active_perfect' ||
        enemy.ai === 'active_normal';
      let emissive = 0x000000;
      if (flashing) emissive = new THREE.Color(telegraphColor).getHex();
      else if (enemy.ai === 'windup' || wallWind) emissive = WINDUP_TINT;
      else if (enemy.ai === 'staggered') emissive = STAGGER_COLOR;
      else if (enemy.burnTicks > 0) emissive = BURN_TINT;
      else if ((enemy.freezeTicks ?? 0) > 0) emissive = FREEZE_TINT;
      else if ((enemy.slowTicks ?? 0) > 0) emissive = FROST_TINT;

      // 화상 — 몸에서 불티가 계속 피어오른다. 발광색은 다른 상태에 가려지므로
      // 이것이 "불타는 중"을 알리는 실제 신호다
      if (enemy.burnTicks > 0 && now >= visual.nextEmberMs) {
        visual.nextEmberMs = now + BURN_EMBER_MS;
        this.spawnBurnEmber(enemy.x, enemy.z, def2.radius, def2.height);
      }

      // 해머 적중 명멸 — 무엇보다 우선한다. 켜짐/꺼짐을 빠르게 교대해 "번쩍번쩍"
      // 얼음 결정 — 얼어 있는 동안 몸에 박혀 있다. 남은 시간이 줄면 살짝 작아져 "곧 풀린다"가 읽힌다
      const frozen = (enemy.freezeTicks ?? 0) > 0;
      if (frozen && !visual.ice) {
        visual.ice = makeIceShards(enemyDef(enemy.type));
        visual.torso.add(visual.ice);
      }
      // 그물에 걸렸다 — 몸을 감싼 거미줄 고치(와이어프레임 구). 버둥거리듯 잔떨림
      const netted = (enemy.nettedTicks ?? 0) > 0;
      if (netted && !visual.web) {
        const dw = enemyDef(enemy.type);
        const web = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 1),
          new THREE.MeshBasicMaterial({ color: 0xe8e4d0, wireframe: true, transparent: true, opacity: 0.85 }),
        );
        web.scale.set(dw.radius * 1.35, dw.height * 0.56, dw.radius * 1.35);
        web.position.y = dw.height * 0.5;
        visual.web = web;
        visual.torso.add(web);
      }
      if (visual.web) {
        visual.web.visible = netted;
        if (netted) {
          visual.web.rotation.y = Math.sin(now / 90) * 0.08;
          visual.web.rotation.z = Math.cos(now / 70) * 0.05;
        }
      }
      // 결정은 완전 빙결 동안만 — 깨지는 순간 파편으로 튀고(spawnThaw), 둔화 단계는 틴트만 남는다.
      // 나타나는 순간엔 1.7배로 잡혔다가 220ms 에 걸쳐 제 크기로 조여든다 — "쩍" 하고 굳는 팝
      if (visual.ice) {
        const showIce = (enemy.freezeTicks ?? 0) > 0;
        if (showIce && !visual.ice.visible) visual.iceShownMs = now;
        visual.ice.visible = showIce;
        if (showIce) {
          const t = Math.min(1, (now - (visual.iceShownMs ?? now)) / 220);
          const pop = 1 + 0.7 * (1 - t) * (1 - t);
          visual.ice.scale.set(pop, pop, pop);
        }
      }
      // 헤드샷 — 머리가 홱 젖혀졌다가 떨며 되돌아온다. 자세(torso)는 안 건드린다
      if (visual.head) {
        const shakeLeft = (visual.headShakeUntil ?? 0) - now;
        if (shakeLeft > 0) {
          const k = shakeLeft / HEADSHOT_SHAKE_MS;
          visual.head.rotation.x = -0.6 * k;
          visual.head.rotation.z = 0.28 * k * Math.sin((1 - k) * 26);
        } else if (visual.head.rotation.x !== 0 || visual.head.rotation.z !== 0) {
          visual.head.rotation.x = 0;
          visual.head.rotation.z = 0;
        }
      }
      const hitLeft = visual.hitFlashUntil - now;
      let hitIntensity = 0;
      if (hitLeft > 0) {
        const on = Math.sin((now / 1000) * HIT_FLASH_HZ * Math.PI * 2) > 0;
        if (on) {
          emissive = HIT_FLASH_COLOR;
          hitIntensity = hitLeft / HIT_FLASH_MS; // 잦아들며 멎는다
        }
      }
      // 감전 — 몸이 푸르게 물들고 전류 마디가 매 프레임 새 자리에서 튄다.
      // 피격 섬광이 도는 중에는 그쪽이 이긴다 (맞은 순간이 더 중요하다)
      const zapLeft = (visual.zapUntil ?? 0) - now;
      if (zapLeft > 0 && hitIntensity <= 0) {
        emissive = ZAP_BODY_COLOR;
        hitIntensity = 0.35 + 0.35 * Math.abs(Math.sin(now / 17));
      }
      if (zapLeft > 0) {
        visual.zap ??= makeBodyZap(visual.group);
        visual.zap.group.visible = true;
        visual.zap.mat.opacity = Math.min(1, zapLeft / (ZAP_BODY_MS * 0.5));
        const radius = def2.radius;
        for (const seg of visual.zap.segs) {
          const ang = Math.random() * Math.PI * 2;
          const r = radius * (0.7 + Math.random() * 0.5);
          seg.position.set(
            Math.cos(ang) * r,
            (0.1 + Math.random() * 0.85) * def2.height,
            Math.sin(ang) * r,
          );
          seg.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI,
          );
          seg.scale.z = 0.12 + Math.random() * 0.28;
        }
      } else if (visual.zap) {
        visual.zap.group.visible = false;
      }
      for (const material of visual.flashMaterials) {
        material.emissive.set(emissive);
        material.emissiveIntensity = hitIntensity > 0 ? hitIntensity : 1;
      }
      // 떨림의 기우뚱. z 회전은 이 연출만 쓰므로 매 프레임 절대값으로 넣는다 —
      // 자세를 만드는 x 회전(기울임·내지름)은 건드리지 않는다
      visual.torso.rotation.z = shocked ? shake * SHOCK_ROLL : 0;

      // 락온 마커 — 소울라이크처럼 몸통 중앙에 찍힌다. 항상 몸 앞에 그려져
      // (depthTest 끔) 가려질 일이 없고, 숨쉬는 맥동으로 시선이 걸린다
      if (enemy.id === this.lockOnTargetId) {
        const spr = this.ensureLockSprite();
        const pulse = 1 + Math.sin(now / 160) * 0.15;
        const size = Math.max(0.7, def2.radius * 1.3) * pulse;
        spr.visible = true;
        spr.scale.set(size, size, 1);
        spr.position.set(
          visual.group.position.x,
          visual.group.position.y + def2.height * 0.55,
          visual.group.position.z,
        );
      }

      // 인지 표시 — 뛰어올랐다(팝) 잠깐 머물고 옅어진다
      const alertStart = this.alertAt.get(enemy.id);
      const alertLeft = alertStart === undefined ? 0 : alertStart + ALERT_MS - now;
      visual.alert.visible = alertLeft > 0;
      if (alertStart !== undefined && alertLeft <= 0) this.alertAt.delete(enemy.id);
      if (alertLeft > 0) {
        const age = now - alertStart!;
        // 앞 구간은 살짝 넘겼다 돌아오는 탄성 — 시선이 걸리게
        const pop =
          age < ALERT_POP_MS ? 1.35 - 0.35 * Math.pow(1 - age / ALERT_POP_MS, 2) : 1;
        const scale = (def2.boss ? 1.5 : 1.05) * pop;
        visual.alert.scale.set(scale, scale, 1);
        const fade = Math.min(1, alertLeft / 320); // 끝 0.32초 동안만 옅어진다
        (visual.alert.material as THREE.SpriteMaterial).opacity = fade;
        visual.alert.position.y =
          def2.height + (def2.boss ? 1.5 : 1.15) + (1 - Math.min(1, age / ALERT_POP_MS)) * -0.25;
      }

      // 이름표 — 어그로 후에만. 체력·패링 카운터가 바뀔 때만 다시 그린다
      visual.plate.visible = enemy.ai !== 'idle';
      const eyeCfg = balance.lighting.enemyEyes;
      visual.eyeHalo.opacity = enemy.ai !== 'idle' ? eyeCfg.alertedHaloOpacity : eyeCfg.haloOpacity;
      // 원거리 글린트 — 멀수록 후광을 키워 화면에서 몇 픽셀은 늘 남긴다
      const eyeDist = Math.hypot(enemy.x - this.camera.position.x, enemy.z - this.camera.position.z);
      const haloSize = Math.max(visual.eyeHaloBase, eyeDist * eyeCfg.haloPerMeter);
      for (const halo of visual.eyeHalos) halo.scale.set(haloSize, haloSize, 1);
      if (visual.plate.visible) {
        const staggered = enemy.ai === 'staggered';
        const parry = def2.parriesToStagger
          ? { streak: enemy.parryStreak ?? 0, total: def2.parriesToStagger, staggered }
          : null;
        const key = `${Math.ceil(enemy.health)}|${parry ? `${parry.streak}${staggered ? 'S' : ''}` : ''}`;
        if (key !== visual.plateKey) {
          visual.plateKey = key;
          const hb = healthBarState(def2, enemy.health);
          drawPlate(
            visual.plateCanvas,
            def2.name ?? enemy.type,
            hb.frac,
            hb.index,
            hb.count,
            parry,
          );
          visual.plateTexture.needsUpdate = true;
        }
      }

      // warden 방어막 — 튕김 시 번쩍
      if (visual.barrier && visual.barrierMaterial) {
        // 깨진 방어막은 사라진다. 남은 내구가 옅어지는 막으로 보인다 —
        // 몇 대 더 때리면 되는지 눈으로 읽히게
        visual.barrier.visible = enemy.barrierBroken !== true;
        const left = Math.max(
          0,
          1 - (enemy.barrierHits ?? 0) / balance.barrierBreak.hammerHitsToBreak,
        );
        const flashOn = now < visual.barrierFlashUntil;
        visual.barrierMaterial.opacity = flashOn ? 0.55 : 0.06 + 0.12 * left;
        visual.barrierMaterial.emissive.set(flashOn ? BARRIER_COLOR : 0x000000);
      }

      // 공격 모션 — windup에 무기를 머리 위로 치켜들며 몸을 젖히고,
      // 타격 구간에 격하게 내리찍는다. 섬광 구간(마지막 4틱)에는 부르르 떨림.
      const inWindup = enemy.ai === 'windup';
      // 헛친 경직 중에는 마지막(내지른) 자세로 굳는다 — 무방비라는 신호
      const frozenWhiff = enemy.ai === 'recover' && enemy.whiffed === true;
      // 방패에 막혀 튕긴 경직 — 상체가 크게 젖혀진 채 굳는다
      const recoiled = enemy.ai === 'recover' && enemy.recoiled === true;
      const charging = enemy.ai === 'charging';
      // 돌격 예비동작 — 달리는 구간이 따로 있는 돌격만 (창병의 짧은 돌격은 그대로)
      const chargeCoil = inWindup && attack.chargeRunTicks !== undefined;
      const striking =
        enemy.ai === 'active_perfect' ||
        enemy.ai === 'active_normal' ||
        enemy.ai === 'impact' ||
        frozenWhiff;
      const windupProgress = inWindup ? 1 - enemy.timer / attack.windupTicks : 0;
      const isMelee = attack.type !== 'projectile';
      const trembling = inWindup && enemy.timer <= balance.telegraph.visualLeadTicks;

      const isThrust = (MELEE_WEAPONS[enemy.type]?.style ?? 'smash') === 'thrust';
      let leanTarget: number;
      let lungeTarget: number;
      let crouchTarget = 0;
      if (isThrust && isMelee) {
        // 창: 낮추고 뒤로 움츠렸다가(windup) 몸통째 진격하며 내지른다(strike)
        const sp = enemy.strikeProgress ?? 0;
        leanTarget = striking
          ? THRUST_LEAN * sp
          : inWindup
            ? THRUST_COIL_LEAN * windupProgress
            : 0;
        lungeTarget = striking
          ? THRUST_COIL + (THRUST_ADVANCE - THRUST_COIL) * sp // 움츠린 자리에서 진격
          : inWindup
            ? THRUST_COIL * windupProgress
            : 0;
        crouchTarget = inWindup ? -THRUST_CROUCH * windupProgress : 0;
      } else {
        // 치켜들 때 몸을 젖히고(+), 내리칠 때 앞으로 숙인다(-)
        leanTarget = striking && isMelee ? -0.42 : inWindup ? 0.28 * windupProgress : 0;
        lungeTarget = striking && isMelee ? -0.5 : 0;
        // 돌격 예비동작 — 웅크려 앞으로 기울이고 무게를 뒤로 싣는다 (달려들기 직전)
        if (chargeCoil) {
          leanTarget = CHARGE_COIL_LEAN * windupProgress;
          lungeTarget = CHARGE_COIL_ROCK * windupProgress;
          crouchTarget = -def2.height * CHARGE_COIL_CROUCH * windupProgress;
        }
        // 돌격 달리기 — 무기를 치켜든 채 앞으로 숙이고 달려온다
        if (charging) {
          leanTarget = -0.22 + Math.sin(now / 70) * 0.05;
          lungeTarget = 0;
        }
      }
      // 화살 세례 — 예고부터 발사 내내 상체를 젖힌 채 버틴다 (바위 투척과 구분되는 자세)
      const volleying =
        enemy.attackMode === 'volley' && (inWindup || enemy.ai === 'volley');
      if (volleying) {
        leanTarget = inWindup ? VOLLEY_LEAN * windupProgress : VOLLEY_LEAN;
        lungeTarget = 0;
      }

      // 방패 밀쳐내기 — 몸통째 앞으로 내지른다 (찌르기와 구분되는 짧고 굵은 동작)
      const bashing = enemy.attackMode === 'bash';
      if (bashing && striking) {
        leanTarget = -0.3;
        lungeTarget = -0.85;
      }

      // 방패로 버티는 중 — 몸을 낮추고 반 걸음 물러서 웅크린다 (해머 연타를 받아내는 자세)
      if ((enemy.braceTicks ?? 0) > 0) {
        leanTarget = 0.12;
        lungeTarget = 0.14;
        crouchTarget = -def2.height * 0.1;
      }

      // 연출용 전진이 플레이어를 지나치지 않게 제한한다 — 붙어 있을 때 몸이
      // 관통해 보이던 원인. 멀리서 찌를 때는 그대로 크게 파고든다
      const toPlayer = Math.hypot(
        this.camera.position.x - enemy.x,
        this.camera.position.z - enemy.z,
      );
      const maxAdvance = Math.max(0, toPlayer - def2.radius - VISUAL_BODY_GAP);
      // 앞으로 나가는 성분은 두 가지 — 몸통 전진(z)과 앞으로 숙임(회전).
      // 숙임은 피벗이 발밑이라 머리가 height×sin(각) 만큼 앞으로 나간다.
      // 둘을 합친 값이 여유를 넘으면 같은 비율로 함께 줄인다
      const forwardLean = leanTarget < 0 ? def2.height * 0.8 * Math.sin(-leanTarget) : 0;
      const desired = Math.max(0, -lungeTarget) + forwardLean;
      if (desired > maxAdvance) {
        const k = desired > 0 ? maxAdvance / desired : 0;
        if (lungeTarget < 0) lungeTarget *= k;
        if (leanTarget < 0) leanTarget *= k;
      }

      // 구울 자세 — 굽은 등 / 죽은 척(엎어짐) / 파먹기(몸을 파묻고 꿈틀).
      // 전진 제한(위 clamp) 뒤에 덮는다 — 파먹기는 이미 몸이 붙어 있는 상태다
      if (enemy.type === 'ghoul') {
        if (enemy.ai === 'latched') leanTarget = -0.5 + Math.sin(now / 85) * 0.1;
        else if (enemy.feigning) leanTarget = -1.42;
        else leanTarget += -0.2;
        // 팔 — 기본은 앞으로 나란히(좀비 팔). 할퀴기는 치켜들었다 내려찍고,
        // 밀쳐내지거나 넉백당하면 팔이 위로 들린 채 나가떨어진다.
        // 죽은 척일 때만 팔을 몸에 붙이고 눕는다 (안 그러면 땅에 박힌다)
        if (visual.plainArms) {
          let armTarget = GHOUL_ARMS_FORWARD;
          let armSnap = 0.35;
          if (enemy.feigning) {
            armTarget = 0.05;
            armSnap = 1;
          } else if ((enemy.kbTicks ?? 0) > 0) {
            armTarget = GHOUL_ARMS_RAISED; // 밀쳐냄 — 두 팔이 들리며 뒤로 날아간다
            armSnap = 0.55;
          } else if (isMelee && inWindup) {
            armTarget =
              GHOUL_ARMS_FORWARD + (GHOUL_ARMS_RAISED - GHOUL_ARMS_FORWARD) * windupProgress;
          } else if (isMelee && striking) {
            // 내려찍기 — 판정 진행도(strikeProgress)를 그대로 따라간다 (그림 = 판정)
            armTarget =
              GHOUL_ARMS_RAISED + (GHOUL_ARMS_SLAM - GHOUL_ARMS_RAISED) * (enemy.strikeProgress ?? 0);
            armSnap = 1;
          }
          for (const shoulder of visual.plainArms) {
            shoulder.rotation.x += (armTarget - shoulder.rotation.x) * armSnap;
          }
        }
      }
      if (trembling) leanTarget += Math.sin(now / 14) * 0.05;
      // 피탄 움찔 — 상체가 짧게 젖혀졌다 돌아온다 (+ = 뒤로). 남은 틱 비율로 감쇠
      const flinch =
        Math.max(enemy.flinchTicks ?? 0, enemy.attackFreezeTicks ?? 0) /
        balance.weapons.pistol.flinchTicks;
      if (flinch > 0) leanTarget += 0.16 * Math.min(1, flinch);
      // 굳은 동안 힘겹게 버티는 미세 떨림 (완전 정지는 프리즈처럼 보인다)
      if (frozenWhiff) leanTarget += Math.sin(now / 55) * 0.012;
      if (recoiled) leanTarget += 0.5 + Math.sin(now / 40) * 0.03; // 뒤로 크게 젖힘
      // 빙결 — 보간 계수를 0으로 두면 지금 자세(달리던·찌르던 중간)가 그대로 굳는다
      const solidIce = (enemy.freezeTicks ?? 0) > 0;
      const snap = solidIce ? 0 : striking ? 0.55 : 0.3; // 타격은 빠르게, 복귀는 부드럽게
      visual.torso.rotation.x += (leanTarget - visual.torso.rotation.x) * snap;
      visual.torso.position.z += (lungeTarget - visual.torso.position.z) * snap;
      visual.torso.position.y += (crouchTarget - visual.torso.position.y) * snap;

      // 무기 팔 — smash: 치켜들었다 내리침 / thrust: 뒤로 당겼다 내지름.
      // 타격 구간에서는 로직이 계산한 무기 끝 거리(enemy.weaponTipDist)를 그대로 따라간다.
      // 보이는 창끝 = 패링 판정에 쓰이는 창끝 (시간 기반 스냅 애니메이션 금지)
      if (visual.arm) {
        const spec = MELEE_WEAPONS[enemy.type];
        const style = spec?.style ?? 'smash';
        const strikeProgress = enemy.strikeProgress ?? 0;
        let armRotTarget: number;
        let armZTarget = 0;
        let armYawTarget = 0; // 연사만 쓴다 — 나머지 동작은 수직면 안에서만 움직인다
        let direct = false; // 즉시 반영 (보간하면 판정과 어긋난다)
        if (style === 'thrust') {
          // 몸통 기울기를 상쇄 — 창끝이 위로 쓸리지 않고 계속 플레이어를 겨눈다
          armRotTarget = THRUST_LEVEL - visual.torso.rotation.x;
          if (isMelee && inWindup) {
            armZTarget = THRUST_PULL * windupProgress; // 뒤로 당김
            if (trembling) armZTarget += Math.sin(now / 12) * 0.05;
          } else if (isMelee && striking && enemy.attackMode !== 'bash') {
            // 창끝의 로컬 위치 = torsoZ + armZ - tipLocal 이 -weaponTipDist 가 되도록
            const tipLocal = (spec?.length ?? 1) + (spec?.tip ? 0.23 : 0);
            armZTarget = -(enemy.weaponTipDist ?? 0) + tipLocal - visual.torso.position.z;
            direct = true;
          }
        } else if (volleying) {
          // 예고: 무기를 몸 앞으로 가로질러 당긴다 / 발사: 한 발마다 앞으로 짧게 튕긴다
          if (inWindup) {
            armRotTarget = ARM_REST + (ARM_VOLLEY_DRAW - ARM_REST) * windupProgress;
            armYawTarget = ARM_VOLLEY_SWING * windupProgress;
            armZTarget = VOLLEY_PULL * windupProgress;
            if (trembling) armYawTarget += Math.sin(now / 10) * 0.08;
          } else {
            const interval = attack.shotIntervalTicks ?? 30;
            const since = 1 - Math.min(1, enemy.timer / interval); // 0 = 방금 쏨
            const snapK = since < VOLLEY_SNAP ? 1 - since / VOLLEY_SNAP : 0;
            armRotTarget = ARM_VOLLEY_DRAW - 0.3 * snapK;
            armYawTarget = ARM_VOLLEY_SWING * (1 - snapK * 0.85);
            armZTarget = VOLLEY_PULL * (1 - snapK);
            direct = true; // 발사 순간과 그림이 어긋나지 않게
          }
        } else {
          armRotTarget = ARM_REST;
          if (chargeCoil) {
            // 무기를 뒤아래로 끌어 내렸다가 달리며 치켜든다
            armRotTarget = ARM_REST + (ARM_CHARGE_COIL - ARM_REST) * windupProgress;
            armZTarget = 0.3 * windupProgress;
            if (trembling) armRotTarget += Math.sin(now / 11) * 0.09;
          } else if (charging) {
            armRotTarget = ARM_RAISED; // 치켜든 채로 달려온다
          } else if (isMelee && inWindup) {
            armRotTarget = ARM_REST + (ARM_RAISED - ARM_REST) * windupProgress;
            if (trembling) armRotTarget += Math.sin(now / 12) * 0.08;
          } else if (isMelee && striking) {
            // 호를 그리는 무기는 진행도로 각도를 몰아준다 (도달 시점이 판정과 일치)
            armRotTarget = ARM_RAISED + (ARM_SMASH - ARM_RAISED) * strikeProgress;
            direct = true;
          }
        }
        if (direct) {
          visual.arm.rotation.x = armRotTarget;
          visual.arm.rotation.y = armYawTarget;
          visual.arm.position.z = armZTarget;
        } else {
          const armSnap = solidIce ? 0 : striking ? 0.6 : 0.25;
          visual.arm.rotation.x += (armRotTarget - visual.arm.rotation.x) * armSnap;
          visual.arm.rotation.y += (armYawTarget - visual.arm.rotation.y) * armSnap;
          visual.arm.position.z += (armZTarget - visual.arm.position.z) * armSnap;
        }
      }

      // 지면 강타 범위 원 — 예고 내내 보이고 진행할수록 진해진다. 반경은 실제 판정과 같다
      if (visual.aoeRing && visual.aoeRingMaterial) {
        const aoe = attack.aoeRadius;
        // 달려오는 동안에도 보여준다 — 위험 범위가 밀려오는 게 보여야 물러날 수 있다
        const show = aoe !== undefined && (inWindup || charging || striking);
        visual.aoeRing.visible = show;
        if (show) {
          visual.aoeRing.scale.set(aoe!, aoe!, 1);
          // 예고 중엔 차오르고, 내리치는 순간 가장 진하다
          visual.aoeRingMaterial.opacity = inWindup ? 0.18 + 0.42 * windupProgress : 0.75;
          if (charging) visual.aoeRingMaterial.opacity = 0.6;
        }
      }

      // 시전 충전 구체 — windup 동안 부풀어 발사 직전 투사체와 같은 크기·밝기가 된다.
      // 끝값이 1이어야 발사 프레임에 크기가 튀지 않는다
      if (visual.chargeOrb) {
        visual.chargeOrb.visible = inWindup;
        const s = 0.12 + windupProgress * 0.88;
        visual.chargeOrb.scale.set(s, s, s);
        (visual.chargeOrb.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.6 * windupProgress;
        if (visual.chargeOrbLight) visual.chargeOrbLight.intensity = 2.2 * windupProgress;
      }

      // 벽거미 — 벽에 붙으면 몸을 굴려 배를 벽면에 댄다 (벽을 달리는 자세).
      // 굴림 방향은 진행 방향 기준 벽이 있는 쪽, 각은 높이에 비례해 보간(툭 꺾이지 않게).
      // 도약 예고 중엔 납작 웅크렸다가 튀어나간다
      if (SPIDER_TYPES.has(enemy.type) && def2.wallCrawl) {
        const wallH = def2.wallCrawl.height;
        const onWall =
          enemy.wallCling || (enemy.wallClimbTicks ?? 0) > 0 || (enemy.wallWindupTicks ?? 0) > 0;
        let roll = 0;
        if (onWall && enemy.wallNX !== undefined && enemy.wallNZ !== undefined) {
          const fx = -Math.sin(enemy.yaw);
          const fz = -Math.cos(enemy.yaw);
          const sideSign = fx * (enemy.wallNZ ?? 0) - fz * (enemy.wallNX ?? 0) >= 0 ? 1 : -1;
          const lift = Math.min(1, jumpY / (wallH * 0.8));
          // 부호 반전 — 다리가 벽을 딛고 등이 방을 본다 (debug/wallspider 로 실측)
          roll = -sideSign * (Math.PI / 2) * lift;
          // 굴린 몸이 벽면에 닿아 보이게 벽쪽으로 반경만큼 붙인다
          visual.group.position.x -= (enemy.wallNX ?? 0) * def2.radius * 0.55 * lift;
          visual.group.position.z -= (enemy.wallNZ ?? 0) * def2.radius * 0.55 * lift;
        }
        visual.torso.rotation.z = roll;
        visual.torso.scale.y = (enemy.wallWindupTicks ?? 0) > 0 ? 0.7 : 1;
      }

      // 슬라임 핵 — 삼킨 아이템이 있으면 노랗게 (죽이면 게워 낸다는 표시).
      // 젤막 알파(0.82)가 핵 기여를 18% 로 깎아 뒤에서 비추는 방식으론 무슨 색을
      // 넣어도 녹색으로 읽힌다 (실측) — 그래서 배부른 핵만 투명 패스 renderOrder 로
      // 젤 '위에' 덧그린다. 겉 젤은 손대지 않으니 그대로 녹색이다
      if (visual.slimeCore) {
        const sc = visual.slimeCore;
        const fed = !!enemy.eatenItems?.length;
        sc.mat.color.setHex(fed ? SLIME_CORE_FULL : sc.base);
        sc.mat.transparent = fed; // 투명 패스로 넘겨야 젤보다 나중에 그려진다 (opacity 1)
        sc.core.renderOrder = fed ? 2 : 0;
        sc.jellyMat.depthWrite = !fed; // 젤 깊이가 남아 있으면 핵이 깊이 판정에서 진다
        // 발광 — 환경광 0.04 던전에서 스스로 빛나야 노랗게 보인다.
        // 위 flashMaterials 루프가 상태 발광을 칠한 뒤라, 검정(무상태)일 때만 얹는다
        if (fed && sc.mat.emissive.getHex() === 0) {
          sc.mat.emissive.setHex(SLIME_CORE_FULL);
          sc.mat.emissiveIntensity = 0.85;
        }
      }

      // 어미 슬라임 — 젤 속 눈알들이 일제히 플레이어를 따라 돈다 (무정형 몸에 눈만 산 것)
      if (visual.motherEyes) {
        const wy = Math.atan2(
          -(this.camera.position.x - enemy.x),
          -(this.camera.position.z - enemy.z),
        );
        for (const eye of visual.motherEyes) eye.rotation.y = wy - enemy.yaw;
      }

      // 박쥐 — 날개 퍼덕임: 공중은 빠르게, 바닥에 뻗었을 땐(기절) 뒤집혀 늘어진 채 가끔.
      if (enemy.type === 'bat') {
        const wl = visual.torso.getObjectByName('batWingL');
        const wr = visual.torso.getObjectByName('batWingR');
        const downed = (enemy.downTicks ?? 0) > 0;
        if (wl && wr) {
          const flap = downed
            ? 0.9 + Math.sin(now / 260) * 0.3
            : enemy.ai === 'windup'
              ? enemy.timer <= balance.telegraph.visualLeadTicks
                ? Math.sin(now / 30 + enemy.id) * 0.85 + 0.1 // 발사 직전 — 맹렬 (진짜 신호)
                : Math.sin(now / 150 + enemy.id) * 0.28 + 0.3 // 조용한 정지 비행 (1초)
              : Math.sin(now / 70 + enemy.id) * 0.55 + 0.12;
          wl.rotation.z = flap;
          wr.rotation.z = -flap;
        }
        // 뒤집혀 뻗는다 — 피벗이 발밑이라 그냥 굴리면 몸이 바닥 밑으로 꺼진다.
        // 몸 높이만큼 들어 올려 등이 바닥에 닿게 눕힌다 (거머리 천장 뒤집기와 같은 트릭)
        visual.torso.rotation.x = downed ? Math.PI * 0.92 : 0;
        visual.torso.position.y = downed ? def2.height : 0;
      }

      // 거머리 — 매달려 있는 동안 천천히 흔들리고, 천장 돌빛으로 위장한다.
      // 랜턴 빔에 잡히거나 땅에 내려오면 제 색(자줏빛)이 드러난다. 안광은 위장 중에도
      // 남는다 — 올려다보는 플레이어에게 주는 유일한 시각 단서다
      if (enemy.type === 'leech') {
        // 얼굴에 붙은 동안은 월드 모델을 숨긴다 — 화면 가림(HUD #faceleech)이 그 몸이다
        visual.group.visible = enemy.ai !== 'latched';
        visual.torso.rotation.z = enemy.lurking ? Math.sin(now / 520 + enemy.id) * 0.08 : 0;
        // 매달린 자세 — 뒤집혀 촉수(발)가 천장을 딛는다. 낙하가 시작되면 아래
        // lean 보간이 π→0 으로 도로 굴려 몸을 세운다 (떨어지며 공중제비)
        if (enemy.lurking) {
          visual.torso.rotation.x = Math.PI;
          visual.torso.position.y = def2.height;
        }
        // 배불리 먹은 놈은 통통하다 — 피를 얼마나 뺏겼는지 몸집으로 보인다
        const fat = enemy.gorged ? 1.35 : 1;
        visual.torso.scale.set(fat, fat, fat);
        if (visual.leechMats) {
          let camo = enemy.lurking === true;
          if (camo && this.lanternIsOn) {
            const dx = enemy.x - this.camera.position.x;
            const dz = enemy.z - this.camera.position.z;
            const d = Math.hypot(dx, dz);
            if (d > 0.001 && d <= balance.lantern.noticeRange) {
              this.camera.getWorldDirection(LEECH_TMP_DIR);
              const flat = Math.hypot(LEECH_TMP_DIR.x, LEECH_TMP_DIR.z) || 1;
              const dot = ((LEECH_TMP_DIR.x / flat) * dx + (LEECH_TMP_DIR.z / flat) * dz) / d;
              if (dot >= Math.cos((balance.lantern.angleDeg * Math.PI) / 180)) camo = false;
            }
          }
          const base = camo ? LEECH_CAMO_COLOR : ENEMY_COLORS['leech']!;
          for (const entry of visual.leechMats) {
            LEECH_TMP_COLOR.setHex(base).multiplyScalar(entry.mul);
            entry.mat.color.lerp(LEECH_TMP_COLOR, 0.15);
          }
        }
      }

      // 슬라임 꿀렁임 — 기는 동안 squash&stretch, 예고 때 터질 듯 부풀고, 도약 중 살짝 늘어난다
      if (SLIME_TYPES.has(enemy.type)) {
        const inflate = inWindup ? 0.3 * windupProgress : charging ? 0.18 : 0;
        const wobble = solidIce ? 0 : Math.sin(now / 140 + enemy.id * 1.7) * 0.05;
        const sy = 1 + inflate + wobble;
        const sxz = 1 - inflate * 0.35 - wobble * 0.6;
        // 배부른 만큼 살짝 커진다 — 뭘 삼켰는지 몸집으로 읽힌다
        const belly = 1 + Math.min(0.18, (enemy.eatenItems?.length ?? 0) * 0.025);
        visual.torso.scale.set(sxz * belly, sy * belly, sxz * belly);
      }

      // 활 — windup 동안 시위를 당긴다: 재어 둔 화살이 보이고 오늬가 몸 쪽으로
      // 미끄러지며 시위가 V 자로 꺾인다. 놓는 순간 0으로 스냅해 시위가 튕긴다
      if (visual.bowRig) {
        const drawTarget = inWindup ? Math.min(1, windupProgress * 1.15) : 0;
        const prevDraw = visual.bowDraw ?? 0;
        const draw = drawTarget > prevDraw ? prevDraw + (drawTarget - prevDraw) * 0.25 : drawTarget;
        visual.bowDraw = draw;
        updateBowDraw(visual.bowRig, draw, inWindup);
        if (trembling) visual.bowRig.arrow.position.y = Math.sin(now / 16) * 0.012;
        // 당길수록 활이 몸 앞으로 나간다 — 조준 자세
        visual.bowRig.group.position.z = -(def2.radius + 0.15) - 0.12 * draw;
        // 팔 — 왼팔은 활을 밀어 뻗고, 오른팔(시위 손)은 빠르게 들어올린 뒤 귀 쪽으로 끌어온다.
        // 다리 스윙 블록이 먼저 쓴 각을 여기서 덮는다 (당기는 동안만 — 놓으면 팔젓기로 복귀)
        if (visual.plainArms && draw > 0.001) {
          const holdArm = visual.plainArms[0];
          const drawArm = visual.plainArms[1];
          if (holdArm) holdArm.rotation.x = 0.7 + 0.85 * draw; // 만작이면 거의 수평으로 뻗는다
          if (drawArm) drawArm.rotation.x = 0.55 + 0.85 * Math.min(1, draw * 2.5) - 0.45 * draw;
        }
      }

      // 방패 — 피격 시 흰 번쩍. 스태거·밀림 중엔 팔이 내려가 가드가 풀린다.
      // 내리는 조건은 Entities.shieldBlocks 와 같아야 한다 (보이는 것 = 막히는 것)
      // 반파 — 3대째부터 금이 드러나고 판이 그을린다. 6대째에 부서진다
      const halfBroken = (enemy.shieldHits ?? 0) >= balance.shieldBreak.hammerHitsToCrack;
      if (visual.shieldCracks) visual.shieldCracks.visible = halfBroken;
      if (visual.shield && visual.shieldMaterial) {
        visual.shieldMaterial.color.set(halfBroken ? SHIELD_CRACKED_COLOR : SHIELD_COLOR);
        visual.shieldMaterial.emissive.set(now < visual.shieldFlashUntil ? 0xffffff : 0x000000);
        const def = enemyDef(enemy.type);
        const shoved = (enemy.kbTicks ?? 0) > 0;
        // 판정과 그림을 한 곳에서 읽는다 — 어긋나면 "내려간 방패에 막혔다"가 된다
        const down = shoved || shieldLowered(enemy);
        // torso 의 자식이라 웅크림(position.y)·전진(z)·기울기(rotation.x)는
        // 부모가 이미 반영한다 — 여기서 다시 더하면 두 번 움직인다
        const targetY = down ? def.height * SHIELD_DOWN_Y : def.height * 0.5;
        const targetTilt = down ? SHIELD_DOWN_TILT : 0;
        const targetX = down ? SHIELD_DOWN_X : SHIELD_BASE_X;
        if (!down && visual.shieldDown) {
          // 밀림이 끝나는 순간 즉시 다시 든다 — 방어가 켜지는 시점과 그림이 어긋나면 안 된다
          visual.shield.position.y = targetY;
          visual.shield.position.x = SHIELD_BASE_X;
          visual.shield.rotation.x = 0;
        } else {
          visual.shield.position.y += (targetY - visual.shield.position.y) * 0.2;
          visual.shield.position.x += (targetX - visual.shield.position.x) * 0.2;
          visual.shield.rotation.x += (targetTilt - visual.shield.rotation.x) * 0.25;
        }
        visual.shieldDown = down;
      }
    }

    for (const [id, visual] of this.enemyVisuals) {
      if (seen.has(id)) continue;
      const heldUntil = this.heldVictims.get(id);
      if (heldUntil !== undefined) {
        if (now < heldUntil) continue; // 처형 대기 — 마지막 자세 그대로 얼어 있는다
        this.heldVictims.delete(id);
      }
      this.scene.remove(visual.group);
      visual.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      visual.plateTexture.dispose();
      visual.plate.material.dispose();
      visual.alert.material.dispose(); // 텍스처는 전 적이 공유하므로 건드리지 않는다
      this.enemyVisuals.delete(id);
      this.alertAt.delete(id); // 죽은 적의 표시 시각까지 들고 있지 않는다
    }
  }

  /** 투사체 — 화염구/마법탄은 발광 구+점광원, 화살은 어두운 화살대 (빛 없음) */
  syncProjectiles(projectiles: ProjectileState[], alpha: number): void {
    const seen = new Set<number>();
    for (const proj of projectiles) {
      seen.add(proj.id);
      let group = this.projectileVisuals.get(proj.id);
      if (!group) {
        group = new THREE.Group();
        if (proj.kind === 'grenade') {
          // 수류탄 — 작은 암록색 구
          group.add(
            new THREE.Mesh(
              new THREE.SphereGeometry(proj.radius, 8, 8),
              new THREE.MeshLambertMaterial({ color: 0x3d4a2e, emissive: 0x141a10 }),
            ),
          );
        } else if (proj.kind === 'rock') {
          // 바위 — 크고 어두운 덩어리, 무발광
          group.add(
            new THREE.Mesh(
              new THREE.DodecahedronGeometry(proj.radius),
              new THREE.MeshLambertMaterial({ color: 0x6a5a4a, emissive: 0x191410 }),
            ),
          );
        } else if (proj.kind === 'web') {
          // 거미줄 뭉치 — 희끄무레하고 울퉁불퉁한 덩어리. 발광은 아주 약하게
          const web = new THREE.Mesh(
            new THREE.DodecahedronGeometry(proj.radius),
            new THREE.MeshLambertMaterial({
              color: WEB_COLOR,
              emissive: WEB_COLOR,
              emissiveIntensity: 0.22,
              transparent: true,
              opacity: 0.85,
            }),
          );
          group.add(web);
          const strand = new THREE.Mesh(
            new THREE.BoxGeometry(proj.radius * 0.16, proj.radius * 0.16, proj.radius * 2.6),
            new THREE.MeshBasicMaterial({ color: WEB_COLOR, transparent: true, opacity: 0.5 }),
          );
          group.add(strand); // 꼬리처럼 끌리는 실
          group.add(new THREE.PointLight(WEB_COLOR, 0.5, 5, 0));
        } else if (proj.kind === 'frost') {
          // 얼음 화살 — 길쭉한 결정 + 서리빛 후광 + 푸른 광원. 진행 방향으로 눕는다
          const crystal = new THREE.Mesh(
            new THREE.OctahedronGeometry(proj.radius * 1.1, 0),
            new THREE.MeshBasicMaterial({ color: ICE_COLOR, transparent: true, opacity: 0.95 }),
          );
          crystal.scale.set(0.7, 0.7, 2.6);
          group.add(crystal);
          const halo = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: getGlowTexture(), color: 0x9fe0ff, transparent: true, opacity: 0.6,
              blending: THREE.AdditiveBlending, depthWrite: false,
            }),
          );
          halo.scale.set(proj.radius * 5, proj.radius * 5, 1);
          group.add(halo);
          group.add(new THREE.PointLight(0x9fe0ff, 1.4, 5, 0));
        } else if (proj.kind === 'arrow') {
          // 화살 — 나무 화살대 + 회색 촉. 발광하지 않아 어둠 속에서 위협적
          const shaft = new THREE.Mesh(
            new THREE.BoxGeometry(0.05, 0.05, 0.75),
            new THREE.MeshLambertMaterial({ color: 0x6b5233 }),
          );
          group.add(shaft);
          const head = new THREE.Mesh(
            new THREE.BoxGeometry(0.09, 0.09, 0.14),
            new THREE.MeshLambertMaterial({
              color: 0xb9c0c9,
              emissive: 0x3a3f46,
            }),
          );
          head.position.z = -0.42;
          group.add(head);
        } else {
          // 적 마법탄은 보라(반사 가능 규약), 플레이어 화염구는 주황
          const color = proj.owner === 'enemy' ? ENEMY_BOLT_COLOR : FIREBALL_COLOR;
          group.add(
            new THREE.Mesh(
              new THREE.SphereGeometry(proj.radius, 8, 8),
              new THREE.MeshBasicMaterial({ color }),
            ),
          );
          group.add(new THREE.PointLight(color, 2.2, 9, 0));
        }
        this.projectileVisuals.set(proj.id, group);
        this.scene.add(group);
      }
      let px = proj.prevX + (proj.x - proj.prevX) * alpha;
      let py = proj.prevY + (proj.y - proj.prevY) * alpha;
      let pz = proj.prevZ + (proj.z - proj.prevZ) * alpha;
      // 내 화염구는 눈(판정 원점)이 아니라 지팡이 끝에서 나온 것처럼 — 처음 LAUNCH_BLEND_MS 동안
      // 지팡이 끝 → 판정 위치로 미끄러져 합쳐진다 (순수 연출, 판정은 그대로)
      if ((proj.kind === 'fireball' || proj.kind === 'frost') && proj.owner === 'player') {
        let launch = this.projectileLaunch.get(proj.id);
        if (!launch) {
          launch = { ms: performance.now(), from: this.staffTip() };
          this.projectileLaunch.set(proj.id, launch);
        }
        const k = Math.min(1, (performance.now() - launch.ms) / LAUNCH_BLEND_MS);
        px = launch.from.x + (px - launch.from.x) * k;
        py = launch.from.y + (py - launch.from.y) * k;
        pz = launch.from.z + (pz - launch.from.z) * k;
      }
      group.position.set(px, py, pz);
      if (proj.kind === 'arrow' || proj.kind === 'frost') {
        // 화살대·얼음 결정을 비행 방향으로 정렬 (로컬 -Z가 진행 방향)
        group.lookAt(px - proj.vx, py - proj.vy, pz - proj.vz);
      }
    }
    for (const [id, group] of this.projectileVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(group);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.projectileVisuals.delete(id);
      this.projectileLaunch.delete(id);
    }
  }

  /** 격돌 — 부딪힌 지점에서 불꽃이 튀고 짧게 번쩍인다 (막기: 주황 / 패링: 청백) */
  /** 날아오던 것이 공중에서 깨졌다 — 그 자리에서 파편이 사방으로 흩어진다 */
  spawnProjectileDebris(x: number, y: number, z: number, radius: number, color: number): void {
    const now = performance.now();
    for (let i = 0; i < PROJECTILE_DEBRIS_COUNT; i++) {
      const size = radius * (0.22 + Math.random() * 0.3);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 }),
      );
      const yaw = Math.random() * Math.PI * 2;
      const pitch = Math.acos(2 * Math.random() - 1);
      const speed = 2.2 + Math.random() * 3.4;
      const particle: Particle = {
        mesh,
        ox: x,
        oy: y,
        oz: z,
        vx: Math.sin(pitch) * Math.cos(yaw) * speed,
        vy: Math.cos(pitch) * speed + 1.2,
        vz: Math.sin(pitch) * Math.sin(yaw) * speed,
        bornMs: now,
        spinX: (Math.random() - 0.5) * 9,
        spinZ: (Math.random() - 0.5) * 9,
      };
      mesh.position.set(x, y, z);
      this.particles.push(particle);
      this.scene.add(mesh);
    }
  }

  /** 방어막 파괴 — 구면을 따라 파편이 터져 나간다 */
  spawnBarrierShatter(x: number, z: number, radius: number, height: number): void {
    const now = performance.now();
    for (let i = 0; i < BARRIER_SHARD_COUNT; i++) {
      const size = 0.07 + Math.random() * 0.13;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * 1.8, size * 0.3),
        new THREE.MeshBasicMaterial({ color: BARRIER_COLOR, transparent: true, opacity: 0.9 }),
      );
      // 구면 위 한 점에서 바깥으로 — 막이 통째로 터져 나가는 그림
      const yaw = Math.random() * Math.PI * 2;
      const pitch = Math.acos(2 * Math.random() - 1);
      const sx = Math.sin(pitch) * Math.cos(yaw);
      const sy = Math.cos(pitch);
      const sz = Math.sin(pitch) * Math.sin(yaw);
      const speed = 3.5 + Math.random() * 3;
      const particle: Particle = {
        mesh,
        ox: x + sx * radius,
        oy: height + sy * radius,
        oz: z + sz * radius,
        vx: sx * speed,
        vy: sy * speed + 1.5,
        vz: sz * speed,
        bornMs: now,
      };
      mesh.position.set(particle.ox, particle.oy, particle.oz);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.particles.push(particle);
      this.scene.add(mesh);
    }
  }

  spawnGuardSparks(x: number, z: number, height: number, color = 0xfff0b0, power = 1): void {
    const now = performance.now();
    for (let i = 0; i < Math.round(16 * power); i++) {
      const size = 0.03 + Math.random() * 0.05;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }),
      );
      const angle = Math.random() * Math.PI * 2;
      const speed = (1.8 + Math.random() * 4.5) * power;
      this.particles.push({
        mesh,
        ox: x,
        oy: height,
        oz: z,
        vx: Math.cos(angle) * speed,
        vy: 1.2 + Math.random() * 3.5,
        vz: Math.sin(angle) * speed,
        bornMs: now,
        lifeMs: 380,
        gravity: 11,
      });
      this.scene.add(mesh);
    }
    this.triggerFlash(x, height, z, color, 150 + 60 * (power - 1), 3.2 * power);
  }

  /** 화상 불티 하나 — 몸 아무 데서나 피어올라 잠깐 떠 있다 사라진다 */
  /** 피해 숫자 — 맞은 적 머리 위에서 떠올랐다 사라진다. bigAt 이상은 금색·큰 글씨 */
  spawnDamageNumber(x: number, y: number, z: number, amount: number): void {
    const cfg = balance.hud.damageNumbers;
    const shown = Math.round(amount);
    if (shown < 1) return;
    const big = amount >= cfg.bigAt;
    this.spawnFloatText(x, y, z, String(shown), {
      sizeM: big ? cfg.bigSizeM : cfg.sizeM,
      color: big ? '#ffd75e' : '#ffffff',
      ms: cfg.ms,
    });
  }

  /** 처치 XP — 피해 숫자와 같은 자리·같은 방식, 단 더 크게 (delayMs 는 부르는 쪽 몫) */
  spawnXpNumber(x: number, y: number, z: number, amount: number): void {
    const cfg = balance.hud.xpPop;
    this.spawnFloatText(x, y, z, `✦ +${Math.round(amount)}`, {
      sizeM: cfg.sizeM,
      color: '#58e06a', // 경험치 = 녹색 (2026-09-02 사용자 지정)
      ms: cfg.ms,
    });
  }

  /** 골드 획득 — 놓여 있던 자리에서 XP 와 같은 연출로 떠오른다 (금색) */
  spawnGoldNumber(x: number, y: number, z: number, amount: number): void {
    const cfg = balance.hud.xpPop; // '같은 연출' — XP 와 크기·시간·움직임을 공유한다
    this.spawnFloatText(x, y, z, `◆ +${Math.round(amount)}`, {
      sizeM: cfg.sizeM,
      color: '#ffe135', // 골드 = 노란색 (2026-09-02 사용자 지정)
      ms: cfg.ms,
    });
  }

  private spawnFloatText(
    x: number, y: number, z: number, text: string,
    opt: { sizeM: number; color: string; ms: number },
  ): void {
    const font = "900 64px 'Arial Black', sans-serif";
    const canvas = document.createElement('canvas');
    const c2 = canvas.getContext('2d');
    if (!c2) return;
    c2.font = font;
    const w = Math.ceil(c2.measureText(text).width) + 26;
    canvas.width = w;
    canvas.height = 88;
    c2.font = font; // 캔버스 크기를 바꾸면 컨텍스트가 초기화된다
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.lineWidth = 10;
    c2.lineJoin = 'round';
    c2.strokeStyle = 'rgba(12,9,6,0.9)';
    c2.strokeText(text, w / 2, 46);
    c2.fillStyle = opt.color;
    c2.fillText(text, w / 2, 46);
    const mat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthTest: false, // 몸통·벽 모서리에 잘리지 않게 — 락온 마커와 같은 규칙
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 998;
    sprite.scale.set(opt.sizeM * (w / 88), opt.sizeM, 1);
    // 연타가 같은 자리에 겹치지 않게 옆으로 살짝 흩는다
    sprite.position.set(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5);
    this.scene.add(sprite);
    this.damagePops.push({ sprite, y0: y, bornMs: performance.now(), ms: opt.ms });
  }

  private updateDamagePops(now: number): void {
    const cfg = balance.hud.damageNumbers;
    for (let i = this.damagePops.length - 1; i >= 0; i--) {
      const p = this.damagePops[i]!;
      const f = (now - p.bornMs) / p.ms;
      if (f >= 1) {
        this.scene.remove(p.sprite);
        p.sprite.material.map?.dispose();
        p.sprite.material.dispose();
        this.damagePops.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - f) * (1 - f); // 빠르게 떴다가 끝에서 느려진다
      p.sprite.position.y = p.y0 + ease * cfg.riseM;
      p.sprite.material.opacity = f < 0.65 ? 1 : (1 - f) / 0.35;
    }
  }

  private spawnBurnEmber(x: number, z: number, radius: number, height: number): void {
    const size = 0.035 + Math.random() * 0.045;
    const color = BURN_EMBER_COLORS[Math.floor(Math.random() * BURN_EMBER_COLORS.length)]!;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }),
    );
    const angle = Math.random() * Math.PI * 2;
    const r = radius * (0.2 + Math.random() * 0.8);
    this.particles.push({
      mesh,
      ox: x + Math.cos(angle) * r,
      oy: height * (0.15 + Math.random() * 0.75),
      oz: z + Math.sin(angle) * r,
      vx: (Math.random() - 0.5) * 0.35,
      vy: 0.8 + Math.random() * 0.9, // 위로 천천히
      vz: (Math.random() - 0.5) * 0.35,
      bornMs: performance.now(),
      lifeMs: BURN_EMBER_LIFE_MS,
      gravity: -0.6, // 살짝 가속해 올라간다
    });
    this.scene.add(mesh);
  }

  /** 해머 적중 — 몸 전체가 아주 빠르게 명멸한다 */
  /** 뇌창에 맞았다 — 몸에 전류가 흐른다. 맞을 때마다 시간을 다시 채운다 */
  electrifyEnemy(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (visual) visual.zapUntil = performance.now() + ZAP_BODY_MS;
  }

  /** 헤드샷 — 머리가 젖혀지는 연출을 켠다 */
  headshotFlinch(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (visual) visual.headShakeUntil = performance.now() + HEADSHOT_SHAKE_MS;
  }

  /** 헤드샷 처치 — 머리가 떨어져 나가 포물선으로 튄다.
   *  본체 파편(spawnDeathBurst)과 별개로, 그 적의 머리와 같은 크기·색의 상자 하나가
   *  높이 솟았다 떨어진다. 거미는 머리가 따로 없어 제외 */
  spawnHeadPop(enemyType: string, x: number, z: number): void {
    if (SPIDER_TYPES.has(enemyType) || SLIME_TYPES.has(enemyType) || enemyType === 'leech' || enemyType === 'bat') return; // 머리가 없다
    const def = enemyDef(enemyType);
    const headSize = def.radius * 0.9;
    const color = new THREE.Color(ENEMY_COLORS[enemyType] ?? ENEMY_COLOR_FALLBACK).multiplyScalar(
      HEAD_DARKEN,
    );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(headSize, headSize, headSize),
      new THREE.MeshLambertMaterial({ color, transparent: true }), // 끝 페이드용
    );
    // 눈 — 살아 있을 때와 같은 안광이 붙은 채로 굴러간다 (죽는 순간 빛이 꺼진 붉은 눈)
    const ec = balance.lighting.enemyEyes;
    const eyeR = def.radius * ec.radiusMul;
    const eyeMat = new THREE.MeshLambertMaterial({
      color: 0x1a0505,
      emissive: new THREE.Color(ec.color),
      emissiveIntensity: 0.5, // 살아 있을 때보다 흐리게 — 꺼져 가는 눈
    });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 6, 5), eyeMat);
      eye.position.set(side * headSize * ec.spacingMul, headSize * 0.08, -headSize / 2);
      mesh.add(eye);
    }
    const ang = Math.random() * Math.PI * 2;
    const ox = x;
    const oy = def.height - headSize / 2; // 머리가 있던 그 높이에서
    const oz = z;
    mesh.position.set(ox, oy, oz);
    this.particles.push({
      mesh,
      ox, oy, oz,
      vx: Math.cos(ang) * (1.2 + Math.random() * 1.6),
      vy: 3.6 + Math.random() * 1.4, // 위로 솟았다가
      vz: Math.sin(ang) * (1.2 + Math.random() * 1.6),
      gravity: 9,
      lifeMs: 4600, // 날아가는 ~1초 + 바닥에 3초쯤 머문 뒤 사라진다
      restY: headSize / 2, // 바닥에 닿으면 그 자리에 눕는다
      bornMs: performance.now(),
      faceCamera: true, // 마구 구르는 대신 얼굴이 이쪽을 본다
    });
    this.scene.add(mesh);
  }

  /** 튀는 구울 머리 — id 키 동기화. 회전은 튄 방향으로 천천히 구른다 */
  private readonly headPropVisuals = new Map<number, THREE.Group>();

  syncGhoulHeads(heads: { id: number; x: number; y: number; z: number; vx: number; vz: number }[] | undefined): void {
    const seen = new Set<number>();
    const now = performance.now();
    for (const head of heads ?? []) {
      seen.add(head.id);
      let group = this.headPropVisuals.get(head.id);
      if (!group) {
        group = new THREE.Group();
        const def = enemyDef('ghoul');
        const headSize = def.radius * 0.9;
        const color = new THREE.Color(ENEMY_COLORS['ghoul']!).multiplyScalar(HEAD_DARKEN);
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(headSize, headSize, headSize),
          new THREE.MeshLambertMaterial({ color }),
        );
        group.add(mesh);
        const ec = balance.lighting.enemyEyes;
        const eyeR = def.radius * ec.radiusMul;
        const eyeMat = new THREE.MeshLambertMaterial({
          color: 0x1a0505,
          emissive: new THREE.Color(ec.color),
          emissiveIntensity: 0.4, // 죽었는데도 희미하게 — 그래서 더 기분 나쁘다
        });
        for (const side of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 6, 5), eyeMat);
          eye.position.set(side * headSize * ec.spacingMul, headSize * 0.08, -headSize / 2);
          group.add(eye);
        }
        this.scene.add(group);
        this.headPropVisuals.set(head.id, group);
      }
      group.position.set(head.x, head.y, head.z);
      // 얼굴이 카메라 쪽을 힐끗거린다 — 통통 튀는 리듬에 맞춰 갸웃
      group.rotation.set(
        Math.sin(now / 180 + head.id) * 0.25,
        Math.atan2(-(this.camera.position.x - head.x), -(this.camera.position.z - head.z)),
        Math.sin(now / 240 + head.id * 2) * 0.2,
      );
    }
    for (const [id, group] of this.headPropVisuals) {
      if (seen.has(id)) continue;
      this.disposeGroup(group);
      this.headPropVisuals.delete(id);
    }
  }

  /** 점액 장판 시각 — id 키 동기화. 마르는(수명↓) 동안 옅어진다 */
  private readonly gooVisuals = new Map<number, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }>();

  syncGoo(
    puddles: { id: number; x: number; z: number; ticks: number }[] | undefined,
    lifeTicks: number,
  ): void {
    const seen = new Set<number>();
    for (const goo of puddles ?? []) {
      seen.add(goo.id);
      let v = this.gooVisuals.get(goo.id);
      if (!v) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0x49c06a,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 12), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(goo.x, 0.02, goo.z);
        mesh.scale.set(balance.goo.radius, balance.goo.radius, 1);
        this.scene.add(mesh);
        v = { mesh, mat };
        this.gooVisuals.set(goo.id, v);
      }
      v.mat.opacity = 0.28 * Math.min(1, goo.ticks / (lifeTicks * 0.35));
    }
    for (const [id, v] of this.gooVisuals) {
      if (seen.has(id)) continue;
      v.mesh.removeFromParent();
      v.mesh.geometry.dispose();
      v.mat.dispose();
      this.gooVisuals.delete(id);
    }
  }

  /** 얼굴 거머리 표시 — 매 프레임 호출. 붙어 있으면 카메라 앞 실물이 꿈틀거린다 */
  setFaceLeech(on: boolean): void {
    if (on && !this.faceLeechRig) {
      this.faceLeechRig = buildFaceLeechRig();
      this.faceLeechRig.position.set(0, -0.02, -0.3);
      this.camera.add(this.faceLeechRig);
    }
    if (this.faceLeechRig) {
      this.faceLeechRig.visible = on;
      if (on) {
        const now = performance.now();
        animateFaceLeechRig(this.faceLeechRig, now, now - this.faceLeechSuckAt);
      }
    }
  }

  /** 흡혈 순간 — 리그가 훅 조인다 */
  pulseFaceLeech(): void {
    this.faceLeechSuckAt = performance.now();
  }

  flashEnemyHit(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (visual) visual.hitFlashUntil = performance.now() + HIT_FLASH_MS;
  }

  /** 방패 파괴 — 판이 조각나 튀고, 화염구가 남긴 불티가 흩날린다 */
  shatterShield(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (!visual?.shield) return;
    const shield = visual.shield;
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(shield).getSize(size);
    const origin = shield.getWorldPosition(new THREE.Vector3());
    const yaw = visual.group.rotation.y;

    // 방패 본체 제거 — 이후 업데이트에서도 건너뛴다
    this.scene.remove(shield);
    visual.torso.remove(shield);
    // 판에 매달린 것들(균열·꽂힌 화살)도 함께 정리한다 — 판만 dispose 하면
    // 자식 지오메트리가 남는다. 판이 조각나면 박혀 있던 화살도 같이 사라지는 게 맞다
    shield.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    visual.shieldMaterial?.dispose();
    visual.shield = undefined;
    visual.shieldMaterial = undefined;
    visual.shieldCracks = undefined;
    visual.shieldArrows = undefined;

    const now = performance.now();
    // 판을 3×4 격자로 쪼갠 조각들 — 원래 자리에서 앞쪽으로 터져 나간다
    const cols = 3;
    const rows = 4;
    const fw = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const w = (size.x / cols) * 0.86;
        const h = (size.y / rows) * 0.86;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, 0.07),
          new THREE.MeshLambertMaterial({
            color: SHIELD_COLOR,
            transparent: true,
            opacity: 1,
            emissive: 0x552200, // 화염에 달궈진 가장자리
            emissiveIntensity: 0.5,
          }),
        );
        const offX = (c - (cols - 1) / 2) * (size.x / cols);
        const offY = (r - (rows - 1) / 2) * (size.y / rows);
        mesh.rotation.y = yaw;
        const burst = 2.2 + Math.random() * 2.6;
        this.particles.push({
          mesh,
          ox: origin.x + Math.cos(yaw) * offX,
          oy: origin.y + offY,
          oz: origin.z - Math.sin(yaw) * offX,
          // 플레이어 쪽(방패 정면)으로 터지고 좌우로 흩어진다
          vx: fw * burst + (Math.random() - 0.5) * 2.4,
          vy: 1.2 + Math.random() * 3.2 + offY * 1.5,
          vz: fz * burst + (Math.random() - 0.5) * 2.4,
          bornMs: now,
          lifeMs: 1100,
          spinX: (Math.random() - 0.5) * 14,
          spinY: (Math.random() - 0.5) * 14,
          spinZ: (Math.random() - 0.5) * 14,
        });
        this.scene.add(mesh);
      }
    }

    // 불티 — 작고 밝고 짧게, 위로 흩날린다
    for (let i = 0; i < 12; i++) {
      const size2 = 0.04 + Math.random() * 0.05;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size2, size2, size2),
        new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 1 }),
      );
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 3;
      this.particles.push({
        mesh,
        ox: origin.x,
        oy: origin.y,
        oz: origin.z,
        vx: Math.cos(angle) * speed,
        vy: 2.5 + Math.random() * 3.5,
        vz: Math.sin(angle) * speed,
        bornMs: now,
        lifeMs: 620,
        gravity: 4.5, // 불티는 천천히 떨어진다
      });
      this.scene.add(mesh);
    }

    this.triggerFlash(origin.x, origin.y, origin.z, 0xff7a2a, 260, 6);
  }

  /** 적 사망 파편 폭발 — 몸통 색 조각들이 튀어 흩어진다. power>1 이면 더 많이·세게 */
  /** 사망 파편. launch 를 주면 (dirX,dirZ) 쪽으로 쏠려 날아간다 —
   *  폭발에 죽은 적은 밀려날 몸이 남지 않으므로(래그돌 없음) 파편이 대신 날아간다 */
  /** 타격 피 파편 — 맞은 지점(y)에서 공격 방향 원뿔로 튄다. 개수는 피해량 비례,
   *  헤드샷·강타 배율. 일부 방울은 착지해 바닥 얼룩이 된다.
   *  죽는 타격은 사망 파편(spawnDeathBurst) 몫 — main 이 살아 있는 적에게만 부른다 */
  spawnHitBlood(
    x: number,
    z: number,
    y: number,
    dirX: number,
    dirZ: number,
    enemyType: string,
    hit: { damage: number; headshot?: boolean; heavy?: boolean; death?: boolean; sizeMul?: number },
  ): void {
    const cfg = balance.hitBlood;
    const color = bloodColorOf(enemyType);
    const now = performance.now();
    let count = cfg.countMin + hit.damage * cfg.countPerDamage;
    if (hit.headshot) count *= cfg.headshotMul;
    if (hit.heavy) count *= cfg.heavyMul;
    if (hit.death) count *= cfg.deathMul;
    const baseAng = Math.atan2(dirZ, dirX);
    const coneRad = (cfg.coneDeg * Math.PI) / 180;
    for (let i = 0; i < Math.min(cfg.countMax, Math.round(count)); i++) {
      const size = (cfg.sizeMin + Math.random() * cfg.sizeSpan) * (hit.sizeMul ?? 1);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 }),
      );
      const ang = baseAng + (Math.random() - 0.5) * coneRad;
      const speed = cfg.speedMin + Math.random() * cfg.speedSpan;
      const particle: Particle = {
        mesh,
        ox: x,
        oy: y + (Math.random() - 0.5) * 0.24,
        oz: z,
        vx: Math.cos(ang) * speed,
        vy: cfg.upKickMin + Math.random() * cfg.upKickSpan,
        vz: Math.sin(ang) * speed,
        bornMs: now,
        lifeMs: cfg.lifeMs,
        restY: size / 2,
        stainColor: Math.random() < cfg.stain.chance ? color : undefined,
      };
      mesh.position.set(particle.ox, particle.oy, particle.oz);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.particles.push(particle);
      this.scene.add(mesh);
    }
  }

  /** 초음파 비명 파문 — 입에서 고리 셋이 시차를 두고 먹이 쪽으로 밀려 나가며 커지고 옅어진다 */
  spawnSonicScream(x: number, z: number, y: number, dirX: number, dirZ: number): void {
    const now = performance.now();
    const yaw = Math.atan2(dirX, dirZ);
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.16, 0.022, 6, 20),
        new THREE.MeshBasicMaterial({
          color: 0xbfe8ff,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        }),
      );
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw; // 고리 면(법선 +Z)이 진행 방향을 본다
      mesh.visible = false; // bornMs 가 미래인 고리는 그때부터
      this.scene.add(mesh);
      this.sonicWaves.push({ mesh, bornMs: now + i * 110, dirX, dirZ, ox: x, oy: y, oz: z });
    }
  }

  private updateSonicWaves(now: number): void {
    const LIFE = 520;
    for (let i = this.sonicWaves.length - 1; i >= 0; i--) {
      const w = this.sonicWaves[i]!;
      const age = now - w.bornMs;
      if (age < 0) {
        w.mesh.visible = false;
        continue;
      }
      if (age > LIFE) {
        this.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        (w.mesh.material as THREE.Material).dispose();
        this.sonicWaves.splice(i, 1);
        continue;
      }
      w.mesh.visible = true;
      const t = age / LIFE;
      const travel = t * 3.4;
      w.mesh.position.set(w.ox + w.dirX * travel, w.oy, w.oz + w.dirZ * travel);
      const s = 0.5 + t * 3.2;
      w.mesh.scale.set(s, s, s);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
    }
  }

  /** 바닥 핏자국 — 납작한 얼룩이 잠시 남았다 옅어진다. 상한을 넘으면 오래된 것부터 걷는다 */
  private spawnBloodStain(x: number, z: number, color: number): void {
    const cfg = balance.hitBlood.stain;
    while (this.bloodStains.length >= cfg.max) this.removeBloodStain(0);
    const r = cfg.radiusMin + Math.random() * cfg.radiusSpan;
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(r, 10),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        depthWrite: false, // 바닥 위 겹침에서 z-파이팅을 피한다
      }),
    );
    // Euler XYZ 는 z(제자리 회전)부터 적용된다 — 그다음 x 로 눕힌다
    mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    mesh.scale.x = 0.65 + Math.random() * 0.7; // 찌그러진 얼룩 — 정직한 원은 스티커 같다
    mesh.position.set(x, 0.012 + Math.random() * 0.004, z);
    this.scene.add(mesh);
    this.bloodStains.push({ mesh, bornMs: performance.now() });
  }

  private removeBloodStain(index: number): void {
    const s = this.bloodStains[index];
    if (!s) return;
    this.scene.remove(s.mesh);
    s.mesh.geometry.dispose();
    (s.mesh.material as THREE.Material).dispose();
    this.bloodStains.splice(index, 1);
  }

  /** 매 프레임 — 수명이 끝나가는 핏자국을 옅게 하고 걷는다 */
  private updateBloodStains(): void {
    if (this.bloodStains.length === 0) return;
    const cfg = balance.hitBlood.stain;
    const now = performance.now();
    for (let i = this.bloodStains.length - 1; i >= 0; i--) {
      const s = this.bloodStains[i]!;
      const age = now - s.bornMs;
      if (age > cfg.lifeMs) {
        this.removeBloodStain(i);
        continue;
      }
      (s.mesh.material as THREE.MeshBasicMaterial).opacity =
        0.7 * Math.min(1, (cfg.lifeMs - age) / cfg.fadeMs);
    }
  }

  spawnDeathBurst(
    x: number,
    z: number,
    enemyType: string,
    power = 1,
    dirX = 0,
    dirZ = 0,
    launch = 0,
  ): void {
    const def = enemyDef(enemyType);
    const color = ENEMY_COLORS[enemyType] ?? ENEMY_COLOR_FALLBACK;
    const now = performance.now();
    const len = Math.hypot(dirX, dirZ);
    const lx = len > 0 ? dirX / len : 0;
    const lz = len > 0 ? dirZ / len : 0;
    for (let i = 0; i < Math.round(DEATH_PARTICLE_COUNT * power); i++) {
      const size = (0.08 + Math.random() * 0.12) * (power > 1 ? 1.25 : 1);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 }),
      );
      const angle = Math.random() * Math.PI * 2;
      const speed = (1.5 + Math.random() * 3.5) * power;
      // 흩어지는 성분은 남기고 날아가는 성분을 얹는다 — 전부 한 방향이면
      // 파편이 아니라 화살처럼 보인다
      const kick = launch * (0.55 + Math.random() * 0.9);
      const particle: Particle = {
        mesh,
        ox: x,
        oy: def.height * (0.3 + Math.random() * 0.6),
        oz: z,
        vx: Math.cos(angle) * speed + lx * kick,
        vy: (2 + Math.random() * 4) * power + launch * 0.25,
        vz: Math.sin(angle) * speed + lz * kick,
        bornMs: now,
      };
      mesh.position.set(particle.ox, particle.oy, particle.oz);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.particles.push(particle);
      this.scene.add(mesh);
    }
  }

  /** 바닥 아이템 비주얼 — 각인(팔면체 보석) / 포션(붉은 약병) / 골드(낮은 더미) */
  private makeGroundItem(kind: GroundItemState['kind'], sigilId?: string): THREE.Group {
    const group = new THREE.Group();
    if (kind === 'grave') {
      // 비석 — 봉분 위 잿빛 돌판 + 둥근 머리. 돌이라 부유·회전하지 않는다 (grounded)
      const stone = new THREE.MeshLambertMaterial({ color: 0x8b8f96 });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.13), stone);
      slab.position.y = 0.36;
      group.add(slab);
      // 둥근 머리 — 축을 눕힌 원기둥. 아래 절반은 돌판에 묻힌다
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.13, 12), stone);
      top.rotation.x = Math.PI / 2;
      top.position.y = 0.67;
      group.add(top);
      const mound = new THREE.Mesh(
        new THREE.BoxGeometry(0.66, 0.12, 0.44),
        new THREE.MeshLambertMaterial({ color: 0x4a4038 }),
      );
      mound.position.y = 0.06;
      group.add(mound);
      return group;
    }
    if (kind === 'key') {
      // 족장의 열쇠 — 금빛 고리 + 대 + 이빨 둘. 부유·회전은 syncGroundItems 가 준다
      const gold = new THREE.MeshLambertMaterial({
        color: KEY_COLOR,
        emissive: KEY_COLOR,
        emissiveIntensity: 0.55,
      });
      const key = new THREE.Group();
      key.name = 'gem';
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 8, 14), gold);
      bow.position.y = 0.14;
      key.add(bow);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.3, 6), gold);
      shaft.position.y = -0.06;
      key.add(shaft);
      for (const [ty, tw] of [
        [-0.18, 0.1],
        [-0.11, 0.075],
      ] as const) {
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.045, 0.045), gold);
        tooth.position.set(tw / 2 + 0.028, ty, 0);
        key.add(tooth);
      }
      group.add(key);
      group.add(new THREE.PointLight(KEY_COLOR, 0.9, 5, 0));
    } else if (kind === 'potion' || kind === 'mana') {
      const color = kind === 'mana' ? MANA_POTION_COLOR : POTION_COLOR;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.13, 0.24, 8),
        new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.5 }),
      );
      body.name = 'gem';
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.1, 6),
        new THREE.MeshLambertMaterial({ color: POTION_GLASS }),
      );
      neck.position.y = 0.16;
      body.add(neck);
      group.add(body);
      group.add(new THREE.PointLight(color, 0.8, 4.5, 0));
    } else if (kind === 'arrow') {
      // 회수 화살 — 날아가던 화살과 같은 실루엣(샤프트 + 회색 촉)이라
      // "저기 내가 쏜 것"이 바로 읽힌다. 바닥에 눕혀 둔다
      const piece = new THREE.Group();
      piece.name = 'gem';
      const shaft = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.62),
        new THREE.MeshLambertMaterial({ color: 0x6b5233 }),
      );
      piece.add(shaft);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, 0.12),
        new THREE.MeshLambertMaterial({
          color: 0xb9c0c9,
          emissive: 0xb9c0c9,
          emissiveIntensity: 0.35,
        }),
      );
      head.position.z = -0.35;
      piece.add(head);
      // 샤프트는 이미 로컬 Z(수평)로 뻗어 있다 — 여기서 X 로 90도 돌리면
      // 오히려 세워져 바닥을 뚫는다 (실측: 높이 0.46m, 바닥 아래 -0.09m).
      // 눕힌 채로 두고 syncGroundItems 의 Y 회전만 받는다
      group.add(piece);
      group.add(new THREE.PointLight(0xb9c0c9, 0.35, 3.0, 0));
    } else if (kind === 'food') {
      // 음식 — 약병과 헷갈리지 않게 뼈다귀 고기. 뼈가 살점을 관통해 한 덩어리로 보인다.
      // 회전·축소는 'gem' 그룹에만 걸린다 — 살점의 납작한 비율(scale)이 뼈까지
      // 일그러뜨리지 않게 살점과 뼈를 형제로 둔다
      const piece = new THREE.Group();
      piece.name = 'gem';

      const meat = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 10, 8),
        new THREE.MeshLambertMaterial({
          color: FOOD_COLOR,
          emissive: FOOD_COLOR,
          emissiveIntensity: 0.3,
        }),
      );
      meat.scale.set(1.0, 0.82, 0.86);
      piece.add(meat);

      // 뼈 — 자기 축(+Y)으로 만들고 마디를 양 끝에 붙인 뒤 통째로 눕힌다.
      // 마디를 회전 뒤 좌표로 따로 놓으면 축 계산이 어긋나 뼈에서 떨어져 보인다
      const boneMat = new THREE.MeshLambertMaterial({
        color: FOOD_BONE,
        emissive: FOOD_BONE,
        emissiveIntensity: 0.18,
      });
      // 살점 지름(0.3)보다 충분히 길어야 대(shaft)가 밖으로 드러난다 —
      // 짧으면 대가 살점에 다 묻혀 마디만 둥둥 떠 보인다 (실측으로 확인)
      const bone = new THREE.Group();
      const boneLen = 0.56;
      bone.add(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, boneLen, 6), boneMat));
      for (const end of [-1, 1]) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 6), boneMat);
        knob.position.y = (end * boneLen) / 2;
        knob.scale.set(1, 0.82, 1);
        bone.add(knob);
      }
      bone.rotation.z = Math.PI / 2 - 0.42; // 살점을 비스듬히 꿰뚫는다
      piece.add(bone);

      group.add(piece);
      group.add(new THREE.PointLight(FOOD_COLOR, 0.45, 3.5, 0));
    } else if (kind === 'ammo') {
      // 권총탄 — 놋쇠 상자 두 개
      const brass = new THREE.MeshLambertMaterial({
        color: 0xc9a54a, emissive: 0xc9a54a, emissiveIntensity: 0.3,
      });
      for (const off of [-0.07, 0.07]) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.2), brass);
        box.position.set(off, 0.05, off * 0.4);
        box.rotation.y = off * 6;
        group.add(box);
      }
      group.add(new THREE.PointLight(0xc9a54a, 0.4, 3, 0));
    } else if (kind === 'grenade') {
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0x3d4a38, emissive: 0x223022, emissiveIntensity: 0.4 }),
      );
      shell.position.y = 0.13;
      group.add(shell);
      group.add(new THREE.PointLight(0x86b06a, 0.4, 3, 0));
    } else if (kind === 'battery') {
      const cell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.2, 10),
        new THREE.MeshLambertMaterial({ color: 0xd8c23a, emissive: 0xd8c23a, emissiveIntensity: 0.4 }),
      );
      cell.position.y = 0.1;
      group.add(cell);
      group.add(new THREE.PointLight(0xd8c23a, 0.4, 3, 0));
    } else if (kind === 'gold') {
      const pile = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.17, 0.12, 7),
        new THREE.MeshLambertMaterial({
          color: GOLD_COLOR,
          emissive: GOLD_COLOR,
          emissiveIntensity: 0.4,
        }),
      );
      pile.name = 'gem';
      group.add(pile);
      group.add(new THREE.PointLight(GOLD_COLOR, 0.5, 3.5, 0));
    } else {
      // 각인 — 종류마다 색이 다르다. 어둠 속에서 점광원 색만 보고도 무엇인지 안다
      const color = sigilId ? sigilColor(sigilId) : GROUND_ITEM_COLOR;
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        new THREE.MeshLambertMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.55,
        }),
      );
      gem.name = 'gem';
      group.add(gem);
      group.add(new THREE.PointLight(color, 0.9, 5, 0));
    }
    return group;
  }

  private updateParticles(): void {
    const now = performance.now();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      const age = (now - p.bornMs) / 1000;
      const lifeFrac = (now - p.bornMs) / (p.lifeMs ?? DEATH_PARTICLE_LIFE_MS);
      if (lifeFrac >= 1) {
        // 자식까지 걷는다 — 떨어져 나간 머리에는 눈이 붙어 있다
        this.disposeGroup(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      const ballisticY = p.oy + p.vy * age - 0.5 * (p.gravity ?? DEATH_GRAVITY) * age * age;
      if (p.restY !== undefined && p.landedAtAge === undefined && ballisticY <= p.restY && age > 0.1) {
        // 착지 — 그 자리에 눕는다. 더 미끄러지지 않는다
        p.landedAtAge = age;
        p.landedX = p.ox + p.vx * age;
        p.landedZ = p.oz + p.vz * age;
        if (p.stainColor !== undefined) this.spawnBloodStain(p.landedX, p.landedZ, p.stainColor);
      }
      if (p.landedAtAge !== undefined) {
        p.mesh.position.set(p.landedX ?? p.ox, p.restY ?? 0.04, p.landedZ ?? p.oz);
      } else {
        p.mesh.position.set(p.ox + p.vx * age, Math.max(0.04, ballisticY), p.oz + p.vz * age);
      }
      if (p.faceCamera) {
        // 얼굴이 카메라를 본다 — 눈이 계속 보이게. 나는 동안은 끄덕이고,
        // 착지하면 거의 가만히 놓인다 (바닥의 머리가 계속 흔들리면 이상하다)
        const wob = p.landedAtAge !== undefined ? 0.15 : 1;
        p.mesh.rotation.set(
          Math.sin(age * 5) * 0.28 * wob,
          Math.atan2(
            -(this.camera.position.x - p.mesh.position.x),
            -(this.camera.position.z - p.mesh.position.z),
          ),
          Math.sin(age * 3.4) * 0.2 * wob,
        );
      } else if (p.spinX || p.spinY || p.spinZ) {
        p.mesh.rotation.set(
          p.mesh.rotation.x + (p.spinX ?? 0) * 0.016,
          p.mesh.rotation.y + (p.spinY ?? 0) * 0.016,
          p.mesh.rotation.z + (p.spinZ ?? 0) * 0.016,
        );
      }
      // 눕는 파편(머리)은 끝 0.4초에만 옅어진다 — 그 전엔 또렷이 바닥에 남는다
      (p.mesh.material as THREE.MeshLambertMaterial).opacity =
        p.restY !== undefined
          ? Math.min(1, ((p.lifeMs ?? DEATH_PARTICLE_LIFE_MS) - (now - p.bornMs)) / 400)
          : 1 - lifeFrac * lifeFrac;
    }
  }

  /** 바닥 각인 — 떠서 회전하는 금색 팔면체 + 점광원 */
  /** 생명 입자 — 가산 발광 스프라이트. 제자리에서 까딱이다 자석에 걸리면 작아지며 날아온다.
   *  수명 끝 fadeTicks 동안 옅어져 갑자기 꺼지지 않는다 */
  syncLifeMotes(motes: LifeMoteState[]): void {
    const cfg = balance.lifeMotes;
    const now = performance.now();
    const seen = new Set<number>();
    for (const m of motes) {
      seen.add(m.id);
      let sprite = this.lifeMoteVisuals.get(m.id);
      if (!sprite) {
        sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: getGlowTexture(),
            color: new THREE.Color(cfg.color),
            transparent: true,
            opacity: cfg.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        sprite.scale.set(cfg.size, cfg.size, 1);
        this.lifeMoteVisuals.set(m.id, sprite);
        this.scene.add(sprite);
      }
      const bob = m.homing ? 0 : Math.sin(now / 300 + m.id) * 0.06;
      sprite.position.set(m.x, m.y + bob, m.z);
      const left = cfg.lifeTicks - m.ageTicks;
      const fade = m.homing ? 1 : Math.min(1, left / cfg.fadeTicks);
      const pulse = 1 + Math.sin(now / 160 + m.id * 1.7) * 0.12;
      const size = cfg.size * (m.homing ? 0.7 : pulse);
      sprite.scale.set(size, size, 1);
      sprite.material.opacity = cfg.opacity * fade;
    }
    for (const [id, sprite] of this.lifeMoteVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(sprite);
      sprite.material.dispose();
      this.lifeMoteVisuals.delete(id);
    }
  }

  syncGroundItems(items: GroundItemState[]): void {
    const now = performance.now();
    const seen = new Set<number>();
    for (const item of items) {
      seen.add(item.id);
      let group = this.groundItemVisuals.get(item.id);
      if (!group) {
        group = this.makeGroundItem(item.kind, item.sigilId);
        this.groundItemVisuals.set(item.id, group);
        this.scene.add(group);
      }
      // 자석에 걸리면 로직이 계산한 높이(item.y)로 날아간다. 아니면 제자리 부유
      // 골드·화살은 바닥에 놓인 물건이라 떠서 흔들리지 않는다.
      // 화살은 눕혀 둔 것이라 물약처럼 가슴 높이에서 까딱거리면 안 된다
      const grounded =
        item.kind === 'gold' || item.kind === 'arrow' || item.kind === 'grave' ||
        item.kind === 'ammo' || item.kind === 'grenade' || item.kind === 'battery';
      const bob =
        item.y ??
        (grounded ? (item.kind === 'gold' ? 0.12 : item.kind === 'grave' ? 0 : GROUND_ARROW_Y)
                  : 0.55 + Math.sin(now / 400 + item.id) * 0.1);
      group.position.set(item.x, bob, item.z);
      const gem = group.getObjectByName('gem');
      // 빨려드는 동안은 빠르게 회전하고 살짝 작아진다 (몸으로 들어가는 느낌)
      // 화살도 골드처럼 아주 느리게만 돈다 — 빙글빙글 돌면 주울 물건이 아니라
      // 장식으로 보인다
      if (gem) gem.rotation.y = now / (item.magnet ? 90 : grounded ? 1400 : 700);
      const shrink = item.magnet ? 0.78 : 1;
      group.scale.setScalar(group.scale.x + (shrink - group.scale.x) * 0.25);
    }
    for (const [id, group] of this.groundItemVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(group);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.groundItemVisuals.delete(id);
    }
  }

  /** 보물상자 — 열면 뚜껑이 젖혀지고 속에서 금빛이 새어 나온다 */
  syncChests(chests: ChestState[]): void {
    for (const chest of chests) {
      let visual = this.chestVisuals.get(chest.id);
      if (!visual) {
        visual = this.makeChest();
        visual.group.position.set(chest.x, 0, chest.z);
        this.chestVisuals.set(chest.id, visual);
        this.scene.add(visual.group);
      }
      // 뚜껑은 열림 상태로 부드럽게 젖혀진다 (한 번 열리면 되돌아오지 않는다)
      const target = chest.opened ? -CHEST_LID_OPEN : 0;
      visual.lid.rotation.x += (target - visual.lid.rotation.x) * 0.18;
      const glow = visual.group.getObjectByName('glow') as THREE.PointLight | undefined;
      if (glow) glow.intensity = chest.opened ? 0.35 : 1.1;
    }
    // 배열에서 사라진 상자 — 모형을 걷는다. 한 층 안에서는 상자가 사라질 일이 없어
    // 이 경로가 없었는데, 층 교체(clearLevelFx 의 빈 배열 동기화)가 이걸 기대한다.
    // 없으면 앞 층 상자의 겉모습이 새 층에 유령으로 남는다 — 열린 뚜껑째로 (1-2 실측)
    const seen = new Set(chests.map((chest) => chest.id));
    for (const [id, visual] of this.chestVisuals) {
      if (seen.has(id)) continue;
      this.disposeGroup(visual.group);
      this.chestVisuals.delete(id);
    }
  }

  private makeChest(): { group: THREE.Group; lid: THREE.Object3D } {
    const group = new THREE.Group();
    const w = CHEST_W;
    const d = CHEST_D;
    const h = CHEST_H;
    const wood = new THREE.MeshLambertMaterial({ color: CHEST_WOOD });
    const trim = new THREE.MeshLambertMaterial({
      color: CHEST_TRIM,
      emissive: CHEST_TRIM,
      emissiveIntensity: 0.35,
    });

    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
    box.position.y = h / 2;
    group.add(box);
    // 금속 띠 — 어둠 속에서 상자를 상자로 읽게 하는 단서
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, h * 0.16, d * 1.04), trim);
    band.position.y = h * 0.5;
    group.add(band);

    // 뚜껑 — 뒤쪽 모서리를 축으로 젖혀지도록 피벗을 따로 둔다
    const lid = new THREE.Group();
    lid.position.set(0, h, -d / 2);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.28, d), wood);
    lidMesh.position.set(0, h * 0.14, d / 2);
    lid.add(lidMesh);
    const lidBand = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, h * 0.1, d * 0.3), trim);
    lidBand.position.set(0, h * 0.28, d / 2);
    lid.add(lidBand);
    group.add(lid);

    const glow = new THREE.PointLight(CHEST_TRIM, 1.1, 6, 0);
    glow.name = 'glow';
    glow.position.y = h * 0.8;
    group.add(glow);
    return { group, lid };
  }

  /** 폭발통 — 도화선이 돌면 띠가 점점 빠르게 붉게 깜빡인다.
   *  터진 통은 사라진다 (폭발 연출은 explosion 이벤트가 따로 낸다) */
/** 기믹 프리미티브 — 중세 지하 소품. 재질 단색 + 쇠띠·홈 같은 어두운 디테일 한 겹.
   *  id 로 크기·기울기에 잔변화를 준다 (군집이 도장이 안 되게) */
  private makeProp(type: string, id: number): THREE.Group {
    const group = new THREE.Group();
    const v = 0.88 + (id % 5) * 0.06; // 개체 변화
    if (type === 'prop_jar') {
      // 배불뚝이 도자기 항아리 — 굽·배·어깨·벌어진 입 + 유약 띠
      const clay = new THREE.MeshLambertMaterial({ color: 0x8f5a36 });
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.08, 10), clay);
      foot.position.y = 0.04;
      group.add(foot);
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.28 * v, 12, 9), clay);
      belly.scale.set(1, 0.95, 1);
      belly.position.y = 0.34 * v;
      group.add(belly);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.255 * v, 0.27 * v, 0.08, 12),
        new THREE.MeshLambertMaterial({ color: 0x63381e }),
      );
      band.position.y = 0.38 * v;
      group.add(band);
      const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2 * v, 0.16, 10), clay);
      shoulder.position.y = 0.6 * v;
      group.add(shoulder);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.08, 10), clay);
      rim.position.y = 0.71 * v;
      group.add(rim);
    } else if (type === 'prop_crate') {
      // 쇠띠 두른 나무 궤짝 — 몸통 + 뚜껑 턱 + 세로 쇠띠 둘 (2단 스택 변형)
      const wood = new THREE.MeshLambertMaterial({ color: 0x6e5230 });
      const iron = new THREE.MeshLambertMaterial({ color: 0x3a3d44 });
      const makeBox = (w: number, h: number, d: number, y: number, ry: number): void => {
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
        body.position.y = y + h / 2;
        body.rotation.y = ry;
        group.add(body);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(w * 1.08, 0.07, d * 1.1), wood);
        lid.position.y = y + h + 0.035;
        lid.rotation.y = ry;
        group.add(lid);
        for (const off of [-0.16, 0.16]) {
          const bandBox = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h + 0.1, 0.05), iron);
          bandBox.position.set(Math.sin(ry) * off, y + h / 2, Math.cos(ry) * off);
          bandBox.rotation.y = ry;
          group.add(bandBox);
        }
      };
      makeBox(0.68, 0.42, 0.5, 0, (id % 7) * 0.09);
      if (id % 2 === 0) makeBox(0.46, 0.32, 0.36, 0.49, 0.5 + (id % 3) * 0.2);
    } else if (type === 'prop_keg') {
      // 나무 드럼통 — 배 부른 널판 통 + 무광 테 두 줄. 폭발통(어두운 갈색·빨간 띠)과
      // 확실히 다른 밝은 꿀색 나무 — 겉만 봐서는 안에 뭐가 들었는지 모른다
      const wood = new THREE.MeshLambertMaterial({ color: 0x8a6a3e });
      const hoop = new THREE.MeshLambertMaterial({ color: 0x4a3a28 });
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.27 * v, 0.21 * v, 0.36, 11), wood);
      lower.position.y = 0.18;
      group.add(lower);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.21 * v, 0.27 * v, 0.36, 11), wood);
      upper.position.y = 0.54;
      group.add(upper);
      for (const hy of [0.2, 0.52]) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.275 * v, 0.275 * v, 0.05, 11), hoop);
        ring.position.y = hy;
        group.add(ring);
      }
      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2 * v, 0.2 * v, 0.04, 11),
        new THREE.MeshLambertMaterial({ color: 0x6e5230 }),
      );
      lid.position.y = 0.73;
      group.add(lid);
    } else if (type === 'prop_sarcophagus') {
      // 석관 — 받침단 + 관 몸체 + 밝은 뚜껑 + 뚜껑의 십자 홈
      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(1.24, 0.14, 0.74),
        new THREE.MeshLambertMaterial({ color: 0x6e747c }),
      );
      plinth.position.y = 0.07;
      group.add(plinth);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.04, 0.5, 0.58),
        new THREE.MeshLambertMaterial({ color: 0x8a8f96 }),
      );
      body.position.y = 0.39;
      group.add(body);
      const lid = new THREE.Mesh(
        new THREE.BoxGeometry(1.12, 0.14, 0.66),
        new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }),
      );
      lid.position.y = 0.71;
      group.add(lid);
      const groove = new THREE.MeshLambertMaterial({ color: 0x565c66 });
      const long = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.03, 0.08), groove);
      long.position.y = 0.785;
      group.add(long);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.5), groove);
      cross.position.set(-0.22, 0.785, 0);
      group.add(cross);
    } else {
      // prop_minecart — 널판 광차: 나무 몸통 + 위 테두리 쇠틀 + 광석 + 바퀴
      const wood = new THREE.MeshLambertMaterial({ color: 0x5d4a30 });
      const iron = new THREE.MeshLambertMaterial({ color: 0x3a3d44 });
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.44, 0.58), wood);
      hull.position.y = 0.5;
      group.add(hull);
      for (const [w, d, ox, oz] of [
        [0.98, 0.07, 0, 0.29],
        [0.98, 0.07, 0, -0.29],
        [0.07, 0.62, 0.47, 0],
        [0.07, 0.62, -0.47, 0],
      ] as const) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), iron);
        rim.position.set(ox, 0.74, oz);
        group.add(rim);
      }
      const oreMat = new THREE.MeshLambertMaterial({ color: 0x6b6f77 });
      for (const [ox, oz] of [[-0.18, 0.08], [0.14, -0.1], [0.02, 0.14]] as const) {
        const ore = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), oreMat);
        ore.position.set(ox, 0.74, oz);
        ore.rotation.y = ox * 9;
        group.add(ore);
      }
      for (const [wx, wz] of [[-0.28, 0.32], [0.28, 0.32], [-0.28, -0.32], [0.28, -0.32]] as const) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 9), iron);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(wx, 0.14, wz);
        group.add(wheel);
      }
      group.rotation.y = (id % 9) * 0.7; // 버려진 방향 제각각
    }
    group.scale.setScalar(2); // 기믹 2배 — balance 의 판정 크기와 함께 간다
    return group;
  }

  /** 기믹 동기화 — 부서지면(alive=false) 걷는다 */
  syncProps(props: { id: number; type: string; x: number; z: number; alive: boolean }[]): void {
    const seen = new Set<number>();
    for (const prop of props) {
      if (!prop.alive) continue;
      seen.add(prop.id);
      if (!this.propVisuals.has(prop.id)) {
        const group = this.makeProp(prop.type, prop.id);
        group.position.set(prop.x, 0, prop.z);
        this.propVisuals.set(prop.id, group);
        this.scene.add(group);
      }
    }
    for (const [id, group] of this.propVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(group);
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) (mesh.material as THREE.Material).dispose();
      });
      this.propVisuals.delete(id);
    }
  }

  /** 함정 — 배열 전체를 매 프레임 받아 id 로 모형을 캐시한다 (props 와 같은 규약).
   *  spent 도 남긴다(빈 노즐·내려간 가시가 보여야 "썼다"가 읽힌다) — 배열에서 빠질 때만 걷는다 */
  syncTraps(
    traps: (TrapView & { id: number; x: number; z: number; revealed?: boolean })[],
    cellSize: number,
  ): void {
    const now = performance.now();
    const seen = new Set<number>();
    for (const trap of traps) {
      seen.add(trap.id);
      let group = this.trapVisuals.get(trap.id);
      if (!group) {
        group = buildTrapGroup(trap, cellSize);
        group.position.set(trap.x, 0, trap.z);
        this.trapVisuals.set(trap.id, group);
        this.scene.add(group);
      }
      animateTrap(group, trap, now);
      if (trap.type === 'trap_net') {
        // 그물의 실은 랜턴 빔이 닿을 때만 드러난다 — 꺼져 있으면 거의 투명, 켜졌어도 빔 밖이면 희미.
        // 횃불 잔광만으로 보이던 문제(2026-09-02)의 답: 재질이 아니라 가시성 자체를 빔에 묶는다
        const line = (group.userData as Record<string, unknown>)['line'] as THREE.Mesh | undefined;
        const mat = line?.material as THREE.MeshLambertMaterial | undefined;
        if (line && mat) {
          let opacity = 0.04;
          let glow = 0;
          if (this.lanternIsOn && trap.phase === 'armed') {
            const dx = trap.x - this.camera.position.x;
            const dz = trap.z - this.camera.position.z;
            const dist = Math.hypot(dx, dz);
            const fwd = this.camera.getWorldDirection(new THREE.Vector3());
            const flat = Math.hypot(fwd.x, fwd.z) || 1;
            const cosAng = dist > 0.01 ? (dx * fwd.x + dz * fwd.z) / (dist * flat) : 1;
            const half = ((balance.lantern.angleDeg * 1.6) * Math.PI) / 180; // 반음영까지 포함
            const inBeam = cosAng > Math.cos(half) && dist < balance.lantern.radius;
            opacity = inBeam ? 1 : 0.12;
            glow = inBeam ? 0.45 : 0;
          }
          mat.opacity = opacity;
          mat.emissiveIntensity = glow;
        }
      } else if (trap.type === 'trap_oil' && trap.phase === 'firing') {
        // 불티 — 타는 동안 계속 피어오른다 (화상 적의 불티와 같은 파티클)
        const data = group.userData as Record<string, unknown>;
        const next = (data['nextEmberMs'] as number | undefined) ?? 0;
        if (now >= next) {
          data['nextEmberMs'] = now + 70;
          this.spawnBurnEmber(trap.x, trap.z, 1.4, 0.5);
        }
      }
    }
    for (const [id, group] of this.trapVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(group);
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) (mesh.material as THREE.Material).dispose();
      });
      this.trapVisuals.delete(id);
    }
  }

  /** 기믹 파편 — 재질색 조각이 와장창 쏟아진다 (사망 파편과 같은 물리).
   *  타격감은 파편 양이 만든다 — 22조각, 큰 놈 몇 개는 높이 치솟는다 */
  spawnPropDebris(x: number, z: number, color: number, height: number): void {
    const now = performance.now();
    for (let i = 0; i < 22; i++) {
      const big = i < 5; // 큰 조각 몇 개가 높이 치솟아야 '와장창'이 보인다
      const size = big ? 0.13 + Math.random() * 0.12 : 0.05 + Math.random() * 0.1;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 }),
      );
      const ang = Math.random() * Math.PI * 2;
      const speed = (big ? 1.6 : 1.4) + Math.random() * 3.0;
      const particle: Particle = {
        mesh,
        ox: x,
        oy: height * (0.2 + Math.random() * 0.8),
        oz: z,
        vx: Math.cos(ang) * speed,
        vy: (big ? 3.0 : 1.6) + Math.random() * 3.0,
        vz: Math.sin(ang) * speed,
        bornMs: now,
        lifeMs: big ? 1000 : 750,
        restY: size / 2,
        spinX: Math.random() * 8 - 4,
        spinZ: Math.random() * 8 - 4,
      };
      mesh.position.set(particle.ox, particle.oy, particle.oz);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.particles.push(particle);
      this.scene.add(mesh);
    }
  }

  /** 심지 불빛 — 잔해에서 붉게 깜빡인다. 치익 소리의 시각 짝 */
  spawnFuseGlow(x: number, z: number, ttlMs: number): void {
    const light = new THREE.PointLight(0xff3820, 2.2, 6, 0);
    light.position.set(x, 0.35, z);
    this.scene.add(light);
    this.fuseGlows.push({ light, bornMs: performance.now(), ttlMs });
  }

  private updateFuseGlows(now: number): void {
    for (let i = this.fuseGlows.length - 1; i >= 0; i--) {
      const g = this.fuseGlows[i]!;
      const age = now - g.bornMs;
      if (age > g.ttlMs) {
        this.scene.remove(g.light);
        this.fuseGlows.splice(i, 1);
        continue;
      }
      g.light.intensity = 1.4 + Math.sin(age / 30) * 1.2; // 다급한 깜빡임
    }
  }

  syncBarrels(barrels: BarrelState[]): void {
    const now = performance.now();
    const cfg = balance.barrel;
    const seen = new Set<number>();
    for (const barrel of barrels) {
      if (!barrel.alive) continue;
      seen.add(barrel.id);
      let visual = this.barrelVisuals.get(barrel.id);
      if (!visual) {
        visual = this.makeBarrel(cfg.collisionRadius, cfg.height);
        visual.group.position.set(barrel.x, 0, barrel.z);
        this.barrelVisuals.set(barrel.id, visual);
        this.scene.add(visual.group);
      }
      // 점화 전에는 잠잠하다. 다만 뇌창에 지져진 통은 전기를 먹은 만큼 띠가 푸르게
      // 물들고, 지금 지지는 중이면 빠르게 지직거린다 — 얼마나 찼는지가 보여야 한다
      if (barrel.fuseTicks < 0) {
        const charge = Math.min(1, (barrel.zapTicks ?? 0) / cfg.zapTicks);
        if (charge <= 0) {
          visual.band.emissive.set(BARREL_BAND_IDLE);
          visual.band.emissiveIntensity = 0.25;
          visual.light.intensity = 0;
          continue;
        }
        const zapping = now - (this.barrelZapAt.get(barrel.id) ?? -Infinity) < BARREL_ZAP_ACTIVE_MS;
        const flick = zapping && Math.sin(now / 22) < 0 ? 0.35 : 1;
        visual.band.emissive.set(BARREL_BAND_ZAP);
        visual.band.emissiveIntensity = (0.3 + 1.4 * charge) * flick;
        visual.light.color.set(BARREL_BAND_ZAP);
        visual.light.intensity = (zapping ? 1.5 : 0.35) * charge * flick;
        continue;
      }
      const hz = 3 + 9 * (1 - Math.min(1, barrel.fuseTicks / BARREL_FUSE_REF_TICKS));
      const on = Math.sin((now / 1000) * hz * Math.PI * 2) > 0;
      visual.band.emissive.set(on ? BARREL_BAND_LIT : BARREL_BAND_IDLE);
      visual.band.emissiveIntensity = on ? 1.4 : 0.3;
      visual.light.color.set(BARREL_BAND_LIT); // 지져지다 점화된 통은 색을 되돌린다
      visual.light.intensity = on ? 1.6 : 0.15;
    }
    for (const [id, visual] of this.barrelVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(visual.group);
      visual.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.barrelVisuals.delete(id);
      this.barrelZapAt.delete(id);
    }
  }

  /** 이 통이 방금 지져졌다 — 지직거림을 켤 시각을 찍어 둔다 */
  markBarrelZapped(id: number): void {
    this.barrelZapAt.set(id, performance.now());
  }

  private makeBarrel(
    radius: number,
    height: number,
  ): { group: THREE.Group; band: THREE.MeshLambertMaterial; light: THREE.PointLight } {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.92, height, 10),
      new THREE.MeshLambertMaterial({ color: BARREL_COLOR }),
    );
    body.position.y = height / 2;
    group.add(body);
    // 경고 띠 — 어둠 속에서 "저건 터진다"를 알리는 유일한 단서다
    const band = new THREE.MeshLambertMaterial({
      color: BARREL_BAND_COLOR,
      emissive: BARREL_BAND_IDLE,
      emissiveIntensity: 0.25,
    });
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, height * 0.2, 10),
      band,
    );
    ring.position.y = height * 0.62;
    group.add(ring);
    const light = new THREE.PointLight(BARREL_BAND_LIT, 0, 5.5, 0);
    light.position.y = height * 0.62;
    group.add(light);
    return { group, band, light };
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  render(): void {
    this.updateLightningBeam();
    this.updateTracers();
    this.updateParticles();
    this.updateDamagePops(performance.now());
    this.updateBloodStains();
    this.updateSonicWaves(performance.now());
    this.updateFuseGlows(performance.now());
    this.updateExplosions();
    this.updateFrostDecals();
    this.updateScorches(performance.now());
    this.updateDecals(performance.now());
    this.updateExitLight(performance.now());
    this.renderer.render(this.scene, this.camera);
  }
}
