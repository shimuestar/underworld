// 패드 에임 어시스트 — 마찰(적 위에서 스틱이 무거워진다), 자석(스틱을 움직일 때만
// 살짝 끌린다), 손 떼면 무반응, 잠복은 밀고하지 않는다. 마우스는 영향 없음.

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
const SENS = balance.input.mouseSensitivity;
const AA = balance.input.gamepad.aimAssist;

function makeWorld(): World {
  const level = new Level({
    id: 'aimrange',
    name: 'aimrange',
    cellSize: 4,
    ceiling: 4,
    grid: ['#'.repeat(10), '#S' + '.'.repeat(7) + '#', '#' + '.'.repeat(8) + '#', '#' + '.'.repeat(8) + '#', '#'.repeat(10)],
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

function add(type: string, x: number, z: number): EnemyState {
  const e = spawnEnemyAt(type, x, z, 900 + world.enemies.length);
  e.ai = 'chase';
  world.enemies.push(e);
  return e;
}

function padLookTick(dx: number): void {
  world.input = { ...Input.emptySnapshot(), padLookDX: dx };
  PlayerMove.tick(world, DT);
  world.input = Input.emptySnapshot();
}

/** 목표를 겨눈 요(yaw)와의 각 거리 — 자석 검증용 */
function yawOffTo(x: number, z: number): number {
  const off = Math.atan2(-(x - world.player.x), -(z - world.player.z)) - world.player.yaw;
  return Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
}

describe('패드 에임 어시스트', () => {
  it('마찰 — 조준점이 적 위에 있으면 같은 스틱 입력에 시선이 덜 돈다', () => {
    const yaw0 = world.player.yaw;
    padLookTick(0.5); // 적 없음 — 온전한 감도
    const freeTurn = Math.abs(world.player.yaw - yaw0);
    expect(freeTurn).toBeCloseTo(0.5 * SENS, 6);

    world = makeWorld();
    add('goblin_runner', 16, 10); // 정면 8m — 원뿔 안
    const yaw1 = world.player.yaw;
    padLookTick(0.5);
    const assistedTurn = Math.abs(world.player.yaw - yaw1);
    // 마찰 배율만큼 무거워졌다 (자석이 약간 보태므로 상한만 느슨히)
    expect(assistedTurn).toBeLessThan(freeTurn * (AA.frictionMul + 0.25));
  });

  it('자석 — 스틱을 움직이는 동안 조준이 적 쪽으로 끌리고, 손 떼면 끌리지 않는다', () => {
    const e = add('goblin_runner', 16, 10.8); // 정면에서 살짝 옆 — 자석 원뿔 안
    const off0 = yawOffTo(e.x, e.z);
    // 손 뗌 — 아무 일도 없다
    world.input = Input.emptySnapshot();
    PlayerMove.tick(world, DT);
    expect(yawOffTo(e.x, e.z)).toBeCloseTo(off0, 9);
    // 스틱을 아주 살짝만 움직여도(전진 회전과 무관한 미세값) 끌림이 붙는다
    for (let i = 0; i < 10; i++) padLookTick(0.0001);
    expect(yawOffTo(e.x, e.z)).toBeLessThan(off0); // 적 쪽으로 좁혀졌다
  });

  it('마우스는 어시스트와 무관하다 — 적 위에서도 온전한 감도', () => {
    add('goblin_runner', 16, 10);
    const yaw0 = world.player.yaw;
    world.input = { ...Input.emptySnapshot(), lookDX: 0.5 }; // 마우스만
    PlayerMove.tick(world, DT);
    expect(Math.abs(world.player.yaw - yaw0)).toBeCloseTo(0.5 * SENS, 6);
  });

  it('몸 위에 오르면 끌림이 멈춘다 — 덩치 큰 적 머리를 자유롭게 노린다', () => {
    add('ghoul', 16, 10); // 키 1.85 — 정면 8m
    // 조준을 머리 높이(실루엣 안 위쪽)로 — 세로 끌림이 0 이어야 한다
    world.player.pitch = 0.015; // 머리께 — 정수리(0.0197rad) 바로 아래, 실루엣 안
    const pitch0 = world.player.pitch;
    const yaw0 = world.player.yaw;
    // 이동 스틱만 젓는 상태 — 자석 조건은 살아 있다
    for (let i = 0; i < 20; i++) {
      world.input = { ...Input.emptySnapshot(), padMoveActive: true };
      PlayerMove.tick(world, DT);
    }
    expect(world.player.pitch).toBeCloseTo(pitch0, 9); // 중심(가슴)으로 안 끌려 내려간다
    expect(world.player.yaw).toBeCloseTo(yaw0, 9); // 이미 몸 위 — 가로 끌림도 없다
  });

  it('몸 밖에서는 실루엣 가장자리까지 끌린다 — 붙는 순간 멈춘다', () => {
    const e = add('ghoul', 16, 10.9); // 옆으로 어긋남(6.4도) — 자석 원뿔 안, 몸 밖
    for (let i = 0; i < 60; i++) {
      world.input = { ...Input.emptySnapshot(), padMoveActive: true };
      PlayerMove.tick(world, DT);
    }
    // 중심까지 다 끌려가지 않고 가장자리 언저리에서 멈춘다
    const centerOff = yawOffTo(e.x, e.z);
    const halfW = Math.atan2(0.42 * 0.9, Math.hypot(e.x - 8, e.z - 10));
    expect(centerOff).toBeGreaterThan(halfW * 0.5); // 중심 고정이 아니다
    expect(centerOff).toBeLessThanOrEqual(halfW + 0.002); // 몸 가장자리엔 붙었다
  });

  it('잠복한 적은 밀고하지 않는다 — 천장 거머리 위에서 마찰이 없다', () => {
    const l = add('leech', 16, 10);
    l.lurking = true;
    const yaw0 = world.player.yaw;
    padLookTick(0.5);
    expect(Math.abs(world.player.yaw - yaw0)).toBeCloseTo(0.5 * SENS, 6); // 온전한 감도
  });
});
