// data/entities.json 로더. 적 스탯은 전부 여기서 읽는다 — 코드에 하드코딩 금지.

import entitiesJson from '../../data/entities.json';

/** 착탄 시 광역 효과. 수호주술사 마법탄의 '내파' — 화염구(밀어냄)와 정반대로 끌어당긴다 */
export interface ProjectileSplashDef {
  /** 광역 반경(m) — 이 밖은 아무 영향 없음 */
  radius: number;
  /** 폭심 피해. 거리 감쇠는 falloffMin까지 */
  damage: number;
  falloffMin: number;
  /** 폭심 쪽으로 끌려가는 거리(m). 감쇠가 함께 적용된다 */
  pullDistance: number;
  pullTicks: number;
  /** 연출 종류 — Stage가 이 값으로 폭발/내파를 고른다 */
  kind: string;
}

export interface EnemyAttackDef {
  type: string;
  windupTicks: number;
  recoverTicks: number;
  /** 유효 전방 호(도). 없으면 각 제한 없음. 찌르기는 좁고 후려치기는 넓다 */
  arcDeg?: number;
  /** 타격 구간 동안 플레이어를 향해 달려드는 속도 (돌격 공격) */
  chargeSpeed?: number;
  /** 타격 구간에서 무기 끝이 뻗어 나가는 가속 곡선. 1(기본)이면 등속,
   *  클수록 앞쪽에서 확 뻗고 끝에서 천천히 민다 — progress = 1 − (1−t)^ease.
   *  판정 창 길이는 그대로 두고 "찌르는 속도"만 바꾸는 손잡이다 */
  strikeEase?: number;
  /** 도약 — 달리는 구간 동안 이 높이까지 포물선을 그리며 뜬다(m).
   *  없으면 바닥을 그대로 달린다. 판정은 XZ 평면 그대로라 높이는 연출이자 회피 단서다 */
  leapHeight?: number;
  /** 예고 뒤 따로 달리는 구간(틱). 있으면 이 동안 chargeSpeed 로 달린 뒤 타격한다.
   *  없으면 타격 창(0.3초) 동안만 파고들어 3~4m 밖에 못 좁힌다 */
  chargeRunTicks?: number;
  /** 이 공격만의 피해량 (없으면 def.damage) */
  damage?: number;
  /** 이 공격만의 플레이어 밀림 거리 (없으면 balance.playerKnockback[type]) */
  playerKnockback?: number;
  /** 밀림에 쓰는 틱 (없으면 balance.playerKnockback.ticks). 크게 날릴수록 길게 잡아야
   *  순간이동처럼 보이지 않는다 */
  playerKnockbackTicks?: number;
  /** 방어 시 밀림 배율 (없으면 balance.playerKnockback.blockedMul).
   *  1.0 이면 방패로 받아도 그대로 날아간다 — 돌격처럼 몸으로 받으면 안 되는 기술용 */
  blockedKnockbackMul?: number;
  /** 방어 시 관통 피해 비율 (없으면 balance.block.chipDamageRatio) */
  blockedDamageRatio?: number;
  /** 지면 강타 — 각과 무관한 원형 판정 반경(m). 있으면 arcDeg·impactRangeMul 대신 쓴다 */
  aoeRadius?: number;
  /** 투사체 발사 위치 — 무기 든 손에서 나가게 (def.radius/def.height 배율) */
  muzzleSideMul?: number;
  muzzleHeightMul?: number;
  /** 헛쳤을 때의 경직 틱 (없으면 recoverTicks). 그동안 마지막 동작으로 굳는다 */
  whiffRecoverTicks?: number;
  impactRangeMul: number;
  parryable: boolean;
  telegraph?: string;
  deflectable?: boolean;
  projectileSpeed?: number;
  projectileRadius?: number;
  projectileKind?: string;
  /** 맞으면 피해·밀침 대신 들러붙어 파먹는다 — 방어로 막으면 평소처럼 흘려보낸다 (구울) */
  latches?: boolean;
  /** 무리 소환 내용물 — type: 'summon' 공격 전용. healthCost 만큼 제 체력을 떼어 준다 */
  brood?: {
    type: string; count: number; maxAlive: number; healthCost: number; cooldownTicks: number;
    flingDistance?: number;
    /** 한 마리씩 튀어나오는 간격(틱) — 머리에서 순차 사출 */
    emitIntervalTicks?: number;
    /** 플레이어가 이 거리 안이면 사출 방향이 플레이어 쪽(랜덤 퍼짐)이 된다 */
    aimRange?: number;
    aimSpreadDeg?: number;
  };
  /** 원거리 공격 사용 최소 거리 (이보다 가까우면 근접) */
  minRange?: number;
  /** 이 거리 안에서만 고른다 (돌격처럼 "중거리 전용" 기술) */
  maxRange?: number;
  /** 시전 중 플레이어가 이 거리 안으로 들어오면 취소하고 근접으로 전환 */
  abortRange?: number;
  /** 날아가는 중에 플레이어 투사체(화염구·수류탄)로 부술 수 있다.
   *  총알은 히트스캔이라 관여하지 않는다 — 그러면 원거리 공격이 무력해진다 */
  breakable?: boolean;
  /** 맞으면 거미줄에 걸린다 — 수치는 balance.web */
  appliesWeb?: boolean;
  /** 연사 — 1보다 크면 windup 뒤 shotIntervalTicks 간격으로 shots 발을 쏜다 */
  shots?: number;
  shotIntervalTicks?: number;
  /** 이 공격만의 재사용 대기 (연사처럼 큰 기술용) */
  cooldownTicks?: number;
  /** 착탄 시 광역 효과 (없으면 단일 대상) */
  splash?: ProjectileSplashDef;
}

export interface EnemyDef {
  /** 표시 이름 (이름표) */
  name?: string;
  /** 총 체력. healthBars 가 있으면 이 값을 그만큼 나눠 표시한다 */
  health: number;
  /** 체력 바 칸 수 (보스 2단). 없으면 1칸 */
  healthBars?: number;
  /** 처치 시 획득 경험치 */
  xp: number;
  /** 체급 — 넉백 저항 등에 쓴다 (light / medium / heavy) */
  weight: 'light' | 'medium' | 'heavy';
  /** 죽을 때 떨구는 화살통 — 화살을 지고 다니는 적만 갖는다.
   *  min 은 확정, max 까지 extraChance 로 한 대씩 더 굴린다 */
  arrowDrop?: { min: number; max: number; extraChance: number };
  speed: number;
  damage: number;
  radius: number;
  height: number;
  aggroRange: number;
  attackRange: number;
  attack: EnemyAttackDef;
  /** 정면 방패 — 전방 투사체 무효 (goblin_spear) */
  frontalShieldBlocksProjectiles?: boolean;
  shieldArcDeg?: number;
  /** 처형 시 드랍하는 각인 id 목록 */
  drops?: string[];
  /** true면 처형이 아니라 사망 시 드랍 (처형 불가능한 적/보스) */
  dropsOnDeath?: boolean;
  behavior?: string;
  /** 눈이 없다 — 시야·인기척·랜턴으로 못 알아챈다. 소리와 피격만 깨운다 (슬라임) */
  blind?: boolean;
  /** 청각 배율 — 모든 소음 반경이 이 배로 들린다. Spawner 가 EnemyState 로 복사한다 */
  hearingMul?: number;
  /** 진동 감각(m) — 눈 없는 적이 이 반경 안에서 '움직이는' 플레이어를 발밑 울림으로
   *  느낀다. 가만히 서 있으면 모른다 (Enemies 의 장님 분기) */
  tremorSense?: number;
  /** 죽을 때 흘리는 점액 장판 개수 — 죽은 자리 주변(balance.goo.deathScatter)에 흩어진다.
   *  화상·빙결 중 사망은 예외 (분열과 같은 규칙, Enemies.handleSplit) */
  deathGoo?: number;
  /** 비행체(박쥐) — 순항 고도·선회와 추락 규칙 (Enemies.tickFlying) */
  flying?: {
    cruiseHeight: number;
    bobAmp: number;
    bobPeriodTicks: number;
    climbPerTick: number;
    orbitMin: number;
    orbitMax: number;
    jinkTicks: number;
    flapIntervalTicks: number;
    /** 돌진 타격 높이 — 예고 동안 이 높이로 맞추고, 돌진 내내 유지한다 (해머가 닿는다) */
    strikeHeight: number;
    /** 치고 빠지기 — 경직 동안 뒤로 물러나는 속도(m/s)와 틱당 상승량 */
    retreatSpeed: number;
    retreatClimbPerTick: number;
    /** 초음파 비명 — 반경 안 플레이어의 조준을 shakeTicks 동안 흔든다 */
    scream?: { cooldownTicks: number; radius: number; shakeTicks: number; shakeAmp: number };
    /** 무리 동시 강하 — 반경 안의 준비된 비행체들이 함께 몸을 던진다 */
    packDive?: { radius: number; minCount: number; cooldownTicks: number };
    /** 흡혈 박치기 — 명중(비방어) 시 제 체력 회복량 */
    slamHeal?: number;
    /** 돌격 반동 — 방패 막기/정확한 패링에 부딪히면 제 몸이 받는 피해 */
    chargeRecoil?: { blocked: number; parried: number };
    /** 랜턴 속박 — 빛기둥에 잡히면 그 자리에 얼어붙는다 (비추는 동안 쏘는 설계) */
    lanternFreeze?: boolean;
    /** 속박 중 위아래 출렁임(bobAmp) 배율 — 얼어붙은 몸은 가늘게만 떤다 */
    lanternFreezeBobMul?: number;
    knockdown: {
      damageThreshold: number;
      instantDamage: number;
      decayPerTick: number;
      fallTicks: number;
      stunTicks: number;
    };
  };
  /** 벽거미 — 벽에 붙어 기어오고 벽에서 도약해 덮친다 (Enemies.tickWallSpider) */
  wallCrawl?: {
    /** 도약 비행 중 몸통 접촉 판정 반경 — 닿는 순간이 곧 타격이다 */
    pounceContactRadius?: number;
    /** 벽에서 내려온 뒤 다시 붙기까지의 지연 틱 — 문 앞 맴돌이 방지 */
    reattachDelayTicks?: number;
    /** 붙는 높이 (jumpY) */
    height: number;
    speedMul: number;
    /** 이 거리 안에 벽이 있으면 붙을 수 있다 (탐침 길이) */
    attachRange: number;
    climbTicks: number;
    fallTicks: number;
    fallStunTicks: number;
    pounceMinRange: number;
    pounceMaxRange: number;
    pounceWindupTicks: number;
    pounceAirTicks: number;
    pounceRadius: number;
    pounceDamage: number;
    pounceKnockback: number;
    pounceRecoverTicks: number;
    pounceWhiffTicks: number;
    cooldownTicks: number;
    skitterIntervalTicks: number;
  };
  /** 죽으면 갈라진다 — 화상·빙결 중 사망이면 갈라지지 않는다 (Enemies.handleSplit) */
  split?: { into: string; count: number; flingDistance?: number };
  /** 기어간 자리에 점액 장판을 남긴다 — 밟으면 느려진다 (balance.goo) */
  gooTrail?: boolean;
  /** 바닥 아이템을 지나가며 삼킨다 — 죽으면 전부 게워 낸다 (슬라임) */
  eatsItems?: boolean;
  /** 생명 입자를 먹는다 — 회복 + 광란 스택(이속·공속 배율). 플레이어와 입자 경쟁 (구울) */
  eatsMotes?: { senseRadius: number; healPerMote: number; frenzyPerStack: number; frenzyMax: number };
  /** 죽은 척 배치가 깨는 기척 반경(m) — 소음·피격은 반경과 무관하게 깨운다 */
  feignWakeRadius?: number;
  /** 대기 배회 — 생성 지점 반경 안을 어슬렁거린다 (구울) */
  idleWander?: { radius: number; speedMul: number; pauseTicks: number };
  /** 살금살금 접근 — 추격 시 untilRange 밖에서는 speedMul 로 걷는다 (구울: 느리게 다가오다 사정거리에서만 달려든다) */
  stalk?: { speedMul: number; untilRange: number };
  /** 걷는 동안 이 간격으로 흐느낀다 — 들리는 거리(14m)에서만 (구울) */
  moanIntervalTicks?: number;
  /** 얼굴 흡혈 (거머리) — 낙하 명중 시 얼굴에 붙어 피를 빤다 */
  faceSuck?: {
    intervalTicks: number; damage: number; heal: number; maxSucks: number;
    /** 떼어내는 데 필요한 근접 연타 수 — 누르고 있는 동안은 피를 못 빤다 */
    mashToEscape: number;
    kickDistance: number; kickStunTicks: number; selfDetachHop: number;
  };
  /** 천장 잠복 (거머리) — 낙하 사냥의 모든 손잡이 */
  ceilingLurk?: {
    dropRadius: number; chitterRadius: number; dripIntervalTicks: number;
    dropDurTicks: number; dropDamage: number; dropAoeRadius: number; dropWhiffTicks: number;
    groundTicks: number; reascendMinDist: number; ascendDurTicks: number; fallStunTicks: number;
  };
  /** 마법 방어막 (warden) — 실탄만 관통 */
  magicBarrier?: { blocksMagic: boolean; blocksMelee: boolean; piercedBy: string[] };
  /** caster_kite: 이 거리 안이면 물러난다 */
  kiteMinRange?: number;
  /** 보스 (boss_two_phase) */
  boss?: boolean;
  /** 원거리 보조 공격 (족장 바위 투척 등) */
  rangedAttack?: EnemyAttackDef;
  /** 연사 공격 — 예고 뒤 여러 발을 일정 간격으로 (족장 화살 세례) */
  volleyAttack?: EnemyAttackDef;
  /** 돌격 공격 — 멀리 떨어졌을 때 달려들며 찌른다 (창병) */
  chargeAttack?: EnemyAttackDef;
  /** 무리 소환 — 제 몸을 떼어 새끼를 뿌린다 (어미 슬라임). brood 필드가 내용물 */
  summonAttack?: EnemyAttackDef;
  /** 방패 밀쳐내기 — 연타를 멈추지 않는 상대를 떼어낸다 (창병) */
  shieldBash?: EnemyAttackDef;
  /** 완벽 패링만 받는다 — 일반 대역(guardDepth)에서 눌러도 성립하지 않는다.
   *  이르게 누른 입력은 버퍼로 살아남아 무기 끝이 완벽 대역에 들어오는 순간 성립한다 */
  perfectParryOnly?: boolean;
  /** 패링에 성공해도 항상 '일반 패링'으로 처리한다 — 히트스톱·연출·마나·연쇄 전부.
   *  perfectParryOnly 와 짝이다: 완벽 대역에서만 성립하는 적은 성공이 곧 완벽이라
   *  그대로 두면 매 패링이 완벽 보상을 받는다 */
  parryAlwaysNormal?: boolean;
  /** 방패막기로 공격을 끊을 수 없다 — 칩 피해와 밀림은 그대로 받되 적은 튕기지 않는다 */
  blockCannotStagger?: boolean;
  parriesToStagger?: number;
  executeDamage?: number;
}

/** 현재 공격 정의 — attackMode 가 가리키는 특수 공격, 없으면 기본 공격 */
export function currentAttack(def: EnemyDef, enemy: { attackMode?: string }): EnemyAttackDef {
  if (enemy.attackMode === 'summon' && def.summonAttack) return def.summonAttack;
  if (enemy.attackMode === 'bash' && def.shieldBash) return def.shieldBash;
  if (enemy.attackMode === 'charge' && def.chargeAttack) return def.chargeAttack;
  if (enemy.attackMode === 'volley' && def.volleyAttack) return def.volleyAttack;
  if (enemy.attackMode === 'ranged' && def.rangedAttack) return def.rangedAttack;
  return def.attack;
}

/** 체력 바 분할 — healthBars 만큼 나눠 표시한다 (보스는 2칸).
 *  index 는 지금 깎이고 있는 칸(1부터 세고 마지막 칸이 1), frac 은 그 칸 안의 비율.
 *  HUD 와 이름표가 같은 함수를 쓴다 — 갈리면 "바는 찼는데 ×1" 같은 어긋남이 난다 */
export function healthBarState(
  def: EnemyDef,
  health: number,
): { count: number; index: number; frac: number } {
  const count = def.healthBars ?? 1;
  const perBar = def.health / count;
  const hp = Math.max(0, health);
  const index = Math.min(count, Math.max(1, Math.ceil(hp / perBar)));
  const frac = Math.min(1, Math.max(0, (hp - (index - 1) * perBar) / perBar));
  return { count, index, frac };
}

/** 이 근접 공격의 유효 범위 안에 (x,z)가 있는가.
 *  기본은 사거리 × impactRangeMul + 전방 arcDeg — 예비동작에 방향이 고정되므로 옆으로
 *  비키면 빗나간다. aoeRadius 가 있으면 각을 무시한 원형 판정(지면 강타)이다.
 *  Reaction(패링)과 Enemies(피해)가 같은 함수를 쓴다 — 갈리면 "못 막는데 맞는" 구멍이 난다 */
export function attackReaches(
  def: EnemyDef,
  enemy: { x: number; z: number; yaw: number },
  attack: EnemyAttackDef,
  x: number,
  z: number,
): boolean {
  const dx = x - enemy.x;
  const dz = z - enemy.z;
  const dist = Math.hypot(dx, dz);
  if (attack.aoeRadius !== undefined) return dist <= attack.aoeRadius;
  if (dist > def.attackRange * attack.impactRangeMul) return false;
  if (attack.arcDeg === undefined || dist === 0) return true;
  const facingX = -Math.sin(enemy.yaw);
  const facingZ = -Math.cos(enemy.yaw);
  const dot = (facingX * dx + facingZ * dz) / dist;
  return dot >= Math.cos(((attack.arcDeg / 2) * Math.PI) / 180);
}

/** (fromX, fromZ)에서 오는 공격이 정면 방패에 막히는가.
 *  스태거 중이거나 이미 깨졌으면 막지 못한다 — Weapons·Projectiles 공용 규칙 */
/** 공격에 몸을 실은 상태 — 이 동안은 방패를 내린다.
 *  windup(예고)은 뺐다: 예고 중에도 방패가 내려가면 붙어 있는 내내 무방비라
 *  방패가 사실상 없는 것과 같아진다. "창을 내지르는 순간부터 회수까지"가 빈틈이다 */
const SHIELD_DOWN_STATES = new Set(['active_perfect', 'active_normal', 'impact', 'recover']);

/** 지금 방패를 내리고 있는가 (막기 판정과 연출이 같이 읽는다) */
export function shieldLowered(enemy: { ai: string; shieldBroken?: boolean }): boolean {
  return !!enemy.shieldBroken || enemy.ai === 'staggered' || SHIELD_DOWN_STATES.has(enemy.ai);
}

export function shieldBlocks(
  def: EnemyDef,
  enemy: {
    x: number;
    z: number;
    yaw: number;
    ai: string;
    shieldBroken?: boolean;
    kbTicks?: number;
  },
  fromX: number,
  fromZ: number,
): boolean {
  if (!def.frontalShieldBlocksProjectiles) return false;
  // 부서졌거나·스태거·공격에 몸을 실은 동안은 못 막는다.
  // 창을 내지르는 순간 방패가 내려가는 게 방패병의 빈틈이다
  if (shieldLowered(enemy)) return false;
  const facingX = -Math.sin(enemy.yaw);
  const facingZ = -Math.cos(enemy.yaw);
  const toX = fromX - enemy.x;
  const toZ = fromZ - enemy.z;
  const len = Math.hypot(toX, toZ);
  const dot = len > 0 ? (facingX * toX + facingZ * toZ) / len : 1;
  return dot >= Math.cos(((def.shieldArcDeg ?? 120) / 2) * (Math.PI / 180));
}

/** 마법 방어막이 아직 서 있는가 (warden). 해머로 barrierBreak.hammerHitsToBreak 방을
 *  맞으면 깨지고, 그 뒤로는 근접도 마법도 그대로 통한다.
 *  Weapons·Projectiles·Stage 가 같은 함수를 쓴다 — 갈리면 "안 보이는데 막히는" 구멍이 난다 */
export function barrierUp(def: EnemyDef, enemy: { barrierBroken?: boolean }): boolean {
  return def.magicBarrier !== undefined && enemy.barrierBroken !== true;
}

/** 투사체(총·마법)가 정면 방패에 막히는가. 뒤로 떠밀리는 동안은 가드를 못 잡으므로
 *  뚫린다 — 해머 3타로 날려 보낸 사이가 총을 박아 넣는 창이다.
 *
 *  근접은 이 예외를 쓰지 않는다(shieldBlocks 그대로): 벽에 붙어 밀려나지 못하는
 *  방패병을 해머로 관통해 "해머는 방패병에게 HP 피해를 주지 않는다" 규칙이 깨진다.
 *  실제로는 밀려난 적이 해머 사거리 밖이라 눈에 띄지 않는 차이다.
 *  Stage 의 방패 내림 연출은 이쪽(투사체) 조건과 맞춘다 */
export function shieldBlocksProjectile(
  def: EnemyDef,
  enemy: {
    x: number;
    z: number;
    yaw: number;
    ai: string;
    shieldBroken?: boolean;
    kbTicks?: number;
  },
  fromX: number,
  fromZ: number,
): boolean {
  if ((enemy.kbTicks ?? 0) > 0) return false;
  return shieldBlocks(def, enemy, fromX, fromZ);
}

export function enemyDef(type: string): EnemyDef {
  const def = (entitiesJson.enemies as Record<string, unknown>)[type];
  if (!def) throw new Error(`entities.json에 없는 적 타입: ${type}`);
  return def as EnemyDef;
}
