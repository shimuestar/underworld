// 랜턴 — 토글, 소모, 전지 교체. 방전 후 교체는 즉시 다시 켜진다.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Lantern from './Lantern';
import * as Sigils from './Sigils';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['####', '#S.#', '####'],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: 0, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 2 },
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

function pressSwap(world: World): void {
  world.input = { ...Input.emptySnapshot(), batterySwap: true };
  Lantern.tick(world, DT);
  world.input = Input.emptySnapshot();
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('전지 교체', () => {
  it('방전으로 꺼졌다면 교체 즉시 다시 켜진다', () => {
    world.lantern.battery = 0;
    world.lantern.on = false;
    const toggles: { on: boolean }[] = [];
    world.events.on('lantern_toggled', (payload) => toggles.push(payload as { on: boolean }));

    pressSwap(world);
    expect(world.lantern.battery).toBeCloseTo(
      balance.lantern.batteryMax - balance.lantern.drainPerTick, // 켜졌으니 그 틱부터 닳는다
    );
    expect(world.lantern.on).toBe(true);
    expect(world.lantern.spares).toBe(1);
    expect(toggles).toEqual([{ on: true }]);
  });

  it('직접 꺼둔 랜턴은 교체해도 켜지지 않는다 — 끈 선택을 존중', () => {
    world.lantern.battery = 30;
    world.lantern.on = false;
    pressSwap(world);
    expect(world.lantern.battery).toBe(balance.lantern.batteryMax);
    expect(world.lantern.on).toBe(false);
    expect(world.lantern.spares).toBe(1);
  });

  it('예비가 없으면 아무 일도 없다', () => {
    world.lantern.battery = 0;
    world.lantern.on = false;
    world.lantern.spares = 0;
    pressSwap(world);
    expect(world.lantern.battery).toBe(0);
    expect(world.lantern.on).toBe(false);
  });

  it('가득 차 있으면 낭비하지 않는다', () => {
    pressSwap(world);
    expect(world.lantern.spares).toBe(2);
  });
});

describe('소모와 방전', () => {
  it('켜져 있으면 닳고, 0이 되면 꺼지며 lantern_died 발행', () => {
    world.lantern.battery = balance.lantern.drainPerTick * 2;
    const died: unknown[] = [];
    world.events.on('lantern_died', () => died.push(true));

    Lantern.tick(world, DT);
    expect(world.lantern.on).toBe(true);
    Lantern.tick(world, DT);
    expect(world.lantern.battery).toBe(0);
    expect(world.lantern.on).toBe(false);
    expect(died).toHaveLength(1);
  });
});
