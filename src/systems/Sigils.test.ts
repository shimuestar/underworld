// 각인·마법 검증 — 드랍, 부착 페널티/효과, 화염구 시전과 화상.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { sigilDef } from '../core/SigilData';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
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
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 100, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
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
  it('창병은 어떻게 죽이든 드랍 → 그 자리에 놓이고 접근하면 획득', () => {
    // 처형이 아니어도 (총·해머·오사 무엇이든) 사망하면 떨어진다
    world.events.emit('enemy_died', { enemyType: 'goblin_spear', x: 14, z: 6 });
    expect(world.groundItems).toHaveLength(1);
    expect(world.sigils.inventory).toHaveLength(0); // 아직 줍지 않음

    // 멀리 있는 동안은 획득하지 않는다
    Sigils.tick(world, DT);
    expect(world.sigils.inventory).toHaveLength(0);

    // 접근 → 자동 획득 + 즉시 장착
    world.player.x = 14 - balance.sigil.pickupRadius + 0.1;
    Sigils.tick(world, DT);
    expect(world.groundItems).toHaveLength(0);
    expect(world.sigils.equipped.rightArm).toBe('sig_fireball'); // 바로 몸에 새겨진다
    expect(world.sigils.inventory).toHaveLength(0);
  });

  it('처형으로 죽여도 한 번만 떨어진다 (melee_kill + enemy_died 중복 방지)', () => {
    world.events.emit('melee_kill', { enemyType: 'goblin_spear', execution: true, x: 14, z: 6 });
    world.events.emit('enemy_died', { enemyType: 'goblin_spear', x: 14, z: 6 });
    expect(world.groundItems).toHaveLength(1);
  });

  it('일반 근접 처치는 드랍 없음', () => {
    world.events.emit('melee_kill', { enemyType: 'goblin_spear', execution: false, x: 8, z: 6 });
    expect(world.groundItems).toHaveLength(0);
  });

  it('부착: 페널티는 없고 오염 pending 만 누적된다', () => {
    world.sigils.inventory.push('sig_fireball');
    expect(Sigils.attach(world, 'sig_fireball')).toBe(true);
    expect(world.sigils.equipped.rightArm).toBe('sig_fireball');
    expect(world.corruption.pending).toBe(balance.corruption.slotCost.rightArm);
  });

  it('슬롯이 차 있으면 부착 실패', () => {
    world.sigils.inventory.push('sig_fireball', 'sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    expect(Sigils.attach(world, 'sig_fireball')).toBe(false);
  });

  it('해제: 인벤토리로 돌아오고 효과가 사라진다 (흉터 페널티도 폐지)', () => {
    world.sigils.inventory.push('sig_dash');
    Sigils.attach(world, 'sig_dash');
    expect(world.modifiers.dodgeDistanceMul).toBeCloseTo(1.8);
    Sigils.detach(world, 'spine');
    expect(world.modifiers.dodgeDistanceMul).toBe(1);
    expect(world.sigils.inventory).toContain('sig_dash');
  });

  it('돌진 회피(척추): 회피 거리·무적 연장 + 산포 페널티', () => {
    world.sigils.inventory.push('sig_dash');
    Sigils.attach(world, 'sig_dash');
    expect(world.modifiers.dodgeDistanceMul).toBeCloseTo(1.8);
    expect(world.modifiers.dodgeIFrameTicks).toBe(12);
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

  it('시전: 마나 소모(각인이 지정한 manaCost) + 연쇄 리셋 + 투사체 생성', () => {
    world.sigils.inventory.push('sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    world.mana.chainIndex = 2;
    cast();
    expect(world.projectiles).toHaveLength(1);
    expect(world.mana.value).toBeCloseTo(100 - (sigilDef('sig_fireball').effects['manaCost'] as number));
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

describe('화염구 폭발', () => {
  const fx = sigilDef('sig_fireball').effects;

  /** 플레이어(6,6)에서 +X로 화염구를 쏴 dist 지점의 적에게 맞힌다 */
  function castAt(): void {
    world.sigils.inventory.push('sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    world.mana.value = 100;
    world.player.yaw = -Math.PI / 2;
    world.input = { ...Input.emptySnapshot(), castPressed: true };
    Projectiles.tick(world, DT);
    world.input = Input.emptySnapshot();
    for (let i = 0; i < 60 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
  }

  it('적중 지점 주변의 다른 적도 피해를 입는다 (거리 감쇠)', () => {
    const direct = spawnEnemyAt('goblin_runner', 6 + 6, 6, 1);
    const near = spawnEnemyAt('goblin_runner', 6 + 6, 6 + 1.5, 2); // 폭심에서 1.5
    const far = spawnEnemyAt('goblin_runner', 6 + 6, 6 + 3.5, 3); // 3.5
    const outside = spawnEnemyAt('goblin_runner', 6 + 6, 6 + 6, 4); // 반경 밖
    for (const e of [direct, near, far, outside]) {
      e.health = 1000;
      world.enemies.push(e);
    }

    castAt();
    expect(direct.health).toBeLessThan(1000); // 직격
    expect(near.health).toBeLessThan(1000);
    expect(far.health).toBeLessThan(1000);
    expect(outside.health).toBe(1000); // 반경 밖은 무사
    // 가까울수록 크게 다친다
    expect(1000 - near.health).toBeGreaterThan(1000 - far.health);
  });

  it('폭심 가까이 있으면 크게 밀려난다', () => {
    // 사선 위의 적에게 맞혀 그 자리에서 터뜨린다
    const direct = spawnEnemyAt('goblin_runner', 6 + 6, 6, 1);
    const near = spawnEnemyAt('goblin_runner', 6 + 6, 6 + 1.6, 2); // 폭심에서 1.6 (blastRadius 안)
    const far = spawnEnemyAt('goblin_runner', 6 + 6, 6 + 3.5, 3); // 3.5 (밖)
    for (const e of [direct, near, far]) {
      e.health = 1000;
      world.enemies.push(e);
    }

    castAt();
    expect(near.kbTicks).toBe(fx['blastKnockbackTicks']);
    expect(far.kbTicks ?? 0).toBe(0); // blastRadius 밖은 밀리지 않는다
  });

  it('폭심이 반경 안이면 플레이어도 피해를 입는다 (자폭)', () => {
    // 코앞(2m)의 적에게 쏜다 — explodeRadius 4.0 안이라 나도 휘말린다
    const close = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    close.health = 1000;
    world.enemies.push(close);
    const hits: { amount: number }[] = [];
    world.events.on('player_damaged', (payload) => hits.push(payload as { amount: number }));
    let blast: { x: number; z: number } | null = null;
    world.events.on('explosion', (payload) => (blast = payload as { x: number; z: number }));

    const before = world.player.health;
    castAt();
    expect(world.player.health).toBeLessThan(before);
    expect(hits).toHaveLength(1);
    // 실제 폭심까지의 거리로 감쇠를 계산해 대조한다 (탄이 적 표면에서 터지므로 2m보다 가깝다)
    const at = blast!;
    const dist = Math.hypot(at.x - 6, at.z - 6);
    expect(dist).toBeLessThan(fx['explodeRadius']!);
    const falloff = 1 - (1 - fx['explodeFalloffMin']!) * (dist / fx['explodeRadius']!);
    expect(hits[0]!.amount).toBeCloseTo(fx['explodeDamage']! * falloff, 3);
  });

  it('멀리서 터지면 플레이어는 무사하다', () => {
    const far = spawnEnemyAt('goblin_runner', 6 + 8, 6, 1); // 8m — 반경 4.0 밖
    far.health = 1000;
    world.enemies.push(far);

    const before = world.player.health;
    castAt();
    expect(far.health).toBeLessThan(1000); // 적은 맞았고
    expect(world.player.health).toBe(before); // 나는 안 맞았다
  });

  it('회피 무적 중에는 자폭 피해를 받지 않는다', () => {
    const close = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    close.health = 1000;
    world.enemies.push(close);
    world.player.iframeTicks = 60;

    const before = world.player.health;
    castAt();
    expect(world.player.health).toBe(before);
  });

  it('벽에 맞아도 터진다 — 근처 적이 피해를 입는다', () => {
    // 사격장 복도 끝 벽까지 날아가 터지게, 벽 앞에 적을 둔다
    const nearWall = spawnEnemyAt('goblin_runner', 6 + 40, 6 + 1.5, 1);
    nearWall.health = 1000;
    world.enemies.push(nearWall);
    const explosions: unknown[] = [];
    world.events.on('explosion', (payload) => explosions.push(payload));

    castAt();
    expect(explosions.length).toBeGreaterThan(0);
  });
});
