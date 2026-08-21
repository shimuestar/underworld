// 전역 게임 상태 컨테이너. 시스템은 서로를 import 하지 않고
// 이 객체의 상태와 이벤트 버스를 통해서만 통신한다.

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

export interface WeaponState {
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
}

export class World {
  /** 시작 이후 경과한 시뮬레이션 틱 수. 모든 시간 판정의 기준. */
  tick = 0;

  /** 히트스톱 잔여 틱. 0보다 크면 시스템들이 상태 진행을 멈춘다 (입력 버퍼는 계속 받음). */
  freezeTicks = 0;

  /** 플레이어 사망 시 true. 시뮬레이션이 멈춘다. */
  dead = false;

  /** 이번 틱의 입력 스냅샷. 매 틱 시작 시 main이 갱신한다. */
  input: InputSnapshot;

  player: PlayerState;
  lantern: LanternState;
  weapon: WeaponState;
  mana: ManaState;
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
      enemies: EnemyState[];
      level: Level;
    },
  ) {
    this.input = init.input;
    this.player = init.player;
    this.lantern = init.lantern;
    this.weapon = init.weapon;
    this.mana = init.mana;
    this.enemies = init.enemies;
    this.level = init.level;
  }
}
