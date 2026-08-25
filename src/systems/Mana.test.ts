// 마나 경제 검증 — 총기 처치 0, 연쇄 배율, 휘발, 실패 절반 소실.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Mana from './Mana';
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
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: 0, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: false, battery: 100, spares: 0 },
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
  Mana.init(world);
  return world;
}

function chaseEnemy(): EnemyState {
  return {
    id: 1, type: 'goblin_runner', x: 10, z: 6, prevX: 10, prevZ: 6, yaw: 0,
    health: 30, alive: true, ai: 'chase', timer: 0,
    burnTicks: 0, burnDamagePerTick: 0,
  };
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('획득과 연쇄 배율', () => {
  it('완벽 패링: 기본량 획득 + 연쇄 상승 (다음 획득은 ×1.4)', () => {
    world.events.emit('parry_attempt', { result: 'perfect', chain: 0, enemyType: 'x' });
    expect(world.mana.value).toBeCloseTo(balance.mana.gain.parryPerfect);
    expect(world.mana.chainIndex).toBe(1);

    world.events.emit('parry_attempt', { result: 'perfect', chain: 1, enemyType: 'x' });
    expect(world.mana.value).toBeCloseTo(
      balance.mana.gain.parryPerfect + balance.mana.gain.parryPerfect * balance.chain.multipliers[1]!,
    );
    expect(world.mana.chainIndex).toBe(2);
  });

  it('일반 패링: 획득하지만 연쇄는 오르지 않는다', () => {
    world.events.emit('parry_attempt', { result: 'normal', chain: 0, enemyType: 'x' });
    expect(world.mana.value).toBeCloseTo(balance.mana.gain.parryNormal);
    expect(world.mana.chainIndex).toBe(0);
  });

  it('처형: execute 획득량', () => {
    world.events.emit('melee_kill', { enemyType: 'x', execution: true });
    expect(world.mana.value).toBeCloseTo(balance.mana.gain.execute);
  });

  it('총기 처치는 0 — weapon_kill은 마나에 아무 영향 없음 (하드 룰)', () => {
    world.events.emit('weapon_kill', { weapon: 'pistol', enemyType: 'x' });
    expect(world.mana.value).toBe(0);
  });

  it('연쇄 상한 = multipliers 배열 끝', () => {
    for (let i = 0; i < 10; i++) {
      world.events.emit('parry_attempt', { result: 'perfect', chain: i, enemyType: 'x' });
    }
    expect(world.mana.chainIndex).toBe(balance.chain.multipliers.length - 1);
  });

  it('상한 초과 획득은 max로 클램프', () => {
    for (let i = 0; i < 20; i++) {
      world.events.emit('melee_kill', { enemyType: 'x', execution: true });
    }
    expect(world.mana.value).toBe(balance.mana.max);
  });
});

describe('리셋과 소실', () => {
  it('피격 시 연쇄 리셋 (마나는 유지)', () => {
    world.events.emit('parry_attempt', { result: 'perfect', chain: 0, enemyType: 'x' });
    world.events.emit('player_damaged', { amount: 12, health: 88 });
    expect(world.mana.chainIndex).toBe(0);
    expect(world.mana.value).toBeCloseTo(balance.mana.gain.parryPerfect);
  });

  it('패링 실패 시 축적 마나 절반 소실 + 연쇄 리셋', () => {
    world.mana.value = 80;
    world.mana.chainIndex = 2;
    world.events.emit('parry_attempt', { result: 'fail', chain: 2, enemyType: 'x' });
    expect(world.mana.value).toBeCloseTo(40);
    expect(world.mana.chainIndex).toBe(0);
  });
});

describe('전투 종료 휘발 — 폐지 (2026-08)', () => {
  it('전투가 끝나도 마나가 줄지 않는다', () => {
    world.mana.value = 50;
    for (let i = 0; i < balance.mana.combatExitTicks + 600; i++) Mana.tick(world, DT);
    expect(world.mana.value).toBeGreaterThanOrEqual(50); // 오히려 자동 회복으로 는다
  });

  it('전투 종료 이벤트는 그대로 발행된다 (다른 시스템이 쓴다)', () => {
    const events: unknown[] = [];
    world.events.on('combat_exited', (payload) => events.push(payload));
    world.enemies.push(chaseEnemy());
    Mana.tick(world, DT);
    world.enemies[0]!.alive = false;
    for (let i = 0; i < balance.mana.combatExitTicks + 2; i++) Mana.tick(world, DT);
    expect(events).toHaveLength(1);
  });

  it('decayPerTick 을 되살리면 휘발도 되살아난다 (설정으로만 꺼둔 상태)', () => {
    expect(balance.mana.decayPerTick).toBe(0);
  });
});

describe('기본 충전', () => {
  it('상한 아래에서는 시간 경과로 자동 회복된다 (전투 여부 무관)', () => {
    world.mana.value = 0;
    for (let i = 0; i < 300; i++) Mana.tick(world, DT);
    expect(world.mana.value).toBeCloseTo(300 * balance.mana.regenPerTick);

    world.enemies.push(chaseEnemy()); // 전투 중에도 회복
    const before = world.mana.value;
    for (let i = 0; i < 60; i++) Mana.tick(world, DT);
    expect(world.mana.value).toBeCloseTo(before + 60 * balance.mana.regenPerTick);
  });

  it('자동 회복은 최대치까지 찬다 (상한 폐지)', () => {
    expect(balance.mana.regenCap).toBe(balance.mana.max);
    world.mana.value = balance.mana.max - 0.01;
    for (let i = 0; i < 600; i++) Mana.tick(world, DT);
    expect(world.mana.value).toBe(balance.mana.max);
  });
});
