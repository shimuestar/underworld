// M7 검증 — warden(방어막·시전·반사), 보스 2페이즈 교대, 출구 잠금/클리어.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { attackReaches, enemyDef, healthBarState } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { sigilDef } from '../core/SigilData';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Enemies from './Enemies';
import * as Exit from './Exit';
import * as Mana from './Mana';
import * as Projectiles from './Projectiles';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';
import * as Weapons from './Weapons';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['##########', '#S.......#', '#........#', '#.......X#', '##########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: -Math.PI / 2, pitch: 0, health: 100, // +X를 바라봄
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
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

let world: World;
beforeEach(() => {
  world = makeWorld();
});

function tickEnemiesUntil(predicate: () => boolean, maxTicks = 600): void {
  for (let i = 0; i < maxTicks; i++) {
    Enemies.tick(world, DT);
    if (predicate()) return;
  }
  throw new Error('조건 미도달');
}

function pressReaction(): void {
  world.input = { ...Input.emptySnapshot(), reactionPressed: true };
  Reaction.tick(world, DT);
  world.input = Input.emptySnapshot();
}

describe('warden (수호주술사)', () => {
  it('시전 사이클: windup 46t → 적 투사체 발사 → recover', () => {
    const warden = spawnEnemyAt('warden', 18, 6, 1);
    warden.ai = 'chase';
    world.enemies.push(warden);

    tickEnemiesUntil(() => warden.ai === 'windup');
    tickEnemiesUntil(() => warden.ai === 'recover');
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0]!.owner).toBe('enemy');
    expect(world.projectiles[0]!.damage).toBe(enemyDef('warden').damage);
  });

  it('적 투사체가 플레이어에 명중하면 피해', () => {
    const warden = spawnEnemyAt('warden', 18, 6, 1);
    warden.ai = 'chase';
    world.enemies.push(warden);
    tickEnemiesUntil(() => world.projectiles.length === 1);

    for (let i = 0; i < 120 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(world.player.health).toBe(100 - enemyDef('warden').damage);
  });

  it('반사: 투사체 반전(위력 ×1.5, 방어막 무시) → warden 피격', () => {
    const warden = spawnEnemyAt('warden', 18, 6, 1);
    warden.ai = 'chase';
    world.enemies.push(warden);
    tickEnemiesUntil(() => world.projectiles.length === 1);

    // 투사체가 반응 반경 안에 올 때까지 비행
    for (let i = 0; i < 200; i++) {
      Projectiles.tick(world, DT);
      const proj = world.projectiles[0];
      if (!proj) throw new Error('반사 전에 착탄');
      if (Math.hypot(world.player.x - proj.x, world.player.z - proj.z) <= balance.reaction.radius)
        break;
    }
    const baseDamage = world.projectiles[0]!.damage;
    pressReaction();
    const proj = world.projectiles[0]!;
    expect(proj.owner).toBe('player');
    expect(proj.deflected).toBe(true);
    expect(proj.damage).toBeCloseTo(baseDamage * 1.5);

    // 되돌아가 warden 피격 (방어막 무시)
    for (let i = 0; i < 200 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(warden.health).toBeCloseTo(enemyDef('warden').health - baseDamage * 1.5);
  });

  it('마법(화염구)은 방어막에 무효 — barrier_blocked 피드백', () => {
    const warden = spawnEnemyAt('warden', 12, 6, 1);
    world.enemies.push(warden);
    const blocked: unknown[] = [];
    world.events.on('barrier_blocked', (payload) => blocked.push(payload));

    world.projectiles.push({
      id: 1, owner: 'player', x: 8, y: 1.2, z: 6, prevX: 8, prevY: 1.2, prevZ: 6,
      vx: 26, vy: 0, vz: 0, lifeTicks: 120, damage: 45,
      burnTicks: 180, burnDamagePerTick: 0.15, radius: 0.35,
    });
    for (let i = 0; i < 60 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(warden.health).toBe(enemyDef('warden').health);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ kind: 'magic' });
  });

  it('9mm는 방어막을 관통해 피해를 준다 (근거리 몸통 = damage × bodyMul)', () => {
    const warden = spawnEnemyAt('warden', 12, 6, 1);
    world.enemies.push(warden);
    world.input = { ...Input.emptySnapshot(), rangedPressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    // 수평 사격 → 눈높이 1.6 / warden 키 2.0 = 0.8 → 몸통 판정
    expect(warden.health).toBeCloseTo(
      enemyDef('warden').health -
        balance.weapons.pistol.damage * balance.weapons.pistol.hitZones.bodyMul,
    );
  });
});

describe('goblin_chieftain (1구역 보스)', () => {
  function makeBoss(): ReturnType<typeof spawnEnemyAt> {
    const boss = spawnEnemyAt('goblin_chieftain', 8.4, 6, 1); // attackRange 안
    boss.ai = 'chase';
    world.enemies.push(boss);
    return boss;
  }

  /** 족장은 완벽 대역에서만 성립하되 결과는 늘 'normal' 이다 (parryAlwaysNormal).
   *  창이 열린 뒤 매 틱 눌러 닿는 순간을 잡는다 */
  function parryBoss(boss: ReturnType<typeof spawnEnemyAt>): string {
    tickEnemiesUntil(() => boss.ai === 'active_perfect');
    const results: string[] = [];
    const off = (p: unknown): void => {
      results.push((p as { result: string }).result);
    };
    world.events.on('parry_attempt', off);
    for (let i = 0; i < 40 && results.length === 0; i++) {
      pressReaction();
      if (results.length) break;
      Enemies.tick(world, DT);
    }
    return results[0] ?? '없음';
  }

  it('melee 페이즈: 3연속 패링해야 스태거, 그 전엔 recover', () => {
    const boss = makeBoss();
    const def = enemyDef('goblin_chieftain');

    for (let n = 1; n <= def.parriesToStagger!; n++) {
      expect(parryBoss(boss)).toBe('normal'); // 완벽 대역에서만 성립하되 보상은 일반
      if (n < def.parriesToStagger!) {
        expect(boss.ai).toBe('recover');
        expect(boss.parryStreak).toBe(n);
      }
    }
    expect(boss.ai).toBe('staggered');
    expect(boss.parryStreak).toBe(0);
  });

  it('일반 대역에서 누르면 성립하지 않는다 — 완벽 패링만 받는다', () => {
    const def = enemyDef('goblin_chieftain');
    expect(def.perfectParryOnly).toBe(true);
    const boss = makeBoss();
    tickEnemiesUntil(() => boss.ai === 'active_perfect');

    const results: unknown[] = [];
    world.events.on('parry_attempt', (p) => results.push(p));
    // 무기 끝을 일반 대역 한가운데로 강제로 놓고 눌러 본다
    const mid = (balance.parrySpace.perfectBand + balance.parrySpace.guardDepth) / 2;
    boss.weaponTipDist =
      Math.hypot(boss.x - world.player.x, boss.z - world.player.z) - balance.player.radius - mid;
    pressReaction();
    expect(results).toHaveLength(0);
    expect(boss.ai).not.toBe('staggered');
  });

  it('완벽 대역에 닿아도 일반 패링으로 처리한다 — 히트스톱·마나·연쇄까지', () => {
    const def = enemyDef('goblin_chieftain');
    expect(def.parryAlwaysNormal).toBe(true);
    Mana.init(world);
    const boss = makeBoss();
    tickEnemiesUntil(() => boss.ai === 'active_perfect');

    // 무기 끝을 완벽 대역 한복판에 놓고 누른다 — 일반 적이라면 'perfect' 가 나올 자리
    boss.weaponTipDist =
      Math.hypot(boss.x - world.player.x, boss.z - world.player.z) -
      balance.player.radius -
      balance.parrySpace.perfectBand * 0.5;
    const results: { result: string }[] = [];
    const clashes: { kind: string }[] = [];
    world.events.on('parry_attempt', (p) => results.push(p as { result: string }));
    world.events.on('guard_clash', (p) => clashes.push(p as { kind: string }));
    pressReaction();

    expect(results[0]!.result).toBe('normal');
    expect(clashes[0]!.kind).toBe('parry_normal');
    expect(world.freezeTicks).toBe(balance.reaction.hitstopNormalTicks);
    expect(world.mana.value).toBe(balance.mana.gain.parryNormal);
    expect(world.mana.chainIndex).toBe(0); // 연쇄는 오르지 않는다
  });

  it('방패로 막아도 보스는 끊기지 않는다 — 플레이어만 굳는다', () => {
    const def = enemyDef('goblin_chieftain');
    expect(def.blockCannotStagger).toBe(true);
    const boss = makeBoss();
    world.player.blocking = true;
    const clashes: unknown[] = [];
    const blocks: unknown[] = [];
    world.events.on('guard_clash', (p) => clashes.push(p));
    world.events.on('block_hit', (p) => blocks.push(p));

    tickEnemiesUntil(() => boss.ai === 'recover', 400);
    expect(blocks).toHaveLength(1); // 막긴 했다 (방패 섬광·소리)
    expect(clashes).toHaveLength(0); // 격돌 연출은 없다
    expect(boss.recoiled).not.toBe(true); // 튕기지 않았다
    expect(boss.timer).toBe(def.attack.recoverTicks); // 후딜이 늘지 않았다
    expect(world.player.stunTicks).toBeGreaterThan(0); // 플레이어만 굳는다
    expect(world.player.health).toBeLessThan(balance.player.healthMax); // 칩 피해도 받는다
  });

  it('스태거 중 처형 → executeDamage 타격, 스태거는 그 한 번으로 끝난다', () => {
    const boss = makeBoss();
    const def = enemyDef('goblin_chieftain');
    boss.ai = 'staggered';
    boss.timer = 90;

    pressReaction(); // 처형 타격
    expect(boss.health).toBe(def.health - def.executeDamage!);
    expect(boss.alive).toBe(true);

    // 스태거는 그 자리에서 끝난다 — Enemies 를 한 틱도 돌리지 않아도
    expect(boss.ai).toBe('recover');
  });

  it('처형은 보스를 뒤로 크게 날린다 — 다시 붙어야 한다', () => {
    const boss = makeBoss();
    boss.ai = 'staggered';
    boss.timer = balance.reaction.staggerTicks;
    world.enemies.push(boss);
    const before = Math.hypot(boss.x - world.player.x, boss.z - world.player.z);

    pressReaction();
    expect(boss.kbTicks).toBe(balance.reaction.executeKnockbackTicks);
    // 처형 연출 동안은 적이 통째로 멈춘다 — 연출이 끝난 뒤에 날아간다
    const wait = balance.reaction.executeFocusTicks + balance.reaction.executeKnockbackTicks;
    for (let i = 0; i < wait; i++) Enemies.tick(world, DT);
    const after = Math.hypot(boss.x - world.player.x, boss.z - world.player.z);
    expect(after - before).toBeCloseTo(balance.reaction.executeKnockback, 1);
  });

  it('한 번의 스태거에 처형은 한 번 — 연타해도 두 번째는 안 들어간다', () => {
    const boss = makeBoss();
    const def = enemyDef('goblin_chieftain');
    boss.ai = 'staggered';
    boss.timer = balance.reaction.staggerTicks;
    world.enemies.push(boss);

    const hits: unknown[] = [];
    world.events.on('boss_execute', (p) => hits.push(p));

    // 처형 연출 동안 Enemies 는 통째로 멈춘다(executeFocusTicks) — 그 사이에
    // 연타하면 staggered 가 남아 있어 처형이 몇 번이고 들어가던 버그
    for (let i = 0; i < 10; i++) {
      pressReaction();
      Enemies.tick(world, DT); // 연출 프리즈로 아무 일도 안 일어나는 틱
    }
    expect(hits).toHaveLength(1);
    expect(boss.health).toBe(def.health - def.executeDamage!);
    expect(boss.alive).toBe(true); // 만피에서 한 스태거로 죽지 않는다
  });

  it('장갑 페이즈는 없다 — 스태거 뒤에도 총알이 그대로 체력을 깎는다', () => {
    const def = enemyDef('goblin_chieftain');
    expect('armoredAttack' in def).toBe(false);
    expect('armorHealth' in def).toBe(false);
    const boss = makeBoss();

    boss.ai = 'staggered';
    boss.timer = 1;
    Enemies.tick(world, DT); // 스태거 종료
    expect(boss.ai).toBe('recover');

    // 총알 — 흡수하는 장갑이 없으니 체력이 바로 깎인다
    const pistol = balance.weapons.pistol;
    world.weapon.cooldown = 0;
    world.input = { ...Input.emptySnapshot(), rangedPressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(boss.health).toBeCloseTo(def.health - pistol.damage * pistol.hitZones.bodyMul, 5);

    // 마법도 튕기지 않는다
    world.projectiles.push({
      id: 1, owner: 'player', x: 7, y: 1.2, z: 6, prevX: 7, prevY: 1.2, prevZ: 6,
      vx: 26, vy: 0, vz: 0, lifeTicks: 60, damage: 45,
      burnTicks: 0, burnDamagePerTick: 0, radius: 0.35,
    });
    const blocked: unknown[] = [];
    world.events.on('barrier_blocked', (payload) => blocked.push(payload));
    const before = boss.health;
    for (let i = 0; i < 30 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(blocked).toHaveLength(0);
    expect(boss.health).toBeLessThan(before);
  });
});

describe('날아오는 바위 깨기', () => {
  /** 플레이어(6,6) 쪽으로 날아오는 바위 하나 */
  function throwRock(): (typeof world.projectiles)[number] {
    const rock = enemyDef('goblin_chieftain').rangedAttack!;
    const proj = {
      id: 1, owner: 'enemy' as const,
      x: 16, y: 1.2, z: 6, prevX: 16, prevY: 1.2, prevZ: 6,
      vx: -(rock.projectileSpeed ?? 18), vy: 0, vz: 0,
      lifeTicks: 240, damage: 30, burnTicks: 0, burnDamagePerTick: 0,
      radius: rock.projectileRadius ?? 0.45,
      kind: 'rock' as const,
      deflectable: false,
      breakable: rock.breakable,
    };
    world.projectiles.push(proj);
    return proj;
  }

  /** 바위 쪽으로 날아가는 플레이어 화염구 */
  function castFireball(): (typeof world.projectiles)[number] {
    const proj = {
      id: 2, owner: 'player' as const,
      x: 6, y: 1.2, z: 6, prevX: 6, prevY: 1.2, prevZ: 6,
      vx: 26, vy: 0, vz: 0,
      lifeTicks: 120, damage: 45, burnTicks: 0, burnDamagePerTick: 0,
      radius: 0.35, kind: 'fireball' as const,
    };
    world.projectiles.push(proj);
    return proj;
  }

  it('바위는 반사는 안 되지만 부술 수는 있다', () => {
    const rock = enemyDef('goblin_chieftain').rangedAttack!;
    expect(rock.deflectable).toBe(false);
    expect(rock.breakable).toBe(true);
  });

  it('화염구로 공중에서 깬다 — 둘 다 사라진다', () => {
    const rock = throwRock();
    const fire = castFireball();
    const broken: { kind?: string }[] = [];
    world.events.on('projectile_broken', (p) => broken.push(p as { kind?: string }));

    for (let i = 0; i < 40 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(broken).toHaveLength(1);
    expect(broken[0]!.kind).toBe('rock');
    expect(world.projectiles).not.toContain(rock);
    expect(world.projectiles).not.toContain(fire);
    expect(world.player.health).toBe(100); // 바위가 오지 않았다
  });

  it('깨지 않으면 그대로 맞는다 — 대조군', () => {
    throwRock();
    for (let i = 0; i < 60 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(world.player.health).toBeLessThan(100);
  });

  it('수류탄도 바위를 깬다 — 튕기지 않고 그 자리에서 터진다', () => {
    const rock = throwRock();
    const nade = {
      id: 5, owner: 'player' as const,
      x: 6, y: 1.2, z: 6, prevX: 6, prevY: 1.2, prevZ: 6,
      vx: 22, vy: 0, vz: 0,
      lifeTicks: 120, damage: balance.weapons.grenade.damage,
      burnTicks: 0, burnDamagePerTick: 0, radius: 0.2, kind: 'grenade' as const,
    };
    world.projectiles.push(nade);
    const broken: unknown[] = [];
    const booms: unknown[] = [];
    world.events.on('projectile_broken', (p) => broken.push(p));
    world.events.on('explosion', (p) => booms.push(p));

    for (let i = 0; i < 40 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(broken).toHaveLength(1);
    expect(booms).toHaveLength(1); // 튕긴 게 아니라 터졌다
    expect(world.projectiles).not.toContain(rock);
    expect(world.projectiles).not.toContain(nade);
    expect(world.player.health).toBe(100);
  });

  it('바위를 깬 화염구는 그 자리에서 터져 주변 적을 함께 친다', () => {
    // 바위가 오는 길목에 적을 세워 둔다 — 바위를 미끼로 폭심을 잡는 플레이
    const fx = sigilDef('sig_fireball').effects;
    // 요격 지점(≈x 12) 옆 — 바위 진로 위에 두면 바위가 먼저 오사로 때린다
    const near = spawnEnemyAt('goblin_runner', 12, 6 + 2.5, 7);
    near.health = 1000;
    world.enemies.push(near);
    throwRock();
    castFireball();

    for (let i = 0; i < 40 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(near.health).toBeLessThan(1000); // 스플래시가 들어갔다
    expect(1000 - near.health).toBeLessThanOrEqual(fx['explodeDamage']!);
  });

  it('부술 수 없는 투사체(화살)는 통과한다', () => {
    const arrow = {
      id: 3, owner: 'enemy' as const,
      x: 16, y: 1.2, z: 6, prevX: 16, prevY: 1.2, prevZ: 6,
      vx: -26, vy: 0, vz: 0,
      lifeTicks: 240, damage: 12, burnTicks: 0, burnDamagePerTick: 0,
      radius: 0.15, kind: 'arrow' as const,
    };
    world.projectiles.push(arrow);
    castFireball();
    const broken: unknown[] = [];
    world.events.on('projectile_broken', (p) => broken.push(p));
    for (let i = 0; i < 40 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(broken).toHaveLength(0);
    expect(world.player.health).toBeLessThan(100); // 화살은 그대로 왔다
  });

  it('적 투사체끼리는 서로 부수지 않는다', () => {
    throwRock();
    world.projectiles.push({
      id: 4, owner: 'enemy', x: 6, y: 1.2, z: 6, prevX: 6, prevY: 1.2, prevZ: 6,
      vx: 26, vy: 0, vz: 0, lifeTicks: 120, damage: 10,
      burnTicks: 0, burnDamagePerTick: 0, radius: 0.3, kind: 'magic', casterId: 99,
    });
    const broken: unknown[] = [];
    world.events.on('projectile_broken', (p) => broken.push(p));
    for (let i = 0; i < 20; i++) Projectiles.tick(world, DT);
    expect(broken).toHaveLength(0);
  });
});

describe('보스 체력 2칸', () => {
  it('총량을 healthBars 로 나눠 표시한다 — 첫 칸을 다 깎아야 ×1 로 넘어간다', () => {
    const def = enemyDef('goblin_chieftain');
    expect(def.healthBars).toBe(2);
    const perBar = def.health / def.healthBars!;

    expect(healthBarState(def, def.health)).toMatchObject({ count: 2, index: 2, frac: 1 });
    expect(healthBarState(def, perBar + 1).index).toBe(2); // 1 남아도 아직 두 번째 칸
    expect(healthBarState(def, perBar).index).toBe(1); // 딱 절반 = 마지막 칸이 가득
    expect(healthBarState(def, perBar).frac).toBe(1);
    expect(healthBarState(def, perBar / 2)).toMatchObject({ index: 1, frac: 0.5 });
    expect(healthBarState(def, 0)).toMatchObject({ index: 1, frac: 0 });
    expect(healthBarState(def, -50)).toMatchObject({ index: 1, frac: 0 }); // 과피해도 안 깨진다
  });

  it('바가 없는 적은 한 칸으로 다룬다', () => {
    const def = enemyDef('goblin_runner');
    expect(def.healthBars).toBeUndefined();
    expect(healthBarState(def, def.health)).toMatchObject({ count: 1, index: 1, frac: 1 });
    expect(healthBarState(def, def.health / 4).frac).toBe(0.25);
  });

  it('처형 타격은 총량의 15% 이상이다 — 완벽 패링 3연속의 대가', () => {
    const def = enemyDef('goblin_chieftain');
    expect(def.executeDamage! / def.health).toBeGreaterThan(0.15);
    const boss = spawnEnemyAt('goblin_chieftain', 8.4, 6, 1);
    boss.ai = 'staggered';
    boss.timer = 90;
    world.enemies.push(boss);

    pressReaction();
    expect(boss.health).toBe(def.health - def.executeDamage!);
    // 첫 칸(×2) 안에서 끝난다 — 한 방에 칸이 넘어갈 만큼 세지는 않다
    expect(healthBarState(def, boss.health).index).toBe(2);
  });
});

describe('시야 — 등 뒤에서는 못 알아챈다', () => {
  const vision = balance.enemyAi.vision;

  // 랜턴 빔은 시야각과 무관하게 깨운다(아래 describe) — 여기서는 눈으로 보는
  // 규칙만 떼어 보려고 꺼 둔다
  beforeEach(() => {
    world.lantern.on = false;
  });

  /** 적을 (거리, 각도)에 놓고 n틱 돌린 뒤 깨어났는지 본다.
   *  angle 0 = 적이 플레이어를 정면으로 본다 / π = 등을 돌리고 있다 */
  function watch(dist: number, angle: number, ticks = 4): boolean {
    const p = world.player;
    const enemy = spawnEnemyAt('goblin_runner', p.x + dist, p.z, 1);
    enemy.ai = 'idle';
    // 플레이어를 향한 방향에서 angle 만큼 돌려 세운다
    enemy.homeYaw = Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z)) + angle;
    world.enemies.push(enemy);
    for (let i = 0; i < ticks; i++) Enemies.tick(world, DT);
    return enemy.ai !== 'idle';
  }

  it('정면이면 알아챈다', () => {
    expect(watch(8, 0)).toBe(true);
  });

  it('등 뒤에 있으면 못 알아챈다 — 사거리 안이어도', () => {
    const def = enemyDef('goblin_runner');
    expect(8).toBeLessThan(def.aggroRange); // 거리 조건은 충족한다
    expect(watch(8, Math.PI)).toBe(false);
  });

  it('시야각 경계 — 훑는 폭까지 더해서 판단한다', () => {
    // 실제 시야 = 고정 시야각 ± 훑는 폭. 그 안쪽은 언제 봐도 보이고,
    // 바깥쪽은 한 바퀴를 다 훑어도 안 보인다
    const half = (vision.arcDeg * Math.PI) / 360;
    const scanHalf = (vision.scanArcDeg * Math.PI) / 360;
    expect(watch(8, half - scanHalf - 0.15)).toBe(true); // 확실히 안쪽
    world.enemies.length = 0;
    expect(watch(8, half + scanHalf + 0.15, vision.scanTicks + 5)).toBe(false); // 확실히 바깥
  });

  it('코앞이면 각과 무관하게 안다 — 등에 붙어 서 있는데 모르는 건 이상하다', () => {
    expect(watch(vision.noticeRadius - 0.5, Math.PI)).toBe(true);
  });

  it('대기 중에는 천천히 좌우를 살핀다 — 사각이 고정되지 않는다', () => {
    const enemy = spawnEnemyAt('goblin_runner', 100, 100, 1); // 아무도 못 보는 곳
    enemy.ai = 'idle';
    enemy.homeYaw = 0;
    world.enemies.push(enemy);
    const seen = new Set<string>();
    for (let i = 0; i < vision.scanTicks; i++) {
      Enemies.tick(world, DT);
      world.tick++;
      seen.add(enemy.yaw.toFixed(3));
    }
    expect(seen.size).toBeGreaterThan(50); // 계속 움직인다
    const half = (vision.scanArcDeg * Math.PI) / 360;
    const yaws = [...seen].map(Number);
    expect(Math.max(...yaws)).toBeLessThanOrEqual(half + 1e-6);
    expect(Math.min(...yaws)).toBeGreaterThanOrEqual(-half - 1e-6);
  });

  it('소리는 각을 가리지 않는다 — 등 뒤에서 쏴도 깬다', () => {
    const p = world.player;
    const enemy = spawnEnemyAt('goblin_runner', p.x + 8, p.z, 1);
    enemy.ai = 'idle';
    enemy.homeYaw = Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z)) + Math.PI; // 등을 돌림
    world.enemies.push(enemy);
    Enemies.tick(world, DT);
    expect(enemy.ai).toBe('idle'); // 보고는 모른다

    world.weapon.cooldown = 0;
    world.input = { ...Input.emptySnapshot(), rangedPressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(enemy.ai).toBe('chase'); // 총성은 등 뒤에도 들린다
  });
});

describe('랜턴 — 비추면 즉시 들킨다', () => {
  const lp = balance.lantern;

  /** 적을 (거리, 플레이어 시선 기준 각도)에 놓고 몇 틱 돌린다 */
  function shine(dist: number, beamOffset: number, ticks = 3): EnemyState {
    const p = world.player;
    p.yaw = -Math.PI / 2; // +X 를 본다
    const angle = p.yaw + beamOffset;
    const enemy = spawnEnemyAt(
      'goblin_runner',
      p.x - Math.sin(angle) * dist,
      p.z - Math.cos(angle) * dist,
      1,
    );
    enemy.ai = 'idle';
    // 적은 플레이어를 등지고 있다 — 눈으로는 절대 못 본다
    enemy.homeYaw = Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z)) + Math.PI;
    world.enemies.push(enemy);
    for (let i = 0; i < ticks; i++) Enemies.tick(world, DT);
    return enemy;
  }

  it('등을 돌린 적도 빔에 잡히면 즉시 깬다', () => {
    world.lantern.on = true;
    const enemy = shine(10, 0);
    expect(enemy.ai).toBe('chase');
  });

  it('알림에 랜턴 때문이라고 실어 보낸다', () => {
    world.lantern.on = true;
    const alerts: { lantern?: boolean }[] = [];
    world.events.on('enemy_alerted', (p) => alerts.push(p as { lantern?: boolean }));
    shine(10, 0);
    expect(alerts[0]!.lantern).toBe(true);
  });

  it('랜턴을 끄면 안 들킨다 — 어둠이 유일한 은폐다', () => {
    world.lantern.on = false;
    expect(shine(10, 0).ai).toBe('idle');
  });

  it('배터리가 나가도 안 들킨다', () => {
    world.lantern.on = true;
    world.lantern.battery = 0;
    expect(shine(10, 0).ai).toBe('idle');
  });

  it('빔 밖(각도)이면 안 들킨다', () => {
    world.lantern.on = true;
    const half = (lp.angleDeg * Math.PI) / 180;
    expect(shine(10, half * 0.5).ai).toBe('chase'); // 빔 안
    world.enemies.length = 0;
    expect(shine(10, half * 2.5).ai).toBe('idle'); // 빔 밖
  });

  it('빔 밖(거리)이면 안 들킨다', () => {
    world.lantern.on = true;
    expect(shine(lp.noticeRange - 2, 0).ai).toBe('chase');
    world.enemies.length = 0;
    expect(shine(lp.noticeRange + 5, 0).ai).toBe('idle');
  });

  it('벽 너머는 못 비춘다', () => {
    world.lantern.on = true;
    const p = world.player;
    const enemy = spawnEnemyAt('goblin_runner', p.x + 10, p.z, 1);
    enemy.ai = 'idle';
    enemy.homeYaw = 0;
    world.enemies.push(enemy);
    // 사이를 벽으로 막는다 (아레나 격자를 직접 손대는 대신 시야선을 확인)
    expect(world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)).toBe(true);
    enemy.z = p.z - 40; // 격자 밖 = 벽 취급
    for (let i = 0; i < 3; i++) Enemies.tick(world, DT);
    expect(enemy.ai).toBe('idle');
  });
});

describe('보스 포효 — 주변을 함께 깨운다', () => {
  it('보스가 플레이어를 알아채면 반경 안의 잠든 적이 전부 함께 달려든다', () => {
    const radius = balance.enemyAi.bossAlertRadius;
    const boss = spawnEnemyAt('goblin_chieftain', 6 + 10, 6, 1); // aggroRange(18) 안
    const near = spawnEnemyAt('goblin_runner', boss.x + radius - 2, boss.z, 2);
    const far = spawnEnemyAt('goblin_runner', boss.x + radius + 5, boss.z, 3);
    // 벽 너머라도 소리는 들린다 — 시야를 막아도 깨어야 한다
    const blind = spawnEnemyAt('goblin_runner', boss.x, boss.z + 6, 4);
    for (const e of [boss, near, far, blind]) {
      e.ai = 'idle';
      world.enemies.push(e);
    }
    // 보스는 플레이어를 보고 있어야 알아챈다 (시야각) — 깨우는 쪽 규칙은 소리라
    // 나머지는 등을 돌린 채 둔다
    boss.homeYaw = Math.atan2(-(world.player.x - boss.x), -(world.player.z - boss.z));
    const alerted: { enemyId: number }[] = [];
    world.events.on('enemy_alerted', (p) => alerted.push(p as { enemyId: number }));

    Enemies.tick(world, DT);

    expect(boss.ai).toBe('chase');
    expect(near.ai).toBe('chase');
    expect(blind.ai).toBe('chase');
    expect(far.ai).toBe('idle'); // 반경 밖은 그대로 잔다
    expect(alerted.map((a) => a.enemyId).sort()).toEqual([boss.id, near.id, blind.id].sort());
    // 머리 위 인지 표시가 이 id 로 대상을 고른다 — 하나라도 빠지면 표시가 안 뜬다
    expect(alerted.every((a) => typeof a.enemyId === 'number')).toBe(true);
  });

  it('알아챈 직후 noticeDelayTicks 동안은 발이 안 나간다 — 느낌표를 읽을 틈', () => {
    const delay = balance.enemyAi.noticeDelayTicks;
    const runner = spawnEnemyAt('goblin_runner', 6 + 8, 6, 1);
    runner.ai = 'idle';
    runner.homeYaw = Math.atan2(-(world.player.x - runner.x), -(world.player.z - runner.z));
    world.enemies.push(runner);

    Enemies.tick(world, DT); // 알아채는 틱
    expect(runner.ai).toBe('chase');
    expect(runner.noticeTicks).toBe(delay);
    const startX = runner.x;

    // 멈칫하는 동안은 제자리 — 대신 몸은 플레이어를 향해 돌아간다
    for (let i = 0; i < delay; i++) Enemies.tick(world, DT);
    expect(runner.x).toBe(startX);
    expect(runner.noticeTicks).toBe(0);
    expect(runner.yaw).toBeCloseTo(
      Math.atan2(-(world.player.x - runner.x), -(world.player.z - runner.z)),
      5,
    );

    // 멈칫이 끝나면 달려든다
    Enemies.tick(world, DT);
    expect(runner.x).toBeLessThan(startX); // 플레이어(-X 쪽)로 다가온다
  });

  it('멈칫 중에는 공격도 시작하지 않는다', () => {
    const delay = balance.enemyAi.noticeDelayTicks;
    // 사거리 안에 붙여 둔다 — 멈칫이 없으면 알아채자마자 예비동작에 들어간다
    const spear = spawnEnemyAt('goblin_spear', 6 + 2.5, 6, 1);
    spear.ai = 'idle';
    spear.homeYaw = Math.atan2(-(world.player.x - spear.x), -(world.player.z - spear.z));
    world.enemies.push(spear);

    Enemies.tick(world, DT);
    expect(spear.ai).toBe('chase');
    for (let i = 0; i < delay; i++) {
      expect(spear.ai).toBe('chase'); // windup 으로 안 넘어간다
      Enemies.tick(world, DT);
    }
    Enemies.tick(world, DT);
    expect(spear.ai).toBe('windup'); // 이제서야 겨눈다
  });

  it('보스 포효로 깬 적도 같은 멈칫을 받는다 — 깨우는 경로가 여섯이라 한 군데만 걸면 샌다', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 6 + 6, 6, 1);
    const near = spawnEnemyAt('goblin_runner', 6 + 10, 6, 2);
    for (const e of [boss, near]) {
      e.ai = 'idle';
      world.enemies.push(e);
    }
    boss.homeYaw = Math.atan2(-(world.player.x - boss.x), -(world.player.z - boss.z));
    const startX = near.x;
    Enemies.tick(world, DT);
    expect(near.ai).toBe('chase');
    // 깨운 보스보다 배열에서 뒤라 같은 틱에 이미 한 틱을 쓴다 — 16ms 차이라 그냥 둔다
    expect(near.noticeTicks).toBeGreaterThanOrEqual(balance.enemyAi.noticeDelayTicks - 1);

    for (let i = 0; i < balance.enemyAi.noticeDelayTicks - 1; i++) Enemies.tick(world, DT);
    expect(near.x).toBe(startX); // 포효를 듣고도 한 박자 멈칫한다
  });

  it('보스가 아니면 주변을 깨우지 않는다', () => {
    const runner = spawnEnemyAt('goblin_runner', 6 + 5, 6, 1);
    const other = spawnEnemyAt('goblin_runner', 6 + 8, 6, 2);
    for (const e of [runner, other]) {
      e.ai = 'idle';
      e.homeYaw = Math.atan2(-(world.player.x - e.x), -(world.player.z - e.z));
      world.enemies.push(e);
    }
    Enemies.tick(world, DT);
    expect(runner.ai).toBe('chase');
    expect(other.ai).toBe('chase'); // 얘는 제 aggroRange 로 스스로 깬 것
    other.ai = 'idle';
    other.x = 6 + enemyDef('goblin_runner').aggroRange + 10; // 제 힘으로는 못 깨는 거리
    Enemies.tick(world, DT);
    expect(other.ai).toBe('idle');
  });
});

describe('goblin_chieftain 원거리 공격', () => {
  it('원거리(minRange 이상)에서는 바위 투척 — 반사 불가 투사체', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1); // dist 12 ≥ minRange 7
    boss.ai = 'chase';
    boss.volleyCooldown = 9999; // 화살 세례가 먼저 나가지 않게
    boss.chargeCooldown = 9999; // 돌격도
    world.enemies.push(boss);

    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('ranged');
    tickEnemiesUntil(() => boss.ai === 'recover');
    expect(world.projectiles).toHaveLength(1);
    const rock = world.projectiles[0]!;
    expect(rock.kind).toBe('rock');
    expect(rock.deflectable).toBe(false);
    expect(rock.damage).toBe(enemyDef('goblin_chieftain').damage);
  });

  it('화살 세례 — 예고 뒤 0.5초 간격으로 10발, 그동안 제자리', () => {
    const volley = enemyDef('goblin_chieftain').volleyAttack!;
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1);
    boss.ai = 'chase';
    boss.chargeCooldown = 9999; // 돌격이 먼저 나가지 않게 (이제 15m 까지 닿는다)
    world.enemies.push(boss);
    const starts: { shots: number }[] = [];
    const shots: { left: number }[] = [];
    world.events.on('enemy_volley_start', (p) => starts.push(p as { shots: number }));
    world.events.on('enemy_volley_shot', (p) => shots.push(p as { left: number }));

    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('volley');
    expect(starts[0]).toMatchObject({ shots: volley.shots });
    expect(world.projectiles).toHaveLength(0); // 예고 중에는 아직 안 쏜다

    tickEnemiesUntil(() => boss.ai === 'volley');
    const heldX = boss.x;
    const heldZ = boss.z;

    // 발사 간격 — 첫 발은 예고가 끝나는 즉시, 이후 shotIntervalTicks 마다
    Enemies.tick(world, DT);
    expect(world.projectiles).toHaveLength(1);
    let gap = 0;
    while (world.projectiles.length === 1 && gap < 200) {
      Enemies.tick(world, DT);
      gap++;
    }
    expect(world.projectiles).toHaveLength(2);
    expect(gap).toBe(30); // 정확히 0.5초 (대기 29틱 + 발사 1틱)

    // 한 발은 약하다 — 연사이므로 def.damage(30)가 아니라 attack.damage(12)
    expect(world.projectiles[0]!.damage).toBe(volley.damage);
    expect(volley.damage!).toBeLessThan(enemyDef('goblin_chieftain').damage);
    expect(world.projectiles[0]!.kind).toBe('arrow');
    expect(world.projectiles[0]!.deflectable).toBe(false); // 회피 전용

    tickEnemiesUntil(() => boss.ai === 'recover', 1200);
    expect(shots).toHaveLength(volley.shots!);
    expect(shots[shots.length - 1]!.left).toBe(0);
    expect(boss.x).toBeCloseTo(heldX, 5); // 쏘는 동안 제자리
    expect(boss.z).toBeCloseTo(heldZ, 5);
    expect(boss.volleyCooldown).toBe(volley.cooldownTicks);
    expect(boss.attackMode).toBe('melee'); // 끝나면 평소 모드로
  });

  it('화살은 손에서 나가도 몸 중심을 향한다 — 조준선은 발사 지점에서 다시 잰다', () => {
    const def = enemyDef('goblin_chieftain');
    const volley = def.volleyAttack!;
    expect(volley.muzzleSideMul!).toBeGreaterThan(0); // 해머 든 손 옆에서 나간다
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1);
    boss.ai = 'chase';
    boss.chargeCooldown = 9999;
    world.enemies.push(boss);

    tickEnemiesUntil(() => world.projectiles.length === 1, 1200);
    const arrow = world.projectiles[0]!;
    const p = world.player;

    // 발사 지점은 몸 중심에서 옆으로 벗어나 있다 (손 위치)
    expect(Math.hypot(arrow.x - boss.x, arrow.z - boss.z)).toBeGreaterThan(def.radius);
    expect(Math.abs(arrow.z - boss.z)).toBeGreaterThan(def.radius * volley.muzzleSideMul! * 0.9);

    // 그런데도 진행선은 플레이어를 관통해야 한다. 몸 중심 기준으로 조준하면
    // 손만큼(0.68m) 평행 이동한 선이 되어 반경(0.4+0.15)을 넘어 영영 빗나간다
    const len = Math.hypot(arrow.vx, arrow.vy, arrow.vz);
    const u = [arrow.vx / len, arrow.vy / len, arrow.vz / len];
    const rel = [
      p.x - arrow.x,
      p.y + balance.player.eyeHeight * 0.8 - arrow.y,
      p.z - arrow.z,
    ];
    const t = rel[0]! * u[0]! + rel[1]! * u[1]! + rel[2]! * u[2]!;
    const perp = Math.hypot(rel[0]! - u[0]! * t, rel[1]! - u[1]! * t, rel[2]! - u[2]! * t);
    expect(perp).toBeLessThan(1e-9);
  });

  it('그래서 정면을 보고 있으면 방패로 받아낼 수 있다', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1);
    boss.ai = 'chase';
    boss.chargeCooldown = 9999;
    world.enemies.push(boss);
    tickEnemiesUntil(() => world.projectiles.length === 1, 1200);

    world.player.blocking = true; // +X 를 본다 = 보스 정면
    const blocked: unknown[] = [];
    world.events.on('block_hit', (payload) => blocked.push(payload));
    const before = world.player.health;

    for (let i = 0; i < 120 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(world.projectiles).toHaveLength(0); // 옆으로 지나쳐 날아가지 않았다
    expect(blocked).toHaveLength(1);
    expect(world.player.health).toBe(before); // 화살 칩 피해는 0
  });

  it('돌격은 예고 뒤 따로 달려 거리를 좁힌다 — 타격 창만으로는 못 닿는다', () => {
    const ch = enemyDef('goblin_chieftain').chargeAttack!;
    const def = enemyDef('goblin_chieftain');
    const start = 12; // 타격 창(0.3초 × chargeSpeed ≒ 3.9m)만으로는 절대 못 닿는 거리
    expect(start - balance.reaction.windowPerfectTicks / 60 * ch.chargeSpeed!).toBeGreaterThan(
      def.attackRange,
    );
    const boss = spawnEnemyAt('goblin_chieftain', 6 + start, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);

    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    expect(boss.attackMode).toBe('charge');
    const atRunStart = boss.x - world.player.x;

    tickEnemiesUntil(() => boss.ai !== 'charging', 300);
    const atStrike = boss.x - world.player.x;
    expect(atStrike).toBeLessThan(atRunStart - 5); // 달려서 크게 좁혔다
    expect(atStrike).toBeLessThanOrEqual(def.attackRange + 0.2); // 사거리 안까지 붙었다
    expect(boss.ai).toBe('active_perfect'); // 붙은 뒤에야 패링 창이 열린다
    // 달리기가 멈추는 자리가 판정 반경 안이어야 한다 — 아니면 붙고도 헛친다
    expect(ch.aoeRadius!).toBeGreaterThan(def.attackRange);
  });

  it('돌격은 예고가 끝난 순간의 좌표로만 달린다 — 옆으로 비키면 헛친다', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 6 + 11, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);

    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    const lockX = boss.chargeTargetX!;
    const lockZ = boss.chargeTargetZ!;
    expect(lockX).toBeCloseTo(world.player.x, 5); // 발동 순간의 플레이어 자리
    expect(lockZ).toBeCloseTo(world.player.z, 5);

    // 플레이어가 옆으로 크게 비킨다
    world.player.z += 7;
    const hits: unknown[] = [];
    world.events.on('player_damaged', (p) => hits.push(p));

    tickEnemiesUntil(() => boss.ai === 'recover', 400);
    // 목표는 그대로 — 따라오지 않았다
    expect(boss.chargeTargetX).toBe(lockX);
    expect(boss.chargeTargetZ).toBe(lockZ);
    expect(Math.hypot(boss.x - lockX, boss.z - lockZ)).toBeLessThan(1.5); // 찍어둔 자리로 갔다
    expect(hits).toHaveLength(0); // 비킨 플레이어는 안 맞는다
    expect(boss.whiffed).toBe(true);
    expect(boss.timer).toBeGreaterThanOrEqual(
      enemyDef('goblin_chieftain').chargeAttack!.whiffRecoverTicks!,
    );
  });

  it('가만히 서 있으면 돌격이 그대로 꽂힌다', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 6 + 11, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);
    const hits: { amount: number }[] = [];
    world.events.on('player_damaged', (p) => hits.push(p as { amount: number }));

    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    tickEnemiesUntil(() => boss.ai === 'recover', 400);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBe(enemyDef('goblin_chieftain').damage);
  });

  it('돌격은 방패로 막아도 크게 튕겨 나가고 피해도 들어온다', () => {
    const ch = enemyDef('goblin_chieftain').chargeAttack!;
    const def = enemyDef('goblin_chieftain');
    expect(ch.blockedKnockbackMul).toBe(1); // 방어해도 밀림이 안 줄어든다

    const boss = spawnEnemyAt('goblin_chieftain', 6 + 2.5, 6, 1);
    boss.yaw = Math.atan2(-(6 - boss.x), -(6 - boss.z)); // 플레이어를 본다
    boss.attackMode = 'charge';
    boss.ai = 'impact';
    world.enemies.push(boss);
    world.player.yaw = -Math.PI / 2; // 보스(+X)를 정면으로 본다
    world.player.blocking = true;
    const hp0 = world.player.health;

    Enemies.tick(world, DT);

    // 피해 — 완전 차단이 아니라 blockedDamageRatio 만큼 들어온다
    const taken = hp0 - world.player.health;
    expect(taken).toBeCloseTo(def.damage * ch.blockedDamageRatio!, 4);
    expect(taken).toBeGreaterThan(def.damage * balance.block.chipDamageRatio); // 평소보다 아프다

    // 밀림 — 방패를 들었는데도 전량
    const flung = Math.hypot(world.player.kbX!, world.player.kbZ!) * world.player.kbTicks!;
    expect(flung).toBeCloseTo(ch.playerKnockback!, 3);
    expect(world.player.kbTicks).toBe(ch.playerKnockbackTicks);
    // 일반 스매시를 막았을 때보다 훨씬 멀리 난다
    const normalBlocked = balance.playerKnockback.smash * balance.playerKnockback.blockedMul;
    expect(flung).toBeGreaterThan(normalBlocked * 5);
  });

  it('중거리에 들어오면 돌격 — 연사보다 먼저 고른다', () => {
    const ch = enemyDef('goblin_chieftain').chargeAttack!;
    const mid = ((ch.minRange ?? 0) + ch.maxRange!) / 2;
    const boss = spawnEnemyAt('goblin_chieftain', 6 + mid, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);
    const charges: unknown[] = [];
    world.events.on('enemy_charge', (p) => charges.push(p));

    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('charge'); // 화살 세례가 아니라 돌격
    expect(charges).toHaveLength(1);
    expect(boss.chargeCooldown).toBe(ch.cooldownTicks);
  });

  it('돌격 사거리 밖(멀리)에서는 화살 세례로 돌아간다', () => {
    const ch = enemyDef('goblin_chieftain').chargeAttack!;
    const boss = spawnEnemyAt('goblin_chieftain', 6 + ch.maxRange! + 3, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);
    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('volley');
  });

  it('붙으면 던지기를 접고 해머로 — 연사 중이어도 끊긴다', () => {
    const volley = enemyDef('goblin_chieftain').volleyAttack!;
    const boss = spawnEnemyAt('goblin_chieftain', 6 + 14, 6, 1);
    boss.ai = 'chase';
    boss.chargeCooldown = 9999; // 돌격 말고 연사를 쓰게
    world.enemies.push(boss);
    const held: unknown[] = [];
    world.events.on('enemy_hold_fire', (p) => held.push(p));

    tickEnemiesUntil(() => boss.ai === 'volley');
    Enemies.tick(world, DT); // 첫 발
    expect(world.projectiles.length).toBeGreaterThan(0);

    // 플레이어가 코앞까지 붙는다
    boss.x = world.player.x + volley.abortRange! - 0.5;
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('chase');
    expect(boss.attackMode).toBe('melee');
    expect(held).toHaveLength(1);
    expect(boss.volleyCooldown).toBe(volley.cooldownTicks); // 끊겨도 쿨다운은 문다
  });

  it('지면 강타는 맞든 빗나가든 ground_slam 을 발행한다 (소리·흔들림용)', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 8.4, 6, 1); // 근접 거리 → 해머
    boss.ai = 'chase';
    world.enemies.push(boss);
    const slams: { radius: number; dist: number }[] = [];
    world.events.on('ground_slam', (p) => slams.push(p as { radius: number; dist: number }));

    tickEnemiesUntil(() => boss.ai === 'recover', 400);
    expect(slams).toHaveLength(1);
    expect(slams[0]!.radius).toBe(enemyDef('goblin_chieftain').attack.aoeRadius);
    expect(slams[0]!.dist).toBeGreaterThan(0);
  });

  it('화살 세례는 쿨다운 중이면 나가지 않는다', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1);
    boss.ai = 'chase';
    boss.volleyCooldown = 5;
    boss.chargeCooldown = 9999;
    world.enemies.push(boss);
    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('ranged'); // 바위 투척으로 대체
  });

  it('해머 지면 강타는 원형 범위 — 옆으로 비켜도 맞고, 반경 밖이면 안 맞는다', () => {
    const def = enemyDef('goblin_chieftain');
    const aoe = def.attack.aoeRadius!;
    expect(aoe).toBeGreaterThan(0);
    const boss = { x: 10, z: 10, yaw: 0 }; // −Z 를 본다

    // 정면 (기존과 동일)
    expect(attackReaches(def, boss, def.attack, 10, 10 - aoe + 0.2)).toBe(true);
    // 완전히 옆 — 호(110°) 밖이지만 원 안이라 맞는다
    expect(attackReaches(def, boss, def.attack, 10 + aoe - 0.2, 10)).toBe(true);
    // 등 뒤도 원 안이면 맞는다
    expect(attackReaches(def, boss, def.attack, 10, 10 + aoe - 0.2)).toBe(true);
    // 반경 밖은 어느 방향이든 안 맞는다
    expect(attackReaches(def, boss, def.attack, 10, 10 - aoe - 0.3)).toBe(false);
    expect(attackReaches(def, boss, def.attack, 10 + aoe + 0.3, 10)).toBe(false);
  });

  it('원형 범위여도 패링 판정은 같은 함수를 쓴다 — 못 막는데 맞는 구멍이 없다', () => {
    const def = enemyDef('goblin_chieftain');
    const aoe = def.attack.aoeRadius!;
    const boss = spawnEnemyAt('goblin_chieftain', 10, 10, 1);
    boss.yaw = 0;
    // 호 밖(정옆)에 서 있어도 Reaction 이 대상으로 잡을 수 있어야 한다
    const sideX = 10 + aoe - 0.4;
    expect(attackReaches(def, boss, def.attack, sideX, 10)).toBe(true);
  });

  it('근접 거리에서는 기존 스매시 (melee 모드)', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 8.4, 6, 1); // dist 2.4 < minRange
    boss.ai = 'chase';
    world.enemies.push(boss);
    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('melee');
    expect(world.projectiles).toHaveLength(0);
  });
});

describe('출구 (7.4) — 쇠사슬·자물쇠·열쇠', () => {
  it('열쇠 없인 E 도 소용없고, 열쇠로 풀면 그다음 E 로 내려간다', () => {
    world.exitNeedsKey = true; // 보스 층 로드 상태 — main 의 loadFloor 가 세팅한다
    const log: string[] = [];
    world.events.on('exit_locked', () => log.push('locked'));
    world.events.on('exit_unlocked', () => log.push('unlocked'));
    world.events.on('zone_cleared', () => log.push('cleared'));

    world.player.x = world.level.exitPos!.x;
    world.player.z = world.level.exitPos!.z;
    Exit.tick(world, DT);
    expect(log).toEqual(['locked']); // 밟자마자 알림 1회

    // 열쇠 없이 E — 사슬만 짤그랑
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Exit.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(log).toEqual(['locked', 'locked']);
    expect(world.cleared).toBe(false);
    expect(world.exitOpen).toBe(false);

    // 열쇠를 쥐고 E — 자물쇠가 풀린다. 아직 내려가지는 않는다
    world.hasExitKey = true;
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Exit.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(log).toEqual(['locked', 'locked', 'unlocked']);
    expect(world.exitOpen).toBe(true);
    expect(world.hasExitKey).toBe(false); // 열쇠는 1회 소모
    expect(world.cleared).toBe(false);

    // 그다음 E 로 내려간다
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Exit.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(log).toEqual(['locked', 'locked', 'unlocked', 'cleared']);
    expect(world.cleared).toBe(true);
  });

  it('보스는 잠긴 층에서만 열쇠를 떨군다 — 잡몹·이미 딴 층은 아니다', () => {
    Exit.init(world);
    const keys = (): number => world.groundItems.filter((g) => g.kind === 'key').length;
    world.exitNeedsKey = true;
    world.events.emit('enemy_died', { enemyType: 'goblin_chieftain', x: 8, z: 6 });
    expect(keys()).toBe(1);
    world.exitNeedsKey = false; // 이미 딴 층 (부활 재전투)
    world.events.emit('enemy_died', { enemyType: 'goblin_chieftain', x: 8, z: 6 });
    expect(keys()).toBe(1);
    world.exitNeedsKey = true;
    world.events.emit('enemy_died', { enemyType: 'goblin_runner', x: 8, z: 6 });
    expect(keys()).toBe(1);
  });

  it('발판 밖에서 E 를 눌러도 클리어되지 않는다', () => {
    world.player.x = 6; // 출구에서 멀리
    world.player.z = 6;
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Exit.tick(world, DT);
    expect(world.cleared).toBe(false);
    expect(world.onExitPad).toBe(false);
  });

  it('보스 없는(잠기지 않은) 층은 첫 틱에 열린다 — exit_opened 1회', () => {
    const opened: unknown[] = [];
    world.events.on('exit_opened', (payload) => opened.push(payload));
    world.player.x = 6;
    world.player.z = 6;
    Exit.tick(world, DT);
    expect(world.exitOpen).toBe(true);
    expect(opened).toHaveLength(1);
    Exit.tick(world, DT); // 계속 돌아도 한 번만
    expect(opened).toHaveLength(1);
  });

  it('입구 발판에서 E — 위층 신호. 첫 층은 canAscend 가 꺼져 있어 침묵한다', () => {
    const up: unknown[] = [];
    world.events.on('floor_ascend', (payload) => up.push(payload));
    world.player.x = world.level.spawn.x;
    world.player.z = world.level.spawn.z;
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Exit.tick(world, DT);
    expect(up).toHaveLength(0); // 첫 층 — 올라갈 곳이 없다
    world.canAscend = true;
    Exit.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(up).toHaveLength(1);
  });
});

describe('캐스터 재배치 — 아군이 사선을 막을 때', () => {
  const strafe = balance.enemyAi.strafe;

  /** 궁수(사거리 18, 카이팅 최소 8)와 그 사선 중앙에 고정된 아군 */
  function setup(): { archer: ReturnType<typeof spawnEnemyAt>; ally: ReturnType<typeof spawnEnemyAt> } {
    world.player.x = 6;
    world.player.z = 10;
    const archer = spawnEnemyAt('goblin_archer', 16, 10, 11);
    archer.ai = 'chase';
    const ally = spawnEnemyAt('goblin_spear', 11, 10, 12);
    ally.ai = 'windup'; // 제자리 고정 (추격으로 사선이 저절로 트이는 것 방지)
    ally.timer = 99999;
    world.enemies.push(archer, ally);
    return { archer, ally };
  }

  it('막히면 쏘지 않고 옆으로 이동한다 — enemy_repositioning 1회', () => {
    const { archer } = setup();
    const repos: unknown[] = [];
    world.events.on('enemy_repositioning', (payload) => repos.push(payload));
    const z0 = archer.z;

    for (let i = 0; i < 20; i++) Enemies.tick(world, DT);
    expect(archer.ai).toBe('chase'); // 아직 발사 안 함
    expect(Math.abs(archer.z - z0)).toBeGreaterThan(0.5); // 옆으로 움직였다
    expect(repos).toHaveLength(1); // 재배치 시작 시 1회만
  });

  it('각이 트이면 발사한다', () => {
    const { archer } = setup();
    for (let i = 0; i < 200 && archer.ai === 'chase'; i++) Enemies.tick(world, DT);
    expect(archer.ai).toBe('windup');
    expect(archer.strafeBlockedTicks).toBe(0);
  });

  it('끝내 각이 안 나오면 giveUpTicks 후 아군을 무릅쓰고 쏜다', () => {
    const { archer, ally } = setup();
    let ticks = 0;
    for (let i = 0; i < strafe.giveUpTicks + 30; i++) {
      ally.x = (archer.x + world.player.x) / 2; // 계속 사선에 붙는다
      ally.z = (archer.z + world.player.z) / 2;
      Enemies.tick(world, DT);
      ticks++;
      if (archer.ai !== 'chase') break;
    }
    expect(archer.ai).toBe('windup');
    expect(ticks).toBeGreaterThanOrEqual(strafe.giveUpTicks);
  });

  it('겨누는 사이 아군이 끼어들면 쏘지 않고 내린다 (enemy_hold_fire)', () => {
    const { archer, ally } = setup();
    ally.x = -500; // 처음엔 사선이 비어 있다
    ally.z = -500;
    Enemies.tick(world, DT);
    expect(archer.ai).toBe('windup');

    // 겨누는 도중 아군이 사선으로 들어온다
    ally.x = (archer.x + world.player.x) / 2;
    ally.z = world.player.z;
    const holds: unknown[] = [];
    world.events.on('enemy_hold_fire', (payload) => holds.push(payload));

    for (let i = 0; i < 40 && archer.ai === 'windup'; i++) Enemies.tick(world, DT);
    expect(holds).toHaveLength(1);
    expect(world.projectiles).toHaveLength(0); // 발사하지 않았다
    expect(archer.ai).toBe('chase'); // 각부터 다시 잡는다
  });

  it('사선이 비어 있으면 재배치 없이 즉시 발사', () => {
    world.player.x = 6;
    world.player.z = 10;
    const archer = spawnEnemyAt('goblin_archer', 16, 10, 11);
    archer.ai = 'chase';
    world.enemies.push(archer);
    Enemies.tick(world, DT);
    expect(archer.ai).toBe('windup');
  });
});
