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

describe('피격 밀림', () => {
  const kb = balance.playerKnockback;

  /** 밀림이 끝날 때까지 PlayerMove만 돌려 이동 거리를 잰다 (입력 없음) */
  function settle(world: World): number {
    const x0 = world.player.x;
    const z0 = world.player.z;
    for (let i = 0; i < kb.ticks + 2; i++) PlayerMove.tick(world, DT);
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

  it('창병 찌르기 — 적 반대 방향으로 thrust 거리만큼 밀린다', () => {
    expect(spearHit(false)).toBeCloseTo(kb.thrust, 1);
  });

  it('방어 중이면 1/3만 밀린다', () => {
    expect(spearHit(true)).toBeCloseTo(kb.thrust * kb.blockedMul, 1);
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

    expect(spearAttack.whiffRecoverTicks).toBe(90); // 60Hz 기준 1.5초
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

  it('창이 아직 멀면 패링되지 않는다 — 경직도 없다 (헛손질)', () => {
    const world = strikeAt(3.5, 3); // gap ≈ 1.30 > guardDepth
    const results: unknown[] = [];
    world.events.on('parry_attempt', (payload) => results.push(payload));

    pressReaction(world);
    expect(results).toHaveLength(0);
    expect(world.enemies[0]!.ai).toBe('active_perfect'); // 공격은 계속된다
    expect(world.player.stunTicks).toBe(0); // 조기 입력이지만 벌은 없다
  });

  it('창끝이 가드에 들어오면 일반 패링: recover + 히트스톱 2t', () => {
    const world = strikeAt(3.5, 6); // gap ≈ 0.80 (guardDepth 0.9 안, perfectBand 밖)
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
    for (let i = 0; i < 6; i++) Enemies.tick(far, DT);
    pressReaction(far);
    expect(far.enemies[0]!.ai).toBe('active_normal'); // 아직 판정 없음 — 공격 계속

    for (let i = 0; i < 8; i++) Enemies.tick(far, DT); // 창이 도달할 때까지 기다리면
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
