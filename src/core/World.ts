// 전역 게임 상태 컨테이너. 시스템은 서로를 import 하지 않고
// 이 객체의 상태와 이벤트 버스를 통해서만 통신한다.

import type { ProjectileSplashDef } from './Entities';
import type { SigilSlot } from './SigilData';
import type { Events } from './Events';
import type { InputSnapshot } from './Input';
import type { Level } from '../level/GridLoader';

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  /** 렌더 보간용 직전 틱 위치 */
  prevX: number;
  prevY: number;
  prevZ: number;
  /** 라디안. yaw 0 = -Z 방향 */
  yaw: number;
  pitch: number;
  health: number;
  /** 패링 실패 경직 잔여 틱. >0이면 이동/사격/반응 불가 */
  stunTicks: number;
  /** 회피 대시 잔여 틱 */
  dodgeTicks: number;
  dodgeDirX: number;
  dodgeDirZ: number;
  /** 회피 무적 잔여 틱 */
  iframeTicks: number;
  /** 히트스톱 중 눌린 반응 입력의 버퍼 잔여 틱 */
  reactionBufferTicks: number;
  /** 질주 키를 마지막으로 누른 뒤 남은 연타 인정 틱 (0 = 창 닫힘) */
  sprintTapTicks?: number;
  /** 조금 이르게 누른 패링의 유효 잔여 틱 — 무기가 도달하면 그때 성립한다 */
  parryBufferTicks?: number;
  /** 방어 중 (Shift 홀드) — 정면 피해 경감, 이동·사격 제한 */
  blocking: boolean;
  /** Space를 누르고 있는 누적 틱 — tapThreshold 이내에 떼면 패링 */
  reactionHeldTicks: number;
  /** 피격 밀림 잔여 틱 + 틱당 밀림량 (PlayerMove가 소비) */
  kbTicks?: number;
  kbX?: number;
  kbZ?: number;
  /** 거미줄 — 벗겨내는 데 남은 해머 타수. 0보다 크면 걸린 상태(느려진다).
   *  시간이나 이동으로는 풀리지 않는다 — 오직 해머만 */
  webSwingsLeft?: number;
}

export interface SigilState {
  /** 소지 중(효과 없음). 부착해야 발동 — economy.md §4 */
  inventory: string[];
  /** 부위에 새겨진 패시브 스킬 — 새겨야 켜진다. 액티브는 부위와 무관 (skillSlots) */
  equipped: Record<SigilSlot, string | null>;
}

/** 부착된 각인에서 매번 재계산되는 파생 수치. Sigils가 갱신한다.
 *  (2026-08: 부위 페널티 폐지 — 각인은 순수 강화이고 대가는 오염으로만 치른다) */
export interface Modifiers {
  dodgeDistanceMul: number;
  dodgeIFrameTicks: number;
  /** 암시야 — 렌더 ambient 가산 계수 */
  ambientVisionBoost: number;
}

export interface CorruptionState {
  /** 몸에 반영된 값 (제단 정산 후) */
  applied: number;
  /** 아직 정산되지 않은 누적분 */
  pending: number;
}

export interface ProjectileState {
  id: number;
  /** player: 적 명중 판정 / enemy: 플레이어 명중 판정 */
  owner: 'player' | 'enemy';
  x: number;
  y: number;
  z: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  vx: number;
  vy: number;
  vz: number;
  lifeTicks: number;
  damage: number;
  burnTicks: number;
  burnDamagePerTick: number;
  radius: number;
  /** 반사된 투사체 — 방어막을 무시한다 */
  deflected?: boolean;
  /** 시전자 (반사 시 되돌아갈 대상) */
  casterId?: number;
  /** 반응 버튼으로 반사 가능한가 (마법탄 true, 화살 false) */
  deflectable?: boolean;
  /** 렌더 형태 */
  kind?: 'fireball' | 'magic' | 'arrow' | 'rock' | 'grenade' | 'web';
  /** 착탄 시 광역 효과. 시전자가 죽어도 남도록 투사체가 들고 다닌다.
   *  반사되면 그대로 적에게 터진다 */
  splash?: ProjectileSplashDef;
  /** 맞은 플레이어가 거미줄에 걸린다 (큰 거미) */
  appliesWeb?: boolean;
  /** 플레이어 투사체로 공중에서 부술 수 있다 (족장이 던진 바위) */
  breakable?: boolean;
  /** 회수 가능한 내 화살 — 꽂히거나 적을 맞히면 바닥 아이템으로 남는다.
   *  적 궁수의 화살은 이 표식이 없어 렌더 잔존물로만 남는다 */
  recoverable?: boolean;
}

export interface SpellState {
  /** (구) 전역 쿨다운 — 지금은 스킬별 cooldowns 를 쓴다 */
  cooldown: number;
  /** 스킬 id → 남은 쿨다운 틱 */
  cooldowns?: Record<string, number>;
}

/** 바닥에 떨어진 각인. 접근하면 획득 */
/** 보물상자 — E로 한 번 열면 골드 무더기와 각인 하나가 쏟아진다 */
/** 적을 (dirX,dirZ) 쪽으로 distance 만큼 ticks 동안 밀어낸다.
 *  밀리는 동안 적은 아무것도 못 한다 (Enemies 가 kbTicks 를 보고 멈춘다).
 *  방향을 부르는 쪽이 주는 이유: 때린 사람에게서 밀려나는 경우(처형·해머)와
 *  폭심에서 밀려나는 경우(폭발통·수류탄)가 있어 기준점이 하나가 아니다.
 *  balance 는 호출부가 읽어 넘긴다 (pushPlayer 와 같은 규약) */
export function pushEnemy(
  enemy: EnemyState,
  dirX: number,
  dirZ: number,
  distance: number,
  ticks: number,
): void {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0 || ticks <= 0 || distance <= 0) return;
  enemy.kbTicks = ticks;
  enemy.kbX = (dirX / len) * (distance / ticks);
  enemy.kbZ = (dirZ / len) * (distance / ticks);
}

/** 적이 플레이어를 알아챘다 — 추격으로 넘기고 멈칫 시간을 건다.
 *  깨우는 곳이 여섯 군데(시야·랜턴·보스 포효·총소리·화염구·폭발통)라 한 군데서만
 *  멈칫을 걸면 나머지는 느낌표가 뜨자마자 달려든다. balance 는 호출부가 읽어 넘긴다
 *  (pushPlayer 와 같은 규약 — World 는 데이터에 의존하지 않는다) */
export function alertEnemy(enemy: EnemyState, noticeTicks: number): void {
  enemy.ai = 'chase';
  enemy.noticeTicks = noticeTicks;
}

/** 문 잠금을 통째로 푼다 — 레버가 부른다. 미닫이와 개방은 Door 가 이어서 돌리므로
 *  레버는 이 한 줄만 건드리면 된다. balance 는 호출부가 읽어 넘긴다
 *  (pushPlayer·spendStamina 와 같은 규약 — World 는 데이터에 의존하지 않는다) */
export function unlockDoor(door: DoorState, openTicks: number): boolean {
  if (door.opened || door.progress >= openTicks) return false;
  door.progress = openTicks;
  return true;
}

/** 잠긴 문 하나. 격자 정보(위치·미닫이 방향)는 Level.doors 에서 그대로 옮겨 온다 */
export interface DoorState {
  row: number;
  col: number;
  x: number;
  z: number;
  /** 미닫이가 밀려 들어갈 방향 (셀 단위, 둘 중 하나만 0이 아니다) */
  dirX: number;
  dirZ: number;
  /** 레버로만 열리는 관문(G)인가 — 문 앞에서 E 를 눌러도 안 열린다 */
  byLever: boolean;
  /** 잠금을 푸는 중 진행 틱. 0 이면 아무도 손대지 않은 상태 */
  progress: number;
  /** 미닫이 진행 0~1. 1 이 되는 틱에 통행이 열린다 */
  slide: number;
  /** 렌더 보간용 직전 값 */
  prevSlide: number;
  opened: boolean;
}

export interface ChestState {
  id: number;
  x: number;
  z: number;
  opened: boolean;
  blocker?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** 폭발통 — 총·해머로 여러 대 때리면 도화선이 짧아지고, 화염구·수류탄은 즉발 */
export interface BarrelState {
  id: number;
  x: number;
  z: number;
  alive: boolean;
  /** 총·해머로 맞은 누적 횟수 */
  hits: number;
  /** 점화됐으면 0 이상 — 0이 되는 틱에 터진다. -1 은 아직 멀쩡 */
  fuseTicks: number;
  /** 몸으로 막는 등록 핸들 (터질 때 뺀다) */
  blocker?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** 가방에 들어가는 소모품 종류. 골드·각인은 가방을 쓰지 않는다 */
export type ItemKind = 'potion' | 'mana' | 'food';

export const ITEM_KINDS: ItemKind[] = ['potion', 'mana', 'food'];

/** 가방 한 칸 — 같은 종류가 count 개 쌓여 있다. 빈 칸은 null */
export interface InventorySlot {
  kind: ItemKind;
  count: number;
}

/** 생명 입자 — 처치 시 흩뿌려져 가까이 가면 빨려 들어온다 (systems/LifeMotes) */
export interface LifeMoteState {
  id: number;
  x: number;
  /** 렌더용 높이 — 로직은 XZ 만 본다 */
  y: number;
  z: number;
  ageTicks: number;
  /** 자석에 걸렸다 — 한번 걸리면 플레이어가 물러나도 계속 따라온다 */
  homing: boolean;
  speed: number;
}

export interface GroundItemState {
  id: number;
  /** 바닥 아이템 종류 — 줍는 주체가 다르다 (sigil: Sigils / potion·gold: Pickups) */
  kind: 'sigil' | 'potion' | 'mana' | 'food' | 'gold' | 'arrow';
  x: number;
  z: number;
  /** kind==='sigil' 일 때만 */
  sigilId?: string;
  /** kind==='gold' 일 때 획득량 */
  amount?: number;
  /** 자석 흡수 중 — 공중으로 떠서 플레이어에게 날아간다 */
  magnet?: boolean;
  /** 비행 중 높이와 현재 속도 (자석 상태에서만 의미 있음) */
  y?: number;
  speed?: number;
  /** 이 틱 수만큼은 자석에 안 걸린다 — 가방에서 버린 직후 도로 주워지는 것을 막는다 */
  noMagnetTicks?: number;

}

export interface ManaState {
  value: number;
  /** 연쇄 단계 (balance.chain.multipliers 인덱스, 상한은 배열 끝) */
  chainIndex: number;
  /** 활성 적이 0이 된 뒤 경과한 틱 (combatExitTicks 초과 시 휘발 시작) */
  outOfCombatTicks: number;
  inCombat: boolean;
}

export interface LanternState {
  on: boolean;
  battery: number;
  spares: number;
}

export type MeleeWeaponKind = 'hammer';
export type RangedWeaponKind = 'pistol' | 'grenade' | 'bow';
export type WeaponKind = MeleeWeaponKind | RangedWeaponKind;
/** 원거리 슬롯 교체 순서 (휠) */
export const RANGED_WEAPONS: RangedWeaponKind[] = ['pistol', 'bow', 'grenade'];

export interface WeaponState {
  /** 장착한 근접 무기 (우클릭) */
  melee: MeleeWeaponKind;
  /** 장착한 원거리 무기 (좌클릭, 휠로 교체) */
  ranged: RangedWeaponKind;
  /** 탄창 잔탄 */
  mag: number;
  /** 예비 탄약 (상한 balance.weapons.*.ammoMax) */
  reserve: number;
  /** 다음 발사까지 남은 틱 */
  cooldown: number;
  /** 장전 완료까지 남은 틱. 0이면 장전 중 아님 */
  reloading: number;
  /** 총구 화염 잔여 틱 (렌더가 읽는다) */
  muzzleFlash: number;
  /** 수류탄 소지 수 (소모성) */
  grenades: number;
  /** 화살 소지 수 (상한 balance.weapons.bow.ammoMax).
   *  가방(ItemKind)이 아니라 무기 탄약이다 — 권총 reserve 와 같은 자리 */
  arrows?: number;
  /** 시위를 당긴 틱 (0 = 안 당김). maxDrawTicks 에서 최대 */
  bowDraw?: number;
  /** 시위를 내린 뒤 잠금 — 좌클릭을 뗄 때까지 다시 안 당겨진다.
   *  없으면 취소한 다음 틱에 곧바로 다시 당겨져 취소가 취소가 아니게 된다 */
  bowDrawLocked?: boolean;
  /** 해머/수류탄 공용 스윙 쿨다운 */
  meleeCooldown: number;
  /** 후딜 중에 눌린 근접 입력을 기억하는 남은 틱 — 풀리는 즉시 이어 친다 */
  meleeBufferTicks?: number;
  /** 이번 연결에서 실제로 적을 때린 스윙 수 — 3타 모두 적중 판정에 쓴다.
   *  헛치면 0으로 끊기고, 연결이 끝나면(마무리·창 만료) 다시 0 */
  comboHits?: number;
  /** 적중 가속 — 해머가 실제로 적을 때린 뒤에만 켜진다. 다음 스윙의 예비동작과
   *  후딜이 줄고 뷰모델도 같은 배율로 빨라진다. 마무리 3타를 치거나 연결 창이
   *  끊기면 꺼진다 — 즉 1→2→3 안에서만 살아 있고 다음 1타는 다시 원속도다 */
  meleeRush?: boolean;
  /** 수류탄 차징 누적 틱 (홀드 중) */
  grenadeCharge: number;
  /** 휘두른 해머가 닿기까지 남은 틱 (0 = 진행 중인 스윙 없음) */
  swingImpact: number;
  /** 진행 중인 스윙이 마무리 강타인가 */
  swingHeavy: boolean;
  /** 해머 연속타 단계 (0=처음). finisherStep 에 도달하면 강타 */
  comboStep: number;
  /** 연속타가 유지되는 잔여 틱. 0이 되면 단계가 초기화된다 */
  comboTimer: number;
}

// 근접 적 공격 상태 머신 — docs/systems/combat.md §2.
// active_perfect가 active_normal보다 먼저 온다 (완벽 패링 = 가장 이른 순간).
export type EnemyAiState =
  | 'idle'
  | 'chase'
  | 'windup'
  | 'active_perfect'
  | 'active_normal'
  | 'impact'
  | 'recover'
  | 'staggered'
  /** 연사 — 제자리에서 일정 간격으로 여러 발 (족장 화살 세례) */
  | 'volley'
  /** 돌격 달리기 — 예고 뒤 타격 전까지 플레이어를 향해 달린다 */
  | 'charging';

export interface EnemyState {
  id: number;
  type: string;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  /** 바라보는 방향 (플레이어와 같은 규약: yaw 0 = -Z) */
  yaw: number;
  health: number;
  alive: boolean;
  ai: EnemyAiState;
  /** 현재 ai 상태의 남은 틱 */
  timer: number;
  /** 배치된 초기 방향 — 대기 중 시선 훑기의 기준축 */
  homeYaw?: number;
  /** 도약 중 지면에서 뜬 높이(m). 렌더 전용 — 판정은 XZ 평면 그대로다 */
  jumpY?: number;
  prevJumpY?: number;
  /** 마법 방어막에 해머를 맞은 횟수 / 깨졌는가 (warden) */
  barrierHits?: number;
  barrierBroken?: boolean;
  /** 화상 잔여 틱 (Projectiles가 피해 적용) */
  burnTicks: number;
  burnDamagePerTick: number;
  /** 서리 둔화 — 남은 틱과 속도 배율 (Projectiles 의 nova 가 건다, Enemies 가 줄인다) */
  slowTicks?: number;
  slowMul?: number;
  /** 보스 전용 — 연속 패링 누적 (parriesToStagger 도달 시 스태거) */
  parryStreak?: number;
  /** 현재 공격이 근접인지 원거리인지 (windup~recover 동안 유지) */
  attackMode?: 'melee' | 'ranged' | 'charge' | 'bash' | 'volley';
  /** 연사 남은 발수 / 재사용 대기 (족장 화살 세례) */
  volleyLeft?: number;
  volleyCooldown?: number;
  /** 거리 조건으로 나가는 돌격의 재사용 대기 (족장) */
  chargeCooldown?: number;
  /** 돌격이 겨눈 지점 — 예고가 끝나는 순간의 플레이어 좌표로 고정한다.
   *  달리는 동안 추적하면 이동으로 피할 수가 없다 */
  chargeTargetX?: number;
  chargeTargetZ?: number;
  /** 방패로 밀쳐낼 차례 (Weapons가 켜고 Enemies가 실행한다) */
  wantsBash?: boolean;
  /** 연속으로 방패에 막아낸 횟수 — 임계를 넘으면 밀쳐낸다 */
  blockedStreak?: number;
  /** 막아낸 기록이 사라지기까지 남은 틱 (연타를 멈추면 초기화) */
  blockedStreakTicks?: number;
  /** 다음 기회에 돌격을 시도한다 (크게 밀려난 직후 확률적으로 켜진다) */
  wantsCharge?: boolean;
  /** 피탄 경직 잔여 틱 — 발이 묶인다 (공격 진행은 막지 않는다. 총알용) */
  flinchTicks?: number;
  /** 강한 타격 경직 — 공격 중이라도 그 상태 그대로 굳는다 (해머용) */
  attackFreezeTicks?: number;
  /** 알아챈 직후 멈칫 — 이 틱 동안 몸만 돌리고 이동·공격을 하지 않는다.
   *  머리 위 느낌표를 읽을 틈을 주는 시간이다 (alertEnemy 가 건다) */
  noticeTicks?: number;
  /** 방패에 막히거나 패링당해 튕긴 직후인가 — recover 동안 뒤로 젖혀진 채 굳는다 */
  recoiled?: boolean;
  /** 헛친 직후인가 — recover 동안 마지막 동작으로 굳고 무방비가 된다 */
  whiffed?: boolean;
  /** 정면 방패가 부서졌는가 — 이후 투사체를 막지 못한다 */
  shieldBroken?: boolean;
  /** 이 적에게서 이미 회수 화살을 하나 떨궜는가.
   *  한 마리에 여러 대를 박아도 주울 수 있는 건 한 대뿐이다 — 없으면
   *  체력 높은 적에게 화살을 퍼부어 회수하는 무한 순환이 생긴다 */
  arrowDropped?: boolean;
  /** 방패가 해머 마무리 타를 받아낸 횟수 (금 → 파괴) */
  shieldHits?: number;
  /** 방패로 버티는 중 — 웅크린 채 아무 행동도 하지 않는다 */
  braceTicks?: number;
  /** 타격 진행도 0~1 (무기가 뻗어나가는 정도) 과 그 시점의 무기 끝 거리(중심 기준).
   *  패링은 이 값으로 판정한다 — 시간이 아니라 무기가 실제로 닿았는지 */
  strikeProgress?: number;
  weaponTipDist?: number;
  /** 캐스터 재배치 — 사선이 아군에 막힌 누적 틱 / 현재 횡이동 방향(+1·-1) */
  strafeBlockedTicks?: number;
  strafeDir?: number;
  /** 넉백 잔여 틱 + 틱당 밀림량 (해머 등) */
  kbTicks?: number;
  kbX?: number;
  kbZ?: number;
}

/** 피격 밀림 시작 — (dirX,dirZ) 방향으로 distance 만큼 ticks 동안 밀린다.
 *  balance는 호출하는 시스템이 읽어 넘긴다 (World는 데이터에 의존하지 않는다) */
export function pushPlayer(
  player: PlayerState,
  dirX: number,
  dirZ: number,
  distance: number,
  ticks: number,
): void {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0 || distance <= 0 || ticks <= 0) return;
  player.kbTicks = ticks;
  player.kbX = (dirX / len) * (distance / ticks);
  player.kbZ = (dirZ / len) * (distance / ticks);
}

/** 스태미너 소모 — 깎고 회복을 미룬다. 이번 소모로 바닥나면 true (호출한 시스템이
 *  stamina_empty 를 발행한다). pushPlayer 와 같은 규약: balance 는 호출부가 읽어 넘긴다 */
export function spendStamina(
  stamina: { value: number; regenDelay: number; exhausted: boolean },
  amount: number,
  regenDelayTicks: number,
): boolean {
  stamina.value = Math.max(0, stamina.value - amount);
  stamina.regenDelay = regenDelayTicks;
  if (stamina.value > 0 || stamina.exhausted) return false;
  stamina.exhausted = true;
  return true;
}

/** 폭발통에 총·해머가 한 대 들어갔다. 맞은 수만큼 도화선이 짧아진다 —
 *  이미 더 짧은 도화선이 돌고 있으면 늘리지 않는다.
 *  balance 는 호출하는 시스템이 읽어 넘긴다 (pushPlayer 와 같은 규약) */
export function hitBarrel(barrel: BarrelState, fuseByHits: readonly number[]): void {
  if (!barrel.alive) return;
  barrel.hits++;
  const fuse = fuseByHits[Math.min(barrel.hits, fuseByHits.length) - 1] ?? 0;
  barrel.fuseTicks = barrel.fuseTicks < 0 ? fuse : Math.min(barrel.fuseTicks, fuse);
}

/** 즉발 — 화염구·수류탄·다른 통의 폭발 */
export function igniteBarrel(barrel: BarrelState): void {
  if (!barrel.alive) return;
  barrel.fuseTicks = 0;
}

/** (sourceX, sourceZ)에서 오는 공격을 방어 중인가 — 정면 arcDeg 안일 때만 */
export function playerBlocks(
  world: World,
  sourceX: number,
  sourceZ: number,
  arcDeg: number,
): boolean {
  const p = world.player;
  if (!p.blocking) return false;
  const toX = sourceX - p.x;
  const toZ = sourceZ - p.z;
  const len = Math.hypot(toX, toZ);
  if (len === 0) return true;
  const facingX = -Math.sin(p.yaw);
  const facingZ = -Math.cos(p.yaw);
  const dot = (facingX * toX + facingZ * toZ) / len;
  return dot >= Math.cos(((arcDeg / 2) * Math.PI) / 180);
}

export class World {
  /** 시작 이후 경과한 시뮬레이션 틱 수. 모든 시간 판정의 기준. */
  tick = 0;

  /** 히트스톱 잔여 틱. 0보다 크면 시스템들이 상태 진행을 멈춘다 (입력 버퍼는 계속 받음). */
  freezeTicks = 0;

  /** 플레이어 사망 시 true. 시뮬레이션이 멈춘다. */
  dead = false;

  /** 각인 UI 등이 열려 있으면 true — 시뮬레이션 일시정지 */
  uiOpen = false;

  /** 이번 틱의 입력 스냅샷. 매 틱 시작 시 main이 갱신한다. */
  input: InputSnapshot;

  player: PlayerState;
  lantern: LanternState;
  weapon: WeaponState;
  mana: ManaState;
  sigils: SigilState;
  modifiers: Modifiers;
  corruption: CorruptionState;
  projectiles: ProjectileState[] = [];
  spell: SpellState = { cooldown: 0 };
  groundItems: GroundItemState[] = [];
  lifeMotes: LifeMoteState[] = [];

  /** 폭발통 — Barrels 가 도화선을 돌리고 터뜨린다 */
  barrels: BarrelState[] = [];

  /** 소모품 가방 — 빈 칸은 null. 칸 수는 Items.init 이 balance 를 읽어 잡는다
   *  (World 는 데이터에 의존하지 않는다 — pushPlayer 와 같은 규약) */
  inventory: (InventorySlot | null)[] = [];

  /** 퀵슬롯 — 1~5 키에 등록된 종류. 칸이 아니라 종류를 기억한다 (balance.items._bindNote) */
  quickslots: (ItemKind | null)[] = [];
  /** 스킬 퀵슬롯 — 액티브 스킬 id. 키보드 Z·X·C·V (Sigils.ensureSkillSlots 가 칸 수를 맞춘다) */
  skillSlots: (string | null)[] = [];
  /** 선택된 스킬 칸 — Q(패드 cycleSkill)로 회전, 가운데 클릭(패드 cast)으로 쓴다 */
  selectedSkill = 0;

  /** 소모품 공용 사용 쿨다운 — 한 프레임에 물약을 들이붓지 못하게 */
  itemCooldown = 0;

  /** 마시는 중 — 끝까지 가야 효과가 난다. 끊기면 아이템은 소모되지 않는다.
   *  PlayerMove 가 이걸 보고 걸음을 늦추고, 손 연출도 여기서 읽는다 */
  itemChannel: { kind: ItemKind; index: number; ticks: number; total: number } | null = null;

  /** 보물상자 — Chest 가 연다 */
  chests: ChestState[] = [];

  /** 지금 바라보고 있는 열 수 있는 상자 (없으면 null) — HUD 안내가 읽는다 */
  chestInView: ChestState | null = null;

  /** 보유 골드 — 적 처치 드랍으로 모인다 (사용처는 이후 구역) */
  /** 스태미너 — 질주로 닳고 회피로 크게 깎인다. 0이 되면 지쳐서 질주 불가 */
  stamina = { value: 0, regenDelay: 0, exhausted: false };

  gold = 0;

  /** 제단 상점 남은 재고 — 품목별. 비어 있으면 stock 만큼 있는 것으로 본다 */
  shopStock: Record<string, number> = {};
  /** 재고가 0이 된 품목이 다시 채워지는 tick.
   *  UI가 열린 동안은 시뮬레이션이 멈추므로 상점에 서서 기다려도 줄지 않는다 */
  shopReadyTick: Record<string, number> = {};

  /** 누적 경험치 — 적 처치 시 획득 (레벨업은 이후 구역) */
  xp = 0;

  /** 일시정지 중 — 렌더는 계속되지만 시뮬레이션은 멈춰 있다 */
  paused = false;

  /** 처형 연출 잔여 틱 — 그동안 모든 적이 멈춘다 (플레이어 동작을 보여주는 시간) */
  executeFocusTicks = 0;

  /** 마지막으로 진입한 제단 (리스폰 지점). 없으면 사망 시 완전 재시작 */
  respawn: { x: number; z: number } | null = null;

  /** 제단 반경 안 (프롬프트 표시용, Altar가 갱신) */
  nearAltar = false;
  /** 반경 안 + 제단을 바라보는 중 — E 안내와 진입 조건 */
  altarInView = false;
  /** 이번 접근에서 이미 진입했는가 (우회 판정용) */
  altarEnteredThisApproach = false;

  /** 오염 25 임계 — 벽의 문자 해독 */
  canReadGlyphs = false;

  /** 구역 클리어 — 시뮬레이션 정지 */
  cleared = false;
  /** 출구 접근 중 잠김 안내 중복 방지 */
  exitLockedNotified = false;
  /** 테스트용 무적 — HP·마나·탄약·배터리·스태미너가 소모되지 않는다 (G 토글) */
  godMode = false;
  /** 스킬 테스트(U · ?skills) — 켜 있는 동안 마나가 매 틱 최대치로 돌아온다 */
  skillTestMode = false;

  /** 출구 개방 여부 — 보스가 죽으면 열린다. 렌더·미니맵이 이 값을 본다 */
  exitOpen = false;
  /** 출구 발판 위에 서 있는가 — 봉인 안내를 계속 띄우기 위한 플래그 */
  onExitPad = false;

  /** 잠긴 문 — Door 가 E 채널을 돌리고 미닫이를 민다 (레버는 2026-08 폐지) */
  doors: DoorState[] = [];

  /** 지금 바라보고 있는 아직 안 열린 문 (없으면 null) — HUD 안내가 읽는다.
   *  관문(byLever)도 여기 잡힌다 — "이건 레버로만 열린다"를 알려 줘야 하므로 */
  doorInView: DoorState | null = null;

  /** 당겨진 레버 ("row-col") — 레버는 1회용 */
  pulledLevers = new Set<string>();

  /** 지금 바라보고 있는 아직 안 당긴 레버 (없으면 null) — HUD 안내가 읽는다 */
  leverInView: { row: number; col: number } | null = null;

  enemies: EnemyState[];
  level: Level;

  constructor(
    readonly events: Events,
    init: {
      input: InputSnapshot;
      player: PlayerState;
      lantern: LanternState;
      weapon: WeaponState;
      mana: ManaState;
      sigils: SigilState;
      modifiers: Modifiers;
      corruption: CorruptionState;
      enemies: EnemyState[];
      /** 폭발통 — 없는 레벨(테스트 아레나 등)에서는 생략한다 */
      barrels?: BarrelState[];
      chests?: ChestState[];
      level: Level;
    },
  ) {
    this.input = init.input;
    this.player = init.player;
    this.lantern = init.lantern;
    this.weapon = init.weapon;
    this.mana = init.mana;
    this.sigils = init.sigils;
    this.modifiers = init.modifiers;
    this.corruption = init.corruption;
    this.enemies = init.enemies;
    if (init.barrels) this.barrels = init.barrels;
    if (init.chests) this.chests = init.chests;
    this.level = init.level;
    this.doors = init.level.doors.map((d) => ({
      row: d.row,
      col: d.col,
      x: d.x,
      z: d.z,
      dirX: d.dirX,
      dirZ: d.dirZ,
      byLever: d.byLever,
      progress: 0,
      slide: 0,
      prevSlide: 0,
      opened: false,
    }));
  }
}
