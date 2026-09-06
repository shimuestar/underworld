// data/entities.json 로더. 적 스탯은 전부 여기서 읽는다 — 코드에 하드코딩 금지.

import entitiesJson from '../../data/entities.json';
import { balance } from './Balance';
import { rayVsAabb, rayVsSphere } from './Ray';
import type { PlayerStatusKind } from './World';

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
  /** 참 = 돌진(windup·charging) 중 피해를 입으면 공격이 끊기고 고꾸라진다 (구울 물어뜯기) */
  cancelOnHit?: boolean;
  /** 끊겼을 때 뻗는 틱 — 반격 창 */
  cancelStaggerTicks?: number;
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
  /** 돌격(chargeRunTicks)이 일반 벽·문에 막혀 끝났을 때의 경직 틱(거수, 기획서 §9.3 — 박히지 않음·눈 안 열림). 없으면 whiffRecoverTicks */
  wallWhiffRecoverTicks?: number;
  impactRangeMul: number;
  parryable: boolean;
  telegraph?: string;
  deflectable?: boolean;
  projectileSpeed?: number;
  projectileRadius?: number;
  projectileKind?: string;
  /** 맞으면 피해·밀침 대신 들러붙어 파먹는다 — 방어로 막으면 평소처럼 흘려보낸다 (구울) */
  latches?: boolean;
  /** 닿는 순간 판정 — 휘두르는 동안 무기 끝이 몸에 닿거나 몸이 부딛치면 창이 끝나길 기다리지 않고 바로 친다.
   *  돌격(chargeRunTicks)이면 달리는 동안 몸이 부딛친 순간 물고, 타격 반경도 몸 접촉(contact.padM)이다 (2026-09-04 사용자) */
  hitOnContact?: boolean;
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
  /** 교대 — attackAlt 슬롯에 두면 기본 attack 과 번갈아 나간다(거수 오른낫·왼낫). 없으면 attackAlt 는 선택되지 않는다 */
  alternate?: boolean;
  /** 패링 → 약점 노출(parryOutcome 'expose' 적, 기획서 §4.1 ①②) — 이 공격을 일반 패링하면 joint 약점이 normalTicks,
   *  완벽 패링하면 perfectTicks 동안 열린다(완벽은 머리 내림도 함께 — balance.weakPoint.headDown.stuckTicks). 없으면 노출 없음 */
  exposeOnParry?: { joint: string; normalTicks: number; perfectTicks: number };
  /** 완벽 회피 보상(거수 돌격, 기획서 §9.3) — 접촉 순간 플레이어가 회피 무적(iframeTicks > 0)이면 피해 대신 charge_dodged +
   *  미끄러짐(pose skid, balance.weakPoint.skid.ticks) + joints 의 관절이 ticks 동안 열린다. 없으면 무적 접촉은 헛돌격(옛 경로) */
  perfectDodgeExposes?: { ticks: number; joints: string[] };
  /** 막지 않은 직격이 플레이어에게 남기는 상태(거수 돌격 → 진탕 'concussion', 기획서 §6). 지속은 balance.status.*.ticks.
   *  값을 세우는 건 Enemies impact, 감소·해제는 Status.ts. 없으면 상태 없음(옛 경로) */
  statusOnHit?: PlayerStatusKind;
  /** 방패로 막았을 때 남기는 상태(거수 낫 → 팔 저림 'numb_arm'). 칩 피해·방어 경직은 기존대로 */
  statusOnBlock?: PlayerStatusKind;
}

/** 세 성분 좌표·치수 — [x, y, z]. x·z 는 def.radius 배, y 는 def.height 배 (Stage 가 곱한다) */
export type VisualTriple = [number, number, number];

/** 낫뿔 거수 외형 부위 정의(렌더 전용, 기획서 §2 표) — 좌표·치수를 radius/height 배율로 두고
 *  Stage.buildBehemothRig 가 곱한다. radius·length·thickness 는 radius 배, legs.height 는 height 배.
 *  색은 Stage 팔레트(튜닝값 아님). 판정(hitBox·약점 구체)과 그림이 같은 표를 읽게 하려는 자리다 */
export interface BehemothVisualDef {
  body: { size: VisualTriple; pos: VisualTriple };
  /** 등갑판 — 같은 높이(y)에 z 만 다른 판 여러 장, tiltDeg 만큼 앞이 들린다 */
  plates: { size: VisualTriple; y: number; z: number[]; tiltDeg: number };
  /** 목 피벗 — 머리 내림(돌격 예고)의 회전축 */
  neck: VisualTriple;
  head: { size: VisualTriple; pos: VisualTriple };
  eye: { radius: number; pos: VisualTriple };
  /** 뿔 — pos 는 밑동(x 는 ± 대칭), tiltDeg 만큼 앞으로 기운다 */
  horns: { radius: number; length: number; pos: VisualTriple; tiltDeg: number };
  /** 어깨 관절(약점 구체이자 낫 팔 피벗) — x 는 ± 대칭 */
  joints: { radius: number; pos: VisualTriple };
  /** 위팔 — 관절에서 낫 힌지까지 */
  upperArm: { thickness: number; length: number };
  /** 낫 상자 — [폭, 날 높이, 길이]. 길이 방향이 팔 축(-z) */
  blade: { size: VisualTriple };
  /** 다리 — pos 는 원기둥 중심(x·z 는 ± 대칭 4개) */
  legs: { radius: number; height: number; pos: VisualTriple };
  heart: { radius: number; pos: VisualTriple };
  vent: { radius: number; pos: VisualTriple };
  /** 아래턱 — hinge 에서 앞·아래로 늘어진 상자 */
  mouth: { size: VisualTriple; hinge: VisualTriple };
  /** 꼬리 — root 에서 +z 로 뻗는 원기둥 */
  tail: { radius: number; length: number; root: VisualTriple };
}

/** 세 성분 로컬 좌표(m) — 정면 = -z(Stage 규약) */
export interface LocalVec3 {
  x: number;
  y: number;
  z: number;
}

/** 약점 구체 정의(거수, 기획서 §4) — 몸 AABB 와 별개인 구체. 히트스캔(권총)·화살·화염구 직격에만 배율,
 *  해머·수류탄·폭발·빔은 배율 없음. 판정과 그림(Stage 구체)이 같은 정의를 읽는다 */
export interface WeakPointDef {
  id: string;
  /** 로컬 오프셋(m, normal 자세). enemy.pose 가 있고 poseOffsets 표에 그 자세가 있으면 표가 우선 */
  offset: LocalVec3;
  radius: number;
  damageMul: number;
  /** 내구 — 있으면 Spawner 가 enemy.weakHp[id] 로 복사하고, 0 에 닿으면 weak_point_broken(판정 닫힘) */
  hp?: number;
  /** 정면 원뿔 축(로컬 단위 벡터에 가까운 값 — 정규화해 쓴다). dot(레이 방향, facing) ≤ −cos(coneDeg/2) 일 때만 성립 */
  facing: LocalVec3;
  /** 원뿔 각(도). 없으면 balance.weakPoint.defaultConeDeg */
  coneDeg?: number;
  /** 노출 자세 — enemy.pose 가 이 목록에 있으면 열린다(눈 = head_down, 심장 = rear). 노출 타이머(enemy.exposure[id])는
   *  이와 별개로 연다(관절 = 패링). 둘 다 아니면 판정 자체가 없다 → 몸통 배율(기획서 §4.2). 빈 배열 = 타이머로만 */
  exposedStates?: string[];
  /** 열림 중 배율 재정의(분출공, B3-2) */
  openMul?: number;
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
    /** 속박 중 덜덜 떨림 — 순항 출렁임 대신 작은 폭·빠른 주기로 떤다 */
    lanternFreezeTremble?: { amp: number; periodTicks: number };
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
  /** 교대 근접 — attack 과 번갈아 나가는 둘째 팔(거수 왼낫). attackMode 'alt'. alternate 플래그가 참일 때만 골라진다 */
  attackAlt?: EnemyAttackDef;
  /** 밀착 공격 — maxRange 안에 붙은 플레이어를 cooldownTicks 마다 낫보다 먼저 밀어낸다(거수 들이받기). attackMode 'close' */
  closeAttack?: EnemyAttackDef;
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
  /** 'expose' — 패링이 스태거 대신 약점을 연다(거수, 기획서 §4.1): 일반 = 그 낫의 관절, 완벽 = 관절 + 머리 내림(눈).
   *  Reaction 은 이 값을 parriesToStagger 보다 먼저 본다. 없으면 옛 경로(완벽 = 스태거 / 보스 = 연속 패링 누적) */
  parryOutcome?: 'expose';
  executeDamage?: number;
  /** 머리 내림(pose head_down) 중 해머 타격을 눈 피해로 집계하는 배율(거수 2.2 — 한 타 = 권총 한 발). 없으면 해머는 약점과 무관 */
  hammerEyeMul?: number;
  /** 머리 내림 중 해머 마무리 넉백을 0 으로 — 붙어서 눈을 두들기는 동안 밀어내지 않는다(거수) */
  noKnockbackWhileHeadDown?: boolean;
  /** 혼절(staggered) 중 해머 3타 전부 적중 시의 체급 무시 5m 날림을 면제 — 처형 반경 밖으로 날아가지 않게(거수, 결정 33) */
  staggerFlingImmune?: boolean;
  /** 피격 AABB 재정의(거수) — 충돌 반경(radius)과 분리해 시각 몸통에 맞춘 직사각 상자.
   *  로컬 축(정면 = -z) 기준 반폭이라 yaw 로 돌아 있으면 레이를 로컬로 돌려 판정한다(rayHitsEnemy).
   *  없으면 기존 radius 정사각 기둥 */
  hitBox?: { halfX: number; halfZ: number };
  /** 보스 포효 기상 반경 재정의(m) — 없으면 balance.enemyAi.bossAlertRadius */
  alertRadius?: number;
  /** false 면 해머 강타 뒤 wantsCharge(밀려난 뒤 확률 돌격) 우회 경로를 쓰지 않는다 —
   *  자세·쿨다운을 무시하고 달려드는 것을 막는다(거수). 없으면 기존대로 */
  chargeOnKnockback?: boolean;
  /** 외형 부위 표(거수) — 없으면 Stage 의 기본 인간형 외형 */
  visual?: BehemothVisualDef;
  /** 약점 구체 목록(거수) — 없으면 약점 판정 없음(옛 경로) */
  weakPoints?: WeakPointDef[];
  /** 자세별 약점 좌표표 pose → wpId → 로컬 좌표(m). 판정(weakPointWorldPos)과 그림(Stage)이 같은 표를 읽는다 */
  poseOffsets?: Record<string, Record<string, LocalVec3>>;
  /** 권총 부위 배율(head/limb)을 받지 않는다 — 약점 아닌 명중은 전부 body 배율, 권총·화살 헤드샷 이벤트 억제(거수: 머리 = 눈 약점) */
  hitZonesImmune?: boolean;
  /** 양 낫 잠김(절뚝) 중 낫 사거리 안에 붙은 플레이어에게서 물러나 유지하는 거리(m, 기획서 §9.2) — min 안이면 뒤로, min~max 는 제자리,
   *  max 밖은 평소 접근. 없으면 제자리에 선다 */
  retreatWhenDisarmed?: { min: number; max: number };
}

/** 낫 쪽 id — 'r' 오른낫(attack) / 'l' 왼낫(attackAlt). EnemyState.lastBlade·bladeLock 이 같은 키를 쓴다 */
export type BladeSide = 'r' | 'l';

/** 관절 약점 ↔ 낫 짝(거수) — 낫 공격 정의의 exposeOnParry.joint 가 "그 낫을 패링하면 그 관절"을 말하므로 같은 표를 거꾸로 읽는다:
 *  attack(오른낫) 의 관절이면 'r', attackAlt(왼낫) 의 관절이면 'l'. 관절 파열이 잠글 낫(Enemies)과 잠긴 낫의 관절(Stage)이 이 한 함수를 쓴다.
 *  짝이 없는 약점(눈·심장·분출공)은 undefined */
export function bladeOfJoint(def: EnemyDef, jointId: string): BladeSide | undefined {
  if (def.attack.exposeOnParry?.joint === jointId) return 'r';
  if (def.attackAlt?.exposeOnParry?.joint === jointId) return 'l';
  return undefined;
}

/** 낫의 관절 약점 id(bladeOfJoint 의 역) — 없으면 undefined */
export function jointOfBlade(def: EnemyDef, blade: BladeSide): string | undefined {
  return blade === 'r' ? def.attack.exposeOnParry?.joint : def.attackAlt?.exposeOnParry?.joint;
}

/** 이 낫이 잠겨 있는가(관절 파열, enemy.bladeLock[blade] > 0) — Enemies 의 공격 선택과 Stage 의 늘어진 낫이 같은 규칙을 읽는다 */
export function bladeLocked(enemy: { bladeLock?: Partial<Record<BladeSide, number>> }, blade: BladeSide): boolean {
  return (enemy.bladeLock?.[blade] ?? 0) > 0;
}

/** 절뚝(limp) — 양 낫이 동시에 잠겼다(기획서 §5). 이속·돌격 속도 배율은 balance.weakPoint.limp */
export function bothBladesLocked(enemy: { bladeLock?: Partial<Record<BladeSide, number>> }): boolean {
  return bladeLocked(enemy, 'r') && bladeLocked(enemy, 'l');
}

/** 현재 공격 정의 — attackMode 가 가리키는 특수 공격, 없으면 기본 공격 */
export function currentAttack(def: EnemyDef, enemy: { attackMode?: string }): EnemyAttackDef {
  if (enemy.attackMode === 'summon' && def.summonAttack) return def.summonAttack;
  if (enemy.attackMode === 'bash' && def.shieldBash) return def.shieldBash;
  if (enemy.attackMode === 'charge' && def.chargeAttack) return def.chargeAttack;
  if (enemy.attackMode === 'volley' && def.volleyAttack) return def.volleyAttack;
  if (enemy.attackMode === 'ranged' && def.rangedAttack) return def.rangedAttack;
  if (enemy.attackMode === 'alt' && def.attackAlt) return def.attackAlt;
  if (enemy.attackMode === 'close' && def.closeAttack) return def.closeAttack;
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

/** 구현된 적 종류 — health·damage 를 가진 것만 (몬스터 시험방 소환 목록). 정의 순서를 지킨다 */
export function implementedEnemyTypes(): string[] {
  const en = entitiesJson.enemies as unknown as Record<string, unknown>;
  return Object.keys(en).filter((k) => {
    const v = en[k];
    return typeof v === 'object' && v !== null && 'health' in v && 'damage' in v; // _note 문자열은 뺀다
  });
}

/** 적 피격 상자(AABB) — 총알·화살·마법 공용. 서 있으면 발 위치의 기둥(공중이면 jumpY 만큼 떠서).
 *  죽은 척(엎어짐)이면 몸이 정면(-sin yaw, -cos yaw)으로 키만큼 누워 있으니 발에서 그쪽으로 뻗은
 *  낮은 상자다 — 기둥을 그대로 쓰면 보이는 몸을 쏴도 빈 공간만 맞아 반응이 없다(2026-09-03) */
export function enemyHitBox(
  enemy: { x: number; z: number; yaw: number; feigning?: boolean; jumpY?: number },
  def: { radius: number; height: number },
  pad: number,
): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } {
  if (enemy.feigning) {
    const hx = enemy.x - Math.sin(enemy.yaw) * def.height * 0.9;
    const hz = enemy.z - Math.cos(enemy.yaw) * def.height * 0.9;
    return {
      minX: Math.min(enemy.x, hx) - def.radius - pad,
      minY: -pad,
      minZ: Math.min(enemy.z, hz) - def.radius - pad,
      maxX: Math.max(enemy.x, hx) + def.radius + pad,
      maxY: def.radius * 1.4 + pad,
      maxZ: Math.max(enemy.z, hz) + def.radius + pad,
    };
  }
  const yBase = enemy.jumpY ?? 0;
  return {
    minX: enemy.x - def.radius - pad,
    minY: yBase - pad,
    minZ: enemy.z - def.radius - pad,
    maxX: enemy.x + def.radius + pad,
    maxY: yBase + def.height + pad,
    maxZ: enemy.z + def.radius + pad,
  };
}

/** 총알·화살·마법 레이가 적 몸에 닿는 t(≥0) — 적 몸 판정의 단일 입구(Weapons·Projectiles 공용). 만나지 않으면 null.
 *  hitBox{halfX, halfZ}(거수) 가 있으면 충돌 반경 대신 시각 몸통에 맞춘 직사각 상자를 쓴다 — 몸이 yaw 로
 *  돌아 있으니 레이를 적의 로컬 좌표(정면 = -z, Stage 규약)로 역회전해 넣고 축 정렬 상자에 맞힌다.
 *  회전은 거리를 보존하므로 t 는 월드 그대로다. 없으면(또는 죽은 척이면) 기존 enemyHitBox 기둥 */
export function rayHitsEnemy(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  enemy: { x: number; z: number; yaw: number; feigning?: boolean; jumpY?: number },
  def: { radius: number; height: number; hitBox?: { halfX: number; halfZ: number } },
  pad: number,
): number | null {
  const box = def.hitBox;
  if (!box || enemy.feigning) return rayVsAabb(ox, oy, oz, dx, dy, dz, enemyHitBox(enemy, def, pad));
  // 월드 → 로컬 (yaw 역회전): 정면 벡터 (-sin yaw, -cos yaw) 가 (0, -1) 로 간다
  const c = Math.cos(enemy.yaw);
  const s = Math.sin(enemy.yaw);
  const wx = ox - enemy.x;
  const wz = oz - enemy.z;
  const lx = wx * c - wz * s;
  const lz = wx * s + wz * c;
  const ldx = dx * c - dz * s;
  const ldz = dx * s + dz * c;
  const yBase = enemy.jumpY ?? 0;
  return rayVsAabb(lx, oy, lz, ldx, dy, ldz, {
    minX: -box.halfX - pad,
    minY: yBase - pad,
    minZ: -box.halfZ - pad,
    maxX: box.halfX + pad,
    maxY: yBase + def.height + pad,
    maxZ: box.halfZ + pad,
  });
}

/** 약점의 로컬 오프셋 — enemy.pose 가 있고 poseOffsets 표에 그 자세·그 약점이 있으면 표, 아니면 정의의 offset(normal).
 *  Stage 의 구체 배치와 판정이 이 한 함수를 쓴다(보이는 자리 = 판정 자리) */
export function weakPointOffset(
  def: { poseOffsets?: Record<string, Record<string, LocalVec3>> },
  wp: WeakPointDef,
  pose: string | undefined,
): LocalVec3 {
  if (pose !== undefined) {
    const table = def.poseOffsets?.[pose];
    const off = table?.[wp.id];
    if (off) return off;
  }
  return wp.offset;
}

/** 로컬 벡터를 적의 yaw 로 월드에 돌린다 — 정면 (0,0,-1) 이 (-sin yaw, -cos yaw) 로 간다(rayHitsEnemy 의 역회전과 짝) */
function rotateLocalByYaw(v: LocalVec3, yaw: number): { x: number; y: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** 약점 구체의 월드 중심 — 적 발 위치 + yaw 회전한 로컬 오프셋, 공중이면 jumpY 만큼 뜬다.
 *  부위 높이 비율이 jumpY 를 빼지 않던 옛 버그(기획서 §4.2)를 여기서는 처음부터 포함한다 */
export function weakPointWorldPos(
  enemy: { x: number; z: number; yaw: number; jumpY?: number; pose?: string },
  def: { poseOffsets?: Record<string, Record<string, LocalVec3>> },
  wp: WeakPointDef,
): { x: number; y: number; z: number } {
  const off = weakPointOffset(def, wp, enemy.pose);
  const r = rotateLocalByYaw(off, enemy.yaw);
  return { x: enemy.x + r.x, y: (enemy.jumpY ?? 0) + r.y, z: enemy.z + r.z };
}

/** 이 약점이 지금 판정을 받는가(기획서 §4.2 "노출 아닐 때는 판정 자체가 없다") — 내구가 0(파열)이면 닫힘.
 *  열림 = 노출 타이머(enemy.exposure[id] > 0 — 패링·완벽 회피가 연다) 또는 자세 노출(enemy.pose ∈ wp.exposedStates — 눈은 head_down).
 *  혼절(pose stunned) 중 눈이 닫히는 것도 이 규칙에서 나온다(stunned 는 눈의 exposedStates 에 없다). Weapons·Projectiles·Stage 공용 */
export function weakPointOpen(
  enemy: { weakHp?: Record<string, number>; exposure?: Record<string, number>; pose?: string },
  wp: WeakPointDef,
): boolean {
  const hp = enemy.weakHp?.[wp.id];
  if (hp !== undefined && hp <= 0) return false;
  if ((enemy.exposure?.[wp.id] ?? 0) > 0) return true;
  return enemy.pose !== undefined && (wp.exposedStates?.includes(enemy.pose) ?? false);
}

export interface WeakPointHit {
  wp: WeakPointDef;
  /** 레이 진입 t (방향 벡터 길이 기준 — 호출부가 정규화 방향을 넣으면 미터) */
  t: number;
}

/** 총알·화살·화염구 레이가 약점 구체에 닿는가 — 열린 약점 중 가장 가까운 것(Weapons·Projectiles 공용).
 *  원뿔 조건: dot(레이 방향, 월드 facing) ≤ −cos(coneDeg/2) — 정면 반구(눈·심장·분출공)나 그쪽 옆(관절)에서만 성립해
 *  등 뒤에서 몸을 뚫고 눈을 맞히거나 오른쪽에서 왼 관절을 맞힐 수 없다.
 *  몸 AABB 와는 독립이다 — 호출부가 "구체 승" 규칙으로 합친다(AABB 미명중 = +∞ 취급이라 구체 단독으로도 성립하고,
 *  관절·심장처럼 AABB 안에 있는 구체도 AABB 진입 t 와 무관하게 이긴다). pad 는 투사체 반지름 */
export function rayHitsWeakPoint(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  enemy: {
    x: number; z: number; yaw: number; jumpY?: number; pose?: string;
    weakHp?: Record<string, number>; exposure?: Record<string, number>; feigning?: boolean;
  },
  def: { weakPoints?: WeakPointDef[]; poseOffsets?: Record<string, Record<string, LocalVec3>> },
  pad: number,
): WeakPointHit | null {
  const wps = def.weakPoints;
  if (!wps || wps.length === 0 || enemy.feigning) return null;
  const dl = Math.hypot(dx, dy, dz);
  if (dl === 0) return null;
  const ndx = dx / dl;
  const ndy = dy / dl;
  const ndz = dz / dl;
  let best: WeakPointHit | null = null;
  for (const wp of wps) {
    if (!weakPointOpen(enemy, wp)) continue;
    const c = weakPointWorldPos(enemy, def, wp);
    const t = rayVsSphere(ox, oy, oz, dx, dy, dz, c.x, c.y, c.z, wp.radius + pad);
    if (t === null || (best && t >= best.t)) continue;
    // 원뿔 — facing 을 월드로 돌려 정규화하고 레이 방향과 마주보는지 본다
    const f = rotateLocalByYaw(wp.facing, enemy.yaw);
    const fl = Math.hypot(f.x, f.y, f.z) || 1;
    const dot = (ndx * f.x + ndy * f.y + ndz * f.z) / fl;
    const coneDeg = wp.coneDeg ?? balance.weakPoint.defaultConeDeg;
    if (dot > -Math.cos((coneDeg / 2) * (Math.PI / 180))) continue;
    best = { wp, t };
  }
  return best;
}
