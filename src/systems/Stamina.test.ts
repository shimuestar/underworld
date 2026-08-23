// 스태미너 — 질주 소모, 회피 소모, 탈진과 회복선.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as PlayerMove from './PlayerMove';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';
import * as Stamina from './Stamina';

const DT = 1 / 60;
const CFG = balance.player.stamina;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['########', '#S.....#', '#......#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 10, y: 0, z: 10, prevX: 10, prevY: 0, prevZ: 10,
      yaw: 0, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: {
      inventory: [],
      equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null },
      scars: { eye: 0, rightArm: 0, leftArm: 0, heart: 0, spine: 0 },
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  Stamina.init(world);
  return world;
}

/** 질주 입력으로 n틱 이동 */
function sprint(world: World, ticks: number, moving = true): void {
  for (let i = 0; i < ticks; i++) {
    world.input = { ...Input.emptySnapshot(), sprint: true, moveForward: moving ? 1 : 0 };
    PlayerMove.tick(world, DT);
    Stamina.tick(world, DT);
    world.input = Input.emptySnapshot();
  }
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('질주', () => {
  it('가득 찬 상태로 시작하고, 달리는 동안만 닳는다', () => {
    expect(world.stamina.value).toBe(CFG.max);
    sprint(world, 10);
    expect(world.stamina.value).toBeCloseTo(CFG.max - 10 * CFG.sprintDrainPerTick, 5);
  });

  it('제자리에서 쉬프트만 누르면 닳지 않는다', () => {
    sprint(world, 30, false);
    expect(world.stamina.value).toBe(CFG.max);
  });

  it('달리는 동안에는 회복하지 않는다 (regenDelay)', () => {
    sprint(world, 5);
    const after = world.stamina.value;
    sprint(world, 5);
    expect(world.stamina.value).toBeLessThan(after);
  });

  it('바닥나면 탈진 — 회복선까지 차야 다시 질주할 수 있다', () => {
    const empty: unknown[] = [];
    const recovered: unknown[] = [];
    world.events.on('stamina_empty', () => empty.push(1));
    world.events.on('stamina_recovered', () => recovered.push(1));

    sprint(world, Math.ceil(CFG.max / CFG.sprintDrainPerTick) + 1);
    expect(world.stamina.value).toBe(0);
    expect(world.stamina.exhausted).toBe(true);
    expect(empty).toHaveLength(1); // 한 번만

    // 탈진 중엔 쉬프트를 눌러도 평속이고 더 닳지도 않는다
    const x0 = world.player.x;
    sprint(world, 1);
    const sprintStep = balance.player.sprintSpeed * DT;
    expect(Math.abs(world.player.x - x0)).toBeLessThan(sprintStep - 1e-6);

    // 회복선(exhaustRecoverTo)에 닿는 순간 풀린다 — 그 전에는 계속 탈진
    world.input = Input.emptySnapshot();
    let ticks = 0;
    while (world.stamina.exhausted && ticks < 600) {
      expect(world.stamina.value).toBeLessThan(CFG.exhaustRecoverTo);
      Stamina.tick(world, DT);
      ticks++;
    }
    expect(world.stamina.exhausted).toBe(false);
    expect(world.stamina.value).toBeGreaterThanOrEqual(CFG.exhaustRecoverTo);
    expect(recovered).toHaveLength(1);
  });

  it('쉬면 회복한다 — 단 한동안 기다린 뒤에야 (regenDelayTicks)', () => {
    sprint(world, 60); // 상한에 부딪히지 않게 넉넉히 쓴다
    const spent = world.stamina.value;
    expect(spent).toBeLessThan(CFG.max - 12 * CFG.regenPerTick);
    world.input = Input.emptySnapshot();

    // 지연 구간 동안은 미동도 없다
    for (let i = 0; i < CFG.regenDelayTicks - 2; i++) Stamina.tick(world, DT);
    expect(world.stamina.value).toBe(spent);

    // 지연이 풀리면 regenPerTick 씩 오른다
    for (let i = 0; i < 12; i++) Stamina.tick(world, DT);
    expect(world.stamina.value).toBeGreaterThan(spent);
    const mid = world.stamina.value;
    Stamina.tick(world, DT);
    expect(world.stamina.value).toBeCloseTo(mid + CFG.regenPerTick, 5);
  });
});

describe('회피', () => {
  function dodge(world: World): void {
    world.input = { ...Input.emptySnapshot(), reactionPressed: true, sprint: true };
    Reaction.tick(world, DT);
    world.input = Input.emptySnapshot();
  }

  it('질주보다 훨씬 크게 깎인다 — dodgeCost 만큼', () => {
    dodge(world);
    expect(world.player.dodgeTicks).toBe(balance.reaction.dodgeDashTicks);
    expect(world.stamina.value).toBe(CFG.max - CFG.dodgeCost);
    expect(CFG.dodgeCost).toBeGreaterThan(CFG.sprintDrainPerTick * 10);
  });

  it('모자라면 회피가 아예 나가지 않는다 — 스태미너도 그대로', () => {
    world.stamina.value = CFG.dodgeCost - 1;
    const blocked: { action: string }[] = [];
    world.events.on('stamina_blocked', (payload) => blocked.push(payload as { action: string }));

    dodge(world);
    expect(world.player.dodgeTicks).toBe(0);
    expect(world.stamina.value).toBe(CFG.dodgeCost - 1);
    expect(blocked[0]).toMatchObject({ action: 'dodge' });
  });
});
