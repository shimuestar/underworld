// 폭발통 — 점화 규칙(총·해머 누적 / 화염구·수류탄 즉발), 폭발 피해, 연쇄.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type BarrelState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnBarrels } from '../level/Spawner';
import { spawnEnemyAt } from '../level/Spawner';
import * as Barrels from './Barrels';
import * as Projectiles from './Projectiles';
import * as Sigils from './Sigils';
import * as Stamina from './Stamina';
import * as Weapons from './Weapons';

const DT = 1 / 60;
const CFG = balance.barrel;

function makeLevel(): Level {
  return new Level({
    id: 'range',
    name: 'range',
    cellSize: 4,
    ceiling: 4,
    grid: ['#'.repeat(30), '#S' + '.'.repeat(27) + '#', '#'.repeat(30)],
    lighting: { ambient: 0.04, torches: [] },
  });
}

function makeWorld(): World {
  const level = makeLevel();
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: -Math.PI / 2, pitch: 0, health: balance.player.healthMax, // +X 를 본다
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: {
      inventory: [],
      active: null,
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  Stamina.init(world);
  return world;
}

/** (x,z)에 폭발통 하나 */
function putBarrel(world: World, x: number, z: number, id = 1): BarrelState {
  const barrel: BarrelState = { id, x, z, alive: true, hits: 0, fuseTicks: -1 };
  barrel.blocker = world.level.addBlocker(x, z, CFG.collisionRadius);
  world.barrels.push(barrel);
  return barrel;
}

/** 총 한 발 — 통은 가슴 높이라 눈높이 수평선 아래에 있다. 조준을 맞춰 준다 */
function aimAt(world: World, x: number, z: number): void {
  const p = world.player;
  const flat = Math.hypot(x - p.x, z - p.z);
  p.yaw = Math.atan2(-(x - p.x), -(z - p.z));
  p.pitch = Math.atan2(balance.barrel.height * 0.5 - (p.y + balance.player.eyeHeight), flat);
}

function shoot(world: World): void {
  world.weapon.cooldown = 0;
  world.input = { ...Input.emptySnapshot(), rangedPressed: true };
  Weapons.tick(world, DT);
  world.input = Input.emptySnapshot();
}

/** 해머 한 번 — 닿을 때까지 진행 */
function swing(world: World): void {
  world.weapon.meleeCooldown = 0;
  world.input = { ...Input.emptySnapshot(), meleePressed: true };
  Weapons.tick(world, DT);
  world.input = Input.emptySnapshot();
  for (let i = 0; i < 20 && world.weapon.swingImpact > 0; i++) Weapons.tick(world, DT);
}

/** n틱 동안 도화선을 돌린다 */
function burn(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) Barrels.tick(world, DT);
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('점화 — 맞은 수만큼 도화선이 짧아진다', () => {
  it('총 1발 = 2초, 2발 = 0.5초, 3발 = 즉발', () => {
    const [long, mid, instant] = CFG.fuseByHits;
    expect(long).toBe(120); // 2초
    expect(mid).toBe(30); // 0.5초
    expect(instant).toBe(0);

    const barrel = putBarrel(world, 6 + 6, 6);
    aimAt(world, barrel.x, barrel.z);
    expect(barrel.fuseTicks).toBe(-1); // 건드리기 전에는 잠잠하다

    shoot(world);
    expect(barrel.hits).toBe(1);
    expect(barrel.fuseTicks).toBe(long);

    shoot(world);
    expect(barrel.fuseTicks).toBe(mid);

    shoot(world);
    expect(barrel.fuseTicks).toBe(instant);
    expect(barrel.alive).toBe(true); // 아직 Barrels 가 안 돌았다
    Barrels.tick(world, DT);
    expect(barrel.alive).toBe(false);
  });

  it('1발만 쏘면 2초를 꽉 채워야 터진다', () => {
    const barrel = putBarrel(world, 6 + 6, 6);
    aimAt(world, barrel.x, barrel.z);
    shoot(world);
    burn(world, CFG.fuseByHits[0]! - 1); // 2초에서 한 틱 모자라다
    expect(barrel.alive).toBe(true);
    Barrels.tick(world, DT);
    expect(barrel.alive).toBe(false); // 정확히 120틱 = 2.00초
  });

  it('도화선이 도는 중에 더 맞히면 앞당겨진다 — 늘어나지는 않는다', () => {
    const barrel = putBarrel(world, 6 + 6, 6);
    aimAt(world, barrel.x, barrel.z);
    shoot(world); // 1발째 도화선
    burn(world, 30);
    expect(barrel.fuseTicks).toBe(CFG.fuseByHits[0]! - 30);
    shoot(world); // 2발째 → 더 짧은 도화선으로 앞당김
    expect(barrel.fuseTicks).toBe(CFG.fuseByHits[1]!);

    // 남은 도화선이 이미 더 짧으면 그대로 둔다.
    // 태우는 틱 수는 수치를 다시 튜닝해도 따라오게 CFG 에서 뽑는다
    burn(world, CFG.fuseByHits[1]! - 5);
    const left = barrel.fuseTicks;
    expect(left).toBeLessThan(CFG.fuseByHits[1]!);
    barrel.hits = 1; // 다시 1발째 취급으로 되돌려 더 긴 도화선을 물려 본다
    shoot(world);
    expect(barrel.fuseTicks).toBeLessThanOrEqual(left);
  });

  it('해머도 총알과 같은 규약이다', () => {
    const barrel = putBarrel(world, 6 + 2, 6);
    swing(world);
    expect(barrel.hits).toBe(1);
    expect(barrel.fuseTicks).toBe(CFG.fuseByHits[0]);
    swing(world);
    swing(world);
    expect(barrel.hits).toBe(3);
    expect(barrel.fuseTicks).toBe(0);
  });

  it('화염구는 즉발이다 — 한 방', () => {
    const barrel = putBarrel(world, 6 + 6, 6);
    world.projectiles.push({
      id: 1, owner: 'player', x: 6, y: 0.6, z: 6, prevX: 6, prevY: 0.6, prevZ: 6,
      vx: 26, vy: 0, vz: 0, lifeTicks: 60, damage: 45,
      burnTicks: 0, burnDamagePerTick: 0, radius: 0.35,
    });
    for (let i = 0; i < 30 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(barrel.hits).toBe(0); // 누적이 아니라 즉발이다
    expect(barrel.fuseTicks).toBe(0);
    expect(world.projectiles).toHaveLength(0); // 통에 꽂혀 사라진다
    Barrels.tick(world, DT);
    expect(barrel.alive).toBe(false);
  });

  it('수류탄 폭풍에 닿아도 즉발이다', () => {
    const barrel = putBarrel(world, 6 + 3, 6);
    world.projectiles.push({
      id: 2, owner: 'player', x: 6 + 1, y: 0.5, z: 6, prevX: 6 + 1, prevY: 0.5, prevZ: 6,
      vx: 0, vy: -8, vz: 0, lifeTicks: 60, damage: balance.weapons.grenade.damage,
      burnTicks: 0, burnDamagePerTick: 0, radius: 0.2, kind: 'grenade',
    });
    for (let i = 0; i < 30 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(barrel.fuseTicks).toBe(0);
  });
});

describe('폭발', () => {
  it('수류탄의 70% 피해를 거리 감쇠와 함께 준다', () => {
    expect(CFG.damage).toBeCloseTo(balance.weapons.grenade.damage * 0.7, 5);
    const near = spawnEnemyAt('goblin_runner', 20 + 0.5, 6, 1);
    const far = spawnEnemyAt('goblin_runner', 20 + CFG.radius - 0.2, 6, 2);
    const outside = spawnEnemyAt('goblin_runner', 20 + CFG.radius + 1, 6, 3);
    for (const e of [near, far, outside]) {
      e.health = 1000;
      world.enemies.push(e);
    }
    const barrel = putBarrel(world, 20, 6);
    barrel.fuseTicks = 0;
    Barrels.tick(world, DT);

    const damageAt = (d: number): number =>
      CFG.damage * (1 - (1 - CFG.damageFalloffMin) * Math.min(1, d / CFG.radius));
    const nearDmg = 1000 - near.health;
    const farDmg = 1000 - far.health;
    expect(nearDmg).toBeGreaterThan(farDmg); // 가까울수록 아프다
    expect(nearDmg).toBeCloseTo(damageAt(0.5), 5);
    expect(farDmg).toBeCloseTo(damageAt(CFG.radius - 0.2), 5);
    expect(farDmg / nearDmg).toBeLessThan(0.45); // 가장자리는 확실히 약하다
    expect(outside.health).toBe(1000); // 반경 밖은 무사
  });

  it('반경만 넓혔지 피해는 그대로다 — 중심 84, 가장자리 21', () => {
    // 2026-08: radius 4.5 → 6.5. "범위는 넓게, 데미지는 전과 동일" 요청의 계약.
    // damage 와 damageFalloffMin 을 건드리지 않으면 양 끝값이 고정된다
    expect(CFG.damage).toBe(84);
    expect(CFG.damage * CFG.damageFalloffMin).toBeCloseTo(21, 5);
    expect(CFG.radius).toBeGreaterThan(balance.weapons.grenade.radius); // 수류탄보다 넓다

    const center = spawnEnemyAt('goblin_runner', 20, 6, 1);
    const rim = spawnEnemyAt('goblin_runner', 20 + CFG.radius, 6, 2);
    for (const e of [center, rim]) {
      e.health = 1000;
      world.enemies.push(e);
    }
    const barrel = putBarrel(world, 20, 6);
    barrel.fuseTicks = 0;
    Barrels.tick(world, DT);

    expect(1000 - center.health).toBeCloseTo(CFG.damage, 5);
    expect(1000 - rim.health).toBeCloseTo(CFG.damage * CFG.damageFalloffMin, 5);
  });

  it('적도 폭풍에 밀린다 — 폭심 반대쪽으로', () => {
    const kb = balance.explosionKnockback;
    const near = spawnEnemyAt('goblin_runner', 20 + 1, 6, 1);
    const far = spawnEnemyAt('goblin_runner', 20 + CFG.radius - 0.5, 6, 2);
    for (const e of [near, far]) {
      e.health = 1000; // 죽으면 안 밀린다 (시체는 밀지 않는다)
      world.enemies.push(e);
    }
    const barrel = putBarrel(world, 20, 6);
    barrel.fuseTicks = 0;
    Barrels.tick(world, DT);

    expect(near.kbTicks).toBe(kb.ticks);
    expect(near.kbX).toBeGreaterThan(0); // 폭심(-X 쪽)에서 멀어진다
    expect(near.kbZ).toBeCloseTo(0, 5);
    // 폭심에 가까울수록 멀리 — 피해와 같은 감쇠를 탄다
    expect(near.kbX!).toBeGreaterThan(far.kbX!);
  });

  it('체급이 무거울수록 덜 밀린다 — 해머 마무리와 같은 규약', () => {
    const byWeight = balance.explosionKnockback.byWeight as unknown as Record<string, number>;
    const light = spawnEnemyAt('goblin_runner', 20 + 1, 6, 1);
    const heavy = spawnEnemyAt('goblin_chieftain', 20 - 1, 6, 2);
    for (const e of [light, heavy]) {
      e.health = 5000;
      world.enemies.push(e);
    }
    const barrel = putBarrel(world, 20, 6);
    barrel.fuseTicks = 0;
    Barrels.tick(world, DT);

    expect(byWeight.heavy!).toBeLessThan(byWeight.light!);
    expect(Math.abs(heavy.kbX!)).toBeCloseTo(Math.abs(light.kbX!) * byWeight.heavy!, 5);
  });

  it('폭발로 죽은 적은 밀지 않는다 — 대신 파편 방향을 실어 보낸다', () => {
    // 사망 즉시 모형이 사라져(래그돌 없음) 밀어 봐야 보이는 게 없다.
    // 그래서 죽은 쪽은 파편이 폭심 반대로 날아가게 방향만 넘긴다
    const doomed = spawnEnemyAt('goblin_runner', 20 + 1, 6, 1);
    doomed.health = 5; // 확실히 죽는다
    world.enemies.push(doomed);
    const deaths: { blastX?: number; blastZ?: number }[] = [];
    world.events.on('enemy_died', (p) => deaths.push(p as { blastX?: number; blastZ?: number }));

    const barrel = putBarrel(world, 20, 6);
    barrel.fuseTicks = 0;
    Barrels.tick(world, DT);

    expect(doomed.alive).toBe(false);
    expect(doomed.kbTicks ?? 0).toBe(0);
    expect(deaths[0]!.blastX).toBeGreaterThan(0); // 폭심(-X)에서 바깥으로
    expect(deaths[0]!.blastZ).toBeCloseTo(0, 5);
  });

  it('반경 안에 살아남은 적은 죽지 않아도 전부 밀린다', () => {
    // "죽을 때만 밀리는 것 아니냐"에 대한 못. 살아 있으면 거리와 무관하게 밀린다
    const dists = [0.5, 2, 4, CFG.radius - 0.3];
    const mobs = dists.map((d, i) => {
      const e = spawnEnemyAt('goblin_runner', 20 + d, 6, i + 1);
      e.health = 100000; // 아무도 안 죽는다
      world.enemies.push(e);
      return e;
    });
    const outside = spawnEnemyAt('goblin_runner', 20 + CFG.radius + 1, 6, 99);
    outside.health = 100000;
    world.enemies.push(outside);

    const barrel = putBarrel(world, 20, 6);
    barrel.fuseTicks = 0;
    Barrels.tick(world, DT);

    for (const e of mobs) {
      expect(e.alive).toBe(true);
      expect(e.kbTicks).toBe(balance.explosionKnockback.ticks);
      expect(e.kbX!).toBeGreaterThan(0);
    }
    expect(outside.kbTicks ?? 0).toBe(0); // 반경 밖은 그대로
  });

  it('플레이어도 맞는다 — 뒤로 밀리기까지', () => {
    const p = world.player;
    const barrel = putBarrel(world, p.x + 2, p.z);
    barrel.fuseTicks = 0;
    const hurt: { amount: number }[] = [];
    world.events.on('player_damaged', (payload) => hurt.push(payload as { amount: number }));

    Barrels.tick(world, DT);
    expect(hurt).toHaveLength(1);
    expect(hurt[0]!.amount).toBeGreaterThan(CFG.damage * 0.5);
    expect(p.health).toBeLessThan(balance.player.healthMax);
    expect(p.kbTicks).toBe(CFG.playerKnockbackTicks);
    expect(p.kbX).toBeLessThan(0); // 통 반대쪽(−X)으로 밀린다
  });

  it('반경 밖 플레이어는 무사하다', () => {
    const p = world.player;
    const barrel = putBarrel(world, p.x + CFG.radius + 2, p.z);
    barrel.fuseTicks = 0;
    Barrels.tick(world, DT);
    expect(p.health).toBe(balance.player.healthMax);
  });

  it('반경 안의 다른 통을 연쇄로 터뜨린다 — 재귀로 들어가지 않는다', () => {
    const a = putBarrel(world, 30, 6, 1);
    const b = putBarrel(world, 30 + CFG.radius - 0.5, 6, 2);
    const c = putBarrel(world, 30 + (CFG.radius - 0.5) * 2, 6, 3);
    const far = putBarrel(world, 30 + 40, 6, 4);
    const booms: unknown[] = [];
    world.events.on('barrel_exploded', (payload) => booms.push(payload));

    a.fuseTicks = 0;
    for (let i = 0; i < 5; i++) Barrels.tick(world, DT);
    expect([a.alive, b.alive, c.alive]).toEqual([false, false, false]);
    expect(far.alive).toBe(true); // 사슬이 닿지 않는 통은 그대로
    expect(booms).toHaveLength(3);
  });

  it('터진 통은 길을 막지 않는다 — 차단 블록이 빠진다', () => {
    const barrel = putBarrel(world, 40, 6);
    const before = world.level.props.length;
    barrel.fuseTicks = 0;
    Barrels.tick(world, DT);
    expect(world.level.props.length).toBe(before - 1);
    expect(barrel.blocker).toBeUndefined();
  });
});

describe('레벨 배치', () => {
  it('벽 안에 놓인 통은 걸러진다', () => {
    const level = makeLevel();
    const barrels = spawnBarrels(
      [
        { type: 'barrel', cell: [1, 5] }, // 바닥
        { type: 'barrel', cell: [0, 5] }, // 벽 — 버려진다
        { type: 'goblin_runner', cell: [1, 6] }, // 통이 아니다
      ],
      level,
    );
    expect(barrels).toHaveLength(1);
    expect(barrels[0]!.x).toBeCloseTo(5.5 * 4, 5);
    expect(level.props).toHaveLength(1); // 살아남은 통만 몸을 막는다
  });
});
