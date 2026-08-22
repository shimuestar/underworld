// 전역 게임 상태 컨테이너. 시스템은 서로를 import 하지 않고
// 이 객체의 상태와 이벤트 버스를 통해서만 통신한다.

import type { Events } from './Events';
import type { InputSnapshot } from './Input';
import type { SigilSlot } from './SigilData';
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
  /** 방어 중 (우클릭 홀드) — 정면 피해 경감, 이동·사격 제한 */
  blocking: boolean;
  /** 우클릭을 누르고 있는 누적 틱 — tapThreshold 이내에 떼면 패링 */
  reactionHeldTicks: number;
  /** 피격 밀림 잔여 틱 + 틱당 밀림량 (PlayerMove가 소비) */
  kbTicks?: number;
  kbX?: number;
  kbZ?: number;
}

export interface SigilState {
  /** 소지 중(효과 없음). 부착해야 발동 — economy.md §4 */
  inventory: string[];
  equipped: Record<SigilSlot, string | null>;
  /** 흉터 — 해제해도 잔존하는 페널티 비율 (0 또는 scarRatio, 누적 최댓값) */
  scars: Record<SigilSlot, number>;
}

/** 제단 공격성 보너스용 구간 전투 통계. 제단 진입 시 리셋 */
export interface CombatStats {
  meleeKills: number;
  totalKills: number;
  perfectParries: number;
  encounters: number;
  cleanEncounters: number;
  damagedThisEncounter: boolean;
}

/** 부착된 각인·부위 페널티에서 매번 재계산되는 파생 수치. Sigils가 갱신한다 */
export interface Modifiers {
  reloadTimeMul: number;
  lanternIntensityMul: number;
  aimSpreadMul: number;
  /** 피격 시 소실되는 마나 비율 (heart 페널티: 1.0 = 전량) */
  manaLostOnHit: number;
  flashbangSelfDamage: boolean;
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
  kind?: 'fireball' | 'magic' | 'arrow' | 'rock' | 'grenade';
}

export interface SpellState {
  cooldown: number;
}

/** 바닥에 떨어진 각인. 접근하면 획득 */
export interface GroundItemState {
  id: number;
  /** 바닥 아이템 종류 — 줍는 주체가 다르다 (sigil: Sigils / potion·gold: Pickups) */
  kind: 'sigil' | 'potion' | 'gold';
  x: number;
  z: number;
  /** kind==='sigil' 일 때만 */
  sigilId?: string;
  /** kind==='gold' 일 때 획득량 */
  amount?: number;
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

export type WeaponKind = 'hammer' | 'grenade' | 'pistol';

export interface WeaponState {
  /** 선택된 무기 (1=hammer, 2=grenade, 3=pistol) */
  active: WeaponKind;
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
  /** 해머/수류탄 공용 스윙 쿨다운 */
  meleeCooldown: number;
  /** 수류탄 차징 누적 틱 (홀드 중) */
  grenadeCharge: number;
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
  | 'staggered';

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
  /** 화상 잔여 틱 (Projectiles가 피해 적용) */
  burnTicks: number;
  burnDamagePerTick: number;
  /** 보스 (boss_two_phase) 전용 */
  phase?: 'melee' | 'armored';
  armorHealth?: number;
  parryStreak?: number;
  /** 현재 공격이 근접인지 원거리인지 (windup~recover 동안 유지) */
  attackMode?: 'melee' | 'ranged';
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

  /** 보유 골드 — 적 처치 드랍으로 모인다 (사용처는 이후 구역) */
  gold = 0;

  /** 마지막으로 진입한 제단 (리스폰 지점). 없으면 사망 시 완전 재시작 */
  respawn: { x: number; z: number } | null = null;

  /** 제단 반경 안 (프롬프트 표시용, Altar가 갱신) */
  nearAltar = false;
  /** 이번 접근에서 이미 진입했는가 (우회 판정용) */
  altarEnteredThisApproach = false;

  /** 현 구역 탄약 상한 배율 (제단 공격성 보너스) */
  altarBonusMul = 1;

  /** 오염 25 임계 — 벽의 문자 해독 */
  canReadGlyphs = false;

  /** 구역 클리어 — 시뮬레이션 정지 */
  cleared = false;
  /** 출구 접근 중 잠김 안내 중복 방지 */
  exitLockedNotified = false;

  /** 당겨진 레버 ("row-col") — 레버는 1회용 */
  pulledLevers = new Set<string>();

  combatStats: CombatStats = {
    meleeKills: 0,
    totalKills: 0,
    perfectParries: 0,
    encounters: 0,
    cleanEncounters: 0,
    damagedThisEncounter: false,
  };
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
    this.level = init.level;
  }
}
