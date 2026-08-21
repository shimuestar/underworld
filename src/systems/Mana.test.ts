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
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false,
    },
    lantern: { on: false, battery: 100, spares: 0 },
    weapon: { mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0 },
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

describe('전투 종료 휘발', () => {
  it('활성 적 0 → combatExitTicks 후 매 틱 decayPerTick 감소', () => {
    world.mana.value = 50;
    for (let i = 0; i < balance.mana.combatExitTicks; i++) Mana.tick(world, DT);
    expect(world.mana.value).toBeCloseTo(50 - balance.mana.decayPerTick); // 임계 도달 틱부터 감소
    Mana.tick(world, DT);
    expect(world.mana.value).toBeCloseTo(50 - 2 * balance.mana.decayPerTick);
  });

  it('재교전 시 휘발 즉시 중단, 마나는 초기화되지 않는다', () => {
    world.mana.value = 50;
    for (let i = 0; i < balance.mana.combatExitTicks + 10; i++) Mana.tick(world, DT);
    const remaining = world.mana.value;
    expect(remaining).toBeLessThan(50);

    world.enemies.push(chaseEnemy()); // 재교전
    Mana.tick(world, DT);
    expect(world.mana.value).toBeCloseTo(remaining);
    expect(world.mana.outOfCombatTicks).toBe(0);
  });

  it('전투 중에는 휘발하지 않는다', () => {
    world.mana.value = 50;
    world.enemies.push(chaseEnemy());
    for (let i = 0; i < 300; i++) Mana.tick(world, DT);
    expect(world.mana.value).toBe(50);
  });

  it('idle 적만 있으면 전투로 치지 않는다', () => {
    world.mana.value = 50;
    const enemy = chaseEnemy();
    enemy.ai = 'idle';
    world.enemies.push(enemy);
    for (let i = 0; i < balance.mana.combatExitTicks + 5; i++) Mana.tick(world, DT);
    expect(world.mana.value).toBeLessThan(50);
  });

  it('휘발은 기본 충전 상한(regenCap)에서 멈춘다', () => {
    world.mana.value = 50;
    for (let i = 0; i < 2000; i++) Mana.tick(world, DT);
    expect(world.mana.value).toBeCloseTo(balance.mana.regenCap);
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

  it('자동 회복은 regenCap을 넘지 않는다', () => {
    world.mana.value = balance.mana.regenCap - 0.01;
    world.enemies.push(chaseEnemy()); // 휘발 없이 회복만 보기
    for (let i = 0; i < 600; i++) Mana.tick(world, DT);
    expect(world.mana.value).toBe(balance.mana.regenCap);
  });
});
