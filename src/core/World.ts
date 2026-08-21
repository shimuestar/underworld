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
}

export interface LanternState {
  on: boolean;
  battery: number;
  spares: number;
}

export class World {
  /** 시작 이후 경과한 시뮬레이션 틱 수. 모든 시간 판정의 기준. */
  tick = 0;

  /** 히트스톱 잔여 틱. 0보다 크면 시스템들이 상태 진행을 멈춘다 (입력 버퍼는 계속 받음). */
  freezeTicks = 0;

  /** 이번 틱의 입력 스냅샷. 매 틱 시작 시 main이 갱신한다. */
  input: InputSnapshot;

  player: PlayerState;
  lantern: LanternState;
  level: Level;

  constructor(
    readonly events: Events,
    init: { input: InputSnapshot; player: PlayerState; lantern: LanternState; level: Level },
  ) {
    this.input = init.input;
    this.player = init.player;
    this.lantern = init.lantern;
    this.level = init.level;
  }
}
