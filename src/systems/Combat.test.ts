// 반응 판정 창 타이밍 검증 — M3의 핵심. 틱 수가 하나라도 밀리면 손맛이 무너진다.

import { describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Enemies from './Enemies';
import * as PlayerMove from './PlayerMove';
import * as Projectiles from './Projectiles';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';
import * as Stamina from './Stamina';

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
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 10, y: 0, z: 10, prevX: 10, prevY: 0, prevZ: 10,
      yaw: 0, pitch: 0,
      health: balance.player.healthMax,
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
  Stamina.init(world); // 회피는 스태미너를 쓴다 — 가득 찬 상태로 시작
  return world;
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
  world.input = { ...Input.emptySnapshot(), reactionPressed: true };
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
    // 오사는 위력 감소 — 막아주긴 하되 한 방에 죽지는 않는다
    const ffMul = balance.enemyAi.friendlyFireDamageMul;
    expect(ally.health).toBe(enemyDef('goblin_spear').health - 10 * ffMul);
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

describe('적 몸통 충돌', () => {
  const contact = (world: World): number => {
    const e = world.enemies[0]!;
    return Math.hypot(world.player.x - e.x, world.player.z - e.z);
  };

  it('적을 향해 걸어도 통과하지 못하고 몸통 앞에서 멈춘다', () => {
    const world = makeWorld();
    const enemy = makeSpear(14, 10);
    enemy.ai = 'idle'; // 제자리 (움직이지 않는 벽 역할)
    world.enemies.push(enemy);
    world.player.yaw = -Math.PI / 2; // 동쪽(적)을 바라봄
    const minDist = balance.player.radius + enemyDef('goblin_spear').radius;

    for (let i = 0; i < 180; i++) {
      world.input = { ...Input.emptySnapshot(), moveForward: 1 };
      PlayerMove.tick(world, DT);
      expect(contact(world)).toBeGreaterThanOrEqual(minDist - 0.01);
    }
    // 적 앞에 붙어서 멈췄다 (통과하지 못했다)
    expect(world.player.x).toBeLessThan(enemy.x);
    expect(contact(world)).toBeLessThan(minDist + 0.2);
  });

  it('추격하는 적도 플레이어를 파고들지 못한다', () => {
    const world = makeWorld();
    const enemy = makeSpear(14, 10);
    world.enemies.push(enemy);
    const minDist = balance.player.radius + enemyDef('goblin_spear').radius;

    for (let i = 0; i < 240; i++) {
      Enemies.tick(world, DT);
      PlayerMove.tick(world, DT);
      expect(contact(world)).toBeGreaterThanOrEqual(minDist - 0.01);
    }
  });

  it('죽은 적은 통과할 수 있다', () => {
    const world = makeWorld();
    const enemy = makeSpear(11, 10);
    enemy.alive = false;
    world.enemies.push(enemy);
    world.player.yaw = -Math.PI / 2;
    for (let i = 0; i < 60; i++) {
      world.input = { ...Input.emptySnapshot(), moveForward: 1 };
      PlayerMove.tick(world, DT);
    }
    expect(world.player.x).toBeGreaterThan(enemy.x); // 시체는 막지 않는다
  });
});

describe('피격 밀림', () => {
  const kb = balance.playerKnockback;

  /** 밀림이 끝날 때까지 PlayerMove만 돌려 이동 거리를 잰다 (입력 없음).
   *  공격마다 미는 시간이 다르므로(playerKnockbackTicks) 남은 틱이 0이 될 때까지 돈다 */
  function settle(world: World): number {
    const x0 = world.player.x;
    const z0 = world.player.z;
    for (let i = 0; i < 60 && (world.player.kbTicks ?? 0) > 0; i++) PlayerMove.tick(world, DT);
    return Math.hypot(world.player.x - x0, world.player.z - z0);
  }

  function spearHit(blocking: boolean): number {
    const world = makeWorld();
    world.enemies.push(makeSpear(12, 10)); // 플레이어(10,10) 동쪽
    world.player.yaw = -Math.PI / 2; // 적을 바라봄 (정면 방어 성립)
    world.player.blocking = blocking;
    tickUntil(world, 'impact');
    Enemies.tick(world, DT); // 타격 적용 → 밀림 시작
    world.player.blocking = false; // 이동 감속 페널티는 배제하고 밀림만 측정
    return settle(world);
  }

  function arrowHit(blocking: boolean): number {
    const world = makeWorld();
    world.player.yaw = -Math.PI / 2;
    world.player.blocking = blocking;
    world.projectiles.push({
      id: 1, owner: 'enemy',
      x: 12, y: 1.2, z: 10, prevX: 12, prevY: 1.2, prevZ: 10,
      vx: -20, vy: 0, vz: 0,
      lifeTicks: 120, damage: 8, burnTicks: 0, burnDamagePerTick: 0,
      radius: 0.15, kind: 'arrow',
    });
    for (let i = 0; i < 10 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    world.player.blocking = false;
    return settle(world);
  }

  it('창병 찌르기 — 기본 thrust 의 2배로 밀린다 (속도는 그대로)', () => {
    const spear = enemyDef('goblin_spear').attack;
    expect(spear.playerKnockback).toBeCloseTo(kb.thrust * 2, 5);
    // 거리만 늘리고 시간을 그대로 두면 순간이동처럼 보인다 — 미는 시간도 2배
    expect(spear.playerKnockbackTicks).toBe(kb.ticks * 2);
    expect(spear.playerKnockback! / spear.playerKnockbackTicks!).toBeCloseTo(
      kb.thrust / kb.ticks,
      5,
    );
    expect(spearHit(false)).toBeCloseTo(spear.playerKnockback!, 1);
  });

  it('방어 중이면 1/3만 밀린다', () => {
    const spear = enemyDef('goblin_spear').attack;
    expect(spearHit(true)).toBeCloseTo(spear.playerKnockback! * kb.blockedMul, 1);
  });

  it('화살은 아주 조금, 마법은 많이 — 종류별로 다르다', () => {
    expect(arrowHit(false)).toBeCloseTo(kb.arrow, 1);
    expect(kb.arrow).toBeLessThan(kb.contact);
    expect(kb.contact).toBeLessThan(kb.thrust);
    expect(kb.thrust).toBeLessThan(kb.magic);
  });

  it('화살도 방어하면 1/3 (막아도 밀린다)', () => {
    expect(arrowHit(true)).toBeCloseTo(kb.arrow * kb.blockedMul, 2);
  });

  it('벽을 등지면 벽에서 멈춘다 (밀림이 벽을 뚫지 않는다)', () => {
    const world = makeWorld();
    world.player.x = 5; // 서쪽 벽(x=4) 바로 앞
    world.player.z = 10;
    world.enemies.push(makeSpear(8, 10)); // 동쪽에서 찌른다 → 서쪽으로 밀림
    tickUntil(world, 'impact');
    Enemies.tick(world, DT);
    settle(world);
    expect(world.player.x).toBeGreaterThanOrEqual(4 + balance.player.radius - 0.01);
  });
});

describe('패링 격돌 — 적만 굳는다', () => {
  const reaction = balance.reaction;

  /** 창병을 dist 앞에 두고 타격 이동 n틱째에 패링 */
  function parryAt(dist: number, n: number): World {
    const world = makeWorld();
    world.enemies.push(makeSpear(10 + dist, 10));
    tickUntil(world, 'active_perfect');
    for (let i = 0; i < n; i++) Enemies.tick(world, DT);
    pressReaction(world);
    return world;
  }

  it('완벽 패링 — 적 스태거, 플레이어는 경직 없음', () => {
    const world = parryAt(3.5, 10);
    const enemy = world.enemies[0]!;
    expect(enemy.ai).toBe('staggered');
    expect(world.player.stunTicks).toBe(0); // 성공했으니 벌이 없다
    expect(world.freezeTicks).toBe(reaction.hitstopPerfectTicks);
  });

  it('일반 패링 — 스태거는 없지만 후딜이 크게 붙고, 플레이어는 멀쩡하다', () => {
    // 창끝이 일반 대역(guardDepth)에는 들어왔지만 완벽 대역(perfectBand)에는
    // 아직인 시점. strikeEase 1.8 로 창이 앞쪽에서 확 뻗으므로 이 구간은
    // 3.5m 기준 대략 2~5틱이다 (등속이던 시절엔 3~8틱)
    const world = parryAt(3.5, 2);
    const enemy = world.enemies[0]!;
    expect(enemy.ai).toBe('recover');
    expect(enemy.timer).toBe(
      enemyDef('goblin_spear').attack.recoverTicks + reaction.parryRecoilTicks,
    );
    expect(enemy.recoiled).toBe(true);
    expect(world.player.stunTicks).toBe(0);
  });

  it('패링 보상이 막기보다 크다 (패링 반동 > 막기 반동)', () => {
    expect(reaction.parryRecoilTicks).toBeGreaterThan(balance.block.clashEnemyRecoilTicks);
  });

  it('격돌 연출 이벤트를 kind와 함께 발행한다', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(13.5, 10));
    const events: { kind: string }[] = [];
    world.events.on('guard_clash', (payload) => events.push(payload as { kind: string }));
    tickUntil(world, 'active_perfect');
    for (let i = 0; i < 10; i++) Enemies.tick(world, DT);
    pressReaction(world);
    expect(events[0]!.kind).toBe('parry_perfect');
  });
});

describe('방패 격돌 — 막으면 양쪽이 굳는다', () => {
  const clash = balance.block;

  function blockedHit(): World {
    const world = makeWorld();
    world.enemies.push(makeSpear(13, 10));
    world.player.yaw = -Math.PI / 2; // 적을 바라봄 (정면 방어)
    world.player.blocking = true;
    tickUntil(world, 'impact');
    Enemies.tick(world, DT); // 타격 → 방패에 막힘
    return world;
  }

  it('막으면 플레이어는 짧게, 적은 더 길게 굳는다 (반격 창)', () => {
    const events: unknown[] = [];
    const world = makeWorld();
    world.enemies.push(makeSpear(13, 10));
    world.player.yaw = -Math.PI / 2;
    world.player.blocking = true;
    world.events.on('guard_clash', (payload) => events.push(payload));
    tickUntil(world, 'impact');
    Enemies.tick(world, DT);

    const enemy = world.enemies[0]!;
    expect(events).toHaveLength(1);
    expect(world.player.stunTicks).toBe(clash.clashPlayerStunTicks);
    expect(enemy.recoiled).toBe(true);
    expect(enemy.timer).toBe(
      enemyDef('goblin_spear').attack.recoverTicks + clash.clashEnemyRecoilTicks,
    );
    expect(enemy.timer).toBeGreaterThan(world.player.stunTicks); // 적이 더 오래 굳는다
    expect(world.freezeTicks).toBe(clash.clashHitstopTicks);
  });

  it('경직이 풀리면 양쪽 다 정상으로 돌아온다', () => {
    const world = blockedHit();
    const enemy = world.enemies[0]!;
    const total = enemyDef('goblin_spear').attack.recoverTicks + clash.clashEnemyRecoilTicks;
    for (let i = 0; i < total + 2; i++) {
      Enemies.tick(world, DT);
      Reaction.tick(world, DT);
    }
    expect(world.player.stunTicks).toBe(0);
    expect(enemy.recoiled).toBe(false);
    expect(enemy.ai).not.toBe('recover'); // 다시 움직인다 (붙어 있으면 바로 다음 공격)
  });

  it('막지 않고 맞으면 격돌이 없다', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(13, 10));
    const events: unknown[] = [];
    world.events.on('guard_clash', (payload) => events.push(payload));
    tickUntil(world, 'impact');
    Enemies.tick(world, DT);
    expect(events).toHaveLength(0);
    expect(world.enemies[0]!.recoiled).toBeFalsy();
    expect(world.player.health).toBeLessThan(balance.player.healthMax);
  });
});

describe('근접 히트박스 방향 판정', () => {
  const spearArc = enemyDef('goblin_spear').attack.arcDeg!;

  /** 예비동작 진입 후 플레이어를 (x,z)로 옮기고 타격까지 진행 */
  function attackFrom(x: number, z: number): World {
    const world = makeWorld();
    world.enemies.push(makeSpear(13, 10)); // 플레이어(10,10) 동쪽 3.0
    tickUntil(world, 'windup'); // 이 시점에 적의 방향이 고정된다
    world.player.x = x;
    world.player.z = z;
    tickUntil(world, 'recover');
    return world;
  }

  it('정면에 서 있으면 맞는다', () => {
    const world = attackFrom(10, 10);
    expect(world.player.health).toBeLessThan(balance.player.healthMax);
  });

  it('옆으로 비키면 같은 거리라도 빗나간다 (사거리 안이어도)', () => {
    // 적(13,10)에서 거리 3.0을 유지한 채 90도 옆 — 예전엔 거리만 봐서 맞았다
    const world = attackFrom(13, 13);
    const dist = Math.hypot(world.player.x - 13, world.player.z - 13 + 3);
    expect(dist).toBeLessThan(enemyDef('goblin_spear').attackRange); // 사거리 안이다
    expect(world.player.health).toBe(balance.player.healthMax); // 그래도 안 맞는다
    expect(world.enemies[0]!.whiffed).toBe(true); // 헛창 경직으로 이어진다
  });

  it('등 뒤로 돌아가면 빗나간다', () => {
    const world = attackFrom(15, 10); // 적 반대편
    expect(world.player.health).toBe(balance.player.healthMax);
  });

  it('찌르기 호는 좁고 손톱 호는 넓다', () => {
    expect(spearArc).toBeLessThan(enemyDef('goblin_runner').attack.arcDeg!);
    expect(spearArc).toBeLessThanOrEqual(60);
  });

  it('빗나간 공격은 패링 대상도 아니다 (판정 일관성)', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(13, 10));
    tickUntil(world, 'windup');
    world.player.x = 13; // 옆으로 비킴
    world.player.z = 13;
    tickUntil(world, 'active_perfect');
    for (let i = 0; i < 12; i++) Enemies.tick(world, DT);

    const results: unknown[] = [];
    world.events.on('parry_attempt', (payload) => results.push(payload));
    pressReaction(world);
    expect(results).toHaveLength(0);
  });
});

describe('창병 돌격 (창 돌격)', () => {
  const charge = enemyDef('goblin_spear').chargeAttack!;

  it('멀리서 wantsCharge 가 켜지면 걸어오는 대신 달려들며 찌른다', () => {
    const world = makeWorld();
    const enemy = makeSpear(10 + 7, 10); // 사거리 3.6 밖
    enemy.wantsCharge = true;
    world.enemies.push(enemy);
    const events: unknown[] = [];
    world.events.on('enemy_charge', (payload) => events.push(payload));

    Enemies.tick(world, DT);
    expect(events).toHaveLength(1);
    expect(enemy.attackMode).toBe('charge');
    expect(enemy.ai).toBe('windup');
    expect(enemy.wantsCharge).toBe(false); // 한 번만 쓴다

    // 예비동작 동안은 제자리 (텔레그래프)
    const xAtWindup = enemy.x;
    for (let i = 0; i < charge.windupTicks - 1; i++) Enemies.tick(world, DT);
    expect(enemy.x).toBeCloseTo(xAtWindup, 5);

    // 타격 구간에 달려든다
    tickUntil(world, 'active_perfect');
    const xBefore = enemy.x;
    for (let i = 0; i < 12; i++) Enemies.tick(world, DT);
    expect(enemy.x).toBeLessThan(xBefore - 1); // 플레이어 쪽으로 크게 이동
  });

  it('가까우면(minRange 안) 돌격하지 않고 평소 찌르기', () => {
    const world = makeWorld();
    const enemy = makeSpear(10 + 3.4, 10); // minRange 4.5 안
    enemy.wantsCharge = true;
    world.enemies.push(enemy);
    Enemies.tick(world, DT);
    expect(enemy.attackMode).toBe('melee');
  });

  it('돌격은 사거리에 닿으면 멈춘다 (플레이어를 지나치지 않는다)', () => {
    const world = makeWorld();
    const enemy = makeSpear(10 + 7, 10);
    enemy.wantsCharge = true;
    world.enemies.push(enemy);
    tickUntil(world, 'impact', 400);
    const dist = Math.hypot(enemy.x - world.player.x, enemy.z - world.player.z);
    expect(dist).toBeGreaterThan(balance.player.radius); // 파묻히지 않는다
    expect(dist).toBeLessThanOrEqual(
      enemyDef('goblin_spear').attackRange * charge.impactRangeMul,
    ); // 닿는 거리까지는 왔다
  });
});

describe('창병 헛창 경직', () => {
  const spearAttack = enemyDef('goblin_spear').attack;

  it('빗나가면 whiffRecoverTicks 만큼 굳는다 — 명중하면 평소 후딜', () => {
    // 빗나감: 예비동작 중 사거리 밖으로 물러난다
    const miss = makeWorld();
    miss.enemies.push(makeSpear(13, 10));
    tickUntil(miss, 'windup');
    miss.player.x = 4.5; // 멀리 — impact 시 사거리 밖
    const events: unknown[] = [];
    miss.events.on('enemy_whiffed', (payload) => events.push(payload));
    tickUntil(miss, 'recover');
    expect(miss.enemies[0]!.whiffed).toBe(true);
    expect(miss.enemies[0]!.timer).toBe(spearAttack.whiffRecoverTicks);
    expect(events[0]).toMatchObject({ enemyType: 'goblin_spear' });
    expect(miss.player.health).toBe(balance.player.healthMax); // 안 맞았다

    // 명중: 그 자리에 서 있으면 평소 후딜
    const hit = makeWorld();
    hit.enemies.push(makeSpear(13, 10));
    tickUntil(hit, 'recover');
    expect(hit.enemies[0]!.whiffed).toBe(false);
    expect(hit.enemies[0]!.timer).toBe(spearAttack.recoverTicks);
  });

  it('경직 1.5초 동안 그 자리에 굳어 있고, 끝나면 다시 추격한다', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(13, 10));
    tickUntil(world, 'windup');
    world.player.x = 4.5;
    tickUntil(world, 'recover');
    const enemy = world.enemies[0]!;
    const frozen = { x: enemy.x, z: enemy.z };

    expect(spearAttack.whiffRecoverTicks).toBe(63); // 60Hz 기준 1.05초
    for (let i = 0; i < spearAttack.whiffRecoverTicks! - 1; i++) {
      Enemies.tick(world, DT);
      expect(enemy.ai).toBe('recover'); // 내내 굳어 있다
    }
    expect(enemy.x).toBeCloseTo(frozen.x, 5); // 한 발짝도 안 움직였다
    expect(enemy.z).toBeCloseTo(frozen.z, 5);

    Enemies.tick(world, DT);
    expect(enemy.ai).toBe('chase');
    expect(enemy.whiffed).toBe(false);
  });

  it('굳은 동안은 패링 대상이 아니다 — 무기로 때려야 한다', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(13, 10));
    tickUntil(world, 'windup');
    world.player.x = 4.5;
    tickUntil(world, 'recover');
    world.player.x = 11.5; // 다시 붙는다 (반경 안)

    const results: unknown[] = [];
    world.events.on('parry_attempt', (payload) => results.push(payload));
    pressReaction(world);
    expect(results).toHaveLength(0);
    expect(world.enemies[0]!.ai).toBe('recover'); // 여전히 굳어 있다
    expect(world.player.stunTicks).toBe(0); // 헛손질 벌도 없다
  });
});

describe('반응 판정 분기 — 무기 끝 위치 기반', () => {
  /** 창병을 dist 앞에 두고 타격 이동 n틱째까지 진행 (n=0 → 창이 아직 당겨진 상태) */
  function strikeAt(dist: number, n: number): World {
    const world = makeWorld();
    world.enemies.push(makeSpear(10 + dist, 10));
    tickUntil(world, 'active_perfect');
    for (let i = 0; i < n; i++) Enemies.tick(world, DT);
    return world;
  }

  it('창이 아직 멀면 그 자리에서는 패링되지 않는다 (경직도 없다)', () => {
    const world = strikeAt(3.5, 1); // gap ≈ 1.64 > guardDepth
    const results: unknown[] = [];
    world.events.on('parry_attempt', (payload) => results.push(payload));

    pressReaction(world);
    expect(results).toHaveLength(0);
    expect(world.enemies[0]!.ai).toBe('active_perfect'); // 공격은 계속된다
    expect(world.player.stunTicks).toBe(0); // 조기 입력이지만 벌은 없다
  });

  it('조금 이르게 누르면 버퍼에 담겼다가 창이 닿는 순간 성립한다', () => {
    const world = strikeAt(3.5, 1);
    const results: { result: string }[] = [];
    world.events.on('parry_attempt', (payload) => results.push(payload as { result: string }));

    pressReaction(world); // 이른 입력 — 아직 성립하지 않는다
    expect(results).toHaveLength(0);
    expect(world.player.parryBufferTicks).toBe(balance.reaction.parryBufferTicks);

    // 버튼에서 손을 떼도, 창이 도달하면 그 입력으로 패링된다
    for (let i = 0; i < 4 && results.length === 0; i++) {
      Enemies.tick(world, DT);
      Reaction.tick(world, DT);
    }
    expect(results).toHaveLength(1);
    expect(world.player.stunTicks).toBe(0);
  });

  it('예비동작 중 조기 입력은 여전히 벌을 받는다 (버퍼로 봐주지 않는다)', () => {
    const world = makeWorld();
    world.enemies.push(makeSpear(13.5, 10));
    tickUntil(world, 'windup');
    pressReaction(world);
    expect(world.player.stunTicks).toBe(balance.reaction.failStunTicks);
    expect(world.player.parryBufferTicks ?? 0).toBe(0);
  });

  it('창끝이 가드에 들어오면 일반 패링: recover + 히트스톱 2t', () => {
    const world = strikeAt(3.5, 4); // gap ≈ 1.13 (guardDepth 1.3 안, perfectBand 밖)
    pressReaction(world);
    expect(world.enemies[0]!.ai).toBe('recover');
    expect(world.freezeTicks).toBe(balance.reaction.hitstopNormalTicks);
  });

  it('창끝이 방패에 닿는 순간 완벽 패링: 스태거 + 히트스톱 4t', () => {
    const world = strikeAt(3.5, 10); // gap ≈ 0.12 < perfectBand
    const results: unknown[] = [];
    world.events.on('parry_attempt', (payload) => results.push(payload));

    pressReaction(world);
    expect(world.enemies[0]!.ai).toBe('staggered');
    expect(world.freezeTicks).toBe(balance.reaction.hitstopPerfectTicks);
    expect(results[0]).toMatchObject({ result: 'perfect' });
  });

  it('창은 앞쪽에서 확 뻗는다 (strikeEase) — 판정 창 길이는 그대로', () => {
    const def = enemyDef('goblin_spear');
    const ease = def.attack.strikeEase!;
    expect(ease).toBeGreaterThan(1); // 등속이 아니다

    const world = makeWorld();
    world.enemies.push(makeSpear(13.5, 10));
    const enemy = world.enemies[0]!;
    tickUntil(world, 'active_perfect');

    const reach = def.attackRange * def.attack.impactRangeMul;
    const rest = reach * balance.parrySpace.pullbackRatio;
    const total = balance.reaction.windowPerfectTicks + balance.reaction.windowNormalTicks;
    for (let k = 1; k <= 6; k++) Enemies.tick(world, DT);
    const eased = ((enemy.weaponTipDist ?? 0) - rest) / (reach - rest);
    expect(eased).toBeCloseTo(1 - Math.pow(1 - 6 / total, ease), 5);
    expect(eased).toBeGreaterThan(6 / total + 0.15); // 등속보다 확실히 앞서 나갔다

    // 판정 창 자체는 건드리지 않았다 — 6+12틱 뒤에 impact
    tickUntil(world, 'impact', 40);
    expect(enemy.weaponTipDist).toBeCloseTo(reach, 5); // 끝에는 최대 사거리
  });

  it('같은 틱이라도 적이 멀수록 패링 타이밍이 늦게 온다', () => {
    const near = strikeAt(2.2, 6); // 이미 창끝이 몸에 닿음
    pressReaction(near);
    expect(near.enemies[0]!.ai).toBe('staggered'); // 완벽

    // 예비동작 중 물러나면 창이 도달하는 데 더 걸린다 (적은 사거리까지 걸어오므로
    // 멀리 배치하는 것으로는 거리를 만들 수 없다 — 플레이어가 빠져야 한다)
    const far = makeWorld();
    far.enemies.push(makeSpear(10 + 3.5, 10));
    tickUntil(far, 'windup');
    far.player.x -= 0.8; // 거리 4.3
    tickUntil(far, 'active_perfect');
    for (let i = 0; i < 3; i++) Enemies.tick(far, DT);
    pressReaction(far);
    expect(far.enemies[0]!.ai).toBe('active_perfect'); // 아직 판정 없음 — 공격 계속

    for (let i = 0; i < 11; i++) Enemies.tick(far, DT); // 창이 도달할 때까지 기다리면
    pressReaction(far);
    expect(['recover', 'staggered']).toContain(far.enemies[0]!.ai);
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
    const world = strikeAt(3.5, 10);
    pressReaction(world); // 완벽 패링 → 스태거
    const kills: unknown[] = [];
    world.events.on('melee_kill', (payload) => kills.push(payload));

    pressReaction(world); // 처형
    expect(world.enemies[0]!.alive).toBe(false);
    expect(kills[0]).toMatchObject({ enemyType: 'goblin_spear', execution: true });
  });

  it('근접 키(해머)로도 처형이 나간다', () => {
    const world = strikeAt(3.5, 10);
    pressReaction(world); // 완벽 패링 → 스태거
    expect(world.enemies[0]!.ai).toBe('staggered');
    const kills: unknown[] = [];
    world.events.on('melee_kill', (payload) => kills.push(payload));

    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Reaction.tick(world, DT);
    expect(world.enemies[0]!.alive).toBe(false);
    expect(kills[0]).toMatchObject({ execution: true });
    // 그 입력은 처형이 가져간다 — 뒤에 도는 Weapons 가 같은 틱에 해머까지 휘두르면
    // 처형 연출을 스윙이 덮어쓰고 스태미너도 이중으로 나간다
    expect(world.input.meleePressed).toBe(false);
  });

  it('해머를 휘두르는 중이면 근접 키가 처형으로 가로채지 않는다', () => {
    const world = strikeAt(3.5, 10);
    pressReaction(world); // 완벽 패링 → 스태거
    expect(world.enemies[0]!.ai).toBe('staggered');

    // 연결이 열려 있는 상태 — 반응 반경(4.6)이 해머 사거리보다 넓어서
    // 이 예외가 없으면 경직한 적을 해머로 두들기는 선택지가 사라진다
    world.weapon.comboTimer = 20;
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Reaction.tick(world, DT);
    expect(world.enemies[0]!.alive).toBe(true); // 처형 안 됨
    expect(world.input.meleePressed).toBe(true); // 입력은 해머로 넘어간다

    // 반응 버튼은 연결 중이라도 언제나 처형이다
    pressReaction(world);
    expect(world.enemies[0]!.alive).toBe(false);
  });

  it('근접 키는 패링·회피·반사에는 쓰이지 않는다 — 처형 전용', () => {
    const world = strikeAt(3.5, 10); // 무기 끝이 완벽 대역에 들어온 순간
    const attempts: unknown[] = [];
    world.events.on('parry_attempt', (payload) => attempts.push(payload));

    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Reaction.tick(world, DT);
    expect(attempts).toHaveLength(0); // 패링 성립 안 함
    expect(world.enemies[0]!.ai).not.toBe('staggered');
    expect(world.input.meleePressed).toBe(true); // 아무것도 안 했으니 해머로 넘어간다

    // Shift+근접도 회피가 아니다
    world.input = { ...Input.emptySnapshot(), meleePressed: true, sprint: true };
    Reaction.tick(world, DT);
    expect(world.player.dodgeTicks).toBe(0);
  });

  /** Shift 를 한 번 눌렀다 뗀 한 틱 */
  function shiftTap(world: World): void {
    world.input = { ...Input.emptySnapshot(), sprint: true, sprintPressed: true };
    Reaction.tick(world, DT);
    world.input = Input.emptySnapshot();
  }

  it('한 번만 누르면 회피가 아니다 — 그냥 질주다', () => {
    const world = makeWorld();
    shiftTap(world);
    for (let i = 0; i < balance.reaction.dodgeDoubleTapTicks + 4; i++) {
      Reaction.tick(world, DT);
    }
    expect(world.player.dodgeTicks).toBe(0);
  });

  it('연타 창이 지난 뒤 누르면 다시 첫 타로 친다', () => {
    const world = makeWorld();
    shiftTap(world);
    for (let i = 0; i < balance.reaction.dodgeDoubleTapTicks; i++) Reaction.tick(world, DT);
    shiftTap(world); // 창이 닫힌 뒤라 이게 새 첫 타
    expect(world.player.dodgeTicks).toBe(0);
    shiftTap(world); // 이제야 두 번째
    expect(world.player.dodgeTicks).toBe(balance.reaction.dodgeDashTicks);
  });

  it('Shift 를 누른 채로 두어도 회피가 안 나간다 — 엣지로만 센다', () => {
    const world = makeWorld();
    shiftTap(world); // 누른 순간 (엣지)
    // 이후로는 계속 눌려 있기만 하다 (sprintPressed 없음)
    for (let i = 0; i < balance.reaction.dodgeDoubleTapTicks + 10; i++) {
      world.input = { ...Input.emptySnapshot(), sprint: true };
      Reaction.tick(world, DT);
    }
    expect(world.player.dodgeTicks).toBe(0);
  });

  it('Shift 연타 = 즉시 회피 (판정 생략)', () => {
    const world = makeWorld();
    shiftTap(world);
    expect(world.player.dodgeTicks).toBe(0); // 첫 타는 창만 연다
    shiftTap(world);
    expect(world.player.dodgeTicks).toBe(balance.reaction.dodgeDashTicks);
    expect(world.player.iframeTicks).toBe(balance.reaction.dodgeIFrameTicks);

    // windup 중이어도 연타는 실패 경직 없이 회피한다 (빨강 공격 탈출용)
    const world2 = makeWorld();
    world2.enemies.push(makeSpear(12, 10));
    tickUntil(world2, 'windup');
    shiftTap(world2);
    shiftTap(world2);
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

describe('마법탄 내파 (수호주술사)', () => {
  const splash = enemyDef('warden').attack.splash!;

  function makeRunner(x: number, z: number, id: number): EnemyState {
    return {
      id, type: 'goblin_runner',
      x, z, prevX: x, prevZ: z, yaw: 0,
      health: 1000, alive: true, ai: 'chase', timer: 0,
      burnTicks: 0, burnDamagePerTick: 0,
    };
  }

  /** fromX 에서 -X(플레이어 쪽)로 마법탄을 쏜다 */
  function fireBolt(world: World, fromX: number, owner: 'player' | 'enemy' = 'enemy'): void {
    const p = world.player;
    const dir = owner === 'player' ? 1 : -1;
    world.projectiles.push({
      id: 900, owner,
      x: fromX, y: 1.2, z: p.z, prevX: fromX, prevY: 1.2, prevZ: p.z,
      vx: 20 * dir, vy: 0, vz: 0,
      lifeTicks: 120, damage: 26, burnTicks: 0, burnDamagePerTick: 0,
      radius: 0.3, kind: 'magic', casterId: 99, deflectable: true,
      splash,
    });
    for (let i = 0; i < 90 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
  }

  it('빗나가 옆에서 터지면 플레이어가 폭심 쪽으로 끌려간다 (화염구와 반대)', () => {
    const world = makeWorld();
    const p = world.player;
    // 플레이어 동쪽 2u 에 아군 — 탄이 여기서 막혀 터진다
    world.enemies.push(makeRunner(p.x + 2, p.z, 7));
    fireBolt(world, p.x + 8);

    expect(p.kbTicks).toBe(splash.pullTicks);
    expect(p.kbX!).toBeGreaterThan(0); // +X(폭심) 쪽으로 당겨진다
    expect(Math.abs(p.kbZ!)).toBeLessThan(1e-6);
    expect(p.health).toBeLessThan(balance.player.healthMax); // 감쇠 피해
    expect(p.health).toBeGreaterThan(balance.player.healthMax - splash.damage);
  });

  it('직격이면 당김이 아니라 뒤로 밀린다 — 피해도 한 번만', () => {
    const world = makeWorld();
    const p = world.player;
    fireBolt(world, p.x + 8);

    expect(p.health).toBe(balance.player.healthMax - 26); // 광역 피해 중복 없음
    expect(p.kbTicks).toBe(balance.playerKnockback.ticks); // 당김(14t)이 아니라 밀림(8t)
    expect(p.kbX!).toBeLessThan(0); // 날아온 방향(-X)으로 밀린다
  });

  it('반경 밖에서 터지면 아무 영향 없다', () => {
    const world = makeWorld();
    const p = world.player;
    world.enemies.push(makeRunner(p.x + splash.radius + 2, p.z, 7));
    fireBolt(world, p.x + 12);

    expect(p.health).toBe(balance.player.healthMax);
    expect(p.kbTicks ?? 0).toBe(0);
  });

  it('적에게 적중돼도 터진다 — 직격 적은 오사 피해만, 주변 적은 광역 피해', () => {
    const world = makeWorld();
    const p = world.player;
    const direct = makeRunner(p.x + 2, p.z, 7); // 탄이 여기서 막혀 터진다
    const bystander = makeRunner(p.x + 2, p.z + 1.8, 8); // 폭심 옆
    world.enemies.push(direct, bystander);
    const explosions: unknown[] = [];
    world.events.on('explosion', (payload) => explosions.push(payload));
    fireBolt(world, p.x + 8);

    expect(explosions).toHaveLength(1); // 적 몸에 맞아도 광역은 난다
    const ff = balance.enemyAi.friendlyFireDamageMul;
    // 직격 적 — 본 피해(오사 감쇠)만, 광역 피해 중복 없음
    expect(1000 - direct.health).toBeCloseTo(26 * ff, 3);
    // 옆의 적 — 광역 피해만 (역시 오사 감쇠)
    expect(1000 - bystander.health).toBeGreaterThan(0);
    expect(1000 - bystander.health).toBeLessThan(splash.damage * ff);
    // 둘 다 폭심으로 끌린다 (직격 적 포함)
    expect(direct.kbTicks).toBe(splash.pullTicks);
    expect(bystander.kbTicks).toBe(splash.pullTicks);
    expect(bystander.kbZ!).toBeLessThan(0); // z가 작아지는 쪽 = 폭심
  });

  it('반사되면 적들이 폭심으로 끌려 모인다 — 오사 감쇠 없이 전탄 피해', () => {
    const world = makeWorld();
    const p = world.player;
    const direct = makeRunner(p.x + 4, p.z, 7);
    const near = makeRunner(p.x + 4, p.z + 2, 8);
    world.enemies.push(direct, near);
    fireBolt(world, p.x, 'player'); // 반사된 탄 = owner player

    // 둘 다 폭심 쪽으로 당겨진다
    expect(direct.kbTicks).toBe(splash.pullTicks);
    expect(near.kbTicks).toBe(splash.pullTicks);
    expect(near.kbZ!).toBeLessThan(0); // z가 작아지는 쪽 = 폭심
    // 직격은 본 피해만, 주변은 광역 피해만 (오사 배율 없이)
    expect(1000 - direct.health).toBeCloseTo(26, 3);
    const dist = Math.hypot(near.x - direct.x, near.z - direct.z);
    expect(1000 - near.health).toBeGreaterThan(0);
    expect(1000 - near.health).toBeLessThan(splash.damage);
    expect(dist).toBeLessThan(splash.radius);
  });
});

describe('피격 밀림 중 이동', () => {
  const kb = balance.playerKnockback;

  /** 밀림 없이 n틱 걷는다 (yaw −π/2 → +X) */
  function walk(world: World, ticks: number): number {
    const from = { x: world.player.x, z: world.player.z };
    for (let i = 0; i < ticks; i++) {
      world.input = { ...Input.emptySnapshot(), moveForward: 1 };
      PlayerMove.tick(world, DT);
      world.input = Input.emptySnapshot();
    }
    return Math.hypot(world.player.x - from.x, world.player.z - from.z);
  }

  function setup(): World {
    const world = makeWorld();
    world.player.yaw = -Math.PI / 2; // +X 를 본다
    return world;
  }

  it('밀리는 동안 이동 입력이 절반으로 줄어든다', () => {
    const plain = setup();
    const normal = walk(plain, kb.ticks);

    const shoved = setup();
    shoved.player.kbTicks = kb.ticks;
    shoved.player.kbX = 0; // 밀림 자체는 0 으로 두고 이동분만 잰다
    shoved.player.kbZ = 0;
    const slowed = walk(shoved, kb.ticks);

    expect(slowed).toBeCloseTo(normal * kb.moveSpeedMul, 4);
  });

  it('밀림과 이동은 여전히 더해진다 — 달려들면 거리가 줄지만 멈추지는 않는다', () => {
    const world = setup();
    const dist = kb.thrust;
    world.player.kbTicks = kb.ticks;
    world.player.kbX = -dist / kb.ticks; // −X 로 밀린다
    world.player.kbZ = 0;
    const x0 = world.player.x;
    walk(world, kb.ticks); // 밀림 반대 방향(+X)으로 달려든다

    const pushed = x0 - world.player.x;
    expect(pushed).toBeGreaterThan(0); // 그래도 뒤로 밀린다
    expect(pushed).toBeLessThan(dist); // 다만 덜 밀린다
  });

  it('밀림이 끝나면 즉시 원래 속도로 돌아온다', () => {
    const world = setup();
    world.player.kbTicks = 1;
    world.player.kbX = 0;
    world.player.kbZ = 0;
    walk(world, 1); // 마지막 밀림 틱 — 여기까지는 감속
    expect(world.player.kbTicks).toBe(0);

    const plain = setup();
    expect(walk(world, 5)).toBeCloseTo(walk(plain, 5), 4);
  });
});

describe('던진 바위 — 방패로 막아도 밀린다', () => {
  function throwRock(world: World, blocking: boolean): number {
    world.player.yaw = -Math.PI / 2; // +X 를 본다
    world.player.blocking = blocking;
    world.projectiles.push({
      id: 77, owner: 'enemy',
      x: world.player.x + 6, y: 1.2, z: world.player.z,
      prevX: world.player.x + 6, prevY: 1.2, prevZ: world.player.z,
      vx: -20, vy: 0, vz: 0,
      lifeTicks: 120, damage: 30, burnTicks: 0, burnDamagePerTick: 0,
      radius: 0.45, kind: 'rock',
    });
    for (let i = 0; i < 30 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    return world.player.kbX !== undefined ? Math.abs(world.player.kbX) * world.player.kbTicks! : 0;
  }

  it('막아도 밀림이 줄지 않는다 (blockedMulByKind.rock = 1)', () => {
    const kb = balance.playerKnockback;
    const blockedMul = (kb.blockedMulByKind as Record<string, number>)['rock'];
    expect(blockedMul).toBe(1);

    const open = makeWorld();
    const openPush = throwRock(open, false);
    const guard = makeWorld();
    const guardPush = throwRock(guard, true);

    expect(openPush).toBeCloseTo(kb.rock, 4);
    expect(guardPush).toBeCloseTo(openPush, 4); // 방패를 들어도 그대로
    expect(guard.player.health).toBeLessThan(balance.player.healthMax); // 칩 데미지는 들어간다
  });

  it('화살은 여전히 방패로 막으면 거의 안 밀린다 (기존 규칙 유지)', () => {
    const kb = balance.playerKnockback;
    const world = makeWorld();
    world.player.yaw = -Math.PI / 2;
    world.player.blocking = true;
    world.projectiles.push({
      id: 78, owner: 'enemy',
      x: world.player.x + 6, y: 1.2, z: world.player.z,
      prevX: world.player.x + 6, prevY: 1.2, prevZ: world.player.z,
      vx: -20, vy: 0, vz: 0,
      lifeTicks: 120, damage: 12, burnTicks: 0, burnDamagePerTick: 0,
      radius: 0.15, kind: 'arrow',
    });
    for (let i = 0; i < 30 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    const push = Math.abs(world.player.kbX!) * world.player.kbTicks!;
    expect(push).toBeCloseTo(kb.arrow * kb.blockedMul, 4);
  });
});
