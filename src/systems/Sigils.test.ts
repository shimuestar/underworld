// 각인·마법 검증 — 드랍, 부착 페널티/효과, 화염구 시전과 화상.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Mana from './Mana';
import * as Projectiles from './Projectiles';
import * as Sigils from './Sigils';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['########', '#S.....#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: -Math.PI / 2, pitch: 0, health: 100, // +X를 바라봄
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0 },
    mana: { value: 100, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: {
      inventory: [],
      equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null },
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  Sigils.init(world);
  Mana.init(world);
  return world;
}

function runnerAt(x: number, z: number): EnemyState {
  return {
    id: 1, type: 'goblin_runner', x, z, prevX: x, prevZ: z, yaw: 0,
    health: 30, alive: true, ai: 'chase', timer: 0,
    burnTicks: 0, burnDamagePerTick: 0,
  };
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('각인 드랍과 부착', () => {
  it('창병 처형 → 그 자리에 드랍, 접근하면 획득 (소지만으로는 효과 없음)', () => {
    world.events.emit('melee_kill', { enemyType: 'goblin_spear', execution: true, x: 14, z: 6 });
    expect(world.groundItems).toHaveLength(1);
    expect(world.sigils.inventory).toHaveLength(0); // 아직 줍지 않음

    // 멀리 있는 동안은 획득하지 않는다
    Sigils.tick(world, DT);
    expect(world.sigils.inventory).toHaveLength(0);

    // 접근 → 자동 획득
    world.player.x = 14 - balance.sigil.pickupRadius + 0.1;
    Sigils.tick(world, DT);
    expect(world.sigils.inventory).toContain('sig_fireball');
    expect(world.groundItems).toHaveLength(0);
    expect(world.modifiers.reloadTimeMul).toBe(1);
  });

  it('일반 근접 처치는 드랍 없음', () => {
    world.events.emit('melee_kill', { enemyType: 'goblin_spear', execution: false, x: 8, z: 6 });
    expect(world.groundItems).toHaveLength(0);
  });

  it('부착: 오른팔 페널티(재장전 배율) + 오염 pending 누적', () => {
    world.sigils.inventory.push('sig_fireball');
    expect(Sigils.attach(world, 'sig_fireball')).toBe(true);
    expect(world.sigils.equipped.rightArm).toBe('sig_fireball');
    expect(world.modifiers.reloadTimeMul).toBeCloseTo(1 / balance.sigil.slotPenalty.rightArm.reloadSpeedMul);
    expect(world.corruption.pending).toBe(balance.corruption.slotCost.rightArm);
  });

  it('슬롯이 차 있으면 부착 실패', () => {
    world.sigils.inventory.push('sig_fireball', 'sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    expect(Sigils.attach(world, 'sig_fireball')).toBe(false);
  });

  it('해제: 페널티 제거, 인벤토리 복귀', () => {
    world.sigils.inventory.push('sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    Sigils.detach(world, 'rightArm');
    expect(world.modifiers.reloadTimeMul).toBe(1);
    expect(world.sigils.inventory).toContain('sig_fireball');
  });

  it('돌진 회피(척추): 회피 거리·무적 연장 + 산포 페널티', () => {
    world.sigils.inventory.push('sig_dash');
    Sigils.attach(world, 'sig_dash');
    expect(world.modifiers.dodgeDistanceMul).toBeCloseTo(1.8);
    expect(world.modifiers.dodgeIFrameTicks).toBe(12);
    expect(world.modifiers.aimSpreadMul).toBeCloseTo(balance.sigil.slotPenalty.spine.aimSpreadMul);
  });

  it('암시야(눈): ambient 부스트', () => {
    world.sigils.inventory.push('sig_darkvision');
    Sigils.attach(world, 'sig_darkvision');
    expect(world.modifiers.ambientVisionBoost).toBeCloseTo(1.0);
  });
});

describe('화염구', () => {
  function cast(): void {
    world.input = { ...Input.emptySnapshot(), castPressed: true };
    Projectiles.tick(world, DT);
    world.input = Input.emptySnapshot();
  }

  it('오른팔 각인 없으면 시전 실패', () => {
    cast();
    expect(world.projectiles).toHaveLength(0);
    expect(world.mana.value).toBe(100);
  });

  it('시전: 마나 소모(small=22) + 연쇄 리셋 + 투사체 생성', () => {
    world.sigils.inventory.push('sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    world.mana.chainIndex = 2;
    cast();
    expect(world.projectiles).toHaveLength(1);
    expect(world.mana.value).toBeCloseTo(100 - balance.spellCost.small);
    expect(world.mana.chainIndex).toBe(0); // cast_spell → 리셋
  });

  it('마나 부족 시 불발', () => {
    world.sigils.inventory.push('sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    world.mana.value = 5;
    cast();
    expect(world.projectiles).toHaveLength(0);
    expect(world.mana.value).toBe(5);
  });

  it('적 명중: 45 피해 + 화상, 화상 DoT가 마무리하면 spell_kill', () => {
    world.sigils.inventory.push('sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    const enemy = runnerAt(10, 6); // 전방 4u
    world.enemies.push(enemy);
    const kills: unknown[] = [];
    world.events.on('spell_kill', (payload) => kills.push(payload));

    cast();
    // 4u / (26 u/s ÷ 60) ≈ 10틱이면 도달
    for (let i = 0; i < 15 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(enemy.health).toBe(30 - 45); // 즉사 (45 > 30)
    expect(enemy.alive).toBe(false);
    expect(kills).toHaveLength(1);
  });

  it('낮은 피해 상황에서 화상 DoT 누적', () => {
    world.sigils.inventory.push('sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    const enemy = runnerAt(10, 6);
    enemy.health = 200; // 즉사 방지용 가상 체력
    world.enemies.push(enemy);
    cast();
    for (let i = 0; i < 15 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(enemy.burnTicks).toBeGreaterThan(0);
    const afterHit = enemy.health;
    for (let i = 0; i < 60; i++) Projectiles.tick(world, DT);
    expect(enemy.health).toBeCloseTo(afterHit - 60 * 0.15, 1);
  });

  it('벽에 막히면 소멸', () => {
    world.sigils.inventory.push('sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    cast();
    let impacts = 0;
    world.events.on('spell_impact', () => impacts++);
    for (let i = 0; i < 120 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(world.projectiles).toHaveLength(0);
    expect(impacts).toBe(1);
  });
});
