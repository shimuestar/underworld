// 타겟 락온 (R3, 소울라이크) — 획득(중앙 최근접)·토글·자동 전환·거리 해제·
// 카메라 추적·스틱 튕김 전환·죽은 척 제외

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as PlayerMove from './PlayerMove';
import * as Sigils from './Sigils';

const DT = 1 / 60;
const LK = balance.input.gamepad.lockOn;

function makeWorld(): World {
  const level = new Level({
    id: 'lockrange',
    name: 'lockrange',
    cellSize: 4,
    ceiling: 4,
    grid: ['#'.repeat(12), '#S' + '.'.repeat(9) + '#', '#' + '.'.repeat(10) + '#', '#' + '.'.repeat(10) + '#', '#'.repeat(12)],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 8, y: 0, z: 10, prevX: 8, prevY: 0, prevZ: 10,
      yaw: -Math.PI / 2, pitch: 0, health: balance.player.healthMax, // +X 를 본다
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: {
      inventory: [],
      equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null },
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

function add(type: string, x: number, z: number, id: number): EnemyState {
  const e = spawnEnemyAt(type, x, z, id);
  e.ai = 'chase';
  world.enemies.push(e);
  return e;
}

function press(): void {
  world.input = { ...Input.emptySnapshot(), lockOnPressed: true };
  PlayerMove.tick(world, DT);
  world.input = Input.emptySnapshot();
}

function idle(n: number): void {
  for (let i = 0; i < n; i++) {
    world.input = Input.emptySnapshot();
    PlayerMove.tick(world, DT);
  }
}

function yawOffTo(x: number, z: number): number {
  const off = Math.atan2(-(x - world.player.x), -(z - world.player.z)) - world.player.yaw;
  return Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
}

describe('타겟 락온', () => {
  it('획득 — 화면 중앙에 가장 가까운 적이 잡히고, 다시 누르면 풀린다', () => {
    add('goblin_runner', 16, 13, 11); // 중앙에서 먼 쪽
    const center = add('goblin_runner', 16, 10.5, 12); // 거의 정면
    press();
    expect(world.lockOnId).toBe(center.id);
    press();
    expect(world.lockOnId).toBeNull();
  });

  it('허탕 — 대상이 없으면 lockon_fail 만 나고 잡히지 않는다', () => {
    let failed = false;
    world.events.on('lockon_fail', () => (failed = true));
    press();
    expect(world.lockOnId).toBeNull();
    expect(failed).toBe(true);
  });

  it('죽은 척 구울은 잡히지 않는다 — 위장 유지', () => {
    const g = add('ghoul', 16, 10, 13);
    g.feigning = true;
    press();
    expect(world.lockOnId).toBeNull();
  });

  it('카메라 추적 — 옆에 있는 대상을 향해 시선이 상한 속도로 수렴한다', () => {
    const e = add('goblin_runner', 15, 13, 14); // 오른쪽 앞 23도 — 획득 시야각(반각 30도) 안
    press();
    expect(world.lockOnId).toBe(e.id);
    const off0 = yawOffTo(e.x, e.z);
    idle(5);
    const off5 = yawOffTo(e.x, e.z);
    expect(off5).toBeLessThan(off0); // 다가간다
    idle(60);
    expect(yawOffTo(e.x, e.z)).toBeLessThan(0.02); // 사실상 정조준
  });

  it('대상이 죽으면 근처의 다음 적으로 자동 전환, 아무도 없으면 해제', () => {
    const a = add('goblin_runner', 16, 10.5, 15);
    const b = add('goblin_runner', 14, 13, 16);
    press();
    expect(world.lockOnId).toBe(a.id);
    a.alive = false;
    idle(1);
    expect(world.lockOnId).toBe(b.id); // 자동 전환
    b.alive = false;
    idle(1);
    expect(world.lockOnId).toBeNull(); // 해제
  });

  it('사거리를 벗어나면 놓친다', () => {
    const e = add('goblin_runner', 16, 10.5, 17);
    press();
    expect(world.lockOnId).toBe(e.id);
    e.x = 8 + LK.breakRange + 3; // 해제 거리 밖으로
    idle(1);
    expect(world.lockOnId).toBeNull();
  });

  it('오른스틱 튕김 — 화면 그 쪽의 다른 적으로 전환한다', () => {
    const mid = add('goblin_runner', 16, 10.2, 18); // 거의 정면 — 먼저 잡힌다
    const right = add('goblin_runner', 14, 13, 19); // 화면 오른쪽 (+z 쪽)
    press();
    expect(world.lockOnId).toBe(mid.id);
    // 시선이 mid 에 붙게 잠깐 두고, 오른쪽으로 튕긴다
    idle(30);
    world.input = { ...Input.emptySnapshot(), padLookAxisX: 0.9 };
    PlayerMove.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(world.lockOnId).toBe(right.id);
  });
});
