// Three.js 렌더 셋업 전용. 게임 로직 금지.
// World 상태(플레이어, 랜턴, 무기, 적)를 읽어 씬에 반영만 한다.

import * as THREE from 'three';
import { balance } from '../core/Balance';
import { currentAttack, enemyDef } from '../core/Entities';
import { COLOR_EXIT_LOCKED, COLOR_EXIT_OPEN, glyphTexture } from '../level/GridLoader';
import type { EnemyState, GroundItemState, ProjectileState } from '../core/World';
import { FINISHER_CONTACT_MS, HandModel } from './HandModel';

// 적 타입별 몸통 색 (시각 팔레트 — 튜닝값 아님)
const ENEMY_COLORS: Record<string, number> = {
  goblin_runner: 0x4a8f3c,
  goblin_spear: 0x3c7a8f,
  goblin_archer: 0x8a8a3a,
  warden: 0x5a4470,
  goblin_chieftain: 0x8f5a30,
  spider_small: 0x14141a,
  spider_large: 0xd8d8cf,
};
/** 거미는 기둥+머리가 아니라 몸통·배·다리로 만든다 */
const SPIDER_TYPES = new Set(['spider_small', 'spider_large']);
const ENEMY_COLOR_FALLBACK = 0x8f3c3c;

/** 거미 몸 — 낮게 깔린 몸통 + 뒤로 부푼 배 + 사방으로 뻗은 다리 8개.
 *  키(def.height)가 낮아 기둥+머리로 만들면 그냥 통조림처럼 보인다 */
function buildSpiderBody(
  torso: THREE.Group,
  def: { radius: number; height: number },
  bodyMat: THREE.MeshLambertMaterial,
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

  // 눈 — 앞을 향한 작은 점 넷. 어둠 속에서 이것만 보여도 거미인 줄 안다
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
  for (const ex of [-0.55, -0.2, 0.2, 0.55]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.075, 5, 4), eyeMat);
    eye.position.set(ex * r * 0.5, bodyY + r * 0.14, -r * 0.9);
    torso.add(eye);
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
const ARMOR_COLOR = 0x777d88;
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
// 화상 표시 — 발광은 텔레그래프·스태거 색에 가려지므로 불티로 따로 알린다
const BURN_EMBER_MS = 85; // 적 하나당 불티 생성 간격
const BURN_EMBER_LIFE_MS = 520;
const BURN_EMBER_COLORS = [0xff8a2a, 0xffc04a, 0xff5a1a];
const FIREBALL_COLOR = 0xff7733;
const GROUND_ITEM_COLOR = 0xe8c76a; // 바닥 각인 — 어둠 속 금색 발광
const POTION_COLOR = 0xe0384a; // HP 포션 — 붉은 약병
const MANA_POTION_COLOR = 0x3a7ce0; // 마나 물약 — 푸른 약병
const POTION_GLASS = 0xbfe6ff;
const GOLD_COLOR = 0xffcc3a; // 골드 더미
const FOOD_COLOR = 0x9c4a3c; // 음식 — 구운 고기
const FOOD_BONE = 0xe8ddc0;

// 트레이서 시각 상수 (튜닝값 아님 — 순수 연출)
const TRACER_COLOR = 0xffe9b8;
const MUZZLE_OFFSET = { x: -0.17, y: -0.1, z: -0.72 }; // 카메라 로컬: 왼손 권총 총구 끝

// 적 부속물 색
/** 벽 잔존물 수명 — 화살은 좀 더 오래 남는다 (눈에 띄는 물건이라). 끝 DECAL_FADE_MS 동안 옅어진다 */
const STUCK_ARROW_MS = 14000;
const BULLET_MARK_MS = 10000;
const DECAL_FADE_MS = 2000;

const EXIT_FLASH_MS = 900; // 출구가 열리는 순간의 섬광

/** 지면 강타 범위 원 — 예고 중 바닥에 그려진다. 안쪽 반지름은 바깥 대비 비율 */
const AOE_RING_COLOR = 0xff5a3c;
const AOE_RING_INNER = 0.9;

const SHIELD_COLOR = 0x6f7480;
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
  /** 몸통+머리 서브그룹 — 공격 모션(기울임/내지름)의 피벗 (발 기준) */
  torso: THREE.Group;
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
  /** 다음 화상 불티를 낼 시각 */
  nextEmberMs: number;
  /** 해머 적중 명멸이 끝나는 시각 */
  hitFlashUntil: number;
  /** 근접 무기 팔 피벗 — 치켜들었다 내리찍는다 */
  arm?: THREE.Group;
  shieldFlashUntil: number;
  /** warden 방어막 셸 */
  barrier?: THREE.Mesh;
  barrierMaterial?: THREE.MeshLambertMaterial;
  barrierFlashUntil: number;
  /** 보스 장갑판 (armored 페이즈에만 표시) */
  armorPlates?: THREE.Mesh;
  /** 지면 강타 범위 표시 — 예고 중 바닥에 그려지는 원 */
  aoeRing?: THREE.Mesh;
  aoeRingMaterial?: THREE.MeshBasicMaterial;
  /** 시전 충전 구체 (warden) */
  chargeOrb?: THREE.Mesh;
  chargeOrbLight?: THREE.PointLight;
  /** 활 (archer) */
  bow?: THREE.Mesh;
  /** 머리 위 이름표 + HP 바 */
  plate: THREE.Sprite;
  plateTexture: THREE.CanvasTexture;
  plateCanvas: HTMLCanvasElement;
  /** 마지막으로 그린 상태 키 — 변화 시에만 다시 그린다 */
  plateKey: string;
}

const PLATE_W = 256;
const PLATE_H = 72;

function drawPlate(
  canvas: HTMLCanvasElement,
  name: string,
  healthFrac: number,
  armorFrac: number | null,
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, PLATE_W, PLATE_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(name, 129, 19);
  ctx.fillStyle = '#e8e8ee';
  ctx.fillText(name, 128, 18);

  // HP 바
  const barX = 28;
  const barW = 200;
  const barY = 40;
  const barH = 16;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  const frac = Math.max(0, Math.min(1, healthFrac));
  ctx.fillStyle = frac > 0.5 ? '#3fae5a' : frac > 0.25 ? '#c9a227' : '#e04444';
  ctx.fillRect(barX, barY, barW * frac, barH);

  // 보스 장갑 바 (armored 페이즈)
  if (armorFrac !== null) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(barX - 2, barY + barH + 4, barW + 4, 10);
    ctx.fillStyle = '#9aa2ad';
    ctx.fillRect(barX, barY + barH + 6, barW * Math.max(0, Math.min(1, armorFrac)), 6);
  }
}
const TRACER_START_PUSH = 0.5; // 총구에서 이만큼 전진한 지점부터 그린다 (근접부 왜곡 방지)
const TRACER_WIDTH = 0.022;

// 사망 파편 (시각 상수)
const DEATH_PARTICLE_COUNT = 14;
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
  /** 초당 회전 (파편이 돌면서 날아간다) */
  spinX?: number;
  spinY?: number;
  spinZ?: number;
  /** 없으면 DEATH_GRAVITY */
  gravity?: number;
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
  private readonly muzzleLight: THREE.PointLight;
  private readonly eyeHeight = balance.player.eyeHeight;
  private readonly enemyVisuals = new Map<number, EnemyVisual>();
  /** 처형 연출 중 붙잡아 둔 시체 — id → 해제 시각(ms) */
  private readonly heldVictims = new Map<number, number>();
  private readonly projectileVisuals = new Map<number, THREE.Group>();
  private readonly groundItemVisuals = new Map<number, THREE.Group>();
  private readonly tracers: Tracer[] = [];
  private readonly particles: Particle[] = [];
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
    this.executeFlash = new THREE.PointLight(0xffe6b0, 0, lp.radius * 0.9, 0);
    this.executeFlash.visible = false;
    this.scene.add(this.executeFlash);

    // 1인칭 뷰모델
    this.camera.add(this.hands.group);

    window.addEventListener('resize', this.onResize);
  }

  triggerRecoil(): void {
    this.hands.triggerRecoil();
  }

  setHandWeapon(kind: 'hammer' | 'grenade' | 'pistol'): void {
    this.hands.setWeapon(kind);
  }

  /** step: 연속타 단계 (1·2·3) — 단계마다 궤적이 다르다 */
  triggerHammerSwing(step = 1): void {
    this.hands.triggerHammerSwing(step);
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

  triggerParry(result: string): void {
    this.hands.triggerParry(result);
  }

  flashShield(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (visual) visual.shieldFlashUntil = performance.now() + 120;
  }

  /** 방어막/장갑 튕김 번쩍 (7.2 피드백) */
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
  }): void {
    this.hands.update(state);
  }

  setLevel(group: THREE.Group, ambientIntensity: number): void {
    this.scene.add(group);
    this.levelAmbient = ambientIntensity;
    this.ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
    this.scene.add(this.ambientLight);
    this.exitPad = group.getObjectByName('exitPad') as THREE.Mesh | undefined;
    this.exitLight = group.getObjectByName('exitLight') as THREE.PointLight | undefined;
    this.exitOpen = true; // 아래 호출이 실제로 반영되도록 반대값에서 시작
    this.setExitOpen(false);
  }

  private exitPad?: THREE.Mesh;
  private exitLight?: THREE.PointLight;
  private exitOpen = true;
  private exitFlashUntil = 0;

  /** 출구 개방 — 봉인 중엔 꺼진 돌바닥, 열리면 초록으로 켜진다.
   *  "늘 열려 있는 초록 바닥"으로 보이던 문제를 여기서 잡는다 */
  setExitOpen(open: boolean): void {
    if (open === this.exitOpen) return;
    this.exitOpen = open;
    const mat = this.exitPad?.material as THREE.MeshLambertMaterial | undefined;
    if (mat) {
      mat.color.setHex(open ? COLOR_EXIT_OPEN : COLOR_EXIT_LOCKED);
      mat.emissive.setHex(open ? COLOR_EXIT_OPEN : COLOR_EXIT_LOCKED);
      mat.emissiveIntensity = open ? 0.5 : 0.06;
      mat.opacity = open ? 0.85 : 0.55;
    }
    if (this.exitLight) this.exitLight.intensity = open ? 0.9 : 0;
    // 열리는 순간 한 번 크게 번쩍인다 — 멀리서도 보이도록
    if (open) this.exitFlashUntil = performance.now() + EXIT_FLASH_MS;
  }

  private updateExitLight(now: number): void {
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
    this.scene.traverse((obj) => {
      if (obj.name !== 'glyph' || !(obj instanceof THREE.Mesh)) return;
      const material = obj.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.map = glyphTexture(obj.userData['glyphText'] as string, readable);
      material.needsUpdate = true;
    });
  }

  /** 오염 시각 단계를 뷰모델에 전달 */
  setCorruptionStage(stage: number): void {
    this.hands.setCorruptionStage(stage);
  }

  /** 문 개방 — 해당 문 메시 제거 */
  openDoor(row: number, col: number): void {
    this.removeNamedCell(`door-${row}-${col}`);
  }

  /** 균열 벽 파괴 */
  breakCrack(row: number, col: number): void {
    this.removeNamedCell(`crack-${row}-${col}`);
  }

  private removeNamedCell(name: string): void {
    const mesh = this.scene.getObjectByName(name);
    if (mesh instanceof THREE.Mesh) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
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

  /** 벽에 꽂힌 화살 */
  spawnStuckArrow(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const arrow = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({
      color: 0x6b5233,
      transparent: true,
      opacity: 1,
    });
    arrow.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), material));
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

  /** 레버 당김 — 손잡이 반대쪽으로 기울임 */
  pullLever(row: number, col: number): void {
    const handle = this.scene.getObjectByName(`lever-${row}-${col}`);
    if (handle) handle.rotation.z = -0.5;
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

    const flashLeft = this.executeFlashUntil - now;
    this.executeFlash.visible = flashLeft > 0;
    if (flashLeft > 0) {
      const f = flashLeft / this.executeFlashMs;
      this.executeFlash.intensity = balance.lantern.intensity * this.executeFlashPower * f * f;
    }
  }

  setLanternOn(on: boolean): void {
    this.lantern.visible = on;
    this.lanternSpill.visible = on;
  }

  setMuzzleFlash(on: boolean): void {
    this.muzzleLight.visible = on;
  }

  /** 발사 궤적 — 총구(카메라 오른쪽 아래)에서 착탄점까지, tracerTicks 동안 페이드 아웃 */
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
        tracer.beam.geometry.dispose();
        (tracer.beam.material as THREE.Material).dispose();
        tracer.spark.geometry.dispose();
        (tracer.spark.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      const fade = 1 - age;
      (tracer.beam.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
      (tracer.spark.material as THREE.MeshBasicMaterial).opacity = fade;
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
    if (SPIDER_TYPES.has(type)) {
      buildSpiderBody(torso, def, bodyMat, baseColor, flashMaterials);
    } else {
      // 몸통은 충돌 원과 같은 반경의 8각 기둥 — 박스로 두면 모서리가 반경 밖으로
      // 0.21m 튀어나와(0.5→0.707) 비스듬히 부딪칠 때 뚫고 들어가 보인다
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(def.radius, def.radius, def.height * 0.78, 8),
        bodyMat,
      );
      body.position.y = (def.height * 0.78) / 2;
      torso.add(body);

      const headMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(baseColor).multiplyScalar(HEAD_DARKEN),
      });
      flashMaterials.push(headMat);
      const headSize = def.radius * 0.9;
      const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), headMat);
      head.position.set(0, def.height - headSize / 2, -def.radius * 0.2);
      torso.add(head);
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

    const visual: EnemyVisual = {
      group,
      torso,
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
    };

    // 지면 강타 범위 원 — 예고 중에만 보인다. 반경은 매 프레임 attack.aoeRadius 로 맞춘다.
    // 화면 UI 가 아니라 월드 바닥에 놓인 표식이다 (몸이 기울어도 바닥에 붙어 있게 group 소속)
    if (def.attack.aoeRadius || def.armoredAttack?.aoeRadius) {
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

    // 활 (궁수)
    if (type === 'goblin_archer') {
      visual.bow = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 1.15, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x5c4426 }),
      );
      visual.bow.position.set(0.15, def.height * 0.58, -def.radius - 0.25);
      torso.add(visual.bow);
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

    if (def.boss) {
      // 몸통과 같은 8각 기둥 — 박스로 두면 모서리가 충돌 반경 밖으로 크게 삐져나온다
      visual.armorPlates = new THREE.Mesh(
        new THREE.CylinderGeometry(def.radius * 1.04, def.radius * 1.04, def.height * 0.9, 8),
        new THREE.MeshLambertMaterial({ color: ARMOR_COLOR }),
      );
      visual.armorPlates.position.y = def.height * 0.5;
      visual.armorPlates.visible = false;
      torso.add(visual.armorPlates); // 몸통과 함께 기울어진다
    }

    if (def.frontalShieldBlocksProjectiles) {
      visual.shieldMaterial = new THREE.MeshLambertMaterial({ color: SHIELD_COLOR });
      // 폭은 충돌 원 안에 들어오도록 — 넓으면 옆구리가 반경 밖으로 삐져나온다
      visual.shield = new THREE.Mesh(
        new THREE.BoxGeometry(def.radius * 1.6, def.height * 0.72, 0.09),
        visual.shieldMaterial,
      );
      // 방패도 충돌 경계(반경) 근처까지만 — 더 내밀면 몸이 통과한 것처럼 보인다
      visual.shieldBaseZ = -(def.radius * 0.92);
      visual.shield.position.set(SHIELD_BASE_X, def.height * 0.5, visual.shieldBaseZ);
      group.add(visual.shield);

      // 균열 — 마무리 타를 한 번 받아내면 드러난다. 방패면(-z) 바깥쪽에 얇게 붙인다
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
    }

    // 근접 무기 — 어깨 피벗 팔에 쥐고 치켜들었다 내리찍는다
    const weaponSpec = MELEE_WEAPONS[type];
    if (weaponSpec) {
      const arm = new THREE.Group();
      arm.position.set(def.radius * 0.85, def.height * 0.72, 0);
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
          visual.group.remove(visual.shield);
          visual.shield = undefined;
        }
        this.enemyVisuals.set(enemy.id, visual);
        this.scene.add(visual.group);
      }

      visual.group.position.set(
        enemy.prevX + (enemy.x - enemy.prevX) * alpha,
        0,
        enemy.prevZ + (enemy.z - enemy.prevZ) * alpha,
      );
      visual.group.rotation.y = enemy.yaw;

      // 텔레그래프 — 섬광은 windup 종료 visualLeadTicks 전부터 판정 창 내내.
      // 색은 공격 유형 규약: 청=패링 가능, 적=회피 전용, 보라=마법 투사체.
      // 그 전 windup은 옅은 예고 틴트. 스태거는 처형 가능 표시(황색).
      const def2 = enemyDef(enemy.type);
      const attack = currentAttack(def2, enemy);
      const telegraphColor =
        attack.telegraph === 'red'
          ? balance.telegraph.colorUnparryable
          : attack.telegraph === 'purple'
            ? balance.telegraph.colorProjectile
            : balance.telegraph.colorParryable;
      const flashing =
        (enemy.ai === 'windup' && enemy.timer <= balance.telegraph.visualLeadTicks) ||
        enemy.ai === 'active_perfect' ||
        enemy.ai === 'active_normal';
      let emissive = 0x000000;
      if (flashing) emissive = new THREE.Color(telegraphColor).getHex();
      else if (enemy.ai === 'windup') emissive = WINDUP_TINT;
      else if (enemy.ai === 'staggered') emissive = STAGGER_COLOR;
      else if (enemy.burnTicks > 0) emissive = BURN_TINT;

      // 화상 — 몸에서 불티가 계속 피어오른다. 발광색은 다른 상태에 가려지므로
      // 이것이 "불타는 중"을 알리는 실제 신호다
      if (enemy.burnTicks > 0 && now >= visual.nextEmberMs) {
        visual.nextEmberMs = now + BURN_EMBER_MS;
        this.spawnBurnEmber(enemy.x, enemy.z, def2.radius, def2.height);
      }

      // 해머 적중 명멸 — 무엇보다 우선한다. 켜짐/꺼짐을 빠르게 교대해 "번쩍번쩍"
      const hitLeft = visual.hitFlashUntil - now;
      let hitIntensity = 0;
      if (hitLeft > 0) {
        const on = Math.sin((now / 1000) * HIT_FLASH_HZ * Math.PI * 2) > 0;
        if (on) {
          emissive = HIT_FLASH_COLOR;
          hitIntensity = hitLeft / HIT_FLASH_MS; // 잦아들며 멎는다
        }
      }
      for (const material of visual.flashMaterials) {
        material.emissive.set(emissive);
        material.emissiveIntensity = hitIntensity > 0 ? hitIntensity : 1;
      }

      // 이름표 — 어그로 후에만. 체력/장갑이 바뀔 때만 다시 그린다
      visual.plate.visible = enemy.ai !== 'idle';
      if (visual.plate.visible) {
        const armored = enemy.phase === 'armored' && (enemy.armorHealth ?? 0) > 0;
        const key = `${Math.ceil(enemy.health)}|${armored ? Math.ceil(enemy.armorHealth ?? 0) : '-'}`;
        if (key !== visual.plateKey) {
          visual.plateKey = key;
          drawPlate(
            visual.plateCanvas,
            def2.name ?? enemy.type,
            enemy.health / def2.health,
            armored ? (enemy.armorHealth ?? 0) / (def2.armorHealth ?? 1) : null,
          );
          visual.plateTexture.needsUpdate = true;
        }
      }

      // warden 방어막 — 튕김 시 번쩍
      if (visual.barrier && visual.barrierMaterial) {
        const flashOn = now < visual.barrierFlashUntil;
        visual.barrierMaterial.opacity = flashOn ? 0.55 : 0.18;
        visual.barrierMaterial.emissive.set(flashOn ? BARRIER_COLOR : 0x000000);
      }

      // 보스 장갑판 — armored 페이즈에만
      if (visual.armorPlates) {
        visual.armorPlates.visible = enemy.phase === 'armored' && (enemy.armorHealth ?? 0) > 0;
        if (now < visual.barrierFlashUntil) {
          (visual.armorPlates.material as THREE.MeshLambertMaterial).emissive.set(0x444444);
        } else {
          (visual.armorPlates.material as THREE.MeshLambertMaterial).emissive.set(0x000000);
        }
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

      if (trembling) leanTarget += Math.sin(now / 14) * 0.05;
      // 피탄 움찔 — 상체가 짧게 젖혀졌다 돌아온다 (+ = 뒤로). 남은 틱 비율로 감쇠
      const flinch =
        Math.max(enemy.flinchTicks ?? 0, enemy.attackFreezeTicks ?? 0) /
        balance.weapons.pistol.flinchTicks;
      if (flinch > 0) leanTarget += 0.16 * Math.min(1, flinch);
      // 굳은 동안 힘겹게 버티는 미세 떨림 (완전 정지는 프리즈처럼 보인다)
      if (frozenWhiff) leanTarget += Math.sin(now / 55) * 0.012;
      if (recoiled) leanTarget += 0.5 + Math.sin(now / 40) * 0.03; // 뒤로 크게 젖힘
      const snap = striking ? 0.55 : 0.3; // 타격은 빠르게, 복귀는 부드럽게
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
          const armSnap = striking ? 0.6 : 0.25;
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

      // 활 시위 당기기 — windup에 활이 젖혀진다
      if (visual.bow) {
        const bowTilt = inWindup ? -0.35 * windupProgress : 0;
        visual.bow.rotation.x += (bowTilt - visual.bow.rotation.x) * 0.3;
      }

      // 방패 — 피격 시 흰 번쩍. 스태거·밀림 중엔 팔이 내려가 가드가 풀린다.
      // 내리는 조건은 Entities.shieldBlocks 와 같아야 한다 (보이는 것 = 막히는 것)
      if (visual.shieldCracks) visual.shieldCracks.visible = (enemy.shieldHits ?? 0) > 0;
      if (visual.shield && visual.shieldMaterial) {
        visual.shieldMaterial.emissive.set(now < visual.shieldFlashUntil ? 0xffffff : 0x000000);
        const def = enemyDef(enemy.type);
        const shoved = (enemy.kbTicks ?? 0) > 0;
        const down = shoved || enemy.ai === 'staggered';
        const targetY =
          (down ? def.height * SHIELD_DOWN_Y : def.height * 0.5) + visual.torso.position.y;
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
        // 몸통 전진/후퇴를 따라간다 (방패는 group 소속이라 자동으로 따라오지 않는다)
        visual.shield.position.z = visual.shieldBaseZ + visual.torso.position.z;
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
      this.enemyVisuals.delete(id);
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
      const px = proj.prevX + (proj.x - proj.prevX) * alpha;
      const py = proj.prevY + (proj.y - proj.prevY) * alpha;
      const pz = proj.prevZ + (proj.z - proj.prevZ) * alpha;
      group.position.set(px, py, pz);
      if (proj.kind === 'arrow') {
        // 화살대를 비행 방향으로 정렬 (로컬 -Z가 진행 방향)
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
    }
  }

  /** 격돌 — 부딪힌 지점에서 불꽃이 튀고 짧게 번쩍인다 (막기: 주황 / 패링: 청백) */
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
    visual.group.remove(shield);
    shield.geometry.dispose();
    visual.shieldMaterial?.dispose();
    visual.shield = undefined;
    visual.shieldMaterial = undefined;

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
  spawnDeathBurst(x: number, z: number, enemyType: string, power = 1): void {
    const def = enemyDef(enemyType);
    const color = ENEMY_COLORS[enemyType] ?? ENEMY_COLOR_FALLBACK;
    const now = performance.now();
    for (let i = 0; i < Math.round(DEATH_PARTICLE_COUNT * power); i++) {
      const size = (0.08 + Math.random() * 0.12) * (power > 1 ? 1.25 : 1);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 }),
      );
      const angle = Math.random() * Math.PI * 2;
      const speed = (1.5 + Math.random() * 3.5) * power;
      const particle: Particle = {
        mesh,
        ox: x,
        oy: def.height * (0.3 + Math.random() * 0.6),
        oz: z,
        vx: Math.cos(angle) * speed,
        vy: (2 + Math.random() * 4) * power,
        vz: Math.sin(angle) * speed,
        bornMs: now,
      };
      mesh.position.set(particle.ox, particle.oy, particle.oz);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.particles.push(particle);
      this.scene.add(mesh);
    }
  }

  /** 바닥 아이템 비주얼 — 각인(팔면체 보석) / 포션(붉은 약병) / 골드(낮은 더미) */
  private makeGroundItem(kind: GroundItemState['kind']): THREE.Group {
    const group = new THREE.Group();
    if (kind === 'potion' || kind === 'mana') {
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
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        new THREE.MeshLambertMaterial({
          color: GROUND_ITEM_COLOR,
          emissive: GROUND_ITEM_COLOR,
          emissiveIntensity: 0.55,
        }),
      );
      gem.name = 'gem';
      group.add(gem);
      group.add(new THREE.PointLight(GROUND_ITEM_COLOR, 0.9, 5, 0));
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
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.mesh.position.set(
        p.ox + p.vx * age,
        Math.max(0.04, p.oy + p.vy * age - 0.5 * (p.gravity ?? DEATH_GRAVITY) * age * age),
        p.oz + p.vz * age,
      );
      if (p.spinX || p.spinY || p.spinZ) {
        p.mesh.rotation.set(
          p.mesh.rotation.x + (p.spinX ?? 0) * 0.016,
          p.mesh.rotation.y + (p.spinY ?? 0) * 0.016,
          p.mesh.rotation.z + (p.spinZ ?? 0) * 0.016,
        );
      }
      (p.mesh.material as THREE.MeshLambertMaterial).opacity = 1 - lifeFrac * lifeFrac;
    }
  }

  /** 바닥 각인 — 떠서 회전하는 금색 팔면체 + 점광원 */
  syncGroundItems(items: GroundItemState[]): void {
    const now = performance.now();
    const seen = new Set<number>();
    for (const item of items) {
      seen.add(item.id);
      let group = this.groundItemVisuals.get(item.id);
      if (!group) {
        group = this.makeGroundItem(item.kind);
        this.groundItemVisuals.set(item.id, group);
        this.scene.add(group);
      }
      // 자석에 걸리면 로직이 계산한 높이(item.y)로 날아간다. 아니면 제자리 부유
      const bob =
        item.y ?? (item.kind === 'gold' ? 0.12 : 0.55 + Math.sin(now / 400 + item.id) * 0.1);
      group.position.set(item.x, bob, item.z);
      const gem = group.getObjectByName('gem');
      // 빨려드는 동안은 빠르게 회전하고 살짝 작아진다 (몸으로 들어가는 느낌)
      if (gem) gem.rotation.y = now / (item.magnet ? 90 : item.kind === 'gold' ? 1400 : 700);
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

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  render(): void {
    this.updateTracers();
    this.updateParticles();
    this.updateExplosions();
    this.updateDecals(performance.now());
    this.updateExitLight(performance.now());
    this.renderer.render(this.scene, this.camera);
  }
}
