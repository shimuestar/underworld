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
  // 에임 보정은 조준(LT) 중에만 산다 — 테스트도 조준 상태로 젓는다
  world.input = { ...Input.emptySnapshot(), padLookDX: dx, padAiming: true };
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
    world.player.padAimingPrev = true; // LT 는 이미 누른 상태 — 겨누기 시작 스냅 없이 자석만 본다
    const pitch0 = world.player.pitch;
    const yaw0 = world.player.yaw;
    // 이동 스틱만 젓는 상태 — 자석 조건은 살아 있다
    for (let i = 0; i < 20; i++) {
      world.input = { ...Input.emptySnapshot(), padMoveActive: true, padAiming: true };
      PlayerMove.tick(world, DT);
    }
    expect(world.player.pitch).toBeCloseTo(pitch0, 9); // 중심(가슴)으로 안 끌려 내려간다
    expect(world.player.yaw).toBeCloseTo(yaw0, 9); // 이미 몸 위 — 가로 끌림도 없다
  });

  it('몸 밖에서는 실루엣 가장자리까지 끌린다 — 붙는 순간 멈춘다', () => {
    const e = add('ghoul', 16, 10.9); // 옆으로 어긋남(6.4도) — 자석 원뿔 안, 몸 밖
    world.player.padAimingPrev = true; // LT 는 이미 누른 상태 — 스냅이 몸통 중심으로 데려가면 가장자리 규칙을 볼 수 없다
    for (let i = 0; i < 60; i++) {
      world.input = { ...Input.emptySnapshot(), padMoveActive: true, padAiming: true };
      PlayerMove.tick(world, DT);
    }
    // 중심까지 다 끌려가지 않고 가장자리 언저리에서 멈춘다
    const centerOff = yawOffTo(e.x, e.z);
    const halfW = Math.atan2(0.42 * 0.9, Math.hypot(e.x - 8, e.z - 10));
    expect(centerOff).toBeGreaterThan(halfW * 0.5); // 중심 고정이 아니다
    expect(centerOff).toBeLessThanOrEqual(halfW + 0.002); // 몸 가장자리엔 붙었다
  });

  it('천장에 붙은 거머리도 표적이다 — 올려다보면 마찰이 걸린다', () => {
    const l = add('leech', 16, 10);
    l.lurking = true;
    l.jumpY = 3.3; // 천장께 매달림
    world.player.pitch = 0.2; // 매달린 몸 쪽으로 올려다본다 (표적 0.248rad 근처)
    const yaw0 = world.player.yaw;
    padLookTick(0.5);
    expect(Math.abs(world.player.yaw - yaw0)).toBeLessThan(0.5 * SENS * 0.9); // 무거워졌다
  });

  it('죽은 척 구울은 밀고하지 않는다 — 시체 위에서 마찰이 없다', () => {
    const g = add('ghoul', 16, 10);
    g.feigning = true;
    const yaw0 = world.player.yaw;
    padLookTick(0.5);
    expect(Math.abs(world.player.yaw - yaw0)).toBeCloseTo(0.5 * SENS, 6); // 온전한 감도
  });
});

describe('겨누기 시작 스냅 (2026-09-04)', () => {
  const SNAP = AA.snap;
  function aimTick(): void {
    world.input = { ...Input.emptySnapshot(), padAiming: true };
    PlayerMove.tick(world, DT);
  }

  it('LT 를 누르는 순간 원뿔 안 적의 몸통으로 ticks 에 나눠 돌아간다 — 누른 채로는 다시 안 하고, 떼고 다시 누르면 또 한 번', () => {
    const e = add('goblin_runner', 16, 10.9); // 정면 8m, 옆으로 0.9m ≈ 6.4° — 원뿔(9°) 안
    const snapped: unknown[] = [];
    world.events.on('aim_snapped', (p) => snapped.push(p));
    const off0 = yawOffTo(e.x, e.z);
    expect(off0).toBeGreaterThan(0.05);
    for (let i = 0; i < SNAP.ticks; i++) aimTick();
    expect(yawOffTo(e.x, e.z)).toBeLessThan(1e-6);
    expect(snapped).toHaveLength(1);
    expect(snapped[0]).toMatchObject({ enemyId: e.id });
    // 적이 비켜서도 누른 채로는 따라가지 않는다 (스틱을 젓지 않으면 자석도 없다)
    e.z += 0.5;
    const off1 = yawOffTo(e.x, e.z);
    for (let i = 0; i < 10; i++) aimTick();
    expect(yawOffTo(e.x, e.z)).toBeCloseTo(off1, 9);
    // 떼고 다시 누르면 다시 한 번
    world.input = Input.emptySnapshot();
    PlayerMove.tick(world, DT);
    for (let i = 0; i < SNAP.ticks; i++) aimTick();
    expect(yawOffTo(e.x, e.z)).toBeLessThan(1e-6);
    expect(snapped).toHaveLength(2);
  });

  it('원뿔 밖 적은 건드리지 않고, 조준(LT) 없이는(마우스) 일어나지 않는다', () => {
    const e = add('goblin_runner', 16, 13); // ≈ 20.6° 옆 — 원뿔 밖
    const off0 = yawOffTo(e.x, e.z);
    for (let i = 0; i < SNAP.ticks; i++) aimTick();
    expect(yawOffTo(e.x, e.z)).toBeCloseTo(off0, 9);

    world = makeWorld();
    const e2 = add('goblin_runner', 16, 10.9);
    const off2 = yawOffTo(e2.x, e2.z);
    for (let i = 0; i < SNAP.ticks; i++) {
      world.input = { ...Input.emptySnapshot(), lookDX: 0 };
      PlayerMove.tick(world, DT);
    }
    expect(yawOffTo(e2.x, e2.z)).toBeCloseTo(off2, 9);
  });

  it('한 번에 maxDeg 까지만 돌린다 — 멀리 빗나간 건 고쳐 주지 않는다', () => {
    const savedCone = SNAP.coneDeg;
    const savedMax = SNAP.maxDeg;
    SNAP.coneDeg = 30; // 원뿔은 넓게, 상한은 좁게 — 상한만 본다
    SNAP.maxDeg = 3;
    try {
      add('goblin_runner', 16, 12); // ≈ 14° 옆
      const yaw0 = world.player.yaw;
      const pitch0 = world.player.pitch;
      for (let i = 0; i < SNAP.ticks; i++) aimTick();
      const turned = Math.hypot(world.player.yaw - yaw0, world.player.pitch - pitch0);
      expect(turned).toBeCloseTo((3 * Math.PI) / 180, 4);
    } finally {
      SNAP.coneDeg = savedCone;
      SNAP.maxDeg = savedMax;
    }
  });
});
