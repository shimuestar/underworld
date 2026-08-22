// 반응 판정 창 타이밍 검증 — M3의 핵심. 틱 수가 하나라도 밀리면 손맛이 무너진다.

import { describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Enemies from './Enemies';
import * as Projectiles from './Projectiles';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['########', '#S.....#', '#......#', '#......#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 10, y: 0, z: 10, prevX: 10, prevY: 0, prevZ: 10,
      yaw: 0, pitch: 0,
      health: balance.player.healthMax,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { active: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0 },
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
}

function makeSpear(x: number, z: number): EnemyState {
  return {
    id: 1, type: 'goblin_spear',
    x, z, prevX: x, prevZ: z, yaw: 0,
    health: enemyDef('goblin_spear').health,
    alive: true, ai: 'chase', timer: 0,
    burnTicks: 0, burnDamagePerTick: 0,
  };
}

/** 적이 목표 ai 상태가 될 때까지 Enemies만 틱. 도달까지 걸린 틱 수 반환 */
function tickUntil(world: World, target: string, maxTicks = 300): number {
  for (let i = 1; i <= maxTicks; i++) {
    Enemies.tick(world, DT);
    if (world.enemies[0]!.ai === target) return i;
  }
  throw new Error(`${maxTicks}틱 내에 ${target} 미도달 (현재 ${world.enemies[0]!.ai})`);
}

function pressReaction(world: World): void {
  world.input = { ...Input.emptySnapshot(), reactionReleased: true };
  Reaction.tick(world, DT);
  world.input = Input.emptySnapshot();
}

describe('공격 상태 머신 타이밍 (goblin_spear: windup 34t)', () => {
  it('chase→windup 1t, windup 34t, active_perfect 6t, active_normal 12t, impact에서 피해', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(12, 10)); // 거리 2.0 < attackRange 2.4

    expect(tickUntil(world, 'windup')).toBe(1);
    expect(tickUntil(world, 'active_perfect')).toBe(enemyDef('goblin_spear').attack.windupTicks);
    expect(tickUntil(world, 'active_normal')).toBe(balance.reaction.windowPerfectTicks);
    expect(tickUntil(world, 'impact')).toBe(balance.reaction.windowNormalTicks);

    Enemies.tick(world, DT); // impact 적용
    expect(world.player.health).toBe(
      balance.player.healthMax - enemyDef('goblin_spear').damage,
    );
    expect(world.enemies[0]!.ai).toBe('recover');
  });

  it('방어(C 홀드): 정면 공격은 칩 데미지만, 후방은 온전히 맞는다', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(12, 10)); // 플레이어 동쪽
    world.player.yaw = -Math.PI / 2; // 동쪽(적)을 바라봄 → 정면 방어
    world.player.blocking = true;
    tickUntil(world, 'impact');
    Enemies.tick(world, DT);
    const spearDamage = enemyDef('goblin_spear').damage;
    expect(world.player.health).toBeCloseTo(
      balance.player.healthMax - spearDamage * balance.block.chipDamageRatio,
    );

    // 후방 공격 — 방어해도 그대로 맞는다
    const world2 = makeWorld();
    world2.enemies.push(makeSpear(12, 10));
    world2.player.yaw = Math.PI / 2; // 반대편(서쪽)을 바라봄
    world2.player.blocking = true;
    tickUntil(world2, 'impact');
    Enemies.tick(world2, DT);
    expect(world2.player.health).toBe(balance.player.healthMax - spearDamage);
  });

  it('방어 중 화살은 완전 차단(0 데미지), 마법은 칩 데미지', () => {
    const fire = (world: World, kind: 'arrow' | 'magic', damage: number): void => {
      world.projectiles.push({
        id: 99, owner: 'enemy',
        x: 12, y: 1.2, z: 10, prevX: 12, prevY: 1.2, prevZ: 10,
        vx: -20, vy: 0, vz: 0, // 동쪽에서 플레이어를 향해
        lifeTicks: 120, damage, burnTicks: 0, burnDamagePerTick: 0,
        radius: 0.15, kind,
      });
      for (let i = 0; i < 30 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    };

    // 화살 — 정면 방어 시 무피해, block_hit에 kind가 실린다 (방패 연출용)
    const world = makeWorld();
    world.player.yaw = -Math.PI / 2; // 동쪽을 바라봄
    world.player.blocking = true;
    const blockHits: unknown[] = [];
    world.events.on('block_hit', (payload) => blockHits.push(payload));
    fire(world, 'arrow', 10);
    expect(world.player.health).toBe(balance.player.healthMax);
    expect(blockHits[0]).toMatchObject({ kind: 'arrow' });

    // 마법 — 방어해도 칩 데미지는 관통
    const world2 = makeWorld();
    world2.player.yaw = -Math.PI / 2;
    world2.player.blocking = true;
    fire(world2, 'magic', 10);
    expect(world2.player.health).toBeCloseTo(
      balance.player.healthMax - 10 * balance.block.chipDamageRatio,
    );

    // 방어 없으면 화살도 그대로 맞는다
    const world3 = makeWorld();
    fire(world3, 'arrow', 10);
    expect(world3.player.health).toBe(balance.player.healthMax - 10);
  });

  it('적 화살은 사선의 다른 적에게 막힌다 (동료 오사)', () => {
    const spawnArrow = (world: World, casterId: number): void => {
      const p = world.player;
      // 플레이어 동쪽 6u 지점에서 서쪽(플레이어)을 향해 발사
      world.projectiles.push({
        id: 500, owner: 'enemy',
        x: p.x + 6, y: 1.2, z: p.z, prevX: p.x + 6, prevY: 1.2, prevZ: p.z,
        vx: -20, vy: 0, vz: 0,
        lifeTicks: 120, damage: 10, burnTicks: 0, burnDamagePerTick: 0,
        radius: 0.15, kind: 'arrow', casterId,
      });
      for (let i = 0; i < 30 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    };

    // 사선 중간(3u)에 아군 — 화살이 아군에 맞고 플레이어는 무사
    const world = makeWorld();
    const ally = makeSpear(world.player.x + 3, world.player.z);
    ally.id = 7;
    world.enemies.push(ally);
    spawnArrow(world, 1); // 시전자는 다른 id
    expect(ally.health).toBe(enemyDef('goblin_spear').health - 10);
    expect(world.player.health).toBe(balance.player.healthMax);

    // 사선이 비면 플레이어가 맞는다
    const world2 = makeWorld();
    spawnArrow(world2, 1);
    expect(world2.player.health).toBe(balance.player.healthMax - 10);

    // 시전자 자신은 맞지 않는다 (발사 지점과 겹쳐도 통과)
    const world3 = makeWorld();
    const archer = makeSpear(world3.player.x + 6, world3.player.z);
    archer.id = 7;
    world3.enemies.push(archer);
    spawnArrow(world3, 7);
    expect(archer.health).toBe(enemyDef('goblin_spear').health);
    expect(world3.player.health).toBe(balance.player.healthMax - 10);
  });

  it('회피 무적 중에는 impact가 빗나간다', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(12, 10));
    tickUntil(world, 'impact');
    world.player.iframeTicks = 3;
    Enemies.tick(world, DT);
    expect(world.player.health).toBe(balance.player.healthMax);
  });
});

describe('반응 판정 분기', () => {
  it('active_perfect에 입력 → 완벽 패링: 스태거 + 히트스톱 4t', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(12, 10));
    tickUntil(world, 'active_perfect');
    const results: unknown[] = [];
    world.events.on('parry_attempt', (payload) => results.push(payload));

    pressReaction(world);
    expect(world.enemies[0]!.ai).toBe('staggered');
    expect(world.freezeTicks).toBe(balance.reaction.hitstopPerfectTicks);
    expect(results[0]).toMatchObject({ result: 'perfect' });
  });

  it('active_normal에 입력 → 일반 패링: recover + 히트스톱 2t', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(12, 10));
    tickUntil(world, 'active_normal');
    pressReaction(world);
    expect(world.enemies[0]!.ai).toBe('recover');
    expect(world.freezeTicks).toBe(balance.reaction.hitstopNormalTicks);
  });

  it('windup에 조기 입력 → 실패: 경직 20t', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(12, 10));
    tickUntil(world, 'windup');
    pressReaction(world);
    expect(world.player.stunTicks).toBe(balance.reaction.failStunTicks);
    expect(world.enemies[0]!.ai).toBe('windup'); // 적 공격은 계속된다
  });

  it('스태거 적에 입력 → 처형', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(12, 10));
    tickUntil(world, 'active_perfect');
    pressReaction(world); // 완벽 패링 → 스태거
    const kills: unknown[] = [];
    world.events.on('melee_kill', (payload) => kills.push(payload));

    pressReaction(world); // 처형
    expect(world.enemies[0]!.alive).toBe(false);
    expect(kills[0]).toMatchObject({ enemyType: 'goblin_spear', execution: true });
  });

  it('Shift+탭 = 즉시 회피 (판정 생략)', () => {
    const world = makeWorld();
    world.input = { ...Input.emptySnapshot(), reactionReleased: true, sprint: true };
    Reaction.tick(world, DT);
    expect(world.player.dodgeTicks).toBe(balance.reaction.dodgeDashTicks);
    expect(world.player.iframeTicks).toBe(balance.reaction.dodgeIFrameTicks);

    // windup 중이어도 Shift+탭은 실패 경직 없이 회피한다 (빨강 공격 탈출용)
    const world2 = makeWorld();
    world2.enemies.push(makeSpear(12, 10));
    tickUntil(world2, 'windup');
    world2.input = { ...Input.emptySnapshot(), reactionReleased: true, sprint: true };
    Reaction.tick(world2, DT);
    expect(world2.player.dodgeTicks).toBe(balance.reaction.dodgeDashTicks);
    expect(world2.player.stunTicks).toBe(0);
  });

  it('Shift 없는 탭은 반경 내 아무것도 없으면 헛스윙 (회피 아님)', () => {
    const world = makeWorld();
    pressReaction(world);
    expect(world.player.dodgeTicks).toBe(0);
    expect(world.player.iframeTicks).toBe(0);
  });

  it('경직 중에는 반응 입력이 무시된다', () => {
    const world = makeWorld();
    world.player.stunTicks = 5;
    pressReaction(world);
    expect(world.player.dodgeTicks).toBe(0);
  });
});
