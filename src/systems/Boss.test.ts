// M7 검증 — warden(방어막·시전·반사), 보스(족장: 완벽 패링 3연속 → 스태거 → 처형 / 낫뿔 거수 배치 1 뼈대 + 왼낫 교대·들이받기), 출구 잠금/클리어.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { attackInPhase, attackReaches, bladeOfJoint, comboChain, comboStepAttack, currentAttack, despairRoarAttack, despairSlamAttack, enemyDef, headDownPose, healthBarState, implementedEnemyTypes, jointOfBlade, rayHitsEnemy, rayHitsWeakPoint, resolvePhase, shellPlatesActive, slotUnlocked, wakeSlamAttack, weakPointDamageMul, weakPointOpen, weakPointRadius, weakPointWorldPos, type WeakPointDef } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, openExposure, playerStatusTicks, setPlayerStatus, type EnemyState, type ProjectileState, type TrapState } from '../core/World';
import { hitShellPlates } from '../core/ShellPlates';
import { sigilDef } from '../core/SigilData';
import { Level } from '../level/GridLoader';
import { isSpawnable, spawnEnemyAt } from '../level/Spawner';
import * as Corruption from './Corruption';
import * as Enemies from './Enemies';
import * as Exit from './Exit';
import * as Hazards from './Hazards';
import * as Loot from './Loot';
import * as Mana from './Mana';
import * as PlayerMove from './PlayerMove';
import * as Projectiles from './Projectiles';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';
import * as Status from './Status';
import * as Traps from './Traps';
import * as Weapons from './Weapons';

const DT = 1 / 60;

/** 기본 경기장 10×5칸(안쪽 x 4~36 · z 4~16). grid 를 넘기면 그 격자로(B2-5 기둥·균열벽·긴 레인) */
function makeWorld(grid: string[] = ['##########', '#S.......#', '#........#', '#.......X#', '##########']): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid,
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

  it('등 뒤라면 코앞(인기척 반경 안)이어도 못 알아챈다 — 백스탭을 위한 거리다', () => {
    expect(watch(vision.noticeRadius - 0.5, Math.PI)).toBe(false);
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

  /** 적을 (거리, 플레이어 시선 기준 각도)에 놓고 몇 틱 돌린다.
   *  기본은 플레이어를 마주 본다 — 시야각 밖 거리(aggroRange 밖)에 놓아 눈이 아니라
   *  빛 때문에 깨는 것을 갈라낸다. facingAway 면 등을 돌린다 (등진 적은 빛도 못 깨운다) */
  function shine(dist: number, beamOffset: number, ticks = 3, facingAway = false): EnemyState {
    const p = world.player;
    p.z = 10; // 아레나 세로 한가운데 — 빔을 비스듬히 틀어도 적이 벽 안에 안 떨어진다
    p.yaw = -Math.PI / 2; // +X 를 본다
    const angle = p.yaw + beamOffset;
    const enemy = spawnEnemyAt(
      'goblin_runner',
      p.x - Math.sin(angle) * dist,
      p.z - Math.cos(angle) * dist,
      1,
    );
    enemy.ai = 'idle';
    enemy.homeYaw =
      Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z)) + (facingAway ? Math.PI : 0);
    world.enemies.push(enemy);
    for (let i = 0; i < ticks; i++) Enemies.tick(world, DT);
    return enemy;
  }

  /** 눈(aggroRange 16)으로는 못 보고 빔(noticeRange 20)에는 잡히는 거리 */
  const beamOnly = 18;

  it('마주 본 적은 시야 밖 거리라도 빔에 잡히면 즉시 깬다', () => {
    world.lantern.on = true;
    expect(beamOnly).toBeGreaterThan(enemyDef('goblin_runner').aggroRange);
    const enemy = shine(beamOnly, 0);
    expect(enemy.ai).toBe('chase');
  });

  it('등진 적은 빔이 등을 비춰도 못 알아챈다 — 몰래 다가가는 길 (2026-08-27)', () => {
    world.lantern.on = true;
    expect(shine(10, 0, 3, true).ai).toBe('idle');
  });

  it('알림에 랜턴 때문이라고 실어 보낸다', () => {
    world.lantern.on = true;
    const alerts: { lantern?: boolean }[] = [];
    world.events.on('enemy_alerted', (p) => alerts.push(p as { lantern?: boolean }));
    shine(beamOnly, 0);
    expect(alerts[0]!.lantern).toBe(true);
  });

  it('랜턴을 끄면 안 들킨다 — 어둠이 유일한 은폐다', () => {
    world.lantern.on = false;
    expect(shine(beamOnly, 0).ai).toBe('idle');
  });

  it('배터리가 나가도 안 들킨다', () => {
    world.lantern.on = true;
    world.lantern.battery = 0;
    expect(shine(beamOnly, 0).ai).toBe('idle');
  });

  it('빔 밖(각도)이면 안 들킨다', () => {
    world.lantern.on = true;
    const half = (lp.angleDeg * Math.PI) / 180;
    expect(shine(beamOnly, half * 0.5).ai).toBe('chase'); // 빔 안 (7.5도)
    world.enemies.length = 0;
    // 빔 밖은 살짝만(18도) — 크게 틀면 적이 아레나 벽 밖에 떨어져
    // "빔 밖이라서" 가 아니라 "벽이라서" 못 알아채는 테스트가 된다
    expect(shine(beamOnly, half * 1.2).ai).toBe('idle');
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
    // 플레이어를 마주 본다 — 등진 적은 빛으로도 못 깨우므로 (위 테스트) 여기선 마주 봐야
    // "벽 때문에" 못 알아채는 것이 갈라진다
    enemy.homeYaw = Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z));
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
    // 소리는 이제 열린 칸을 따라 흐른다 — near 는 아레나 안(반경 안), far 는 격자 밖(막힘)
    const near = spawnEnemyAt('goblin_runner', boss.x + 16, boss.z, 2);
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

describe('출구 (7.4) — 붉은 쇠창살, 층의 주인', () => {
  it('주인이 살아 있는 동안은 붙들어도 잠겨 있고, 죽는 순간 저절로 열린다', () => {
    world.exitNeedsKey = true; // 보스 층 로드 상태 — main 의 loadFloor 가 세팅한다
    const boss = spawnEnemyAt('goblin_chieftain', 20, 6, 77);
    world.enemies.push(boss);
    const log: string[] = [];
    world.events.on('exit_locked', () => log.push('locked'));
    world.events.on('exit_unlocked', () => log.push('unlocked'));
    world.events.on('zone_cleared', () => log.push('cleared'));

    world.player.x = world.level.exitPos!.x;
    world.player.z = world.level.exitPos!.z;
    Exit.tick(world, DT);
    expect(log).toEqual(['locked']); // 밟자마자 알림 1회

    // 주인이 살아 있는 동안은 붙들어도 소용없다 — 쇠창살만 덜컹
    for (let i = 0; i < balance.stairs.holdTicks + 5; i++) {
      world.input = { ...Input.emptySnapshot(), interactHeld: true };
      Exit.tick(world, DT);
    }
    world.input = Input.emptySnapshot();
    expect(world.cleared).toBe(false);
    expect(world.exitOpen).toBe(false);

    // 주인이 죽는다 — 다음 틱에 창살이 저절로 오른다. 아직 내려가지는 않는다
    boss.alive = false;
    Exit.tick(world, DT);
    expect(log).toEqual(['locked', 'unlocked']);
    expect(world.exitOpen).toBe(true);
    expect(world.exitNeedsKey).toBe(false);
    expect(world.cleared).toBe(false);

    // 이제 붙들면 내려간다 — 게이지가 차기 전엔 그대로다
    for (let i = 0; i < balance.stairs.holdTicks - 1; i++) {
      world.input = { ...Input.emptySnapshot(), interactHeld: true };
      Exit.tick(world, DT);
    }
    expect(world.cleared).toBe(false); // 아직 덜 붙들었다
    world.input = { ...Input.emptySnapshot(), interactHeld: true };
    Exit.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(log).toEqual(['locked', 'unlocked', 'cleared']);
    expect(world.cleared).toBe(true);
  });

  it('배치 플래그(floorBoss) 워든도 주인이다 — 잡몹만 남으면 그대로 열린다', () => {
    world.exitNeedsKey = true;
    const master = spawnEnemyAt('warden', 20, 6, 78);
    master.floorBoss = true; // 레벨 JSON 의 boss: true 배치 — Spawner 가 세운다
    const mob = spawnEnemyAt('goblin_runner', 22, 6, 79);
    world.enemies.push(master, mob);
    let unlocked = 0;
    world.events.on('exit_unlocked', () => unlocked++);
    Exit.tick(world, DT);
    expect(unlocked).toBe(0); // 주인 생존 — 잠김 유지
    mob.alive = false;
    Exit.tick(world, DT);
    expect(unlocked).toBe(0); // 잡몹 죽음은 무관
    master.alive = false;
    Exit.tick(world, DT);
    expect(unlocked).toBe(1); // 주인 사망 — 자동 개방
    Exit.tick(world, DT);
    expect(unlocked).toBe(1); // 한 번만
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
    for (let i = 0; i < balance.stairs.holdTicks + 2; i++) {
      world.input = { ...Input.emptySnapshot(), interactHeld: true };
      Exit.tick(world, DT);
    }
    expect(up).toHaveLength(0); // 첫 층 — 올라갈 곳이 없다
    world.canAscend = true;
    for (let i = 0; i < balance.stairs.holdTicks + 2 && up.length === 0; i++) {
      world.input = { ...Input.emptySnapshot(), interactHeld: true };
      Exit.tick(world, DT);
    }
    world.input = Input.emptySnapshot();
    expect(up).toHaveLength(1);
    // 붙들다 놓으면 게이지가 사라진다
    world.input = { ...Input.emptySnapshot(), interactHeld: true };
    Exit.tick(world, DT);
    expect(world.stairHoldTicks).toBeGreaterThan(0);
    world.input = Input.emptySnapshot();
    Exit.tick(world, DT);
    expect(world.stairHoldTicks).toBe(0);
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

describe('scythe_behemoth (낫뿔 거수) — 낫·돌격·처형 뼈대(B1) + 왼낫 교대·들이받기(B1-3) + 패링 → 노출·머리 내림·눈 혼절(B2-2) + 파열·낫 잠김·절뚝·완벽 회피(B2-3) + 페이즈 골격(B2-6)', () => {
  const TYPE = 'scythe_behemoth';
  const def = enemyDef(TYPE);

  /** (6 + dist, 6) 에 놓고 추격 상태로 — 플레이어(6,6)는 +X 를 본다 */
  function makeBehemoth(dist: number): ReturnType<typeof spawnEnemyAt> {
    const boss = spawnEnemyAt(TYPE, 6 + dist, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);
    return boss;
  }

  /** 낫이 열리면 낫끝을 완벽 대역 한복판에 놓고 누른다 — 결과('perfect'/'normal'/'없음') */
  function perfectParry(boss: ReturnType<typeof spawnEnemyAt>): string {
    tickEnemiesUntil(() => boss.ai === 'active_perfect');
    boss.weaponTipDist =
      Math.hypot(boss.x - world.player.x, boss.z - world.player.z) -
      balance.player.radius -
      balance.parrySpace.perfectBand * 0.5;
    const results: string[] = [];
    const off = (p: unknown): void => {
      results.push((p as { result: string }).result);
    };
    world.events.on('parry_attempt', off);
    pressReaction();
    world.events.off('parry_attempt', off);
    return results[0] ?? '없음';
  }

  it('정의 — 보스 3칸·parryOutcome expose(임시 parriesToStagger 없음)·처형 240·피격 상자·기상 반경·강타 뒤 돌격 끔·해머 특칙, 스포너·소환 탭 등록', () => {
    expect(def.boss).toBe(true);
    expect(def.healthBars).toBe(3);
    expect(healthBarState(def, def.health)).toEqual({ count: 3, index: 3, frac: 1 });
    // B2-2 — 패링은 약점을 연다. 스태거 계열 플래그는 주지 않는다(기획서 §3.1)
    expect(def.parryOutcome).toBe('expose');
    expect(def.parriesToStagger).toBeUndefined();
    expect(def.perfectParryOnly).toBeUndefined();
    expect(def.parryAlwaysNormal).toBeUndefined();
    expect(def.attack.exposeOnParry).toEqual({ joint: 'joint_r', normalTicks: 36, perfectTicks: 90 });
    expect(def.attackAlt!.exposeOnParry).toEqual({ joint: 'joint_l', normalTicks: 36, perfectTicks: 90 });
    expect(def.hammerEyeMul).toBe(2.2);
    expect(def.noKnockbackWhileHeadDown).toBe(true);
    expect(def.staggerFlingImmune).toBe(true);
    expect(balance.weakPoint.dazeThreshold).toBe(66);
    expect(balance.weakPoint.dazeCooldownTicks).toBe(600);
    expect(balance.weakPoint.headDown.stuckTicks).toBe(90);
    // 노출 조건 — 눈은 head_down 자세(+ 포효 예고 roar·탈진 exhaust, B3-4), 관절은 타이머만, 심장은 rear(B3-1). 족장에는 아무것도 없다
    expect(def.weakPoints!.find((w) => w.id === 'eye')!.exposedStates).toEqual(['head_down', 'roar', 'exhaust']);
    expect(def.weakPoints!.find((w) => w.id === 'joint_r')!.exposedStates).toEqual([]);
    expect(def.weakPoints!.find((w) => w.id === 'heart')!.exposedStates).toEqual(['rear']);
    expect(enemyDef('goblin_chieftain').parryOutcome).toBeUndefined();
    expect(enemyDef('goblin_chieftain').attack.exposeOnParry).toBeUndefined();
    expect(def.executeDamage).toBe(240);
    expect(def.hitBox).toEqual({ halfX: 1.25, halfZ: 1.85 });
    expect(def.alertRadius).toBe(18);
    expect(def.chargeOnKnockback).toBe(false);
    expect(def.blockCannotStagger).toBe(true);
    expect(def.attack.parryable).toBe(true);
    expect(def.attack.telegraph).toBe('blue');
    expect(def.chargeAttack!.parryable).toBe(false);
    expect(def.chargeAttack!.telegraph).toBe('red');
    expect(def.chargeAttack!.hitOnContact).toBe(true);
    // 닿는데 패링 반경 밖인 틈 금지 — attackRange × impactRangeMul ≤ reaction.radius (기획서 §3.1 데이터 노트)
    expect(def.attackRange * def.attack.impactRangeMul).toBeLessThanOrEqual(balance.reaction.radius);
    // 돌격 18m 고정 질주 — minRange~maxRange 안이면 미달이 없다
    expect((def.chargeAttack!.chargeSpeed! * def.chargeAttack!.chargeRunTicks!) / 60).toBeGreaterThanOrEqual(def.chargeAttack!.maxRange!);
    // 레벨 배치·시험방 소환 탭 양쪽에 올라온다
    expect(isSpawnable(TYPE)).toBe(true);
    expect(implementedEnemyTypes()).toContain(TYPE);
    expect(spawnEnemyAt(TYPE, 0, 0, 1).parryStreak).toBe(0); // 보스는 연속 패링 카운터를 갖고 태어난다
  });

  /** 낫이 열리면 낫끝을 일반 대역(완벽 대역 밖, guardDepth 안)에 놓고 누른다 */
  function normalParry(boss: ReturnType<typeof spawnEnemyAt>): string {
    tickEnemiesUntil(() => boss.ai === 'active_perfect');
    boss.weaponTipDist =
      Math.hypot(boss.x - world.player.x, boss.z - world.player.z) -
      balance.player.radius -
      (balance.parrySpace.perfectBand + balance.parrySpace.guardDepth) * 0.5;
    const results: string[] = [];
    const off = (p: unknown): void => {
      results.push((p as { result: string }).result);
    };
    world.events.on('parry_attempt', off);
    pressReaction();
    world.events.off('parry_attempt', off);
    return results[0] ?? '없음';
  }

  /** 약점 정의 */
  function wp(id: string): WeakPointDef {
    return def.weakPoints!.find((w) => w.id === id)!;
  }

  /** 권총으로 월드 점을 쏜다 — 시선을 그 점으로 돌리고 한 발. 권총은 쿨다운을 비워 바로 나간다 */
  function shootAt(tx: number, ty: number, tz: number): void {
    const p = world.player;
    const dx = tx - p.x;
    const dz = tz - p.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(ty - (p.y + balance.player.eyeHeight), Math.hypot(dx, dz));
    world.weapon.cooldown = 0;
    world.weapon.mag = Math.max(world.weapon.mag, 1);
    world.input = { ...Input.emptySnapshot(), rangedPressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
  }

  /** 눈 구체 중심을 권총으로 쏜다 */
  function shootEye(boss: EnemyState): void {
    const c = weakPointWorldPos(boss, def, wp('eye'));
    shootAt(c.x, c.y, c.z);
  }

  /** 해머 한 타 — 스윙 시작 뒤 impact 틱까지 돌린다(해머 사거리 3.1 + 몸 반경 안에서). heavy 는 3타째 */
  function hammerSwing(): void {
    world.weapon.meleeCooldown = 0;
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    for (let i = 0; i < 40 && world.weapon.swingImpact > 0; i++) Weapons.tick(world, DT);
  }

  it('(a) 일반 패링 → 그 낫의 관절만 36틱 노출(joint_r), 적은 recover(튕김), 36틱 뒤 exposure_closed{hits} 로 닫힌다 — 스태거는 없다', () => {
    const boss = makeBehemoth(4.0); // attackRange 4.4 안, 돌격 minRange 4.5 밖
    const staggers: unknown[] = [];
    world.events.on('boss_staggered', (p) => staggers.push(p));
    const status: { kind: string; on: boolean; id?: string }[] = [];
    world.events.on('boss_status', (p) => status.push(p as { kind: string; on: boolean; id?: string }));
    const closed: { id: string; hits: number }[] = [];
    world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));

    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false); // 노출 전엔 판정 없음
    expect(normalParry(boss)).toBe('normal');
    expect(boss.attackMode).toBe('melee'); // 첫 낫은 오른낫
    expect(boss.ai).toBe('recover');
    expect(boss.recoiled).toBe(true);
    expect(boss.timer).toBe(def.attack.recoverTicks + balance.reaction.parryRecoilTicks);
    expect(boss.pose).toBeUndefined(); // 머리는 안 내려온다 — 완벽만
    expect(boss.exposure).toEqual({ joint_r: 36 });
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(true);
    expect(weakPointOpen(boss, wp('joint_l'))).toBe(false);
    expect(weakPointOpen(boss, wp('eye'))).toBe(false);
    expect(status).toEqual([{ enemyId: boss.id, enemyType: TYPE, kind: 'expose', id: 'joint_r', on: true, ticks: 36 }]);
    expect(staggers).toHaveLength(0);

    // 35틱까지 열려 있고 36틱째에 닫힌다 (Enemies 가 깎는다 — 튕김 경직 중에도 시계는 간다)
    for (let i = 0; i < 35; i++) Enemies.tick(world, DT);
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(true);
    expect(boss.exposure!['joint_r']).toBe(1);
    Enemies.tick(world, DT);
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
    expect(boss.exposure!['joint_r']).toBeUndefined();
    expect(closed).toEqual([{ enemyId: boss.id, enemyType: TYPE, id: 'joint_r', hits: 0 }]);
    expect(status[1]).toMatchObject({ kind: 'expose', id: 'joint_r', on: false });
  });

  it('노출된 관절은 권총 ×2.0(22) 으로 맞고 exposure_closed 가 명중 수를 센다 — 닫힌 뒤 같은 자리는 몸통 0.8×', () => {
    // 관절 구체의 원뿔(facing 1, 0.4, −0.4)은 그쪽 옆·앞을 향한다 — 정면에서는 안 맞고 오른 옆으로 돌아가야 한다(기획서 §4.2).
    // 벽(z 4)에서 떨어뜨려 놓고, 패링 뒤 플레이어를 보스의 오른 옆(−z 쪽, 보스는 −x 를 본다) 5m 로 옮긴다
    world.player.z = 12;
    world.player.prevZ = 12;
    const boss = spawnEnemyAt(TYPE, 10, 12, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);
    expect(normalParry(boss)).toBe('normal');
    const weakHits: { id: string }[] = [];
    world.events.on('weak_point_hit', (p) => weakHits.push(p as { id: string }));
    const closed: { id: string; hits: number }[] = [];
    world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));
    world.player.x = 10;
    world.player.z = 7;
    const jr = weakPointWorldPos(boss, def, wp('joint_r'));
    expect(jr.z).toBeLessThan(boss.z); // 오른 관절이 플레이어 쪽(−z)에 있다
    const before = boss.health;
    shootAt(jr.x, jr.y, jr.z);
    expect(weakHits).toEqual([expect.objectContaining({ id: 'joint_r', damage: balance.weapons.pistol.damage * 2.0 })]);
    expect(boss.health).toBeCloseTo(before - balance.weapons.pistol.damage * 2.0, 5);
    expect(boss.weakHp!['joint_r']).toBeCloseTo(132 - 22, 5);
    for (let i = 0; i < 36; i++) Enemies.tick(world, DT);
    expect(closed).toEqual([expect.objectContaining({ id: 'joint_r', hits: 1 })]);
    // 닫혔다 — 같은 자리는 몸통 0.8×, 약점 장부 없음
    const after = boss.health;
    shootAt(jr.x, jr.y, jr.z);
    expect(weakHits).toHaveLength(1);
    expect(boss.health).toBeCloseTo(after - balance.weapons.pistol.damage * balance.weapons.pistol.hitZones.bodyMul, 5);
  });

  it('(b) 완벽 패링 → head_down 90틱: 이동·공격 불가, 눈(0.9m) 노출 + 관절 90틱, 낫이 박혀 튕김 자세는 아니다. 90틱 뒤 chase 로 돌아오며 눈이 닫힌다', () => {
    const boss = makeBehemoth(4.0);
    const status: { kind: string; on: boolean; id?: string }[] = [];
    world.events.on('boss_status', (p) => status.push(p as { kind: string; on: boolean; id?: string }));
    const closed: { id: string; hits: number }[] = [];
    world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));

    expect(perfectParry(boss)).toBe('perfect'); // 족장과 달리 완벽 판정이 그대로 성립한다
    expect(boss.pose).toBe('head_down');
    expect(boss.poseTicks).toBe(90);
    expect(boss.ai).toBe('recover');
    expect(boss.recoiled).toBe(false);
    expect(boss.exposure).toEqual({ joint_r: 90 });
    expect(weakPointOpen(boss, wp('eye'))).toBe(true);
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(true);
    expect(weakPointOpen(boss, wp('heart'))).toBe(false);
    // 눈 구체는 표의 head_down 자리(0.9m)
    const eye = weakPointWorldPos(boss, def, wp('eye'));
    expect(eye.y).toBeCloseTo(0.9, 6);
    expect(Math.hypot(eye.x - boss.x, eye.z - boss.z)).toBeCloseTo(1.9, 6);
    expect(status.map((s) => `${s.kind}${s.id ? ':' + s.id : ''}:${s.on}`)).toEqual(['expose:joint_r:true', 'head_down:true']);

    // 90틱 동안 제자리 — 플레이어가 코앞(3.0m 안)에 있어도 들이받기도 낫도 나가지 않는다
    world.player.x = boss.x - 2.5;
    const x0 = boss.x;
    const z0 = boss.z;
    const yaw0 = boss.yaw;
    const windups: unknown[] = [];
    world.events.on('enemy_windup', (p) => windups.push(p));
    for (let i = 0; i < 89; i++) Enemies.tick(world, DT);
    expect(boss.pose).toBe('head_down');
    expect(boss.poseTicks).toBe(1);
    expect(boss.x).toBe(x0);
    expect(boss.z).toBe(z0);
    expect(boss.yaw).toBe(yaw0);
    expect(windups).toHaveLength(0);
    // 90틱째 — 일어난다. 눈은 닫히고(exposure_closed eye) 관절 타이머도 같은 틱에 끝난다
    Enemies.tick(world, DT);
    expect(boss.pose).toBeUndefined();
    expect(boss.poseTicks).toBe(0);
    expect(boss.ai).toBe('chase');
    expect(weakPointOpen(boss, wp('eye'))).toBe(false);
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
    expect(closed.map((c) => c.id).sort()).toEqual(['eye', 'joint_r']);
    expect(status.filter((s) => s.kind === 'head_down').map((s) => s.on)).toEqual([true, false]);
    // 이제 다시 공격한다 (3.0m 안이라 들이받기)
    tickEnemiesUntil(() => boss.ai === 'windup', 30);
    expect(boss.attackMode).toBe('close');
  });

  it('(c) 머리 내림 중 눈 66(권총 33 × 2) → 혼절: staggered 90 + boss_staggered{cause eye} + pose stunned, 눈 판정 닫힘 → 처형 240 → 쿨다운 600', () => {
    const boss = makeBehemoth(4.0);
    const staggers: { cause?: string }[] = [];
    world.events.on('boss_staggered', (p) => staggers.push(p as { cause?: string }));
    const weakHits: { id: string; damage: number }[] = [];
    world.events.on('weak_point_hit', (p) => weakHits.push(p as { id: string; damage: number }));
    const status: { kind: string; on: boolean }[] = [];
    world.events.on('boss_status', (p) => status.push(p as { kind: string; on: boolean }));

    expect(perfectParry(boss)).toBe('perfect');
    const hp0 = boss.health;
    shootEye(boss);
    expect(weakHits).toHaveLength(1);
    expect(weakHits[0]).toMatchObject({ id: 'eye', damage: 33 });
    expect(boss.weakAccum!['eye']).toBe(33);
    Enemies.tick(world, DT); // 66 미달 — 아직 머리 내림
    expect(boss.ai).toBe('recover');
    expect(boss.pose).toBe('head_down');
    expect(staggers).toHaveLength(0);
    shootEye(boss);
    expect(boss.weakAccum!['eye']).toBe(66);
    expect(boss.health).toBeCloseTo(hp0 - 66, 5);
    // 임계는 Enemies 가 다음 틱에 본다 — 그 틱은 전이로 끝나 staggerTicks 가 온전히 남는다(패링 스태거와 같다)
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('staggered');
    expect(boss.timer).toBe(balance.reaction.staggerTicks);
    expect(boss.pose).toBe('stunned');
    expect(boss.poseTicks).toBe(0);
    expect(boss.dazed).toBe(true);
    expect(staggers).toEqual([{ enemyId: boss.id, enemyType: TYPE, cause: 'eye' }]);
    expect(status.filter((s) => s.kind === 'daze')).toEqual([expect.objectContaining({ on: true })]);
    expect(status.filter((s) => s.kind === 'head_down').map((s) => s.on)).toEqual([true, false]);
    // 혼절 중 눈 판정 닫힘 — 눈 자리(stunned 표 2.0m)를 쏘면 몸통 0.8×, 약점 장부 없음
    expect(weakPointOpen(boss, wp('eye'))).toBe(false);
    const eye = weakPointWorldPos(boss, def, wp('eye'));
    expect(eye.y).toBeCloseTo(2.0, 6);
    const hp1 = boss.health;
    shootAt(eye.x, eye.y, eye.z);
    expect(weakHits).toHaveLength(2);
    expect(boss.health).toBeCloseTo(hp1 - balance.weapons.pistol.damage * balance.weapons.pistol.hitZones.bodyMul, 5);
    // 관절(90틱 타이머)은 혼절과 무관하게 여전히 열려 있다
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(true);

    // 처형 — 240. 스태거는 처형 한 번으로 끝난다(recover + 뒤로 날림)
    const hits: { damage: number }[] = [];
    world.events.on('boss_execute', (p) => hits.push(p as { damage: number }));
    pressReaction();
    expect(hits).toEqual([expect.objectContaining({ damage: 240 })]);
    expect(boss.health).toBeCloseTo(hp1 - balance.weapons.pistol.damage * balance.weapons.pistol.hitZones.bodyMul - 240, 5);
    expect(boss.alive).toBe(true);
    expect(boss.ai).toBe('recover');
    // 혼절이 끝났다 — 다음 틱에 쿨다운 600 이 걸리고 stunned 자세가 풀린다
    world.executeFocusTicks = 0; // 처형 연출 정지는 건너뛴다
    Enemies.tick(world, DT);
    expect(boss.dazed).toBe(false);
    expect(boss.dazeCooldown).toBe(balance.weakPoint.dazeCooldownTicks);
    expect(boss.pose).toBeUndefined();
    expect(status.filter((s) => s.kind === 'daze').map((s) => s.on)).toEqual([true, false]);
  });

  it('(d) 혼절이 시간으로 끝나도 쿨다운이 걸리고, 쿨다운 중엔 눈이 열려도 ×3.0 피해만 — 누적 없음, 혼절 없음. 쿨다운이 끝나면 다시 쌓인다', () => {
    const boss = makeBehemoth(4.0);
    const staggers: unknown[] = [];
    world.events.on('boss_staggered', (p) => staggers.push(p));
    expect(perfectParry(boss)).toBe('perfect');
    shootEye(boss);
    shootEye(boss);
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('staggered');
    expect(staggers).toHaveLength(1);
    // 처형 없이 90틱 — 저절로 풀린다
    for (let i = 0; i < balance.reaction.staggerTicks; i++) Enemies.tick(world, DT);
    expect(boss.ai).toBe('recover');
    Enemies.tick(world, DT); // 혼절이 끝난 다음 틱에 쿨다운이 걸린다(그 틱은 아직 깎지 않는다)
    expect(boss.dazeCooldown).toBe(balance.weakPoint.dazeCooldownTicks);
    expect(boss.pose).toBeUndefined();

    // 쿨다운 중 다시 머리를 내리게 하고(상태를 직접 세운다 — 패링 흐름은 위에서 검증) 눈을 세 발
    boss.ai = 'chase';
    boss.timer = 0;
    boss.recoiled = false;
    boss.pose = 'head_down';
    boss.poseTicks = 90;
    boss.ai = 'recover';
    expect(weakPointOpen(boss, wp('eye'))).toBe(true);
    const weakHits: { damage: number }[] = [];
    world.events.on('weak_point_hit', (p) => weakHits.push(p as { damage: number }));
    const hp0 = boss.health;
    for (let i = 0; i < 3; i++) {
      shootEye(boss);
      Enemies.tick(world, DT);
    }
    expect(weakHits).toHaveLength(3);
    expect(weakHits.every((h) => h.damage === 33)).toBe(true); // 피해는 ×3.0 그대로
    expect(boss.health).toBeCloseTo(hp0 - 99, 5);
    expect(boss.weakAccum!['eye']).toBe(0); // 누적은 매 틱 지워진다
    expect(boss.ai).toBe('recover'); // 혼절 없음
    expect(staggers).toHaveLength(1);

    // 쿨다운을 다 돌리고(머리 내림은 다시 세운다) 두 발 → 혼절
    for (let i = 0; i < balance.weakPoint.dazeCooldownTicks; i++) Enemies.tick(world, DT);
    expect(boss.dazeCooldown).toBe(0);
    boss.pose = 'head_down';
    boss.poseTicks = 90;
    boss.ai = 'recover';
    shootEye(boss);
    shootEye(boss);
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('staggered');
    expect(staggers).toHaveLength(2);
  });

  it('(e) 머리 내림 중 해머 = 눈 집계(15 × 2.2 = 33, weak_point_hit eye) — 2타면 혼절. 마무리 강타 넉백 0(noKnockbackWhileHeadDown)', () => {
    const boss = makeBehemoth(4.0);
    expect(perfectParry(boss)).toBe('perfect');
    // 해머 사거리(3.1 + 반경 1.6) 안으로 붙는다
    world.player.x = boss.x - 3.0;
    world.player.yaw = -Math.PI / 2; // +x(보스)를 본다
    const weakHits: { id: string; damage: number }[] = [];
    world.events.on('weak_point_hit', (p) => weakHits.push(p as { id: string; damage: number }));
    const melee: { damage: number; heavy: boolean }[] = [];
    world.events.on('melee_hit', (p) => melee.push(p as { damage: number; heavy: boolean }));
    const hp0 = boss.health;
    hammerSwing(); // 1타
    expect(melee).toHaveLength(1);
    expect(melee[0]!.damage).toBeCloseTo(balance.weapons.hammer.damage * def.hammerEyeMul!, 5);
    expect(weakHits).toEqual([expect.objectContaining({ id: 'eye', damage: 33 })]);
    expect(boss.health).toBeCloseTo(hp0 - 33, 5);
    expect(boss.weakAccum!['eye']).toBeCloseTo(33, 5);
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('recover'); // 아직
    hammerSwing(); // 2타 → 66
    expect(weakHits).toHaveLength(2);
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('staggered');
    expect(boss.pose).toBe('stunned');

    // 넉백 0 — 새 보스를 머리 내림 상태로 두고 3타(강타)까지 친다: kbTicks 가 걸리지 않는다
    world = makeWorld();
    const boss2 = makeBehemoth(4.0);
    expect(perfectParry(boss2)).toBe('perfect');
    world.player.x = boss2.x - 3.0;
    world.player.yaw = -Math.PI / 2;
    boss2.dazeCooldown = 10_000; // 누적 없이 넉백만 본다
    const x0 = boss2.x;
    for (let step = 0; step < 3; step++) {
      hammerSwing();
      for (let i = 0; i < 3; i++) Enemies.tick(world, DT);
    }
    expect(world.weapon.comboStep === 0 || world.weapon.comboStep === 3).toBe(true);
    expect(boss2.kbTicks ?? 0).toBe(0);
    expect(boss2.x).toBe(x0);
    expect(boss2.pose).toBe('head_down');
    // 대조 — 머리 내림이 아닌 족장은 마무리 강타에 heavy 0.25 만큼 밀린다
    world = makeWorld();
    const chief = spawnEnemyAt('goblin_chieftain', 6 + 3.0, 6, 9);
    chief.ai = 'recover';
    chief.timer = 10_000;
    world.enemies.push(chief);
    world.player.yaw = -Math.PI / 2;
    for (let step = 0; step < 3; step++) {
      hammerSwing();
      for (let i = 0; i < 2; i++) Enemies.tick(world, DT);
    }
    expect(chief.kbTicks ?? 0).toBeGreaterThan(0);
  });

  it('(f) 혼절 중 해머 3타 전부 적중 → 5m 날림 면제(staggerFlingImmune): stagger_fling 없음, heavy 0.25 넉백만. 족장은 그대로 날아간다', () => {
    const boss = makeBehemoth(4.0);
    boss.ai = 'staggered';
    boss.timer = 10_000;
    world.player.x = boss.x - 3.0;
    world.player.yaw = -Math.PI / 2;
    const flings: unknown[] = [];
    world.events.on('stagger_fling', (p) => flings.push(p));
    for (let step = 0; step < 3; step++) hammerSwing();
    expect(world.weapon.comboHits).toBe(0); // 3타 뒤 리셋 — 앞 두 타가 들어갔다는 뜻
    expect(flings).toHaveLength(0);
    const kb = balance.weapons.hammer;
    const expectedKb = kb.knockback * kb.combo.knockbackMul * kb.combo.knockbackByWeight.heavy;
    expect(Math.hypot(boss.kbX!, boss.kbZ!) * boss.kbTicks!).toBeCloseTo(expectedKb, 3);
    expect(boss.ai).toBe('staggered'); // 경직은 유지 — 처형 가능
    // 족장(면제 없음) — 5m 날림
    world = makeWorld();
    const chief = spawnEnemyAt('goblin_chieftain', 6 + 3.0, 6, 9);
    chief.ai = 'staggered';
    chief.timer = 10_000;
    world.enemies.push(chief);
    world.player.yaw = -Math.PI / 2;
    const chiefFlings: unknown[] = [];
    world.events.on('stagger_fling', (p) => chiefFlings.push(p));
    for (let step = 0; step < 3; step++) hammerSwing();
    expect(chiefFlings).toHaveLength(1);
    expect(Math.hypot(chief.kbX!, chief.kbZ!) * chief.kbTicks!).toBeCloseTo(kb.combo.staggerFullKnockback, 3);
  });

  it('(g) 자세 비추기 — 돌격 예고·질주·헛돌격 경직 동안 pose charge(구체 표 1.1m), 끝나면 사라진다. 예고 중 눈은 닫혀 있다(질주 중 6m 안 노출은 B2-5 — 아래 describe)', () => {
    const boss = makeBehemoth(10);
    tickEnemiesUntil(() => boss.ai === 'windup', 300);
    expect(boss.attackMode).toBe('charge');
    Enemies.tick(world, DT); // 자세 비추기는 틱 첫머리 — 예고를 시작한 다음 틱부터
    expect(boss.ai).toBe('windup');
    expect(boss.pose).toBe('charge');
    expect(weakPointWorldPos(boss, def, wp('eye')).y).toBeCloseTo(1.1, 6);
    expect(weakPointOpen(boss, wp('eye'))).toBe(false);
    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    world.player.z += 4; // 헛돌격으로 끝나게 — 예고 끝에 고정된 목표 옆으로 크게 비킨다(무적 접촉은 B2-3 부터 완벽 회피라 헛돌격이 아니다)
    expect(boss.pose).toBe('charge');
    tickEnemiesUntil(() => boss.ai === 'recover', 300);
    expect(boss.whiffed).toBe(true);
    expect(boss.pose).toBe('charge'); // 헛돌격 경직 — 웅크린 자세 그대로(Stage 와 같은 규칙)
    tickEnemiesUntil(() => boss.ai === 'chase', 300);
    Enemies.tick(world, DT); // 비추기는 틱 첫머리 — 추격으로 돌아온 다음 틱에 풀린다
    expect(boss.pose).toBeUndefined();
  });

  it('(h) 오버라이드 순서 — 강타 경직(attackFreeze)이 포즈 타이머를 멈춘다(넉백 > brace > attackFreeze > 포즈), 그래도 눈 누적 판정은 매 틱 산다', () => {
    const boss = makeBehemoth(4.0);
    expect(perfectParry(boss)).toBe('perfect');
    boss.attackFreezeTicks = 5;
    for (let i = 0; i < 5; i++) Enemies.tick(world, DT);
    expect(boss.poseTicks).toBe(90); // 얼어 있는 동안 포즈 시계는 멈춘다
    expect(boss.exposure!['joint_r']).toBe(85); // 노출 시계는 간다(플레이어의 시간)
    Enemies.tick(world, DT);
    expect(boss.poseTicks).toBe(89);
    // 얼어 있는 중에도 눈 66 이면 혼절
    boss.attackFreezeTicks = 5;
    shootEye(boss);
    shootEye(boss);
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('staggered');
  });

  it('(b) 돌격 접촉 — 45 피해 + 7m/20틱 밀림 + 진탕(concussion 360, B2-4 — 감소·이벤트는 Status.ts, Status.test 가 본다)', () => {
    const ch = def.chargeAttack!;
    const boss = makeBehemoth(10); // minRange 4.5 ~ maxRange 15 안
    const hits: { amount: number; blocked: boolean }[] = [];
    world.events.on('player_damaged', (p) => hits.push(p as { amount: number; blocked: boolean }));

    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    expect(boss.attackMode).toBe('charge');
    tickEnemiesUntil(() => boss.ai === 'recover', 300);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBe(45);
    expect(hits[0]!.amount).toBe(ch.damage);
    expect(hits[0]!.blocked).toBe(false);
    expect(world.player.health).toBe(100 - 45);
    // 밀림 — 공격별 재정의 7m 를 20틱에 걸쳐
    expect(world.player.kbTicks).toBe(ch.playerKnockbackTicks);
    const flung = Math.hypot(world.player.kbX!, world.player.kbZ!) * world.player.kbTicks!;
    expect(flung).toBeCloseTo(ch.playerKnockback!, 3);
    // 진탕(concussion) — 직격만 세운다(statusOnHit). 팔 저림은 낫을 막았을 때만
    expect(world.player.concussionTicks).toBe(balance.status.concussion.ticks);
    expect(world.player.numbArmTicks ?? 0).toBe(0);
    expect(boss.whiffed).toBe(false);
    // 몸 접촉이 곧 명중 — 달리기가 멈춘 자리는 접촉 거리 안이다
    expect(Math.hypot(boss.x - world.player.x, boss.z - world.player.z)).toBeLessThanOrEqual(Enemies.contactDist(def));
  });

  it('(c) 완벽 회피(B2-3) — 접촉 순간이 회피 무적 8틱 안이면 피해 0 + charge_dodged + 미끄러짐(pose skid 90, 이동·공격 불가) + 양 관절 40틱 노출. 90틱 뒤 chase, 관절은 40틱에 닫힌다', () => {
    const ch = def.chargeAttack!;
    expect(ch.perfectDodgeExposes).toEqual({ ticks: 40, joints: ['joint_r', 'joint_l'], poolKind: 'skid' }); // poolKind 는 B3-2 미끄러짐 웅덩이
    expect(balance.weakPoint.skid.ticks).toBe(90);
    const boss = makeBehemoth(10);
    const hits: unknown[] = [];
    world.events.on('player_damaged', (p) => hits.push(p));
    const dodged: unknown[] = [];
    world.events.on('charge_dodged', (p) => dodged.push(p));
    const status: { kind: string; on: boolean; id?: string }[] = [];
    world.events.on('boss_status', (p) => status.push(p as { kind: string; on: boolean; id?: string }));
    const closed: { id: string; hits: number }[] = [];
    world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));

    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    // 몸이 닿기 직전(≈ 4틱 전, 15 m/s = 0.25m/틱)에 회피 무적을 건다 — 무적은 Reaction 이 매 틱 깎는다
    const cd = Enemies.contactDist(def);
    tickEnemiesUntil(() => Math.hypot(boss.x - world.player.x, boss.z - world.player.z) <= cd + 1.0, 300);
    world.player.iframeTicks = balance.reaction.dodgeIFrameTicks;
    world.player.iframeSource = 'dodge'; // 회피 무적(B2-3 검토 — 블링크·탈출 무적은 완벽 회피가 아니다)
    for (let i = 0; i < 300 && boss.ai !== 'recover'; i++) {
      Enemies.tick(world, DT);
      Reaction.tick(world, DT);
    }

    expect(hits).toHaveLength(0);
    expect(world.player.health).toBe(100);
    expect(world.player.kbTicks ?? 0).toBe(0);
    expect(dodged).toEqual([{ enemyId: boss.id, enemyType: TYPE, x: boss.x, z: boss.z }]);
    // 헛돌격(whiff 90)이 아니라 미끄러짐 — 포즈 타이머가 이동·공격을 막는다
    expect(boss.ai).toBe('recover');
    expect(boss.whiffed).toBe(false);
    expect(boss.pose).toBe('skid');
    expect(boss.poseTicks).toBe(90);
    expect(boss.exposure).toEqual({ joint_r: 40, joint_l: 40 });
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(true);
    expect(weakPointOpen(boss, wp('joint_l'))).toBe(true);
    expect(weakPointOpen(boss, wp('eye'))).toBe(false); // 눈은 skid 자세에서 닫혀 있다 — 돌격 중 6m 안 노출(B2-5)은 질주가 끝나는 impact 에서 닫힌다
    expect(weakPointWorldPos(boss, def, wp('joint_r')).y).toBeCloseTo(2.4, 6); // 표의 skid 자리
    // 다가오며 6m 안에 든 동안 눈이 열렸다가(B2-5) 접촉 순간 닫히고, 그 다음 관절·미끄러짐
    expect(status.map((s) => `${s.kind}${s.id ? ':' + s.id : ''}:${s.on}`)).toEqual(['expose:eye:true', 'expose:eye:false', 'expose:joint_r:true', 'expose:joint_l:true', 'skid:true']);

    // 미끄러지는 90틱 동안 제자리 — 코앞이라도 들이받기·낫·돌격 어느 것도 나가지 않는다
    const x0 = boss.x;
    const z0 = boss.z;
    const windups: unknown[] = [];
    world.events.on('enemy_windup', (p) => windups.push(p));
    for (let i = 0; i < 40; i++) Enemies.tick(world, DT);
    expect(closed.map((c) => c.id).sort()).toEqual(['eye', 'joint_l', 'joint_r']); // 관절은 40틱에 닫힌다 (눈은 접촉 순간 hits 0 으로)
    expect(closed.find((c) => c.id === 'eye')!.hits).toBe(0);
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
    expect(boss.pose).toBe('skid');
    for (let i = 0; i < 49; i++) Enemies.tick(world, DT);
    expect(boss.pose).toBe('skid');
    expect(boss.poseTicks).toBe(1);
    expect(boss.x).toBe(x0);
    expect(boss.z).toBe(z0);
    expect(windups).toHaveLength(0);
    Enemies.tick(world, DT);
    expect(boss.pose).toBeUndefined();
    expect(boss.ai).toBe('chase');
    expect(status.filter((s) => s.kind === 'skid').map((s) => s.on)).toEqual([true, false]);
  });

  it('완벽 회피는 마나를 주지 않는다 — 노출이 보상(결정 6). 돌격이 아닌 들이받기는 무적 접촉이어도 그냥 빗나간다(perfectDodgeExposes 없음)', () => {
    const boss = makeBehemoth(10);
    const mana: unknown[] = [];
    world.events.on('mana_gained', (p) => mana.push(p));
    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    const cd = Enemies.contactDist(def);
    tickEnemiesUntil(() => Math.hypot(boss.x - world.player.x, boss.z - world.player.z) <= cd + 1.0, 300);
    world.player.iframeTicks = 1e9;
    world.player.iframeSource = 'dodge';
    tickEnemiesUntil(() => boss.pose === 'skid', 300);
    expect(mana).toHaveLength(0);
    // 들이받기 — 무적 접촉은 옛 경로(헛침)
    const boss2 = makeBehemoth(2.4);
    world.enemies.splice(world.enemies.indexOf(boss), 1);
    tickEnemiesUntil(() => boss2.ai === 'windup', 60);
    expect(boss2.attackMode).toBe('close');
    tickEnemiesUntil(() => boss2.ai === 'recover', 60);
    expect(boss2.whiffed).toBe(true);
    expect(boss2.pose).toBeUndefined();
    expect(boss2.exposure ?? {}).toEqual({});
  });

  it('무적이 아니면 같은 자리에서 그대로 맞는다 — (c)의 대조군', () => {
    const boss = makeBehemoth(10);
    const hits: unknown[] = [];
    world.events.on('player_damaged', (p) => hits.push(p));
    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    const cd = Enemies.contactDist(def);
    tickEnemiesUntil(() => Math.hypot(boss.x - world.player.x, boss.z - world.player.z) <= cd + 1.0, 300);
    for (let i = 0; i < 300 && boss.ai !== 'recover'; i++) {
      Enemies.tick(world, DT);
      Reaction.tick(world, DT);
    }
    expect(hits).toHaveLength(1);
  });

  it('hitBox — 피격 상자는 시각 몸통 직사각(1.25 × 1.85)이고 yaw 를 따라 돈다', () => {
    const boss = spawnEnemyAt(TYPE, 20, 20, 1);
    const y = 1.5;
    // 정면 -z (yaw 0): 옆(+x)에서 쏘면 반폭 1.25, 앞(-z)에서 쏘면 반길이 1.85
    boss.yaw = 0;
    expect(rayHitsEnemy(23, y, 20, -1, 0, 0, boss, def, 0)).toBeCloseTo(3 - 1.25, 6);
    expect(rayHitsEnemy(20, y, 15, 0, 0, 1, boss, def, 0)).toBeCloseTo(5 - 1.85, 6);
    // 옆 허공 — 반폭 1.25 밖(1.5)이면 빗나간다. 옛 radius 1.6 정사각이면 맞았을 자리
    expect(rayHitsEnemy(21.5, y, 15, 0, 0, 1, boss, def, 0)).toBeNull();
    // 정면 -x (yaw π/2): 같은 +x 에서 쏘면 이제 앞이라 1.85
    boss.yaw = Math.PI / 2;
    expect(rayHitsEnemy(23, y, 20, -1, 0, 0, boss, def, 0)).toBeCloseTo(3 - 1.85, 6);
    expect(rayHitsEnemy(20, y, 15, 0, 0, 1, boss, def, 0)).toBeCloseTo(5 - 1.25, 6);
    // 머리 위(3.0m)를 넘으면 빗나간다
    expect(rayHitsEnemy(23, 3.2, 20, -1, 0, 0, boss, def, 0)).toBeNull();
    // hitBox 가 없는 적은 옛 radius 정사각 그대로
    const chief = spawnEnemyAt('goblin_chieftain', 20, 20, 2);
    expect(rayHitsEnemy(23, y, 20, -1, 0, 0, chief, enemyDef('goblin_chieftain'), 0)).toBeCloseTo(3 - 0.8, 6);
  });

  it('외형 부위 표(visual, B1-2) — radius/height 배율이 기획서 §2 미터를 되돌리고, 눈 앞끝은 접촉 거리 안·낫 상한은 천장 아래', () => {
    const v = def.visual!;
    expect(v).toBeDefined();
    const R = def.radius;
    const H = def.height;
    const m = (t: readonly [number, number, number]): number[] => [t[0] * R, t[1] * H, t[2] * R].map((n) => +n.toFixed(2));
    // 몸통 2.3 × 1.5 × 2.6 at (0, 1.6, 0) — 피격 상자(halfX 1.25 / halfZ 1.85)가 몸통을 품는다
    expect(m(v.body.size)).toEqual([2.3, 1.5, 2.6]);
    expect(m(v.body.pos)).toEqual([0, 1.6, 0]);
    expect((v.body.size[0] * R) / 2).toBeLessThanOrEqual(def.hitBox!.halfX);
    expect((v.body.size[2] * R) / 2).toBeLessThanOrEqual(def.hitBox!.halfZ);
    // 높은 머리 1.0 × 0.9 × 0.9 at (0, 2.35, −1.4) — 머리 앞면(−1.85)도 피격 상자 안, 꼭대기(2.8)는 height 아래
    expect(m(v.head.size)).toEqual([1, 0.9, 0.9]);
    expect(m(v.head.pos)).toEqual([0, 2.35, -1.4]);
    expect(Math.abs(v.head.pos[2] * R) + (v.head.size[2] * R) / 2).toBeLessThanOrEqual(def.hitBox!.halfZ);
    expect(v.head.pos[1] * H + (v.head.size[1] * H) / 2).toBeLessThanOrEqual(H);
    // 약점 다섯 자리 — 눈 r0.26 (0, 2.35, −1.88) 앞끝 2.14 ≤ contactDist 2.15 / 관절 r0.30 (±1.15, 2.5, −0.8) / 심장 r0.35 (0, 0.6, −0.4) / 분출공 r0.30 (0, 1.65, −1.55)
    expect(m(v.eye.pos)).toEqual([0, 2.35, -1.88]);
    expect(+(v.eye.radius * R).toFixed(2)).toBe(0.26);
    expect(Math.abs(v.eye.pos[2] * R) + v.eye.radius * R).toBeLessThanOrEqual(Enemies.contactDist(def));
    expect(m(v.joints.pos)).toEqual([1.15, 2.5, -0.8]);
    expect(+(v.joints.radius * R).toFixed(2)).toBe(0.3);
    expect(m(v.heart.pos)).toEqual([0, 0.6, -0.4]);
    expect(+(v.heart.radius * R).toFixed(2)).toBe(0.35);
    expect(m(v.vent.pos)).toEqual([0, 1.65, -1.55]);
    expect(+(v.vent.radius * R).toFixed(2)).toBe(0.3);
    // 분출공은 머리(y ≥ 1.9) 아래에 있어 정면에서 가리지 않는다
    expect(v.vent.pos[1] * H + v.vent.radius * R).toBeLessThanOrEqual(v.head.pos[1] * H - (v.head.size[1] * H) / 2 + 0.06);
    // 낫 0.12 × 0.5 × 1.8 — 어깨 피벗 2.5 에서 45° 들어도 끝이 3.8 아래 (천장 4m)
    expect(m(v.blade.size)).toEqual([0.12, 0.5, 1.8]);
    expect(v.joints.pos[1] * H + v.blade.size[2] * R * Math.sin(Math.PI / 4)).toBeLessThanOrEqual(3.8);
    // 어깨 피벗 + 위팔 + 낫이 사거리에 닿는다 (보이는 낫끝 = 판정 낫끝을 어깨 밀기 없이 그릴 수 있는 길이)
    expect(Math.abs(v.joints.pos[2] * R) + v.upperArm.length * R + v.blade.size[2] * R).toBeGreaterThanOrEqual(def.attackRange * def.attack.impactRangeMul * 0.9);
    // 등갑판 3장 2.1 × 0.25 × 0.8, 다리 4개 r0.22 h1.0 (±1.0, 0.5, ±1.0), 꼬리 r0.15 h1.2
    expect(m(v.plates.size)).toEqual([2.1, 0.25, 0.8]);
    expect(v.plates.z).toHaveLength(3);
    expect(+(v.legs.height * H).toFixed(2)).toBe(1);
    expect(m(v.legs.pos)).toEqual([1, 0.5, 1]);
    expect(+(v.tail.length * R).toFixed(2)).toBe(1.2);
    // 다른 적은 visual 블록이 없다 — 옛 인간형 외형 경로 그대로
    expect(enemyDef('goblin_chieftain').visual).toBeUndefined();
    expect(enemyDef('slime_mother').visual).toBeUndefined();
  });

  // 리그 천장·낫끝·들이받기 자세·리그 구성 검사(B1-2/B1-3)는 src/render/Behemoth.test.ts 로 옮겼다 (B2-2)

  it('B1-3 정의 — attackAlt(왼낫: 오른낫과 같되 예고 28틱·alternate)·closeAttack(들이받기: contact·hitOnContact·패링 불가·빨강·22틱·22·3.5m·3.0m·쿨 240), 다른 적은 슬롯 없음', () => {
    const alt = def.attackAlt!;
    const close = def.closeAttack!;
    expect(alt.alternate).toBe(true);
    expect(alt.windupTicks).toBe(28);
    expect(def.attack.windupTicks).toBe(32);
    // 예고 길이·교대 플래그·노출 관절(왼) 말고는 오른낫과 같다
    const { windupTicks: _wl, alternate: _al, exposeOnParry: altEx, ...altRest } = alt;
    const { windupTicks: _wr, exposeOnParry: rightEx, ...rightRest } = def.attack;
    expect(altRest).toEqual(rightRest);
    expect(altEx!.joint).toBe('joint_l');
    expect(rightEx!.joint).toBe('joint_r');
    expect({ ...altEx, joint: 'x' }).toEqual({ ...rightEx, joint: 'x' });
    expect(close).toMatchObject({
      type: 'contact', hitOnContact: true, parryable: false, telegraph: 'red',
      windupTicks: 22, damage: 22, playerKnockback: 3.5, maxRange: 3.0, cooldownTicks: 240,
    });
    // 판정 사거리 = maxRange — 붙어 있던 자리(3.0m 안)까지 닿는다
    expect(def.attackRange * close.impactRangeMul).toBeCloseTo(close.maxRange!, 2);
    // currentAttack 이 모드를 슬롯으로 잇는다 — 슬롯이 없는 적은 기본 공격으로 떨어진다
    expect(currentAttack(def, { attackMode: 'alt' })).toBe(alt);
    expect(currentAttack(def, { attackMode: 'close' })).toBe(close);
    expect(currentAttack(def, { attackMode: 'melee' })).toBe(def.attack);
    const chief = enemyDef('goblin_chieftain');
    expect(chief.attackAlt).toBeUndefined();
    expect(chief.closeAttack).toBeUndefined();
    expect(currentAttack(chief, { attackMode: 'alt' })).toBe(chief.attack);
    expect(currentAttack(chief, { attackMode: 'close' })).toBe(chief.attack);
    expect(enemyDef('slime_mother').attackAlt).toBeUndefined();
    expect(enemyDef('slime_mother').closeAttack).toBeUndefined();
  });

  /** 예고가 열릴 때마다 (attackMode, 예고 틱, 몇 틱째) 를 기록하며 n 번의 예고를 본다 */
  function recordWindups(enemy: EnemyState, n: number, maxTicks = 3000): { mode: string; windup: number; tick: number }[] {
    const seen: { mode: string; windup: number; tick: number }[] = [];
    let wasWindup = false;
    for (let i = 0; i < maxTicks && seen.length < n; i++) {
      Enemies.tick(world, DT);
      const now = enemy.ai === 'windup';
      if (now && !wasWindup) seen.push({ mode: enemy.attackMode ?? '?', windup: enemy.timer, tick: i });
      wasWindup = now;
    }
    return seen;
  }

  it('두 낫이 교대로 나온다 — 오른낫(melee·32틱) → 왼낫(alt·28틱) → 오른낫 → 왼낫, lastBlade 가 기억한다', () => {
    const boss = makeBehemoth(4.0); // 낫 사거리(4.4) 안 · 들이받기(3.0) 밖 · 돌격(4.5) 밖
    world.player.iframeTicks = 1e9; // 전부 헛치게 두고 순서만 본다 (Reaction 을 안 돌리니 무적이 유지된다)
    const seen = recordWindups(boss, 4);
    expect(seen.map((s) => s.mode)).toEqual(['melee', 'alt', 'melee', 'alt']);
    expect(seen.map((s) => s.windup)).toEqual([32, 28, 32, 28]);
    expect(boss.lastBlade).toBe('l');
    expect(boss.closeCooldown ?? 0).toBe(0); // 들이받기는 한 번도 안 나갔다
  });

  it('왼낫도 같은 패링 파이프 — 왼낫(alt)을 패링하면 joint_l 이 열린다(일반 36 / 완벽 90 + 머리 내림). 스태거는 없다', () => {
    const boss = makeBehemoth(4.0);
    world.player.iframeTicks = 1e9; // 첫 오른낫은 헛치게 흘려보낸다
    tickEnemiesUntil(() => boss.ai === 'recover' && boss.attackMode === 'melee');
    world.player.iframeTicks = 0;
    expect(normalParry(boss)).toBe('normal');
    expect(boss.attackMode).toBe('alt'); // 둘째는 왼낫
    expect(boss.exposure).toEqual({ joint_l: 36 });
    expect(boss.ai).toBe('recover');
    expect(boss.pose).toBeUndefined();
    // 다음 낫(오른낫)을 완벽 패링 — 머리 내림 + joint_r 90. 왼 관절 타이머는 그대로 흐른다
    expect(perfectParry(boss)).toBe('perfect');
    expect(boss.attackMode).toBe('melee');
    expect(boss.pose).toBe('head_down');
    expect(boss.exposure!['joint_r']).toBe(90);
    expect(boss.ai).not.toBe('staggered');
  });

  it('족장(parryOutcome 없음)은 옛 parriesToStagger 경로 그대로 — 노출·자세·혼절 장부가 생기지 않는다', () => {
    const chief = spawnEnemyAt('goblin_chieftain', 8.4, 6, 1);
    chief.ai = 'chase';
    world.enemies.push(chief);
    const cdef = enemyDef('goblin_chieftain');
    const staggers: { cause?: string }[] = [];
    world.events.on('boss_staggered', (p) => staggers.push(p as { cause?: string }));
    for (let n = 1; n <= cdef.parriesToStagger!; n++) {
      tickEnemiesUntil(() => chief.ai === 'active_perfect');
      let got = false;
      const off = (): void => {
        got = true;
      };
      world.events.on('parry_attempt', off);
      for (let i = 0; i < 40 && !got; i++) {
        pressReaction();
        if (got) break;
        Enemies.tick(world, DT);
      }
      world.events.off('parry_attempt', off);
      expect(got).toBe(true);
    }
    expect(chief.ai).toBe('staggered');
    expect(staggers).toEqual([{ enemyId: chief.id, enemyType: 'goblin_chieftain', cause: 'parry' }]);
    expect(chief.exposure).toBeUndefined();
    expect(chief.pose).toBeUndefined();
    expect(chief.poseTicks).toBeUndefined();
    expect(chief.dazed).toBeUndefined();
    for (let i = 0; i < 5; i++) Enemies.tick(world, DT);
    expect(chief.pose).toBeUndefined(); // 약점 정의가 없는 적은 stunned 자세를 비추지 않는다
  });

  it('3.0m 안에서는 들이받기(close·22틱)가 낫보다 먼저 나온다 — 쿨다운 240 이 도는 동안은 낫 교대, 끝나면 다시 들이받기', () => {
    const close = def.closeAttack!;
    const boss = makeBehemoth(2.5);
    world.player.iframeTicks = 1e9;
    const seen = recordWindups(boss, 6);
    expect(seen[0]).toMatchObject({ mode: 'close', windup: 22 });
    // 쿨다운 중엔 낫 — 교대는 들이받기와 무관하게 이어진다
    expect(seen[1]!.mode).toBe('melee');
    expect(seen[2]!.mode).toBe('alt');
    const again = seen.findIndex((s, i) => i > 0 && s.mode === 'close');
    expect(again).toBeGreaterThan(0);
    expect(seen[again]!.tick - seen[0]!.tick).toBeGreaterThanOrEqual(close.cooldownTicks!);
    for (let i = 1; i < again; i++) expect(['melee', 'alt']).toContain(seen[i]!.mode);
    // 들이받기 뒤에도 교대 순서는 그대로 이어진다 (alt 다음은 melee)
    expect(seen[again + 1]!.mode).toBe('melee');
  });

  it('들이받기는 패링 대상이 아니다 — 판정 창 없이 예고 → 즉시 타격. 반응은 조기 입력(fail)이거나 허공, 22 피해·3.5m/12틱 밀림', () => {
    const close = def.closeAttack!;
    const boss = makeBehemoth(2.5);
    const parries: string[] = [];
    world.events.on('parry_attempt', (p) => parries.push((p as { result: string }).result));
    const hits: { amount: number; blocked: boolean }[] = [];
    world.events.on('player_damaged', (p) => hits.push(p as { amount: number; blocked: boolean }));

    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('close');
    expect(boss.closeCooldown).toBe(close.cooldownTicks);
    expect(attackReaches(def, boss, close, world.player.x, world.player.z)).toBe(true);
    // 예고 중 누르면 조기 입력 실패 — 성립할 판정 창이 없다
    pressReaction();
    expect(parries).toEqual(['fail']);
    world.player.stunTicks = 0; // 실패 경직은 치우고 계속 본다
    // 예고가 끝나면 active_perfect/active_normal 을 거치지 않고 바로 impact
    const states: string[] = [];
    while (boss.ai === 'windup') {
      Enemies.tick(world, DT);
      states.push(boss.ai);
    }
    expect(states[states.length - 1]).toBe('impact');
    expect(states).not.toContain('active_perfect');
    expect(states).not.toContain('active_normal');
    // 타격 틱에 눌러도 패링은 없고 타격은 그대로 들어간다
    pressReaction();
    expect(parries).toEqual(['fail']);
    Enemies.tick(world, DT);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBe(22);
    expect(hits[0]!.blocked).toBe(false);
    expect(world.player.health).toBe(100 - 22);
    expect(world.player.kbTicks).toBe(close.playerKnockbackTicks);
    const flung = Math.hypot(world.player.kbX!, world.player.kbZ!) * world.player.kbTicks!;
    expect(flung).toBeCloseTo(close.playerKnockback!, 3);
    expect(boss.ai).toBe('recover');
    expect(boss.timer).toBe(close.recoverTicks);
    // 3.0m 밖(3.3m)에 선 플레이어에게는 닿지 않는다 — 뒤 대시 한 번이면 나간다
    const far = spawnEnemyAt(TYPE, 6 + 3.3, 6, 7);
    far.yaw = Math.atan2(-(6 - far.x), -(6 - far.z));
    expect(attackReaches(def, far, close, 6, 6)).toBe(false);
  });

  it('교대 플래그·밀착 슬롯이 없는 적은 예전 그대로 — 족장은 붙어도 매번 melee, lastBlade·closeCooldown 은 생기지 않는다', () => {
    const chief = spawnEnemyAt('goblin_chieftain', 6 + 3.0, 6, 1);
    chief.ai = 'chase';
    world.enemies.push(chief);
    world.player.iframeTicks = 1e9;
    const seen = recordWindups(chief, 3);
    expect(seen.map((s) => s.mode)).toEqual(['melee', 'melee', 'melee']);
    expect(chief.lastBlade).toBeUndefined();
    expect(chief.closeCooldown).toBeUndefined();
  });

  // ── B2-3 관절 파열·낫 잠김·절뚝 ──

  /** 보스를 (10, 12) 에, 플레이어를 보스의 오른 옆(−z 쪽, 보스는 −x 를 본다) 5m 로 — 관절 원뿔(facing 1, 0.4, −0.4)이 그쪽 옆을 향한다 */
  function makeBehemothSideShot(): ReturnType<typeof spawnEnemyAt> {
    world.player.z = 12;
    world.player.prevZ = 12;
    const boss = spawnEnemyAt(TYPE, 10, 12, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);
    return boss;
  }

  /** 노출된 관절 구체 중심을 권총으로 n 발 — 쿨다운을 비워 같은 틱에 쏜다(노출 36틱 안) */
  function shootJoint(boss: EnemyState, id: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const c = weakPointWorldPos(boss, def, wp(id));
      shootAt(c.x, c.y, c.z);
    }
  }

  it('B2-3 데이터 — rupture{60, 600}·limp{0.65, 0.7}·skid{90}·retreatWhenDisarmed{2.5, 6}, 관절 132 = 권총 6발(22×6), 낫 ↔ 관절 짝은 exposeOnParry 표의 역', () => {
    expect(balance.weakPoint.rupture).toEqual({ staggerTicks: 60, bladeLockTicks: 600 });
    expect(balance.weakPoint.limp).toEqual({ speedMul: 0.65, chargeSpeedMul: 0.7 });
    expect(balance.weakPoint.skid).toEqual({ ticks: 90 });
    expect(def.retreatWhenDisarmed).toEqual({ min: 2.5, max: 6 });
    expect(wp('joint_r').hp).toBe(132);
    expect(wp('joint_l').hp).toBe(132);
    expect(balance.weapons.pistol.damage * wp('joint_r').damageMul * 6).toBe(132);
    expect(bladeOfJoint(def, 'joint_r')).toBe('r');
    expect(bladeOfJoint(def, 'joint_l')).toBe('l');
    expect(bladeOfJoint(def, 'eye')).toBeUndefined();
    expect(jointOfBlade(def, 'r')).toBe('joint_r');
    expect(jointOfBlade(def, 'l')).toBe('joint_l');
    expect(bladeOfJoint(enemyDef('goblin_chieftain'), 'joint_r')).toBeUndefined();
    expect(enemyDef('goblin_chieftain').retreatWhenDisarmed).toBeUndefined();
    expect(enemyDef('goblin_chieftain').chargeAttack!.perfectDodgeExposes).toBeUndefined();
  });

  it('관절 132 → 파열: 권총 6발(22×6)에 내구 0 → weak_point_broken + boss_status rupture{joint_r, r} + 비틀거림 60(recover) + 오른낫 잠김 600, 관절 판정 닫힘(exposure_closed{hits 6})', () => {
    const boss = makeBehemothSideShot();
    expect(normalParry(boss)).toBe('normal');
    const recoverAfterParry = boss.timer; // 40 + 36 = 76
    const status: { kind: string; on: boolean; id?: string; blade?: string; ticks?: number }[] = [];
    world.events.on('boss_status', (p) => status.push(p as { kind: string; on: boolean; id?: string; blade?: string; ticks?: number }));
    const broken: { id: string }[] = [];
    world.events.on('weak_point_broken', (p) => broken.push(p as { id: string }));
    const closed: { id: string; hits: number }[] = [];
    world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));
    world.player.x = 10;
    world.player.z = 7;
    // 5발까지는 내구만 깎인다 — 파열 없음
    shootJoint(boss, 'joint_r', 5);
    expect(boss.weakHp!['joint_r']).toBeCloseTo(132 - 22 * 5, 5);
    expect(broken).toHaveLength(0);
    Enemies.tick(world, DT);
    expect(boss.bladeLock).toBeUndefined();
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(true);
    // 6발째 — 내구 0. 판정은 그 즉시 닫히고(weakPointOpen), Enemies 다음 틱에 파열 처리
    shootJoint(boss, 'joint_r', 1);
    expect(boss.weakHp!['joint_r']).toBe(0);
    expect(broken).toEqual([expect.objectContaining({ id: 'joint_r' })]);
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
    const before = boss.health;
    shootJoint(boss, 'joint_r', 1); // 파열한 관절은 몸통 0.8×
    expect(boss.health).toBeCloseTo(before - balance.weapons.pistol.damage * balance.weapons.pistol.hitZones.bodyMul, 5);
    expect(boss.timer).toBe(recoverAfterParry - 1);
    Enemies.tick(world, DT);
    expect(boss.ruptured).toEqual({ joint_r: true });
    expect(boss.bladeLock).toEqual({ r: 600 });
    expect(boss.lastBlade).toBe('r');
    // 비틀거림 — recover 60 (남은 튕김 경직 74 가 더 길면 그쪽) + 튕긴 자세
    expect(boss.ai).toBe('recover');
    expect(boss.timer).toBe(Math.max(recoverAfterParry - 2, balance.weakPoint.rupture.staggerTicks));
    expect(boss.recoiled).toBe(true);
    // 장부 — 노출은 파열 틱에 닫혀 명중 6 을 센다, 상태 이벤트는 rupture on 하나(절뚝은 아직)
    expect(closed).toEqual([expect.objectContaining({ id: 'joint_r', hits: 6 })]);
    expect(status.filter((st) => st.kind === 'rupture')).toEqual([
      expect.objectContaining({ kind: 'rupture', id: 'joint_r', blade: 'r', on: true, ticks: 600 }),
    ]);
    expect(status.some((st) => st.kind === 'limp')).toBe(false);
    expect(boss.limping ?? false).toBe(false);
    // 왼 관절은 멀쩡하다
    expect(boss.weakHp!['joint_l']).toBe(132);
  });

  it('파열 비틀거림은 자유 상태에서만 — 머리 내림(완벽 패링) 중 관절이 터지면 눈 창을 빼앗지 않고 낫만 잠근다', () => {
    const boss = makeBehemothSideShot();
    expect(perfectParry(boss)).toBe('perfect');
    expect(boss.pose).toBe('head_down');
    world.player.x = 10;
    world.player.z = 7;
    for (let i = 0; i < 10; i++) Enemies.tick(world, DT);
    shootJoint(boss, 'joint_r', 6);
    Enemies.tick(world, DT);
    expect(boss.bladeLock).toEqual({ r: 600 });
    expect(boss.pose).toBe('head_down');
    expect(boss.poseTicks).toBe(90 - 11);
    expect(weakPointOpen(boss, wp('eye'))).toBe(true);
    expect(boss.recoiled).toBe(false);
    // 낫 공격 예고 중에 터지면 예고가 끊긴다 — 잠긴 낫으로는 휘두르지 못한다
    const boss2 = makeBehemoth(4.0);
    world.enemies.splice(world.enemies.indexOf(boss), 1);
    world.player.x = 6;
    world.player.z = 6;
    tickEnemiesUntil(() => boss2.ai === 'windup', 60);
    expect(boss2.attackMode).toBe('melee');
    boss2.weakHp!['joint_r'] = 0; // 내구 0 (외부 경로)
    Enemies.tick(world, DT);
    expect(boss2.ai).toBe('recover');
    expect(boss2.timer).toBe(balance.weakPoint.rupture.staggerTicks - 1); // 파열 틱의 recover 가 한 틱 깎는다 — 60틱 뒤 chase
    expect(boss2.bladeLock).toEqual({ r: 600 });
    for (let i = 0; i < 58; i++) Enemies.tick(world, DT);
    expect(boss2.ai).toBe('recover');
    Enemies.tick(world, DT);
    expect(boss2.ai).toBe('chase');
  });

  it('잠긴 낫은 선택되지 않는다 — 오른낫 잠김 600틱 동안 낫 공격은 전부 왼낫(alt), 601틱 뒤 rupture off 와 함께 오른낫이 다시 나온다', () => {
    const boss = makeBehemoth(4.0);
    world.player.health = 1e6; // 관찰 중 죽지 않게 (Enemies 만 돌리므로 밀림은 적용되지 않는다)
    boss.chargeCooldown = 1e9; // 낫 선택만 본다
    boss.closeCooldown = 1e9;
    const status: { kind: string; on: boolean; blade?: string }[] = [];
    world.events.on('boss_status', (p) => status.push(p as { kind: string; on: boolean; blade?: string }));
    const modes: string[] = [];
    world.events.on('enemy_windup', () => modes.push(boss.attackMode ?? '?'));
    // 첫 낫은 오른낫 — 예고 시작 뒤 파열(외부 경로로 내구 0)
    tickEnemiesUntil(() => boss.ai === 'windup', 60);
    expect(modes).toEqual(['melee']);
    boss.weakHp!['joint_r'] = 0;
    Enemies.tick(world, DT);
    const lockedAt = world.tick; // (Enemies.tick 은 world.tick 을 세지 않으니 틱 수를 직접 센다)
    void lockedAt;
    expect(boss.bladeLock).toEqual({ r: 600 });
    expect(boss.ai).toBe('recover');
    // 잠김 600틱 동안 — 나가는 낫은 전부 왼낫
    let ticks = 0;
    for (; ticks < 599; ticks++) Enemies.tick(world, DT);
    expect(boss.bladeLock).toEqual({ r: 1 });
    expect(modes.length).toBeGreaterThan(3);
    expect(modes.slice(1).every((m) => m === 'alt')).toBe(true);
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false); // 관절 hp 는 그대로 0 — 갑각 재생(B2-6) 전엔 닫힌 채
    // 600틱째 — 해제
    Enemies.tick(world, DT);
    expect(boss.bladeLock).toEqual({});
    expect(status.filter((st) => st.kind === 'rupture').map((st) => `${st.blade}:${st.on}`)).toEqual(['r:true', 'r:false']);
    expect(boss.weakHp!['joint_r']).toBe(0);
    expect(boss.ruptured).toEqual({ joint_r: true }); // 다시 파열하지 않는다
    // 이후 — 교대가 돌아온다: 다음 낫들 중에 오른낫(melee)이 있다
    const n = modes.length;
    for (let i = 0; i < 400; i++) Enemies.tick(world, DT);
    expect(modes.slice(n)).toContain('melee');
    expect(modes.slice(n)).toContain('alt');
    expect(boss.ruptured).toEqual({ joint_r: true });
  });

  it('파열한 관절은 패링으로 다시 열리지 않는다 — 잠김 600 해제 뒤 그 낫 일반 패링: exposure 에 joint_r 없음·boss_status expose 없음·exposure_closed 없음(hp 는 갑각 재생 B2-6 까지 0). 완벽 패링은 head_down(눈)만 연다', () => {
    const boss = makeBehemoth(4.0);
    world.player.health = 1e6; // 관찰 중 죽지 않게 (Enemies 만 돌리므로 밀림은 적용되지 않는다)
    boss.chargeCooldown = 1e9; // 낫만 본다
    boss.closeCooldown = 1e9;
    // 오른낫 예고 중 파열(외부 경로로 내구 0) → 잠김 600 → 해제. 관절 hp 는 그대로 0
    tickEnemiesUntil(() => boss.ai === 'windup' && boss.attackMode === 'melee', 60);
    boss.weakHp!['joint_r'] = 0;
    Enemies.tick(world, DT);
    expect(boss.bladeLock).toEqual({ r: 600 });
    for (let i = 0; i < 600; i++) Enemies.tick(world, DT);
    expect(boss.bladeLock).toEqual({});
    expect(boss.weakHp!['joint_r']).toBe(0);
    // 이제부터 장부를 본다 — 파열 틱의 exposure_closed{joint_r} 는 그 전이다
    const status: { kind: string; on: boolean; id?: string }[] = [];
    world.events.on('boss_status', (p) => status.push(p as { kind: string; on: boolean; id?: string }));
    const closed: { id: string; hits: number }[] = [];
    world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));
    // 오른낫이 돌아오면 일반 패링 — 패링 자체는 성립(튕김)하지만 관절 노출은 세워지지 않는다
    tickEnemiesUntil(() => boss.ai === 'windup' && boss.attackMode === 'melee', 1200);
    expect(normalParry(boss)).toBe('normal');
    expect(boss.ai).toBe('recover');
    expect(boss.recoiled).toBe(true);
    expect(boss.exposure?.['joint_r']).toBeUndefined();
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
    expect(status.filter((st) => st.kind === 'expose')).toEqual([]);
    // 36틱이 지나도 닫힘 장부(exposure_closed{hits 0})가 나가지 않는다 — 노출 활용률 분모를 부풀리지 않는다
    for (let i = 0; i < 40; i++) Enemies.tick(world, DT);
    expect(closed.filter((c) => c.id === 'joint_r')).toEqual([]);
    expect(status.filter((st) => st.kind === 'expose')).toEqual([]);
    // 완벽 패링 — 머리 내림(눈)만 열리고 파열한 관절은 닫힌 채
    tickEnemiesUntil(() => boss.ai === 'windup' && boss.attackMode === 'melee', 1200);
    expect(perfectParry(boss)).toBe('perfect');
    expect(boss.pose).toBe('head_down');
    expect(weakPointOpen(boss, wp('eye'))).toBe(true);
    expect(boss.exposure?.['joint_r']).toBeUndefined();
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
    expect(status.filter((st) => st.kind === 'expose')).toEqual([]);
    expect(status.filter((st) => st.kind === 'head_down' && st.on)).toHaveLength(1);
    // 대조군 — 멀쩡한 왼 관절은 왼낫 패링에 평소처럼 열린다(같은 문, hp 132)
    for (let i = 0; i < 90; i++) Enemies.tick(world, DT);
    tickEnemiesUntil(() => boss.ai === 'windup' && boss.attackMode === 'alt', 1200);
    expect(normalParry(boss)).toBe('normal');
    expect(boss.exposure?.['joint_l']).toBe(36);
    expect(weakPointOpen(boss, wp('joint_l'))).toBe(true);
    expect(status.filter((st) => st.kind === 'expose')).toEqual([expect.objectContaining({ kind: 'expose', id: 'joint_l', on: true, ticks: 36 })]);
  });

  it('양 낫 잠김 → 절뚝(boss_status limp on): 낫이 안 나가고 2.5m 안이면 이속 ×0.65 로 물러나 2.5~6m 를 유지, 돌격 속도 ×0.7. 한쪽이 풀리면 limp off', () => {
    const boss = makeBehemoth(2.0); // 낫 사거리 안·들이받기 3.0m 안
    boss.closeCooldown = 1e9; // 들이받기를 빼고 물러서기만 본다
    boss.chargeCooldown = 1e9;
    const status: { kind: string; on: boolean }[] = [];
    world.events.on('boss_status', (p) => status.push(p as { kind: string; on: boolean }));
    const windups: unknown[] = [];
    world.events.on('enemy_windup', (p) => windups.push(p));
    boss.bladeLock = { r: 3000, l: 3000 }; // 관찰 내내 잠겨 있게
    Enemies.tick(world, DT);
    expect(boss.limping).toBe(true);
    expect(status).toEqual([expect.objectContaining({ kind: 'limp', on: true })]);
    // 물러난다 — 한 틱 이동량 = speed × 0.65 / 60
    const d0 = Math.hypot(boss.x - world.player.x, boss.z - world.player.z);
    Enemies.tick(world, DT);
    const d1 = Math.hypot(boss.x - world.player.x, boss.z - world.player.z);
    expect(d1 - d0).toBeCloseTo((def.speed * balance.weakPoint.limp.speedMul) / 60, 4);
    expect(boss.yaw).toBeCloseTo(Math.atan2(-(world.player.x - boss.x), -(world.player.z - boss.z)), 6); // 마주 본 채 뒷걸음
    // 2.5m 에 닿으면 멈춘다 — 그 뒤로는 제자리, 낫 예고는 한 번도 없다
    tickEnemiesUntil(() => Math.hypot(boss.x - world.player.x, boss.z - world.player.z) >= def.retreatWhenDisarmed!.min, 200);
    const x1 = boss.x;
    for (let i = 0; i < 60; i++) Enemies.tick(world, DT);
    expect(boss.x).toBe(x1);
    expect(boss.ai).toBe('chase');
    expect(windups).toHaveLength(0);
    // 4.4~6m — 다가오지 않는다(유지). 6m 밖 — 평소처럼 다가온다(절뚝 이속). 플레이어는 방 안쪽(+x, 벽은 x < 4)에 둔다
    world.player.x = boss.x + 5.0;
    for (let i = 0; i < 30; i++) Enemies.tick(world, DT);
    expect(boss.x).toBe(x1);
    world.player.x = boss.x + 8.0;
    const x2 = boss.x;
    const z2 = boss.z;
    Enemies.tick(world, DT);
    // 접근은 산개 편각(flank)이 붙으니 이동량 크기로 잰다
    expect(Math.hypot(boss.x - x2, boss.z - z2)).toBeCloseTo((def.speed * balance.weakPoint.limp.speedMul) / 60, 4);
    // 돌격(4.5~15m, 쿨다운 0) — 질주 속도도 ×0.7
    boss.chargeCooldown = 0;
    world.player.x = boss.x + 10;
    tickEnemiesUntil(() => boss.ai === 'charging', 200);
    expect(boss.attackMode).toBe('charge');
    const cx = boss.x;
    Enemies.tick(world, DT);
    expect(boss.x - cx).toBeCloseTo((def.chargeAttack!.chargeSpeed! * balance.weakPoint.limp.chargeSpeedMul) / 60, 4);
    // 왼낫 잠김이 먼저 풀리면 절뚝 해제
    boss.bladeLock = { r: 5, l: 1 };
    Enemies.tick(world, DT);
    expect(boss.bladeLock).toEqual({ r: 4 });
    expect(boss.limping).toBe(false);
    expect(status.filter((st) => st.kind === 'limp').map((st) => st.on)).toEqual([true, false]);
  });

  it('절뚝 중에도 들이받기(3.0m 안·쿨다운)는 나간다 — 낫만 빠진다. 절뚝이 아닌 한쪽 잠김은 물러서지 않는다', () => {
    const boss = makeBehemoth(2.4);
    boss.bladeLock = { r: 600, l: 600 };
    tickEnemiesUntil(() => boss.ai === 'windup', 60);
    expect(boss.attackMode).toBe('close');
    // 한쪽만 잠김 — 4.0m 에서 물러서지 않고 남은 낫으로 친다
    const boss2 = makeBehemoth(4.0);
    world.enemies.splice(world.enemies.indexOf(boss), 1);
    boss2.bladeLock = { l: 600 };
    const x0 = boss2.x;
    tickEnemiesUntil(() => boss2.ai === 'windup', 60);
    expect(boss2.x).toBe(x0);
    expect(boss2.attackMode).toBe('melee');
    // 족장은 아무것도 달라지지 않는다 — 장부가 생기지 않는다
    const chief = spawnEnemyAt('goblin_chieftain', 6 + 3, 6, 2);
    chief.ai = 'chase';
    world.enemies.splice(world.enemies.indexOf(boss2), 1);
    world.enemies.push(chief);
    for (let i = 0; i < 30; i++) Enemies.tick(world, DT);
    expect(chief.bladeLock).toBeUndefined();
    expect(chief.limping).toBeUndefined();
    expect(chief.ruptured).toBeUndefined();
  });

  it('완벽 회피 노출은 파열한 관절을 열지 않는다 — 오른 관절 hp 0 이면 왼 관절만 40틱', () => {
    const boss = makeBehemoth(10);
    boss.weakHp!['joint_r'] = 0;
    boss.ruptured = { joint_r: true };
    boss.bladeLock = { r: 600 };
    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    const cd = Enemies.contactDist(def);
    tickEnemiesUntil(() => Math.hypot(boss.x - world.player.x, boss.z - world.player.z) <= cd + 1.0, 300);
    world.player.iframeTicks = 1e9;
    world.player.iframeSource = 'dodge';
    tickEnemiesUntil(() => boss.pose === 'skid', 300);
    expect(boss.exposure).toEqual({ joint_l: 40 });
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
    expect(weakPointOpen(boss, wp('joint_l'))).toBe(true);
  });

  it('보스 포효 기상 반경 — alertRadius(18) 밖의 잠든 적은 함께 깨지 않는다', () => {
    const boss = spawnEnemyAt(TYPE, 6 + 8, 6, 1);
    boss.yaw = Math.atan2(-(6 - boss.x), -(6 - boss.z)); // 플레이어를 본다
    world.enemies.push(boss);
    const near = spawnEnemyAt('goblin_runner', 6 + 8 + 12, 6, 2); // 보스에서 12m — 안
    const far = spawnEnemyAt('goblin_runner', 6 + 8 + 20, 6, 3); // 보스에서 20m — 밖 (기본 45 라면 깼을 자리)
    near.yaw = -Math.PI / 2; // 등(+x)을 돌려 스스로는 못 알아챈다 (아군 거리도 aggroRange 밖)
    far.yaw = -Math.PI / 2;
    world.enemies.push(near, far);

    tickEnemiesUntil(() => boss.ai !== 'idle', 60);
    expect(near.ai).not.toBe('idle');
    expect(far.ai).toBe('idle');
  });

  describe('B2-5 돌격 눈멂·지형 충돌·기둥 P (기획서 §4.1 B·§5 blind/topple·§9.3)', () => {
    const wpc = balance.weakPoint;
    /** 레인 격자 16×6칸(안쪽 x 4~60 · z 4~20) — (row 3, col 5) = x 20~24 · z 12~16 에 문자 ch(기둥 P / 균열벽 C / 벽 #) */
    const laneGrid = (ch: string): string[] => ['################', '#S.............#', '#..............#', `#....${ch}.........#`, '#..............#', '################'];
    /** 긴 레인 24×6칸(안쪽 x 4~92) — 눈멂 오버런이 벽에 닿지 않고 끝나게 */
    const longGrid = (): string[] => ['#'.repeat(24), '#S' + '.'.repeat(21) + '#', '#' + '.'.repeat(22) + '#', '#' + '.'.repeat(22) + '#', '#' + '.'.repeat(22) + '#', '#'.repeat(24)];
    type Status = { kind: string; on: boolean; id?: string; ticks?: number; cause?: string; cell?: string; row?: number; col?: number };
    function placePlayer(x: number, z: number): void {
      const p = world.player;
      p.x = x;
      p.z = z;
      p.prevX = x;
      p.prevZ = z;
    }
    function placeBoss(x: number, z: number): EnemyState {
      const boss = spawnEnemyAt(TYPE, x, z, 1);
      boss.ai = 'chase';
      world.enemies.push(boss);
      return boss;
    }
    function watch() {
      const status: Status[] = [];
      world.events.on('boss_status', (p) => status.push(p as Status));
      const closed: { id: string; hits: number }[] = [];
      world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));
      const whiffs: { ticks: number; wall?: boolean }[] = [];
      world.events.on('enemy_whiffed', (p) => whiffs.push(p as { ticks: number; wall?: boolean }));
      const pillars: unknown[] = [];
      world.events.on('pillar_hit', (p) => pillars.push(p));
      const cracks: unknown[] = [];
      world.events.on('crack_wall_broken', (p) => cracks.push(p));
      const hits: { amount: number }[] = [];
      world.events.on('player_damaged', (p) => hits.push(p as { amount: number }));
      const tag = (st: Status): string => `${st.kind}${st.id ? ':' + st.id : ''}:${st.on}`;
      return { status, closed, whiffs, pillars, cracks, hits, tag };
    }
    const distTo = (boss: EnemyState): number => Math.hypot(boss.x - world.player.x, boss.z - world.player.z);
    /** 정면(경로 위)에서 권총 2발 — 눈 33×2 = 66 */
    function blindShots(boss: EnemyState): void {
      shootEye(boss);
      shootEye(boss);
    }
    /** 보스가 (bossX, z) 에서 질주에 들어가게 — 예고 시작은 visibleX 에서(시야선), 예고가 끝나기 전에 플레이어를 targetX 로 옮겨 그 자리를 겨누게 한다
     *  (돌격 목표는 예고 종료 좌표에 고정 — 기존 규칙). 겨눈 선(z 14)이 (row 3, col 5) 칸을 지나게 하는 데 쓴다 — z 를 주면 그 줄로 */
    function chargeToward(boss: EnemyState, visibleX: number, targetX: number, z = 14): void {
      placePlayer(visibleX, z);
      tickEnemiesUntil(() => boss.ai === 'windup' && boss.attackMode === 'charge', 300);
      placePlayer(targetX, z);
      tickEnemiesUntil(() => boss.ai === 'charging', 300);
      expect(boss.chargeTargetX).toBe(targetX);
      expect(boss.chargeTargetZ).toBe(z);
    }

    it('데이터 — blindRangeM 6·blindThreshold 66(권총 33×2)·blindOverrunTicks 40·chargeStuckTicks 2·headDown.toppleTicks 90, 돌격 wallWhiffRecoverTicks 60 < 헛돌격 90, 전도 튕김은 내려온 눈 구체가 벽면에서 사람 하나(0.8m) 이상 떨어지게. 족장·잡몹엔 없다(옛 경로)', () => {
      expect(wpc.blindRangeM).toBe(6);
      expect(wpc.blindThreshold).toBe(66);
      expect(balance.weapons.pistol.damage * wp('eye').damageMul * 2).toBeGreaterThanOrEqual(wpc.blindThreshold);
      expect(wpc.blindOverrunTicks).toBe(40);
      expect(wpc.chargeStuckTicks).toBe(2);
      expect(wpc.headDown.toppleTicks).toBe(90);
      const ch = def.chargeAttack!;
      expect(ch.wallWhiffRecoverTicks).toBe(60);
      expect(ch.wallWhiffRecoverTicks!).toBeLessThan(ch.whiffRecoverTicks!);
      // 튕김 — head_down 표의 눈 앞끝(−z + r)이 몸 반경(1.6) 보다 앞에 있는 만큼 + 플레이어 폭. 그대로면 눈 구체가 기둥 안에 묻힌다
      const eyeHd = def.poseOffsets!['head_down']!['eye']!;
      const protrude = -eyeHd.z + wp('eye').radius - def.radius;
      expect(protrude).toBeGreaterThan(0);
      expect(wpc.headDown.toppleReboundM).toBeGreaterThanOrEqual(protrude + balance.player.radius * 2);
      expect(wpc.headDown.toppleReboundTicks).toBeGreaterThan(0);
      expect(def.poseOffsets!['blind']!['eye']).toEqual({ x: 0, y: 1.2, z: -1.95 });
      // 족장 돌격엔 벽 헛돌격 필드가 없고 약점도 없다 — 지형 충돌·눈 노출 코드가 돌지 않는다
      expect(enemyDef('goblin_chieftain').chargeAttack!.wallWhiffRecoverTicks).toBeUndefined();
      expect(enemyDef('goblin_chieftain').weakPoints).toBeUndefined();
    });

    it('질주 중 6m 밖에서는 눈이 닫혀 있고 6m 안에 들면 열린다(expose eye, 표의 charge 자리 1.1m, 매 틱 되살아남) — 눈 66 → 눈멂: boss_status blind{ticks = 남은 질주 + 40}·pose blind(1.2m)·눈 닫힘(exposure_closed eye hits 2). 눈먼 거수는 겨눈 자리를 지나 yaw 그대로 직진, 일반 벽 # 에 박히면 헛돌격 60(wall)·전도 없음·눈 안 열림', () => {
      const boss = makeBehemoth(10); // (16,6) → 플레이어(6,6) 를 겨눈다
      const w = watch();
      tickEnemiesUntil(() => boss.ai === 'charging', 300);
      expect(boss.chargeTargetX).toBe(6);
      Enemies.tick(world, DT); // 9.75m — 밖
      expect(weakPointOpen(boss, wp('eye'))).toBe(false);
      expect(boss.exposure?.['eye']).toBeUndefined();
      tickEnemiesUntil(() => weakPointOpen(boss, wp('eye')), 60);
      expect(distTo(boss)).toBeLessThanOrEqual(wpc.blindRangeM + 1e-6);
      expect(distTo(boss)).toBeGreaterThan(wpc.blindRangeM - 0.3); // 들어온 그 틱
      expect(boss.pose).toBe('charge');
      expect(weakPointWorldPos(boss, def, wp('eye')).y).toBeCloseTo(1.1, 6);
      expect(w.status.map(w.tag)).toEqual(['expose:eye:true']);
      // 열린 채 다가온다 — 타이머는 매 틱 되살아나 닫히지 않는다
      for (let i = 0; i < 3; i++) Enemies.tick(world, DT);
      expect(weakPointOpen(boss, wp('eye'))).toBe(true);
      expect(w.closed).toHaveLength(0);
      expect(boss.blind ?? false).toBe(false);
      // 정면에서 권총 2발(33×2 = 66) → 다음 틱 눈멂. 혼절 쿨다운 중이어도 — 쿨다운은 머리 내림의 혼절 누적만 막는다(기획서 §5 blind)
      boss.dazeCooldown = wpc.dazeCooldownTicks;
      blindShots(boss);
      expect(boss.weakAccum!['eye']).toBe(66);
      const timerBefore = boss.timer;
      const yaw0 = boss.yaw;
      Enemies.tick(world, DT);
      expect(boss.blind).toBe(true);
      expect(boss.dazeCooldown).toBe(wpc.dazeCooldownTicks - 1); // 쿨다운은 그대로 흐른다 — 눈멂이 건드리지 않는다
      expect(boss.ai).toBe('charging');
      expect(boss.pose).toBe('blind');
      expect(weakPointWorldPos(boss, def, wp('eye')).y).toBeCloseTo(1.2, 6); // 표의 blind 자리(머리 휘저음은 Stage)
      expect(boss.timer).toBe(timerBefore - 1 + wpc.blindOverrunTicks);
      expect(weakPointOpen(boss, wp('eye'))).toBe(false); // 눈먼 눈은 표적이 아니다
      expect(w.closed).toEqual([{ enemyId: boss.id, enemyType: TYPE, id: 'eye', hits: 2 }]);
      expect(w.status.map(w.tag)).toEqual(['expose:eye:true', 'expose:eye:false', 'blind:true']);
      expect(w.status[2]!.ticks).toBe(boss.timer + 1);
      // 비켜 선다(경로 z 6 에서 4m — 접촉 2.15m 밖, 6m 안이지만 눈먼 뒤라 눈은 안 열린다). 거수는 겨눈 자리(6,6)를 지나 서쪽 벽까지 직진
      placePlayer(6, 10);
      tickEnemiesUntil(() => boss.ai !== 'charging', 200);
      expect(boss.yaw).toBe(yaw0); // 조향 없음
      expect(boss.x).toBeLessThan(6); // 겨눈 자리(몸 반경 1.6 안이면 멈췄을 x 7.6)를 지났다
      expect(boss.x).toBeCloseTo(4 + def.radius, 1); // 벽(x 4) 앞 몸 반경
      expect(boss.z).toBeCloseTo(6, 6);
      // 일반 벽 — 헛돌격 60(wallWhiffRecoverTicks), 박히지 않는다(전도 없음), 눈 안 열림
      expect(boss.ai).toBe('recover');
      expect(boss.whiffed).toBe(true);
      expect(boss.timer).toBe(def.chargeAttack!.wallWhiffRecoverTicks);
      expect(boss.pose).toBe('charge');
      expect(boss.poseTicks ?? 0).toBe(0);
      expect(boss.blind).toBe(false);
      expect(weakPointOpen(boss, wp('eye'))).toBe(false);
      expect(w.whiffs).toEqual([{ enemyId: boss.id, enemyType: TYPE, ticks: 60, wall: true }]);
      expect(w.status.map(w.tag)).toEqual(['expose:eye:true', 'expose:eye:false', 'blind:true', 'blind:false']);
      expect(w.pillars).toHaveLength(0);
      expect(w.hits).toHaveLength(0);
      expect(w.closed).toHaveLength(1); // 눈먼 뒤 4m 옆을 지나도 다시 열리지 않았다
      tickEnemiesUntil(() => boss.ai === 'chase', 120);
      Enemies.tick(world, DT);
      expect(boss.pose).toBeUndefined();
    });

    it('눈먼 돌격이 기둥 P 에 박히면 전도 — pillar_hit{row, col} + boss_status topple{cell P} + head_down 90(cause topple, 눈 0.9m 노출) + 뒤로 튕김(넉백 동안 포즈 시계 정지), 기둥은 남는다. 전도 중 눈 66 → 혼절(처형 창)', () => {
      world = makeWorld(laneGrid('P'));
      placePlayer(26, 14); // 기둥(x 20~24) 동쪽 2m 앞에 서서 거수를 부른다
      const boss = placeBoss(40, 14);
      const w = watch();
      tickEnemiesUntil(() => boss.ai === 'charging', 300);
      expect(boss.chargeTargetX).toBe(26);
      tickEnemiesUntil(() => weakPointOpen(boss, wp('eye')), 100);
      blindShots(boss);
      Enemies.tick(world, DT);
      expect(boss.blind).toBe(true);
      placePlayer(26, 9.5); // 마지막 순간 비켜 선다 — 거수는 서 있던 자리 뒤의 기둥으로 직진
      tickEnemiesUntil(() => boss.pose === 'head_down', 200);
      expect(boss.blind).toBe(false);
      expect(boss.ai).toBe('recover');
      expect(boss.whiffed).toBe(false);
      expect(boss.poseTicks).toBe(wpc.headDown.toppleTicks);
      expect(w.pillars).toEqual([{ enemyId: boss.id, enemyType: TYPE, row: 3, col: 5, x: 22, z: 14 }]);
      expect(w.status.find((st) => st.kind === 'topple')).toMatchObject({ on: true, ticks: 90, cell: 'P', row: 3, col: 5 });
      expect(w.status.find((st) => st.kind === 'head_down')).toMatchObject({ on: true, ticks: 90, cause: 'topple' });
      expect(w.status.map(w.tag)).toEqual(['expose:eye:true', 'expose:eye:false', 'blind:true', 'blind:false', 'topple:true', 'head_down:true']);
      expect(w.whiffs).toHaveLength(0);
      expect(w.cracks).toHaveLength(0);
      expect(weakPointOpen(boss, wp('eye'))).toBe(true);
      expect(weakPointWorldPos(boss, def, wp('eye')).y).toBeCloseTo(0.9, 6);
      expect(world.level.charAt(5, 3)).toBe('P'); // 내구 −1 은 B3 — 지금은 pillar_hit 만
      // 튕김 — 박힌 자리(기둥 면 x 24 + 몸 반경)에서 뒤로 toppleReboundM. 넉백 동안 포즈 시계는 멈춘다
      const hitX = boss.x;
      expect(hitX).toBeCloseTo(24 + def.radius, 1);
      expect(boss.kbTicks).toBe(wpc.headDown.toppleReboundTicks);
      for (let i = 0; i < wpc.headDown.toppleReboundTicks; i++) Enemies.tick(world, DT);
      expect(boss.x).toBeCloseTo(hitX + wpc.headDown.toppleReboundM, 1);
      expect(boss.z).toBeCloseTo(14, 6);
      expect(boss.poseTicks).toBe(wpc.headDown.toppleTicks);
      expect(boss.pose).toBe('head_down');
      // 눈 구체가 기둥 면(x 24) 밖 — 기둥 앞에 서서 정면으로 쏜다. 전도 중 눈 66 → 혼절(낫 박힘의 머리 내림과 같은 누적)
      const eye = weakPointWorldPos(boss, def, wp('eye'));
      expect(eye.x - wp('eye').radius).toBeGreaterThan(24 + balance.player.radius * 2);
      placePlayer(24 + balance.player.radius + 0.1, 14);
      blindShots(boss);
      Enemies.tick(world, DT);
      expect(boss.ai).toBe('staggered');
      expect(boss.dazed).toBe(true);
      expect(w.status.map(w.tag).slice(6)).toEqual(['head_down:false', 'daze:true']);
    });

    it('눈멂 없이도 돌격이 기둥에 박히면 전도(눈은 열리지 않았다) — 균열벽 C 에 박히면 전도 + 그 칸 개방(World.breakCrackWalls → crack_wall_broken, pillar_hit 없음)', () => {
      for (const cell of ['P', 'C'] as const) {
        world = makeWorld(laneGrid(cell));
        const boss = placeBoss(40, 14);
        const w = watch();
        chargeToward(boss, 26, 18); // 겨눈 선(z 14)이 (row 3, col 5) 를 지난다 — 플레이어는 기둥 뒤라 6m 안에 안 든다
        tickEnemiesUntil(() => boss.ai !== 'charging', 200);
        expect(boss.pose, cell).toBe('head_down');
        expect(boss.poseTicks, cell).toBe(wpc.headDown.toppleTicks);
        expect(boss.blind ?? false, cell).toBe(false);
        expect(w.status.map(w.tag), cell).toEqual(['topple:true', 'head_down:true']); // 눈은 한 번도 안 열렸다
        expect(w.status[0], cell).toMatchObject({ cell, row: 3, col: 5 });
        expect(w.whiffs, cell).toHaveLength(0);
        if (cell === 'P') {
          expect(w.pillars, cell).toHaveLength(1);
          expect(w.cracks, cell).toHaveLength(0);
          expect(world.level.charAt(5, 3)).toBe('P');
        } else {
          expect(w.pillars, cell).toHaveLength(0);
          expect(w.cracks, cell).toEqual([{ row: 3, col: 5, x: 22, z: 14 }]);
          expect(world.level.charAt(5, 3)).toBe('.'); // 열렸다 — 보물 벽감 루트(수류탄 대체)
          expect(world.level.solidAt(5, 3)).toBe(false);
        }
      }
    });

    it('기둥 모서리를 0.2m 만 스쳐 막힌 질주(레인 z 16 + 1.4 = 17.4, 몸 z 15.8~19 vs 기둥 z 12~16)도 전도 — 선두 면 너머를 몸 폭 전체로 읽는다(pillar_hit·topple·head_down 90). 레이 몇 줄 탐침은 기둥 옆을 지나 벽을 못 찾고 질주 시간이 다할 때까지 굳어 있었다(2026-09-06 검토)', () => {
      world = makeWorld(laneGrid('P'));
      const boss = placeBoss(40, 17.4);
      const w = watch();
      chargeToward(boss, 26, 18, 17.4); // 겨눈 선 z 17.4 — 몸 남쪽 가장자리(15.8)가 기둥(z ≤ 16)을 0.2m 겹친다
      tickEnemiesUntil(() => boss.ai !== 'charging', 200);
      expect(boss.x).toBeCloseTo(24 + def.radius, 1); // 기둥 면(x 24) 앞 몸 반경에 막혔다
      expect(boss.z).toBeCloseTo(17.4, 6);
      expect(boss.pose).toBe('head_down');
      expect(boss.poseTicks).toBe(wpc.headDown.toppleTicks);
      expect(boss.ai).toBe('recover');
      expect(boss.whiffed).toBe(false);
      expect(w.pillars).toEqual([{ enemyId: boss.id, enemyType: TYPE, row: 3, col: 5, x: 22, z: 14 }]);
      expect(w.status.map(w.tag)).toEqual(['topple:true', 'head_down:true']);
      expect(w.status[0]).toMatchObject({ cell: 'P', row: 3, col: 5, ticks: 90 });
      expect(w.status[1]).toMatchObject({ cause: 'topple', ticks: 90 });
      expect(w.whiffs).toHaveLength(0);
      expect(w.cracks).toHaveLength(0);
      expect(boss.kbTicks).toBe(wpc.headDown.toppleReboundTicks); // 튕김 — 기둥 모서리에서도 같다
    });

    it('벽이 아닌 것(소품 AABB — 아군·잔해도 같다)에 막혀 선 질주는 뒤 기둥에 박힌 것으로 오판하지 않는다 — 선두 면 바로 너머(SKIN + 0.01m)의 칸만 읽으니 소품 두께만큼 먼 기둥은 없다(전도·pillar_hit·벽 헛돌격 없음, 질주 시간이 다한 뒤 보통 헛돌격 90)', () => {
      world = makeWorld(laneGrid('P'));
      // 기둥 동쪽 면(x 24) 앞 0.2m 에 두께 0.5m 소품 — 몸은 소품에 막혀 x 26.3 에 서고, 진행 방향 2.3m 앞에 기둥 면이 있다(옛 레이 탐지 폭 반경 + 반 칸 3.6m 안)
      world.level.props.push({ minX: 24.2, maxX: 24.7, minZ: 12, maxZ: 16 });
      const boss = placeBoss(40, 14);
      const w = watch();
      chargeToward(boss, 26, 18);
      tickEnemiesUntil(() => boss.ai !== 'charging', 200);
      expect(boss.x).toBeCloseTo(24.7 + def.radius, 1); // 소품 앞에 섰다
      expect(boss.z).toBeCloseTo(14, 6);
      expect(boss.pose).toBe('charge');
      expect(boss.poseTicks ?? 0).toBe(0);
      expect(w.pillars).toHaveLength(0);
      expect(w.status).toHaveLength(0); // 전도·머리 내림 없음
      expect(world.level.charAt(5, 3)).toBe('P');
      // 질주 시간이 다해 impact(지형 충돌이면 곧장 recover 였다) → 다음 틱 플레이어를 놓친 보통 헛돌격(wall 없음, whiffRecoverTicks 90)
      expect(boss.ai).toBe('impact');
      Enemies.tick(world, DT);
      expect(boss.ai).toBe('recover');
      expect(boss.whiffed).toBe(true);
      expect(boss.timer).toBe(def.chargeAttack!.whiffRecoverTicks);
      expect(w.whiffs).toEqual([{ enemyId: boss.id, enemyType: TYPE, ticks: def.chargeAttack!.whiffRecoverTicks }]);
    });

    it('일반 벽 # 에 박히면(눈멂 없이) 헛돌격 60(enemy_whiffed{wall}) — 박히지 않고 눈도 안 열린다. 잡몹·족장 돌격은 지형 충돌 코드가 돌지 않는다', () => {
      world = makeWorld(laneGrid('#'));
      const boss = placeBoss(40, 14);
      const w = watch();
      chargeToward(boss, 26, 18);
      tickEnemiesUntil(() => boss.ai !== 'charging', 200);
      expect(boss.ai).toBe('recover');
      expect(boss.whiffed).toBe(true);
      expect(boss.timer).toBe(60);
      expect(boss.pose).toBe('charge');
      expect(boss.poseTicks ?? 0).toBe(0);
      expect(weakPointOpen(boss, wp('eye'))).toBe(false);
      expect(boss.x).toBeCloseTo(24 + def.radius, 1);
      expect(w.whiffs).toEqual([{ enemyId: boss.id, enemyType: TYPE, ticks: 60, wall: true }]);
      expect(w.status).toHaveLength(0);
      expect(w.pillars).toHaveLength(0);
      // 족장 — 같은 레인에서 같은 벽으로 달려도 옛 경로: 질주 시간이 다한 뒤 impact(헛돌격 whiffRecoverTicks), wall 표식 없음, chargeStuck 장부 없음
      world = makeWorld(laneGrid('#'));
      const chief = spawnEnemyAt('goblin_chieftain', 40, 14, 2);
      chief.ai = 'chase';
      world.enemies.push(chief);
      const w2 = watch();
      const chDef = enemyDef('goblin_chieftain');
      placePlayer(40 - (chDef.chargeAttack!.maxRange! - 1), 14);
      tickEnemiesUntil(() => chief.ai === 'windup' && chief.attackMode === 'charge', 400);
      placePlayer(18, 14);
      tickEnemiesUntil(() => chief.ai === 'charging', 300);
      tickEnemiesUntil(() => chief.ai !== 'charging', 400);
      expect(chief.chargeStuck).toBeUndefined();
      expect(w2.whiffs.every((wf) => wf.wall === undefined)).toBe(true);
      expect(w2.status).toHaveLength(0);
    });

    it('눈먼 돌격도 접촉하면 그대로 — 45 + 7m 밀림 + 진탕, 그 자리에서 눈멂 해제(blind off). 회피 무적 접촉이면 완벽 회피(미끄러짐)가 눈멂보다 우선', () => {
      // 접촉
      let boss = makeBehemoth(10);
      let w = watch();
      tickEnemiesUntil(() => boss.ai === 'charging', 300);
      tickEnemiesUntil(() => weakPointOpen(boss, wp('eye')), 60);
      blindShots(boss);
      Enemies.tick(world, DT);
      expect(boss.blind).toBe(true);
      tickEnemiesUntil(() => boss.ai === 'recover', 200); // 경로 위에 그대로 서 있다
      expect(w.hits).toHaveLength(1);
      expect(w.hits[0]!.amount).toBe(def.chargeAttack!.damage);
      expect(world.player.concussionTicks).toBe(balance.status.concussion.ticks);
      expect(world.player.kbTicks).toBe(def.chargeAttack!.playerKnockbackTicks);
      expect(boss.whiffed).toBe(false);
      expect(boss.blind).toBe(false);
      expect(boss.pose).toBe('charge');
      expect(w.status.map(w.tag)).toEqual(['expose:eye:true', 'expose:eye:false', 'blind:true', 'blind:false']);
      // 완벽 회피 우선 — 눈먼 채 달려와도 무적 8틱 안 접촉이면 미끄러짐 + 양 관절
      world = makeWorld();
      boss = makeBehemoth(10);
      w = watch();
      tickEnemiesUntil(() => boss.ai === 'charging', 300);
      tickEnemiesUntil(() => weakPointOpen(boss, wp('eye')), 60);
      blindShots(boss);
      Enemies.tick(world, DT);
      expect(boss.blind).toBe(true);
      const cd = Enemies.contactDist(def);
      tickEnemiesUntil(() => distTo(boss) <= cd + 1.0, 300);
      world.player.iframeTicks = balance.reaction.dodgeIFrameTicks;
      world.player.iframeSource = 'dodge';
      for (let i = 0; i < 300 && boss.ai !== 'recover'; i++) {
        Enemies.tick(world, DT);
        Reaction.tick(world, DT);
      }
      expect(w.hits).toHaveLength(0);
      expect(boss.pose).toBe('skid');
      expect(boss.blind).toBe(false);
      expect(boss.exposure).toEqual({ joint_r: 40, joint_l: 40 });
      expect(w.status.map(w.tag)).toEqual(['expose:eye:true', 'expose:eye:false', 'blind:true', 'blind:false', 'expose:joint_r:true', 'expose:joint_l:true', 'skid:true']);
    });

    it('눈멂인데 아무것도 안 부딛히면 — 남은 질주 + 40틱 오버런을 겨눈 자리 너머로 달린 뒤 헛돌격 90(wall 아님), 관절·눈 안 열림', () => {
      world = makeWorld(longGrid());
      placePlayer(56, 14);
      const boss = placeBoss(70, 14);
      const w = watch();
      tickEnemiesUntil(() => boss.ai === 'charging', 300);
      expect(boss.chargeTargetX).toBe(56);
      tickEnemiesUntil(() => weakPointOpen(boss, wp('eye')), 100);
      blindShots(boss);
      Enemies.tick(world, DT);
      expect(boss.blind).toBe(true);
      const left = boss.timer; // 남은 질주(오버런 포함)
      const x0 = boss.x;
      placePlayer(56, 9.5); // 비켜 선다
      tickEnemiesUntil(() => boss.ai === 'recover', 300); // 시간이 다하면 impact → 헛돌격
      expect(boss.ai).toBe('recover');
      expect(boss.whiffed).toBe(true);
      expect(boss.timer).toBe(def.chargeAttack!.whiffRecoverTicks); // 벽이 아니라 시간이 다한 헛돌격
      expect(w.whiffs).toEqual([{ enemyId: boss.id, enemyType: TYPE, ticks: 90 }]);
      const speed = def.chargeAttack!.chargeSpeed! * DT;
      // 오버런 끝까지 달렸다 — 눈을 맞힌 피탄 움찔(pistol.flinchTicks, 눈멂 틱에 이미 1 소진)만큼은 발이 묶여 그만큼 덜 간다(기존 규칙 — 타이머는 그대로 흐른다)
      const flinchLeft = balance.weapons.pistol.flinchTicks - 1;
      expect(x0 - boss.x).toBeCloseTo((left - flinchLeft) * speed, 1);
      expect(boss.x).toBeLessThan(56 - def.radius); // 겨눈 자리를 지나쳤다(눈이 보였으면 거기서 멈췄을 것)
      expect(boss.pose).toBe('charge');
      expect(boss.poseTicks ?? 0).toBe(0);
      expect(boss.exposure ?? {}).toEqual({});
      expect(w.status.map(w.tag)).toEqual(['expose:eye:true', 'expose:eye:false', 'blind:true', 'blind:false']);
      expect(w.pillars).toHaveLength(0);
      expect(w.hits).toHaveLength(0);
    });
  });

  describe('B2-6 페이즈 골격 (기획서 §8 — boss_phase·phaseTarget 큐잉·phase_shift 갑각 재생·phases[] 덮어쓰기)', () => {
    const wpc = balance.weakPoint;
    const perBar = def.health / def.healthBars!; // 500
    type Phase = { phase: number; from: number; skipped: boolean; fromTicks: number; name?: string; shiftText?: string };
    type Status = { kind: string; on: boolean; id?: string; blade?: string; ticks?: number; phase?: number; from?: number };
    function watch() {
      const phases: Phase[] = [];
      world.events.on('boss_phase', (p) => phases.push(p as Phase));
      const status: Status[] = [];
      world.events.on('boss_status', (p) => status.push(p as Status));
      const sheds: { count: number }[] = [];
      world.events.on('plate_shed', (p) => sheds.push(p as { count: number }));
      const closed: { id: string; hits: number }[] = [];
      world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));
      const hits: { amount: number }[] = [];
      world.events.on('player_damaged', (p) => hits.push(p as { amount: number }));
      const tag = (st: Status): string => `${st.kind}${st.id ? ':' + st.id : ''}:${st.on}`;
      return { phases, status, sheds, closed, hits, tag };
    }
    /** 머리 내림(완벽 패링) 창을 연다 — 큐잉 시험의 '창' */
    function openHeadDown(boss: EnemyState): void {
      expect(perfectParry(boss)).toBe('perfect');
      expect(boss.pose).toBe('head_down');
      expect(boss.poseTicks).toBe(wpc.headDown.stuckTicks);
    }

    it('데이터 — phases 3칸(bar 3·2·1, 이름 돌각·오염 갑각·광란), P2 해금·돌격 쿨 360, P3 이속 ×1.2·낫 34·들이받기 24·돌격 50/300·발구르기 28/5.5, phaseShiftTicks 90·쿨다운 배율 0.5. 누적 합치기(resolvePhase)·해금 판정(slotUnlocked)·스포너 초기 phase 3, 족장엔 없다', () => {
      const ph = def.phases!;
      expect(ph.map((x) => x.bar)).toEqual([3, 2, 1]);
      expect(ph.map((x) => x.name)).toEqual(['돌각', '오염 갑각', '광란']);
      expect(ph[1]!.unlock).toEqual(['slam', 'volley', 'wakeSlam']);
      expect(ph[1]!.poolsOn).toBe(true);
      expect(ph[1]!.shellPlatesOn).toBe(true);
      expect(ph[1]!.attackOverrides).toEqual({ charge: { cooldownTicks: 360 } });
      expect(ph[1]!.shiftText).toBe('갑각이 갈라진다');
      expect(ph[2]!.speedMul).toBe(1.2);
      expect(ph[2]!.unlock).toEqual(['roar', 'combo', 'chainCharge']);
      expect(ph[2]!.shedPlates).toBe(true);
      expect(ph[2]!.firstPick).toBe('roar');
      expect(ph[2]!.shiftText).toBe('거수가 광란한다');
      expect(ph[2]!.attackOverrides).toEqual({
        attack: { damage: 34 }, attackAlt: { damage: 34 }, close: { damage: 24 }, charge: { damage: 50, cooldownTicks: 300 }, slam: { damage: 28, aoeRadius: 5.5 },
      });
      expect(wpc.phaseShiftTicks).toBe(90);
      expect(wpc.phaseShiftCooldownMul).toBe(0.5);
      // 누적 — P3 는 P2 의 해금·갑각판을 그대로 갖고 같은 키는 P3 가 덮는다(돌격 쿨 360 → 300)
      const p1 = resolvePhase(def, 3)!;
      const p2 = resolvePhase(def, 2)!;
      const p3 = resolvePhase(def, 1)!;
      expect(p1.speedMul).toBe(1);
      expect([...p1.unlock]).toEqual([]);
      expect(p1.attackOverrides).toEqual({});
      expect(p1.shellPlatesOn).toBe(false);
      expect(p2.attackOverrides['charge']).toEqual({ cooldownTicks: 360 });
      expect(p2.unlock.has('volley')).toBe(true);
      expect(p2.unlock.has('roar')).toBe(false);
      expect(p2.shiftText).toBe('갑각이 갈라진다');
      expect(p3.speedMul).toBe(1.2);
      expect(p3.unlock.has('volley')).toBe(true);
      expect(p3.unlock.has('roar')).toBe(true);
      expect(p3.attackOverrides['charge']).toEqual({ damage: 50, cooldownTicks: 300 });
      expect(p3.shellPlatesOn).toBe(true);
      expect(p3.shedPlates).toBe(true);
      expect(p3.name).toBe('광란');
      expect(p3.shiftText).toBe('거수가 광란한다');
      expect(resolvePhase(def, undefined)).toBeUndefined();
      // 해금 — 어느 페이즈에도 안 적힌 슬롯(attack·charge·close)은 늘 열려 있고 volley 는 P2 부터. 표가 없는 족장은 늘 참
      expect(slotUnlocked(def, { phase: 3 }, 'volley')).toBe(false);
      expect(slotUnlocked(def, { phase: 2 }, 'volley')).toBe(true);
      expect(slotUnlocked(def, { phase: 3 }, 'attack')).toBe(true);
      expect(slotUnlocked(def, { phase: 3 }, 'charge')).toBe(true);
      expect(slotUnlocked(def, { phase: 3 }, 'roar')).toBe(false);
      expect(slotUnlocked(def, { phase: 1 }, 'roar')).toBe(true);
      expect(slotUnlocked(enemyDef('goblin_chieftain'), {}, 'volley')).toBe(true);
      // 스포너 — 첫 칸(3)으로 태어난다. 족장·어미 슬라임은 페이즈가 없다(체력 칸은 표시만)
      expect(spawnEnemyAt(TYPE, 0, 0, 1).phase).toBe(3);
      expect(enemyDef('goblin_chieftain').phases).toBeUndefined();
      expect(spawnEnemyAt('goblin_chieftain', 0, 0, 1).phase).toBeUndefined();
      // 덮어쓰기 없는 슬롯·페이즈는 원본 객체 그대로(항등 비교하는 옛 코드가 있어도 안전)
      expect(currentAttack(def, { attackMode: 'melee', phase: 3 })).toBe(def.attack);
      expect(currentAttack(def, { attackMode: 'charge', phase: 3 })).toBe(def.chargeAttack);
      expect(currentAttack(def, { attackMode: 'charge', phase: 2 })).not.toBe(def.chargeAttack);
      expect(currentAttack(def, { attackMode: 'charge', phase: 2 }).cooldownTicks).toBe(360);
      expect(currentAttack(def, { attackMode: 'charge', phase: 2 }).damage).toBe(45);
      expect(currentAttack(def, { attackMode: 'charge', phase: 2 })).toBe(currentAttack(def, { attackMode: 'charge', phase: 2 })); // 캐시
      expect(currentAttack(def, { attackMode: 'melee', phase: 1 }).damage).toBe(34);
      expect(currentAttack(def, { attackMode: 'alt', phase: 1 }).damage).toBe(34);
      expect(currentAttack(def, { attackMode: 'alt', phase: 1 }).windupTicks).toBe(28); // 나머지 필드는 그대로
      expect(currentAttack(def, { attackMode: 'close', phase: 1 }).damage).toBe(24);
      expect(currentAttack(def, { attackMode: 'charge', phase: 1 }).damage).toBe(50);
      expect(currentAttack(def, { attackMode: 'charge', phase: 1 }).cooldownTicks).toBe(300);
      const chief = enemyDef('goblin_chieftain');
      expect(currentAttack(chief, { attackMode: 'melee' })).toBe(chief.attack);
    });

    it('칸 경계 전환 — 추격 중 체력이 1000(3칸째 비움)에 닿는 틱에 boss_phase{phase 2, from 3} 한 번 + phase_shift: recover 90·pose roar·molting(약점 전부 닫힘), 90틱 뒤 chase 복귀 + molt off. 1001 에선 아무 일도 없다', () => {
      const boss = makeBehemoth(10);
      boss.chargeCooldown = 9999; // 돌격이 끼어들지 않게 — 걷기만
      boss.volleyCooldown = 9999; // P2 복귀 뒤 10m 는 갑각 떨기(B3-2, ≥ 6m) 거리다 — 여기선 걷기만 본다
      const w = watch();
      Enemies.tick(world, DT);
      expect(boss.phase).toBe(3);
      expect(boss.phaseSince).toBeDefined();
      boss.health = perBar * 2 + 1; // 1001 — 아직 3칸째
      Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(0);
      expect(boss.phase).toBe(3);
      expect(boss.phaseTarget).toBeUndefined();
      expect(resolvePhase(def, boss.phase)!.name).toBe('돌각');
      // 노출 하나 열어 두고(눈 타이머 — 돌격 중 눈과 같은 문) — 전환이 닫아야 한다. 관절 타이머 노출은 전환을 기다리게 하므로(B3-6, 아래 별도 케이스) 여기선 눈으로
      openExposure(world, boss, 'eye', 50);
      expect(weakPointOpen(boss, wp('eye'))).toBe(true);
      const t0 = world.tick;
      boss.health = perBar * 2; // 1000 — 칸이 빈다
      Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(1);
      expect(w.phases[0]).toMatchObject({ phase: 2, from: 3, skipped: false, name: '오염 갑각', shiftText: '갑각이 갈라진다' });
      expect(boss.phase).toBe(2);
      expect(boss.phaseTarget).toBeUndefined();
      expect(boss.ai).toBe('recover');
      expect(boss.pose).toBe('roar');
      expect(boss.molting).toBe(true);
      expect(boss.poseTicks).toBe(wpc.phaseShiftTicks - 1); // 전환 틱에 포즈 시계가 한 번 돈다
      expect(boss.exposure?.['eye']).toBeUndefined();
      expect(w.closed.map((c) => c.id)).toEqual(['eye']);
      expect(w.status.map(w.tag)).toEqual(['expose:eye:true', 'expose:eye:false', 'molt:true']);
      expect(w.status[2]).toMatchObject({ kind: 'molt', on: true, ticks: 90, phase: 2, from: 3 });
      expect(resolvePhase(def, boss.phase)!.name).toBe('오염 갑각');
      // 약점 전부 닫힘 — 타이머를 억지로 세워도 판정이 없다(포효 자세라도 눈은 표적이 아니다)
      boss.exposure = { joint_r: 30 };
      expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
      expect(weakPointOpen(boss, wp('eye'))).toBe(false);
      delete boss.exposure['joint_r'];
      // 무적은 아니다 — 몸통 사격이 들어간다
      const hpBefore = boss.health;
      shootAt(boss.x, 1.6, boss.z);
      expect(boss.health).toBeLessThan(hpBefore);
      // 전환 동안은 움직이지도 공격하지도 않는다
      const x0 = boss.x;
      tickEnemiesUntil(() => boss.ai === 'chase', 200);
      expect(world.tick - t0).toBe(0); // world.tick 은 Loop 이 올린다 — 여기선 틱 수를 poseTicks 로 잰다
      expect(boss.x).toBe(x0);
      expect(boss.pose).toBeUndefined();
      expect(boss.molting).toBe(false);
      expect(boss.poseTicks ?? 0).toBe(0);
      expect(w.status.map(w.tag).slice(3)).toEqual(['molt:false']);
      expect(w.phases).toHaveLength(1);
      expect(boss.phase).toBe(2);
      // 복귀 뒤 다시 걷는다
      Enemies.tick(world, DT);
      expect(boss.x).toBeLessThan(x0);
    });

    it('전환은 진행 중 공격을 취소한다 — 낫 예고 중 칸이 비면 그 틱에 예고가 끊기고 포효(attackMode melee·strikeProgress 0), 돌격 예고도 같다(chargeCooldown 은 절반으로)', () => {
      const boss = makeBehemoth(4.0);
      const w = watch();
      tickEnemiesUntil(() => boss.ai === 'windup');
      boss.health = perBar * 2;
      Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(1);
      expect(boss.ai).toBe('recover');
      expect(boss.pose).toBe('roar');
      expect(boss.attackMode).toBe('melee');
      expect(boss.strikeProgress).toBe(0);
      tickEnemiesUntil(() => boss.ai === 'chase', 200);
      expect(w.hits).toHaveLength(0); // 끊긴 낫은 닿지 않았다
      // 돌격 예고 중 — 두 번째 경계(500). 플레이어를 10m 뒤(+x, 경기장 안쪽)로 물린다
      world.player.x = boss.x + 10;
      world.player.prevX = world.player.x;
      boss.closeCooldown = 0;
      tickEnemiesUntil(() => boss.ai === 'windup' && boss.attackMode === 'charge', 400);
      const cdBefore = boss.chargeCooldown!;
      expect(cdBefore).toBe(360); // P2 돌격 쿨(attackOverrides.charge.cooldownTicks) — 선택 순간에 물린다
      boss.health = perBar;
      Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(2);
      expect(w.phases[1]).toMatchObject({ phase: 1, from: 2, skipped: false });
      expect(boss.attackMode).toBe('melee');
      expect(boss.ai).toBe('recover');
      expect(boss.pose).toBe('roar');
      expect(boss.chargeCooldown).toBe(Math.round(cdBefore * wpc.phaseShiftCooldownMul) - 1); // 절반, 그 뒤 전환 틱의 감소 1
      expect(boss.chargeTargetX).toBeUndefined();
    });

    it('관절 타이머 노출도 전환을 막는다(B2-6 잔여 메모 → B3-6) — 일반 패링으로 joint_r 36틱을 연 채 칸이 비면 phaseTarget 만 갱신, 타이머가 다해 닫히는 틱(exposure_closed 는 소진 — 전환이 빼앗은 게 아니다)에 전환. 눈·분출공의 되살리는 타이머는 관절이 아니라 막지 않는다', () => {
      const boss = makeBehemoth(4.0);
      const w = watch();
      expect(normalParry(boss)).toBe('normal');
      expect(boss.exposure?.['joint_r']).toBe(def.attack.exposeOnParry!.normalTicks);
      // 패링 반동(넉백)이 끝나 그 밖의 막는 창이 없을 때까지
      tickEnemiesUntil(() => (boss.kbTicks ?? 0) === 0 && boss.ai !== 'staggered', 30);
      expect((boss.exposure?.['joint_r'] ?? 0)).toBeGreaterThan(10);
      boss.health = perBar * 2; // 3칸째가 빈다
      Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(0);
      expect(boss.phaseTarget).toBe(2);
      expect(boss.phase).toBe(3);
      let waited = 1;
      while (w.phases.length === 0 && waited < 80) {
        // 노출이 살아 있는 동안은 전환이 없다
        expect((boss.exposure?.['joint_r'] ?? 0)).toBeGreaterThan(0);
        Enemies.tick(world, DT);
        waited++;
      }
      expect(w.phases).toHaveLength(1);
      expect(w.phases[0]).toMatchObject({ phase: 2, from: 3 });
      expect(waited).toBeLessThanOrEqual(def.attack.exposeOnParry!.normalTicks + 2);
      expect(w.closed.find((c) => c.id === 'joint_r')).toMatchObject({ id: 'joint_r', hits: 0 }); // 소진으로 닫혔다(전환의 '노출 전부 닫힘' 이 아니라도 결과는 같다)
      expect(boss.exposure?.['joint_r'] ?? 0).toBe(0);
      expect(boss.pose).toBe('roar');
      // 대조 — 돌격 질주 중 6m 안 눈 노출(되살리는 타이머)은 전환을 막지 않는다: 질주 중 칸이 비면 그 틱에 전환·질주 취소
      tickEnemiesUntil(() => boss.ai === 'chase', 200);
      world.player.x = boss.x + 10;
      world.player.prevX = world.player.x;
      boss.chargeCooldown = 0;
      boss.closeCooldown = 9999;
      tickEnemiesUntil(() => boss.ai === 'charging', 400);
      tickEnemiesUntil(() => (boss.exposure?.['eye'] ?? 0) > 0, 80);
      boss.health = perBar;
      Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(2);
      expect(boss.ai).toBe('recover');
    });

    it('큐잉 — 머리 내림(완벽 패링)·혼절(처형 창)·처형 넉백 중에 칸이 비면 phaseTarget 만 갱신하고 발동하지 않는다(눈 창·처형 창을 빼앗지 않는다). 넉백이 끝나 자유로워지는 틱에 한 번만 전환', () => {
      const boss = makeBehemoth(4.0);
      const w = watch();
      openHeadDown(boss);
      boss.health = perBar * 2; // 칸이 비었지만 창 안
      for (let i = 0; i < 20; i++) Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(0);
      expect(boss.phase).toBe(3);
      expect(boss.phaseTarget).toBe(2);
      expect(boss.pose).toBe('head_down'); // 창은 그대로
      expect(weakPointOpen(boss, wp('eye'))).toBe(true);
      expect(resolvePhase(def, boss.phase)!.name).toBe('돌각'); // HUD 페이즈명도 아직 이전 것
      // 눈 66 → 혼절(처형 창) — 여전히 발동하지 않는다
      shootEye(boss);
      shootEye(boss);
      Enemies.tick(world, DT);
      expect(boss.ai).toBe('staggered');
      for (let i = 0; i < 30; i++) Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(0);
      expect(boss.phaseTarget).toBe(2);
      // 처형 — 240 이 들어가고 6.5m 넉백. 넉백 동안도 발동하지 않고, 넉백이 끝난 뒤 첫 자유 틱에 한 번
      pressReaction();
      expect(boss.health).toBeCloseTo(perBar * 2 - 240 - 66, 5); // 눈 33×2 + 처형 240 — 아직 2칸째(694 > 500)
      expect(boss.kbTicks).toBe(balance.reaction.executeKnockbackTicks);
      let firedWithKb = false;
      let ticksToFire = 0;
      for (let i = 0; i < 200 && w.phases.length === 0; i++) {
        const kbBefore = (boss.kbTicks ?? 0) > 0;
        Enemies.tick(world, DT);
        ticksToFire++;
        if (w.phases.length > 0 && kbBefore) firedWithKb = true;
      }
      expect(w.phases).toHaveLength(1);
      expect(firedWithKb).toBe(false); // 넉백 마지막 틱까지는 발동하지 않는다
      expect(boss.kbTicks ?? 0).toBe(0);
      expect(ticksToFire).toBeGreaterThan(balance.reaction.executeKnockbackTicks); // 처형 연출 정지(executeFocusTicks) + 넉백 뒤
      expect(w.phases[0]).toMatchObject({ phase: 2, from: 3, skipped: false });
      expect(boss.phase).toBe(2);
      expect(boss.phaseTarget).toBeUndefined();
      expect(boss.pose).toBe('roar');
      // 혼절 쿨다운(플레이어 쪽 박자)은 절반이 되지 않는다 — 처형 뒤 흐른 틱만큼만 줄었다
      expect(boss.dazeCooldown!).toBeGreaterThan(wpc.dazeCooldownTicks * wpc.phaseShiftCooldownMul);
      expect(boss.dazeCooldown!).toBeGreaterThanOrEqual(wpc.dazeCooldownTicks - ticksToFire);
      tickEnemiesUntil(() => boss.ai === 'chase', 200);
      expect(w.phases).toHaveLength(1);
    });

    it('2단 건너뜀 — 한 창(머리 내림) 안에서 두 경계를 넘으면(1500 → 400) 한 번의 전환으로 P3: boss_phase{phase 1, from 3, skipped true}, 연출은 P3 것(plate_shed·문구 광란), P2 의 해금·덮어쓰기도 누적. 이속 ×1.2 는 걷기에만', () => {
      const boss = makeBehemoth(4.0);
      const w = watch();
      openHeadDown(boss);
      boss.health = perBar - 100; // 400 — 1칸째
      for (let i = 0; i < 10; i++) Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(0);
      expect(boss.phaseTarget).toBe(1);
      tickEnemiesUntil(() => boss.pose === 'roar', 120);
      expect(w.phases).toHaveLength(1);
      expect(w.phases[0]).toMatchObject({ phase: 1, from: 3, skipped: true, name: '광란', shiftText: '거수가 광란한다' });
      expect(boss.phase).toBe(1);
      expect(w.sheds).toHaveLength(1); // 등갑판 탈락은 P3 연출 — P2 를 건너뛰어도 한 번
      expect(w.sheds[0]!.count).toBe(def.visual!.plates.z.length);
      expect(w.status.filter((st) => st.kind === 'molt' && st.on)).toHaveLength(1);
      // 덮어쓰기 — 낫 34(오른·왼)·들이받기 24·돌격 50/300, 해금은 P2 것까지
      boss.attackMode = 'melee';
      expect(currentAttack(def, boss).damage).toBe(34);
      boss.attackMode = 'alt';
      expect(currentAttack(def, boss).damage).toBe(34);
      boss.attackMode = 'close';
      expect(currentAttack(def, boss).damage).toBe(24);
      boss.attackMode = 'melee';
      expect(attackInPhase(def, boss, 'charge', def.chargeAttack!)).toMatchObject({ damage: 50, cooldownTicks: 300 });
      expect(slotUnlocked(def, boss, 'volley')).toBe(true);
      expect(slotUnlocked(def, boss, 'roar')).toBe(true);
      // 걷기 ×1.2 — 복귀 뒤 멀리 선 플레이어(돌격 maxRange 밖)를 향해 3.84 m/s 로 걷는다. 돌격 속도는 데이터 그대로
      tickEnemiesUntil(() => boss.ai === 'chase', 200);
      // P3 복귀 첫 선택은 포효(B3-4 firstPick) — 여기선 걷기만 본다: 첫 선택·간격을 지운다(포효는 B3-4 검증에서)
      boss.firstPick = undefined;
      boss.roarCooldown = 9999;
      world.player.x = boss.x - 20;
      world.player.prevX = world.player.x;
      boss.closeCooldown = 0;
      const x0 = boss.x;
      const z0 = boss.z;
      for (let i = 0; i < 10; i++) Enemies.tick(world, DT);
      expect(Math.hypot(boss.x - x0, boss.z - z0)).toBeCloseTo((def.speed * 1.2 * 10) / 60, 2);
      expect(attackInPhase(def, boss, 'charge', def.chargeAttack!).chargeSpeed).toBe(def.chargeAttack!.chargeSpeed);
    });

    it('갑각 재생(molt) — 파열한 두 관절(hp 0·ruptured·낫 잠김·절뚝)이 전환에 hp 132 로 돌아오고 표식이 지워져 낫 잠김(rupture off ×2)·절뚝(limp off)이 풀린다, 공격 쿨다운 절반. 복귀 뒤 낫이 다시 나가고, 관절이 다시 0 이 되면 다시 파열한다', () => {
      const boss = makeBehemoth(4.0);
      const w = watch();
      boss.weakHp!['joint_r'] = 0;
      boss.weakHp!['joint_l'] = 0;
      Enemies.tick(world, DT);
      expect(boss.ruptured).toEqual({ joint_r: true, joint_l: true });
      expect(boss.bladeLock).toEqual({ r: wpc.rupture.bladeLockTicks, l: wpc.rupture.bladeLockTicks });
      expect(boss.limping).toBe(true);
      boss.timer = 0; // 비틀거림을 끝내 자유 상태로
      Enemies.tick(world, DT);
      boss.chargeCooldown = 400;
      boss.closeCooldown = 200;
      boss.volleyCooldown = 30;
      boss.health = perBar * 2;
      Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(1);
      expect(boss.weakHp).toEqual({ joint_r: wp('joint_r').hp, joint_l: wp('joint_l').hp, vent: wp('vent').hp }); // 분출공 내구(B3-2)는 낫 짝이 없어 재생 대상이 아니다(질식이 따로 관리)
      expect(boss.ruptured).toEqual({});
      expect(boss.bladeLock).toEqual({});
      // 절반 — 전환 틱의 쿨다운 감소(−1)가 그 뒤에 한 번 돈다
      expect(boss.chargeCooldown).toBe(Math.round(400 * wpc.phaseShiftCooldownMul) - 1);
      expect(boss.closeCooldown).toBe(Math.round(200 * wpc.phaseShiftCooldownMul) - 1);
      expect(boss.volleyCooldown).toBe(Math.round(30 * wpc.phaseShiftCooldownMul) - 1);
      const tags = w.status.map(w.tag);
      expect(tags.filter((t) => t === 'rupture:joint_r:false')).toHaveLength(1);
      expect(tags.filter((t) => t === 'rupture:joint_l:false')).toHaveLength(1);
      Enemies.tick(world, DT);
      expect(boss.limping).toBe(false);
      expect(w.status.map(w.tag)).toContain('limp:false');
      // 관절 판정이 다시 산다(내구가 돌아왔으니 노출 타이머가 열린다) — 전환이 끝난 뒤
      tickEnemiesUntil(() => boss.ai === 'chase', 200);
      openExposure(world, boss, 'joint_r', 30);
      expect(weakPointOpen(boss, wp('joint_r'))).toBe(true);
      // 낫이 다시 나간다(pickMeleeMode 가 null 이 아니다)
      tickEnemiesUntil(() => boss.ai === 'windup', 300);
      expect(['melee', 'alt']).toContain(boss.attackMode);
      // 다시 0 → 다시 파열(표식이 지워졌으니) — 오른낫 잠김
      boss.weakHp!['joint_r'] = 0;
      Enemies.tick(world, DT);
      expect(boss.ruptured).toEqual({ joint_r: true });
      expect(boss.bladeLock).toEqual({ r: wpc.rupture.bladeLockTicks });
      expect(w.status.map(w.tag).filter((t) => t === 'rupture:joint_r:true')).toHaveLength(2); // 처음 파열 + 재생 뒤 다시 파열
    });

    it('덮어쓰기가 실제 타격에 적용된다 — P3 낫이 플레이어에게 34(P1 30) 를 넣는다', () => {
      const boss = makeBehemoth(4.0);
      const w = watch();
      boss.health = perBar; // 500 — 1칸째(P3)
      Enemies.tick(world, DT);
      expect(boss.phase).toBe(1);
      // P3 의 포효 첫 선택·삼연낫(B3-4)은 그쪽 검증에서 — 여기선 단발 낫만 본다
      boss.firstPick = undefined;
      boss.roarCooldown = 9999;
      boss.comboCooldown = 9999;
      tickEnemiesUntil(() => boss.ai === 'chase', 200);
      tickEnemiesUntil(() => w.hits.length > 0, 400);
      expect(w.hits[0]!.amount).toBe(34);
      expect(['melee', 'alt']).toContain(boss.attackMode);
    });

    it('페이즈 표가 없는 보스(족장, 2칸)는 칸이 비어도 아무 일도 없다 — boss_phase·molt·phase 없음, currentAttack 은 원본 객체 그대로', () => {
      const chief = spawnEnemyAt('goblin_chieftain', 14, 6, 1);
      chief.ai = 'chase';
      world.enemies.push(chief);
      const w = watch();
      const cdef = enemyDef('goblin_chieftain');
      expect(healthBarState(cdef, cdef.health).index).toBe(2);
      Enemies.tick(world, DT);
      chief.health = cdef.health / 2; // 2칸째가 빈다
      for (let i = 0; i < 5; i++) Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(0);
      expect(w.status.filter((st) => st.kind === 'molt')).toHaveLength(0);
      expect(chief.phase).toBeUndefined();
      expect(chief.pose).toBeUndefined();
      chief.attackMode = 'melee';
      expect(currentAttack(cdef, chief)).toBe(cdef.attack);
      chief.attackMode = 'charge';
      expect(currentAttack(cdef, chief)).toBe(cdef.chargeAttack);
    });

    it('사망 — 마지막 페이즈의 소요 틱을 boss_phase{phase 0, from, fromTicks, death} 로 한 번만 알린다(계측: 페이즈별 시간)', () => {
      const boss = makeBehemoth(10);
      boss.chargeCooldown = 9999;
      const w = watch();
      for (let i = 0; i < 30; i++) {
        Enemies.tick(world, DT);
        world.tick++;
      }
      boss.health = 0;
      boss.alive = false;
      Enemies.tick(world, DT);
      Enemies.tick(world, DT);
      expect(w.phases).toHaveLength(1);
      expect(w.phases[0]).toMatchObject({ phase: 0, from: 3, fromTicks: 30, death: true });
    });
  });

  describe('B3-1 P2 발구르기·심장 역류·기상 발구르기·절뚝 (기획서 §4.1 heart·§5 backflow·§6 hobble·§7 P2·§9.2)', () => {
    const wpc = balance.weakPoint;
    const slam = def.slamAttack!;
    const perBar = def.health / def.healthBars!; // 500
    type Status = { kind: string; on: boolean; id?: string; ticks?: number; cause?: string; sealed?: boolean; selfDamage?: number };
    function watch() {
      const status: Status[] = [];
      world.events.on('boss_status', (p) => status.push(p as Status));
      const hits: { amount: number; blocked?: boolean }[] = [];
      world.events.on('player_damaged', (p) => hits.push(p as { amount: number; blocked?: boolean }));
      const slams: { radius: number; dist: number }[] = [];
      world.events.on('ground_slam', (p) => slams.push(p as { radius: number; dist: number }));
      const landed: { radius: number; wake: boolean; hit: boolean }[] = [];
      world.events.on('slam_landed', (p) => landed.push(p as { radius: number; wake: boolean; hit: boolean }));
      const starts: { wake: boolean; dist: number }[] = [];
      world.events.on('enemy_slam_start', (p) => starts.push(p as { wake: boolean; dist: number }));
      const windups: { telegraph: string }[] = [];
      world.events.on('enemy_windup', (p) => windups.push(p as { telegraph: string }));
      const closed: { id: string; hits: number }[] = [];
      world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));
      const weakHits: { id: string; damage: number }[] = [];
      world.events.on('weak_point_hit', (p) => weakHits.push(p as { id: string; damage: number }));
      const pops: { enemyId: number; amount: number }[] = [];
      world.events.on('damage_pop', (p) => pops.push(p as { enemyId: number; amount: number }));
      const staggers: unknown[] = [];
      world.events.on('boss_staggered', (p) => staggers.push(p));
      const tag = (st: Status): string => `${st.kind}${st.id ? ':' + st.id : ''}:${st.on}`;
      return { status, hits, slams, landed, starts, windups, closed, weakHits, pops, staggers, tag };
    }
    /** P2 로 둔다(게임플레이 페이즈 = 체력 칸 index 2). 체력은 그대로 — tickPhase 는 칸이 phase 보다 낮아질 때만 전환하니 그대로 P2 에 머문다 */
    function toP2(boss: EnemyState): void {
      boss.phase = 2;
    }
    /** 발구르기 예고까지 돌린다(돌격은 쿨다운으로 막는다 — 4.5m 밖에서 돌격이 먼저 나간다) */
    function untilSlamWindup(boss: EnemyState, maxTicks = 300): void {
      boss.chargeCooldown = 9999;
      tickEnemiesUntil(() => boss.ai === 'windup' && boss.attackMode === 'slam', maxTicks);
    }
    /** 심장 구체 중심을 권총으로 쏜다 */
    function shootHeart(boss: EnemyState): void {
      const c = weakPointWorldPos(boss, def, wp('heart'));
      shootAt(c.x, c.y, c.z);
    }

    it('데이터 — slamAttack(contact·aoe 5.0·46틱·24·4m·2.5 < d ≤ 6·쿨 420·패링 불가·빨강·rearPose 8~36·statusOnHit hobble·막으면 없음), wakeSlam 30, P2 unlock slam·wakeSlam, balance heart 66/600·backflow 60/45·status.hobble 300/×2/noSprint. currentAttack: P2 발구르기 = 정의, P3 28/5.5, 기상 발구르기 = 예고 30·rearPose 없음·P3 에서도 24/5.0(슬롯 wakeSlam)·캐시. 족장엔 없다', () => {
      expect(slam).toMatchObject({ type: 'contact', aoeRadius: 5.0, windupTicks: 46, damage: 24, playerKnockback: 4.0, minRange: 2.5, maxRange: 6, cooldownTicks: 420, parryable: false, telegraph: 'red', statusOnHit: 'hobble' });
      expect(slam.rearPose).toEqual({ from: 8, to: 36 });
      expect(slam.rearPose!.to - slam.rearPose!.from).toBe(28); // 기획서 "28틱 안 66"
      expect(slam.statusOnBlock).toBeUndefined(); // 막으면 칩만, 절뚝 없음
      expect(slam.arcDeg).toBeUndefined(); // 원형 — 각 무시
      expect(slam.aoeRadius!).toBeLessThan(balance.reaction.dodgeDistance + 2.0); // 뒤 대시는 항상 나간다(최소 거리 2.0 + 3.5 = 5.5 > 5.0)
      expect(def.wakeSlam).toEqual({ windupTicks: 30 });
      expect(resolvePhase(def, 2)!.unlock.has('slam')).toBe(true);
      expect(resolvePhase(def, 2)!.unlock.has('wakeSlam')).toBe(true);
      expect(slotUnlocked(def, { phase: 3 }, 'slam')).toBe(false);
      expect(slotUnlocked(def, { phase: 3 }, 'wakeSlam')).toBe(false);
      expect(wpc.heartThreshold).toBe(66);
      expect(wpc.heartCooldownTicks).toBe(600);
      expect(wpc.headDown.backflowTicks).toBe(60);
      expect(wpc.backflow.selfDamage).toBe(45);
      expect(balance.status.hobble).toEqual({ ticks: 300, dodgeStaminaMul: 2, noSprint: true });
      expect(wp('heart').exposedStates).toEqual(['rear']);
      expect(wp('heart').damageMul).toBe(3.0);
      // 공격 정의 — P2 그대로 / P3 덮어쓰기 / 기상 발구르기
      expect(currentAttack(def, { attackMode: 'slam', phase: 2 })).toBe(slam);
      expect(currentAttack(def, { attackMode: 'slam', phase: 1 })).toMatchObject({ damage: 28, aoeRadius: 5.5, windupTicks: 46 });
      const wake = wakeSlamAttack(def)!;
      expect(wake.windupTicks).toBe(30);
      expect(wake.rearPose).toBeUndefined();
      expect(wake).toMatchObject({ aoeRadius: 5.0, damage: 24, playerKnockback: 4.0, statusOnHit: 'hobble', telegraph: 'red', parryable: false });
      expect(slam.rearPose).toBeDefined(); // 원본은 건드리지 않는다
      expect(currentAttack(def, { attackMode: 'slam', phase: 2, wakeSlam: true })).toBe(wake);
      expect(currentAttack(def, { attackMode: 'slam', phase: 1, wakeSlam: true })).toBe(wake); // 슬롯 'wakeSlam' 엔 P3 덮어쓰기가 없다(표: 24/24)
      expect(wakeSlamAttack(def)).toBe(wake); // 캐시
      expect(wakeSlamAttack(enemyDef('goblin_chieftain'))).toBeUndefined();
      expect(enemyDef('goblin_chieftain').slamAttack).toBeUndefined();
      expect(enemyDef('goblin_chieftain').wakeSlam).toBeUndefined();
    });

    it('P1 에선 발구르기가 나오지 않고(5m — 걸어온다), P2 에선 5m 에서 발구르기: attackMode slam·예고 46·빨강·쿨 420·enemy_slam_start{wake false}. 양 낫 잠김이라 낫이 없어도 4m 에서 발구르기(물러서기보다 먼저)', () => {
      const boss = makeBehemoth(5.0); // 낫 4.4 밖·돌격 minRange 4.5 안쪽이 아니라 밖이지만 돌격은 쿨다운으로 막는다
      boss.chargeCooldown = 9999;
      const w = watch();
      const x0 = boss.x;
      for (let i = 0; i < 20; i++) Enemies.tick(world, DT);
      expect(boss.attackMode ?? 'melee').not.toBe('slam');
      expect(boss.x).toBeLessThan(x0); // 걸어온다
      expect(w.starts).toHaveLength(0);
      // P2
      world.enemies.length = 0;
      const b2 = makeBehemoth(5.0);
      toP2(b2);
      untilSlamWindup(b2, 5);
      expect(b2.timer).toBe(slam.windupTicks);
      expect(b2.wakeSlam).toBe(false);
      expect(b2.slamCooldown).toBe(slam.cooldownTicks);
      expect(w.windups.at(-1)).toMatchObject({ telegraph: 'red' });
      expect(w.starts).toEqual([expect.objectContaining({ wake: false, dist: 5.0 })]);
      // 양 낫 잠김 — 낫 사거리 안(4m)이라도 낫이 없으니 발구르기(2.5 밖)가 물러서기보다 먼저
      world.enemies.length = 0;
      const b3 = makeBehemoth(4.0);
      toP2(b3);
      b3.bladeLock = { r: 600, l: 600 };
      b3.closeCooldown = 9999;
      untilSlamWindup(b3, 5);
      expect(b3.limping).toBe(true);
      // 2.5m 안에선 안 나온다(minRange) — 들이받기(≤ 3.0)와 물러서기의 영역
      world.enemies.length = 0;
      const b4 = makeBehemoth(2.4);
      toP2(b4);
      b4.closeCooldown = 9999;
      b4.chargeCooldown = 9999;
      for (let i = 0; i < 5; i++) Enemies.tick(world, DT);
      expect(b4.attackMode ?? 'melee').not.toBe('slam');
    });

    it('예고 8~36틱 앞발 들기 — pose rear 는 예고 경과 8 ≤ t < 36 의 28틱만: 그 동안 심장이 표 (0, 1.15, −1.0) 자리에서 열리고(weakPointOpen), 밖에선 닫혀 normal 자리. 들면 boss_status rear on(+joint_open 문구는 main), 내리면 rear off + exposure_closed{heart, hits 0}. 눈·관절은 열리지 않는다', () => {
      const boss = makeBehemoth(5.0);
      toP2(boss);
      const w = watch();
      untilSlamWindup(boss, 5);
      const rearTicks: number[] = [];
      let sawHeartOpen = false;
      for (let k = 1; k <= slam.windupTicks; k++) {
        Enemies.tick(world, DT);
        const elapsed = slam.windupTicks - boss.timer;
        expect(elapsed).toBe(k);
        if (boss.pose === 'rear') {
          rearTicks.push(elapsed);
          expect(weakPointOpen(boss, wp('heart'))).toBe(true);
          const c = weakPointWorldPos(boss, def, wp('heart'));
          expect(c.y).toBeCloseTo(1.15, 6);
          expect(Math.hypot(c.x - boss.x, c.z - boss.z)).toBeCloseTo(1.0, 6); // 앞으로 1.0
          sawHeartOpen = true;
        } else {
          expect(weakPointOpen(boss, wp('heart'))).toBe(false);
          expect(weakPointWorldPos(boss, def, wp('heart')).y).toBeCloseTo(0.6, 6);
        }
        expect(weakPointOpen(boss, wp('eye'))).toBe(false);
        expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
        if (boss.ai !== 'windup') break;
      }
      expect(sawHeartOpen).toBe(true);
      expect(rearTicks).toHaveLength(slam.rearPose!.to - slam.rearPose!.from); // 28
      expect(rearTicks[0]).toBe(slam.rearPose!.from);
      expect(rearTicks.at(-1)).toBe(slam.rearPose!.to - 1);
      expect(w.status.map(w.tag)).toEqual(['rear:true', 'rear:false']);
      expect(w.status[0]).toMatchObject({ kind: 'rear', on: true, sealed: false });
      expect(w.closed).toEqual([expect.objectContaining({ id: 'heart', hits: 0 })]);
      expect(boss.pose).toBeUndefined();
    });

    it('착지 — 예고 46틱 뒤 impact: 반경 5.0 안 24 + 밀림 4m/14틱 + 절뚝 300(hobbleTicks — Status 가 hobble_applied), ground_slam{radius 5} + slam_landed{radius 5, wake false, hit true}, 헛침 아닌 recover 40. 막으면 칩 7.2·절뚝 없음. 5.5m 밖(뒤 대시 뒤)은 안 맞고 땅만 울린다(hit false)', () => {
      const boss = makeBehemoth(5.0);
      toP2(boss);
      const w = watch();
      const applied: { kind: string; ticks: number }[] = [];
      world.events.on('hobble_applied', (p) => applied.push(p as { kind: string; ticks: number }));
      untilSlamWindup(boss, 5);
      tickEnemiesUntil(() => boss.ai === 'recover', 60);
      expect(w.hits).toEqual([expect.objectContaining({ amount: 24, blocked: false })]);
      expect(world.player.health).toBe(76);
      expect(world.player.kbTicks).toBe(slam.playerKnockbackTicks);
      expect(Math.hypot(world.player.kbX!, world.player.kbZ!) * slam.playerKnockbackTicks!).toBeCloseTo(slam.playerKnockback!, 5);
      expect(world.player.hobbleTicks).toBe(balance.status.hobble.ticks);
      expect(world.player.concussionTicks ?? 0).toBe(0);
      Status.tick(world, DT);
      expect(applied).toEqual([{ kind: 'hobble', ticks: 300 }]);
      expect(w.slams).toEqual([expect.objectContaining({ radius: 5.0 })]);
      expect(w.landed).toEqual([expect.objectContaining({ radius: 5.0, wake: false, hit: true })]);
      expect(boss.whiffed).toBe(false);
      expect(boss.timer).toBe(slam.recoverTicks);
      expect(boss.wakeSlam).toBe(false);
      // 막기 — 칩 30% 만, 절뚝 없음, 밀림은 blockedMul
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.hobbleTicks = 0;
      world.player.kbTicks = 0;
      const b2 = makeBehemoth(5.0);
      toP2(b2);
      untilSlamWindup(b2, 5);
      world.player.blocking = true; // 플레이어(+X 를 봄)의 정면
      tickEnemiesUntil(() => b2.ai === 'recover', 60);
      world.player.blocking = false;
      expect(w.hits).toHaveLength(2);
      expect(w.hits[1]).toMatchObject({ blocked: true });
      expect(w.hits[1]!.amount).toBeCloseTo(24 * balance.block.chipDamageRatio, 5);
      expect(world.player.hobbleTicks ?? 0).toBe(0);
      expect(world.player.stunTicks).toBeGreaterThan(0); // 방어 경직은 기존대로
      // 반경 밖 — 뒤 대시 뒤(5.5m): 안 맞고 땅만 울린다
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.stunTicks = 0;
      const b3 = makeBehemoth(5.0);
      toP2(b3);
      untilSlamWindup(b3, 5);
      world.player.x = b3.x - 5.5;
      world.player.prevX = world.player.x;
      tickEnemiesUntil(() => b3.ai === 'recover', 60);
      expect(w.hits).toHaveLength(2);
      expect(world.player.health).toBe(100);
      expect(w.slams).toHaveLength(3);
      expect(w.landed[2]).toMatchObject({ hit: false });
      expect(b3.whiffed).toBe(false); // whiffRecoverTicks 가 없다 — 땅은 어차피 울렸다
      expect(b3.timer).toBe(slam.recoverTicks);
    });

    it('역류 — 앞발 들기 중 심장 66(권총 2발 ×3.0 = 33×2) → 다음 틱: 발구르기 취소(AoE·ground_slam 없음, attackMode melee) + 자해 45(damage_pop) + head_down 60 cause backflow + 심장 봉인 600(weakCooldown — 판정 없음·rear 라도 닫힘) + exposure_closed{heart, hits 2}. 봉인 중엔 심장을 쏴도 몸통 0.8×. 머리 내림 중 눈 66 은 혼절이 아니다(피해만). 60틱 뒤 일어서며 기상 발구르기 확정(예고 30·rear 없음·심장 안 열림·slam_landed{wake true}). 봉인은 600틱 뒤 풀린다', () => {
      const boss = makeBehemoth(5.0);
      toP2(boss);
      const w = watch();
      untilSlamWindup(boss, 5);
      tickEnemiesUntil(() => boss.pose === 'rear', 20);
      const hpBefore = boss.health;
      shootHeart(boss);
      shootHeart(boss);
      expect(w.weakHits).toEqual([
        expect.objectContaining({ id: 'heart', damage: balance.weapons.pistol.damage * 3.0 }),
        expect.objectContaining({ id: 'heart', damage: balance.weapons.pistol.damage * 3.0 }),
      ]);
      expect(boss.weakAccum!['heart']).toBeCloseTo(66, 5);
      expect(boss.ai).toBe('windup'); // 아직 — Enemies 가 다음 틱에 본다
      Enemies.tick(world, DT);
      // 역류
      expect(boss.attackMode).toBe('melee');
      expect(boss.pose).toBe('head_down');
      expect(boss.poseCause).toBe('backflow');
      expect(boss.poseTicks).toBe(wpc.headDown.backflowTicks);
      expect(boss.ai).toBe('recover');
      expect(boss.health).toBeCloseTo(hpBefore - 66 - wpc.backflow.selfDamage, 5);
      expect(w.pops.filter((p) => p.amount === wpc.backflow.selfDamage)).toHaveLength(1);
      expect(boss.weakCooldown).toEqual({ heart: wpc.heartCooldownTicks });
      expect(weakPointOpen(boss, wp('heart'))).toBe(false);
      expect(weakPointOpen(boss, wp('eye'))).toBe(true); // 머리 내림 — 눈은 열려 있다(피해만)
      expect(w.closed).toEqual([expect.objectContaining({ id: 'heart', hits: 2 })]);
      expect(w.status.map(w.tag)).toEqual(['rear:true', 'rear:false', 'backflow:true', 'head_down:true']);
      expect(w.status[2]).toMatchObject({ kind: 'backflow', on: true, ticks: 60, selfDamage: 45 });
      expect(w.status[3]).toMatchObject({ kind: 'head_down', on: true, ticks: 60, cause: 'backflow' });
      expect(w.slams).toHaveLength(0); // AoE 는 안 떨어졌다
      expect(w.hits).toHaveLength(0);
      // (봉인 중 심장 사격 = 몸통 0.8× 는 다음 테스트 — 머리 내림 자세에선 정면 사선이 열린 눈(0.9m)을 먼저 지난다)
      // 머리 내림 중 눈 66 — 혼절 없음(역류 원인은 누적이 없다), 피해는 ×3.0 그대로
      const hp3 = boss.health;
      shootEye(boss);
      shootEye(boss);
      expect(boss.health).toBeCloseTo(hp3 - 66, 5);
      Enemies.tick(world, DT);
      expect(boss.ai).toBe('recover');
      expect(boss.pose).toBe('head_down');
      expect(w.staggers).toHaveLength(0);
      expect(boss.weakAccum!['eye']).toBe(0); // 누적은 매 틱 비워진다
      // 60틱이 다하면 backflow off·head_down off → 일어서며 기상 발구르기
      tickEnemiesUntil(() => boss.ai === 'chase', 70);
      expect(w.status.map(w.tag).slice(4)).toEqual(['head_down:false', 'backflow:false']);
      expect(boss.wakeSlamPending).toBe(true);
      expect(boss.poseCause).toBeUndefined();
      Enemies.tick(world, DT);
      expect(boss.ai).toBe('windup');
      expect(boss.attackMode).toBe('slam');
      expect(boss.wakeSlam).toBe(true);
      expect(boss.wakeSlamPending).toBe(false);
      expect(boss.timer).toBe(def.wakeSlam!.windupTicks);
      expect(currentAttack(def, boss).rearPose).toBeUndefined();
      expect(w.starts.at(-1)).toMatchObject({ wake: true });
      // 기상 발구르기 예고 내내 앞발 들기(rear)·심장 열림이 없다
      for (let i = 0; i < def.wakeSlam!.windupTicks && boss.ai === 'windup'; i++) {
        Enemies.tick(world, DT);
        expect(boss.pose).toBeUndefined();
        expect(weakPointOpen(boss, wp('heart'))).toBe(false);
      }
      tickEnemiesUntil(() => boss.ai === 'recover', 5);
      expect(w.landed).toEqual([expect.objectContaining({ radius: 5.0, wake: true })]);
      expect(boss.wakeSlam).toBe(false);
      // 봉인 — 600틱이 다하면 지워지고 다음 앞발 들기에 다시 열린다
      const left = boss.weakCooldown!['heart']!;
      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThan(wpc.heartCooldownTicks);
      for (let i = 0; i < left; i++) Enemies.tick(world, DT);
      expect(boss.weakCooldown?.['heart']).toBeUndefined();
    });

    it('봉인(쿨다운) 중의 앞발 들기 — 자세는 서되(boss_status rear{sealed true}) 심장은 열리지 않고(표 자리를 쏘면 약점 장부 없이 몸통 0.8×) exposure_closed 도 없다. 페이즈 전환이 앞발 들기 중 끼면 심장 노출을 닫고 포효로', () => {
      const boss = makeBehemoth(5.0);
      toP2(boss);
      boss.weakCooldown = { heart: 5000 };
      const w = watch();
      untilSlamWindup(boss, 5);
      tickEnemiesUntil(() => boss.pose === 'rear', 20);
      expect(weakPointOpen(boss, wp('heart'))).toBe(false);
      expect(w.status.at(-1)).toMatchObject({ kind: 'rear', on: true, sealed: true });
      // 봉인된 심장 자리(표 1.15m — 눈은 3.0m 로 사선 밖)를 쏘면 약점이 아니라 몸통 0.8×
      const hp0 = boss.health;
      shootHeart(boss);
      expect(w.weakHits).toHaveLength(0);
      expect(boss.health).toBeCloseTo(hp0 - balance.weapons.pistol.damage * balance.weapons.pistol.hitZones.bodyMul, 5);
      tickEnemiesUntil(() => boss.pose !== 'rear', 40);
      expect(w.closed).toHaveLength(0);
      expect(w.status.map(w.tag)).toEqual(['rear:true', 'rear:false']);
      // 전환이 끼면 — 열린 심장 노출을 닫고(exposure_closed) 포효
      world.enemies.length = 0;
      const b2 = makeBehemoth(5.0);
      toP2(b2);
      untilSlamWindup(b2, 5);
      tickEnemiesUntil(() => b2.pose === 'rear', 20);
      b2.health = perBar; // 1칸째 — P3
      Enemies.tick(world, DT);
      expect(b2.pose).toBe('roar');
      expect(b2.attackMode).toBe('melee');
      expect(w.closed).toEqual([expect.objectContaining({ id: 'heart' })]);
      expect(w.slams).toHaveLength(0);
    });

    it('기상 발구르기 — 머리 내림(완벽 패링 90)이 끝나는 첫 추격 틱에 거리(4m)·쿨다운(9999) 무관 확정; 혼절이 시간으로 끝나도, 처형 넉백 뒤에도; 미끄러짐(완벽 회피) 뒤엔 없다; P1 에선 없다', () => {
      // (a) 낫 박힘 → 90틱 → 일어서며
      const boss = makeBehemoth(4.0);
      toP2(boss);
      boss.slamCooldown = 9999;
      const w = watch();
      expect(perfectParry(boss)).toBe('perfect');
      expect(boss.pose).toBe('head_down');
      tickEnemiesUntil(() => boss.ai === 'chase', 120);
      expect(boss.wakeSlamPending).toBe(true);
      Enemies.tick(world, DT);
      expect(boss.ai).toBe('windup');
      expect(boss.attackMode).toBe('slam');
      expect(boss.wakeSlam).toBe(true);
      expect(boss.timer).toBe(30);
      expect(boss.slamCooldown).toBeGreaterThan(9000); // 기상 발구르기는 쿨다운을 물지 않는다(그 사이 흐른 틱만큼만 줄었다 — 420 으로 다시 세우지 않는다)
      expect(w.starts).toEqual([expect.objectContaining({ wake: true })]);
      tickEnemiesUntil(() => boss.ai === 'recover', 40);
      expect(w.hits).toEqual([expect.objectContaining({ amount: 24 })]); // 4m — 반경 안. 머리에 붙어 있던 근접 플레이어의 벌칙
      expect(world.player.hobbleTicks).toBe(300);
      // (b) 혼절 → 시간 만료 → recover → chase 에 확정
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.kbTicks = 0;
      world.player.hobbleTicks = 0;
      const b2 = makeBehemoth(4.0);
      toP2(b2);
      expect(perfectParry(b2)).toBe('perfect');
      shootEye(b2);
      shootEye(b2);
      Enemies.tick(world, DT);
      expect(b2.ai).toBe('staggered');
      tickEnemiesUntil(() => b2.ai === 'chase', 300);
      expect(b2.wakeSlamPending).toBe(true);
      Enemies.tick(world, DT);
      expect(b2.attackMode).toBe('slam');
      expect(b2.wakeSlam).toBe(true);
      // (c) 혼절 → 처형 → 넉백 → chase 에 확정 (처형 연출 정지 32틱 동안은 Enemies 가 멈춘다)
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.kbTicks = 0;
      const b3 = makeBehemoth(4.0);
      toP2(b3);
      expect(perfectParry(b3)).toBe('perfect');
      shootEye(b3);
      shootEye(b3);
      Enemies.tick(world, DT);
      expect(b3.ai).toBe('staggered');
      pressReaction();
      expect(b3.kbTicks).toBe(balance.reaction.executeKnockbackTicks);
      tickEnemiesUntil(() => b3.ai === 'chase', 300);
      expect(b3.wakeSlamPending).toBe(true);
      Enemies.tick(world, DT);
      expect(b3.attackMode).toBe('slam');
      expect(b3.wakeSlam).toBe(true);
      // (d) 미끄러짐 뒤엔 없다 — 돌격을 무적 안에 받아 skid 90 → chase 로 돌아와도 예약이 없다
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.kbTicks = 0;
      world.player.x = 6;
      world.player.prevX = 6;
      const b4 = makeBehemoth(10);
      toP2(b4);
      tickEnemiesUntil(() => b4.ai === 'charging', 300);
      const cd = Enemies.contactDist(def);
      tickEnemiesUntil(() => Math.hypot(b4.x - world.player.x, b4.z - world.player.z) <= cd + 1.0, 300);
      world.player.iframeTicks = 1e9;
      world.player.iframeSource = 'dodge';
      tickEnemiesUntil(() => b4.pose === 'skid', 60);
      world.player.iframeTicks = 0;
      tickEnemiesUntil(() => b4.ai === 'chase', 120);
      expect(b4.wakeSlamPending ?? false).toBe(false);
      Enemies.tick(world, DT);
      expect(b4.attackMode === 'slam' && b4.wakeSlam === true).toBe(false);
      // (e) P1 — 머리 내림이 끝나도 예약이 조용히 지워지고 평소 선택(낫)으로
      world.enemies.length = 0;
      world.player.kbTicks = 0;
      const b5 = makeBehemoth(4.0);
      expect(b5.phase).toBe(3);
      expect(perfectParry(b5)).toBe('perfect');
      tickEnemiesUntil(() => b5.ai === 'chase', 120);
      Enemies.tick(world, DT);
      expect(b5.attackMode).not.toBe('slam');
      expect(b5.wakeSlamPending).toBe(false);
    });

    it('절뚝(hobble, 기획서 §6) — 300틱·시간으로만(Status 가 깎고 hobble_applied/_ended), 질주 불가(sprint 입력에도 걷기 속도·스태미너 안 닳음), 회피 스태미너 ×2(30 — 29 면 stamina_blocked{need 30}), 회피 거리(3.5m)·무적(8)·대시 틱(6)은 그대로', () => {
      const p = world.player;
      p.x = 12; // 뒤 대시(−x 3.5m)가 서쪽 벽(x 4)에 닿지 않게 경기장 안쪽으로
      p.prevX = 12;
      const ended: { kind: string; reason: string }[] = [];
      world.events.on('hobble_ended', (e) => ended.push(e as { kind: string; reason: string }));
      const blocked: { need: number }[] = [];
      world.events.on('stamina_blocked', (e) => blocked.push(e as { need: number }));
      world.stamina.value = 100;
      // 대조 — 절뚝 전 질주: 9 m/s 로 움직이고 스태미너가 닳는다
      world.input = { ...Input.emptySnapshot(), moveForward: 1, sprint: true };
      const x0 = p.x;
      PlayerMove.tick(world, DT);
      expect(p.x - x0).toBeCloseTo((balance.player.sprintSpeed / 60), 3);
      expect(world.stamina.value).toBeLessThan(100);
      world.stamina.value = 100;
      world.stamina.regenDelay = 0;
      // 절뚝
      setPlayerStatus(p, 'hobble', balance.status.hobble.ticks);
      Status.tick(world, DT);
      expect(playerStatusTicks(p, 'hobble')).toBe(299);
      const x1 = p.x;
      PlayerMove.tick(world, DT);
      expect(p.x - x1).toBeCloseTo(balance.player.moveSpeed / 60, 3); // 걷기 속도
      expect(world.stamina.value).toBe(100); // 질주가 아니니 안 닳는다
      world.input = Input.emptySnapshot();
      // 회피 — 스태미너 ×2
      world.stamina.value = 29;
      world.input = { ...Input.emptySnapshot(), dodgePressed: true };
      Reaction.tick(world, DT);
      expect(blocked).toEqual([{ action: 'dodge', need: balance.player.stamina.dodgeCost * 2 }]);
      expect(p.dodgeTicks).toBe(0);
      world.stamina.value = 100;
      Reaction.tick(world, DT);
      world.input = Input.emptySnapshot();
      expect(world.stamina.value).toBe(100 - balance.player.stamina.dodgeCost * 2);
      expect(p.dodgeTicks).toBe(balance.reaction.dodgeDashTicks);
      expect(p.iframeTicks).toBe(balance.reaction.dodgeIFrameTicks);
      expect(p.dodgeDistMul).toBe(1); // 뒤 대시(이동 입력 없음)
      const dx0 = p.x;
      for (let i = 0; i < balance.reaction.dodgeDashTicks; i++) Reaction.tick(world, DT);
      expect(Math.abs(p.x - dx0)).toBeCloseTo(balance.reaction.dodgeDistance, 3); // 거리는 그대로
      // 대조 — 절뚝이 풀리면 값 15
      setPlayerStatus(p, 'hobble', 0);
      Status.tick(world, DT);
      expect(ended).toEqual([{ kind: 'hobble', reason: 'cured' }]);
      world.stamina.value = 100;
      p.dodgeTicks = 0;
      world.input = { ...Input.emptySnapshot(), dodgePressed: true };
      Reaction.tick(world, DT);
      world.input = Input.emptySnapshot();
      expect(world.stamina.value).toBe(100 - balance.player.stamina.dodgeCost);
      // 시간 경과 — 300틱이면 expired
      setPlayerStatus(p, 'hobble', balance.status.hobble.ticks);
      for (let i = 0; i < balance.status.hobble.ticks; i++) Status.tick(world, DT);
      expect(playerStatusTicks(p, 'hobble')).toBe(0);
      expect(ended.at(-1)).toEqual({ kind: 'hobble', reason: 'expired' });
    });
  });

  describe('B3-2 웅덩이·오염 진액·갑각 떨기·분출공 (기획서 §4.1 vent·§5 backflow/choke·§6 corrosive·§7 P2·§10.2·§11)', () => {
    const wpc = balance.weakPoint;
    const volley = def.volleyAttack!;
    const pistol = balance.weapons.pistol;
    type Status = { kind: string; on: boolean; id?: string; ticks?: number; cause?: string; selfDamage?: number };
    function watch() {
      const status: Status[] = [];
      world.events.on('boss_status', (p) => status.push(p as Status));
      const hits: { amount: number; blocked?: boolean }[] = [];
      world.events.on('player_damaged', (p) => hits.push(p as { amount: number; blocked?: boolean }));
      const windups: { telegraph: string }[] = [];
      world.events.on('enemy_windup', (p) => windups.push(p as { telegraph: string }));
      const starts: { shots: number }[] = [];
      world.events.on('enemy_volley_start', (p) => starts.push(p as { shots: number }));
      const shots: { left: number }[] = [];
      world.events.on('enemy_volley_shot', (p) => shots.push(p as { left: number }));
      const closed: { id: string; hits: number }[] = [];
      world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));
      const weakHits: { id: string; damage: number }[] = [];
      world.events.on('weak_point_hit', (p) => weakHits.push(p as { id: string; damage: number }));
      const broken: { id: string }[] = [];
      world.events.on('weak_point_broken', (p) => broken.push(p as { id: string }));
      const pops: { enemyId: number; amount: number }[] = [];
      world.events.on('damage_pop', (p) => pops.push(p as { enemyId: number; amount: number }));
      const cleansed: { amount: number; source: string; total: number }[] = [];
      world.events.on('corruption_cleansed', (p) => cleansed.push(p as { amount: number; source: string; total: number }));
      const spawned: { kind: string; x: number; z: number; r: number }[] = [];
      world.events.on('pool_spawned', (p) => spawned.push(p as { kind: string; x: number; z: number; r: number }));
      const evaporated: { kind: string; reason: string }[] = [];
      world.events.on('pool_evaporated', (p) => evaporated.push(p as { kind: string; reason: string }));
      const deflects: unknown[] = [];
      world.events.on('deflect', (p) => deflects.push(p));
      const tag = (st: Status): string => `${st.kind}${st.id ? ':' + st.id : ''}:${st.on}`;
      return { status, hits, windups, starts, shots, closed, weakHits, broken, pops, cleansed, spawned, evaporated, deflects, tag };
    }
    function toP2(boss: EnemyState): void {
      boss.phase = 2;
    }
    /** 갑각 떨기 예고까지 — 돌격(4.5~15)·발구르기(≤ 6)는 쿨다운으로 막는다 */
    function untilVolleyWindup(boss: EnemyState, maxTicks = 60): void {
      boss.chargeCooldown = 9999;
      boss.slamCooldown = 9999;
      tickEnemiesUntil(() => boss.ai === 'windup' && boss.attackMode === 'volley', maxTicks);
    }
    /** 분출공 구체 중심을 권총으로 쏜다 */
    function shootVent(boss: EnemyState): void {
      const c = weakPointWorldPos(boss, def, wp('vent'));
      shootAt(c.x, c.y, c.z);
    }
    /** 게임 틱 한 번 — 적 → 반응 → 상태 → 투사체 → 웅덩이 (main 의 systems 순서에서 이 검증에 필요한 것만) */
    function stepAll(): void {
      Enemies.tick(world, DT);
      Reaction.tick(world, DT);
      Status.tick(world, DT);
      Projectiles.tick(world, DT);
      Hazards.tick(world, DT);
    }
    /** 다음 진액 구슬이 반응 반경에 들면 눌러 반사한다 — 반사된 구슬을 돌려준다 */
    function deflectNextOrb(maxTicks = 400): ProjectileState {
      for (let i = 0; i < maxTicks; i++) {
        stepAll();
        const orb = world.projectiles.find(
          (pr) => pr.owner === 'enemy' && pr.kind === 'goo' && Math.hypot(world.player.x - pr.x, world.player.z - pr.z) <= balance.reaction.radius,
        );
        if (orb) {
          pressReaction();
          expect(orb.owner).toBe('player');
          expect(orb.deflected).toBe(true);
          return orb;
        }
      }
      throw new Error('구슬이 반응 반경에 들지 않았다');
    }
    /** 이 구슬이 사라질 때까지(착탄) 돌린다 */
    function flyUntilGone(orb: ProjectileState, maxTicks = 300): void {
      for (let i = 0; i < maxTicks && world.projectiles.includes(orb); i++) stepAll();
      expect(world.projectiles.includes(orb)).toBe(false);
    }

    it('데이터 — volleyAttack(projectile·48틱·보라·goo·16 m/s·r0.35·반사·부술 수 있음·3발/24틱·16·2.8m·minRange 6·abortRange 4·쿨 540·deflectSelfDamage 33·poolKind orb·corrosive 막아도), vent hp 132(= 33 × 4)·openMul 1.5·damageMul 3.0, 낫 poolKind blade·발구르기 stomp·완벽 회피 skid, balance hazards.pools{blade 1.6, stomp 2.0, orb 1.2, skid 1.6 / 480}·poolMax 12, status.corrosive, corruption 정화 1/6/×2, weakPoint ventGagThreshold 66·choke{1800, 10}. P2 해금 volley, P1 잠김. 족장 volley 는 옛 그대로', () => {
      expect(volley).toMatchObject({
        type: 'projectile', windupTicks: 48, telegraph: 'purple', projectileKind: 'goo', projectileSpeed: 16, projectileRadius: 0.35, deflectable: true, breakable: true,
        shots: 3, shotIntervalTicks: 24, damage: 16, playerKnockback: 2.8, minRange: 6, abortRange: 4, cooldownTicks: 540, deflectSelfDamage: 33, poolKind: 'orb',
        statusOnHit: 'corrosive', statusOnBlock: 'corrosive', parryable: false,
      });
      expect(volley.playerKnockback).toBe(balance.playerKnockback.magic); // "magic 밀림 2.8m"
      expect(volley.muzzleHeightMul! * def.height).toBeCloseTo(wp('vent').offset.y, 6); // 구슬은 분출공에서 나간다
      expect(wp('vent')).toMatchObject({ hp: 132, openMul: 1.5, damageMul: 3.0, exposedStates: ['exhaust'] }); // 자세 노출은 탈진(B3-4)만
      expect(wp('vent').hp).toBe(volley.deflectSelfDamage! * 4); // 반사 4회 = 질식
      expect(wpc.ventGagThreshold).toBe(66);
      expect(wpc.ventGagThreshold).toBe(pistol.damage * wp('vent').openMul! * 4); // 예고 중 권총 4발
      expect(wpc.choke).toEqual({ sealTicks: 1800, windupPenalty: 10 });
      expect(def.attack.poolKind).toBe('blade');
      expect(def.attackAlt!.poolKind).toBe('blade');
      expect(def.slamAttack!.poolKind).toBe('stomp');
      expect(def.chargeAttack!.perfectDodgeExposes!.poolKind).toBe('skid');
      expect(def.closeAttack!.poolKind).toBeUndefined();
      expect(balance.hazards.pools).toEqual({ blade: { radius: 1.6, ticks: 480 }, stomp: { radius: 2.0, ticks: 480 }, orb: { radius: 1.2, ticks: 480 }, skid: { radius: 1.6, ticks: 480 } });
      expect(balance.hazards.poolMax).toBe(12);
      expect(balance.status.corrosive).toEqual({ moveSpeedMul: 0.6, dotPerTick: 2, dotIntervalTicks: 30, lingerTicks: 30, pendingPerTicks: 60, pendingCap: 8 });
      expect(balance.corruption).toMatchObject({ ventHitCleanse: 1, ventCleanseCap: 6, corrosiveCleanseMul: 2 });
      expect(resolvePhase(def, 2)!.unlock.has('volley')).toBe(true);
      expect(resolvePhase(def, 2)!.poolsOn).toBe(true);
      expect(resolvePhase(def, 3)!.poolsOn).toBe(false);
      expect(slotUnlocked(def, { phase: 3 }, 'volley')).toBe(false);
      expect(slotUnlocked(def, { phase: 2 }, 'volley')).toBe(true);
      // 족장 화살 세례는 새 필드가 없다(옛 경로)
      const chief = enemyDef('goblin_chieftain').volleyAttack!;
      expect(chief.deflectSelfDamage).toBeUndefined();
      expect(chief.poolKind).toBeUndefined();
      expect(chief.statusOnHit).toBeUndefined();
      expect(slotUnlocked(enemyDef('goblin_chieftain'), {}, 'volley')).toBe(true);
      // 스포너 — 분출공 내구가 장부에 오른다
      expect(spawnEnemyAt(TYPE, 20, 10, 9).weakHp).toEqual({ joint_r: 132, joint_l: 132, vent: 132 });
    });

    it('P1 에선 8m 에서 갑각 떨기가 나오지 않고(걸어온다) 웅덩이도 없다(낫 착지·발구르기·미끄러짐 어느 것도). P2 에선 8m 에서 갑각 떨기: 예고 48·보라·enemy_volley_start{shots 3}, 예고·시전 내내 분출공 열림(×1.5), 3발이 24틱 간격으로 kind goo 로 나가고, 시전이 끝나면 분출공이 닫힌다(exposure_closed{vent})', () => {
      Hazards.init(world);
      const boss = makeBehemoth(8.0);
      boss.chargeCooldown = 9999;
      const w = watch();
      const x0 = boss.x;
      for (let i = 0; i < 20; i++) Enemies.tick(world, DT);
      expect(boss.attackMode ?? 'melee').not.toBe('volley');
      expect(boss.x).toBeLessThan(x0);
      expect(w.starts).toHaveLength(0);
      expect(weakPointOpen(boss, wp('vent'))).toBe(false);
      // P1 낫 착지 — 웅덩이 없음
      world.enemies.length = 0;
      const b1 = makeBehemoth(4.0);
      tickEnemiesUntil(() => b1.ai === 'recover', 120);
      expect(w.hits).toHaveLength(1);
      expect(world.pools).toHaveLength(0);
      expect(w.spawned).toHaveLength(0);
      // P2 — 갑각 떨기
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.kbTicks = 0;
      const b2 = makeBehemoth(8.0);
      toP2(b2);
      untilVolleyWindup(b2, 5);
      expect(b2.timer).toBe(volley.windupTicks);
      expect(w.windups.at(-1)).toMatchObject({ telegraph: 'purple' });
      expect(w.starts).toEqual([expect.objectContaining({ shots: 3 })]);
      // 분출공 — 예고 첫 틱부터 열려 있다(노출 타이머), 배율은 openMul 1.5
      expect(weakPointOpen(b2, wp('vent'))).toBe(true);
      expect(b2.exposure?.['vent']).toBeGreaterThan(0);
      expect(w.status.map(w.tag)).toEqual(['expose:vent:true']);
      const hp0 = b2.health;
      shootVent(b2);
      expect(w.weakHits).toEqual([expect.objectContaining({ id: 'vent', damage: pistol.damage * 1.5 })]);
      expect(b2.health).toBeCloseTo(hp0 - pistol.damage * 1.5, 5);
      expect(b2.weakHp!['vent']).toBeCloseTo(132 - pistol.damage * 1.5, 5);
      // 예고 내내 열려 있고 눈·관절·심장은 닫혀 있다
      for (let i = 0; i < volley.windupTicks - 2; i++) {
        Enemies.tick(world, DT);
        expect(b2.ai).toBe('windup');
        expect(weakPointOpen(b2, wp('vent'))).toBe(true);
        expect(weakPointOpen(b2, wp('eye'))).toBe(false);
        expect(weakPointOpen(b2, wp('heart'))).toBe(false);
      }
      tickEnemiesUntil(() => b2.ai === 'volley', 5);
      expect(b2.volleyLeft).toBe(3);
      // 첫 발은 예고가 끝나는 즉시, 이어서 24틱 간격
      Enemies.tick(world, DT);
      expect(world.projectiles).toHaveLength(1);
      const orb = world.projectiles[0]!;
      expect(orb).toMatchObject({ owner: 'enemy', kind: 'goo', deflectable: true, breakable: true, radius: 0.35, damage: 16, deflectSelfDamage: 33, poolKind: 'orb', statusOnHit: 'corrosive', statusOnBlock: 'corrosive', playerKnockback: 2.8, casterId: b2.id });
      expect(Math.hypot(orb.vx, orb.vy, orb.vz)).toBeCloseTo(16, 5);
      expect(orb.y).toBeCloseTo(wp('vent').offset.y, 6); // 분출공 높이에서 나간다
      expect(weakPointOpen(b2, wp('vent'))).toBe(true); // 시전 중에도 열려 있다
      // 발사 간격 — shotIntervalTicks(24)만큼 기다린 다음 틱에 쏜다(족장 화살 세례와 같은 volley 파이프: 24틱 대기 + 발사 틱)
      for (let i = 0; i < 24; i++) Enemies.tick(world, DT);
      expect(world.projectiles).toHaveLength(1);
      Enemies.tick(world, DT);
      expect(world.projectiles).toHaveLength(2);
      for (let i = 0; i < 25; i++) Enemies.tick(world, DT);
      expect(world.projectiles).toHaveLength(3);
      expect(w.shots.map((s) => s.left)).toEqual([2, 1, 0]);
      expect(b2.ai).toBe('recover');
      expect(b2.volleyCooldown).toBe(volley.cooldownTicks);
      // 시전이 끝난 다음 틱 분출공이 닫힌다 — 그 창 안의 명중 1
      Enemies.tick(world, DT);
      expect(weakPointOpen(b2, wp('vent'))).toBe(false);
      expect(w.closed).toEqual([expect.objectContaining({ id: 'vent', hits: 1 })]);
      expect(w.status.map(w.tag)).toEqual(['expose:vent:true', 'expose:vent:false']);
      // 닫힌 분출공은 몸통 0.8× — 약점 장부에 안 오른다
      shootVent(b2);
      expect(w.weakHits).toHaveLength(1);
    });

    it('진액 구슬 직격 — 16 + magic 밀림 2.8m + 오염 진액(lingerTicks 30, corrosive_applied) + 착탄 자리 웅덩이(orb r1.2). 막아도 붙는다(칩 4.8 + 오염 진액), 무적이면 지나간다. 구슬 3발이 순서대로 웅덩이를 남긴다', () => {
      Hazards.init(world);
      const boss = makeBehemoth(8.0);
      toP2(boss);
      const w = watch();
      const applied: unknown[] = [];
      world.events.on('corrosive_applied', (p) => applied.push(p));
      untilVolleyWindup(boss, 5);
      // 첫 구슬이 플레이어에 닿을 때까지
      for (let i = 0; i < 200 && w.hits.length === 0; i++) stepAll();
      expect(w.hits).toEqual([expect.objectContaining({ amount: 16, blocked: false })]);
      expect(world.player.health).toBe(84);
      expect(world.player.kbTicks).toBe(balance.playerKnockback.ticks);
      expect(Math.hypot(world.player.kbX!, world.player.kbZ!) * balance.playerKnockback.ticks).toBeCloseTo(2.8, 5);
      expect(playerStatusTicks(world.player, 'corrosive')).toBe(balance.status.corrosive.lingerTicks); // 직격이 세운 값 — Status 는 다음 틱에 알린다
      Status.tick(world, DT);
      expect(applied).toHaveLength(1);
      expect(w.spawned).toEqual([expect.objectContaining({ kind: 'orb', r: 1.2 })]);
      expect(Math.hypot(w.spawned[0]!.x - world.player.x, w.spawned[0]!.z - world.player.z)).toBeLessThan(1.0); // 발밑
      expect(world.pools).toHaveLength(1);
      expect(world.pools[0]).toMatchObject({ kind: 'orb', r: 1.2, ticks: expect.any(Number) });
      // 둘째 구슬은 막는다 — 칩만 들어오되 진액은 붙고 밀림은 1/3
      world.player.kbTicks = 0;
      world.input = { ...Input.emptySnapshot(), reactionHeld: true };
      Reaction.tick(world, DT);
      expect(world.player.blocking).toBe(true);
      for (let i = 0; i < 200 && w.hits.length === 1; i++) {
        Enemies.tick(world, DT);
        Projectiles.tick(world, DT);
        Hazards.tick(world, DT);
      }
      world.input = Input.emptySnapshot();
      expect(w.hits[1]).toMatchObject({ amount: 16 * balance.block.chipDamageRatio, blocked: true });
      expect(Math.hypot(world.player.kbX!, world.player.kbZ!) * balance.playerKnockback.ticks).toBeCloseTo(2.8 * balance.playerKnockback.blockedMul, 5);
      expect(world.pools).toHaveLength(2);
      // 셋째 구슬 — 회피 무적이면 통과해 벽·바닥에 떨어져 거기 웅덩이
      world.player.blocking = false;
      for (let i = 0; i < 200 && world.pools.length < 3; i++) {
        world.player.iframeTicks = 5;
        Enemies.tick(world, DT);
        Projectiles.tick(world, DT);
        Hazards.tick(world, DT);
      }
      expect(w.hits).toHaveLength(2);
      expect(world.pools).toHaveLength(3);
      expect(w.spawned.every((s) => s.kind === 'orb')).toBe(true);
    });

    it('반사됐지만 시전자를 빗나간 구슬(보스가 비켜 몸 상자를 놓침)은 벽에 닿아도 웅덩이를 남기지 않는다 — 플레이어 소유(deflected) 투사체가 플레이어를 해치는 장판을 만들지 않는다(B3-2 잔여 메모 → B3-6, 기획서 §10.2). 반사 안 된 구슬은 그대로 웅덩이', () => {
      Hazards.init(world);
      const boss = makeBehemoth(8.0);
      toP2(boss);
      const w = watch();
      untilVolleyWindup(boss, 5);
      const orb = deflectNextOrb();
      // 보스를 옆으로 크게 비켜 세운다 — 되돌아가는 구슬이 몸 상자를 놓치고 뒤 벽에 닿는다
      boss.x = 20;
      boss.z = 14.5;
      boss.prevX = boss.x;
      boss.prevZ = boss.z;
      boss.ai = 'recover';
      boss.timer = 9999;
      boss.attackMode = 'melee';
      world.projectiles.splice(0, world.projectiles.length, orb); // 뒤따르는 구슬은 치우고 이 구슬만 본다
      flyUntilGone(orb);
      expect(w.weakHits).toHaveLength(0); // 분출공에 닿지 않았다
      expect(w.spawned).toHaveLength(0);
      expect(world.pools).toHaveLength(0);
      // 대조 — 반사되지 않은 구슬이 플레이어 뒤 벽에 닿으면 orb 웅덩이
      world.projectiles.push({ ...orb, id: orb.id + 1, owner: 'enemy', deflected: false, x: 8, y: 1.6, z: 6, vx: -16, vy: 0, vz: 0 });
      for (let i = 0; i < 120 && world.projectiles.length > 0; i++) stepAll();
      expect(w.spawned).toEqual([expect.objectContaining({ kind: 'orb' })]);
    });

    it('반사 노선 — 반응 반경 안의 구슬을 누르면 반사(deflect)돼 시전자 가슴으로 되돌아가 분출공에 고정 33(배율·열림 무관 — 시전이 끝나 닫힌 뒤에도) + weak_point_hit{vent 33} + damage_pop 33 + 오염 대기 −1(corruption_cleansed) — 웅덩이는 남기지 않는다. 뒤따라오는 구슬과 부딛혀 깨지지 않는다. 4회(볼리 2번)면 내구 0 → 질식: boss_status choke{ticks 1800} + 웅덩이 전부 증발 + 갑각 떨기 봉인(8m 에서 걸어온다) + 예고 +10(낫 32 → 42) + 분출공 닫힘·hp 0. 1800틱 뒤 hp 132 복귀·choke off·갑각 떨기 재개', () => {
      Hazards.init(world);
      Corruption.init(world);
      world.corruption.pending = 5;
      const boss = makeBehemoth(8.0);
      toP2(boss);
      const w = watch();
      const broken: unknown[] = [];
      world.events.on('projectile_broken', (p) => broken.push(p));
      untilVolleyWindup(boss, 5);
      // 첫 볼리 — 세 발 전부 반사
      const hpBefore = boss.health;
      for (let n = 1; n <= 3; n++) {
        const orb = deflectNextOrb();
        expect(orb.damage).toBeCloseTo(16 * 1.5, 5); // 반사 규약(×1.5)은 그대로지만 분출공엔 고정 33 이 들어간다
        flyUntilGone(orb);
        expect(w.weakHits).toHaveLength(n);
        expect(w.weakHits[n - 1]).toMatchObject({ id: 'vent', damage: 33 });
        expect(boss.weakHp!['vent']).toBe(132 - 33 * n);
        expect(w.cleansed).toHaveLength(n);
        expect(w.cleansed[n - 1]).toMatchObject({ amount: 1, source: 'vent', total: n });
        expect(world.corruption.pending).toBe(5 - n);
      }
      expect(w.deflects).toHaveLength(3);
      expect(broken).toHaveLength(0); // 되돌아가는 구슬이 다음 구슬을 깨지 않았다
      expect(boss.health).toBeCloseTo(hpBefore - 99, 5);
      expect(w.pops.filter((p) => p.amount === 33)).toHaveLength(3);
      expect(w.hits).toHaveLength(0);
      expect(world.pools).toHaveLength(0); // 분출공으로 되돌아간 구슬은 웅덩이가 없다
      expect(w.spawned).toHaveLength(0);
      expect(world.corruption.applied).toBe(0); // applied 는 불변
      expect(boss.chokeTicks ?? 0).toBe(0);
      // 둘째 볼리 — 첫 구슬 반사로 내구 0 → 질식. 그 사이 웅덩이 하나를 놓아 증발을 본다
      Hazards.spawnPool(world, 20, 12, 'blade');
      expect(world.pools).toHaveLength(1);
      boss.volleyCooldown = 0;
      untilVolleyWindup(boss, 120);
      const orb4 = deflectNextOrb();
      flyUntilGone(orb4);
      expect(boss.weakHp!['vent']).toBe(0);
      expect(w.broken).toEqual([expect.objectContaining({ id: 'vent' })]);
      // 질식은 다음 Enemies 틱의 장부에서 — 이미 stepAll 이 돌았을 수 있으니 한 틱 더
      tickEnemiesUntil(() => (boss.chokeTicks ?? 0) > 0, 3);
      expect(boss.chokeTicks).toBeGreaterThanOrEqual(wpc.choke.sealTicks - 2);
      const choke = w.status.find((st) => st.kind === 'choke' && st.on)!;
      expect(choke).toMatchObject({ kind: 'choke', on: true, ticks: wpc.choke.sealTicks });
      expect(w.status.filter((st) => st.kind === 'rupture')).toHaveLength(0); // 파열이 아니다
      expect(world.pools).toHaveLength(0);
      expect(w.evaporated).toEqual([expect.objectContaining({ kind: 'blade', reason: 'choke' })]);
      expect(boss.attackMode).not.toBe('volley'); // 시전이 접혔다(남은 두 발 없음)
      expect(weakPointOpen(boss, wp('vent'))).toBe(false);
      expect(w.cleansed).toHaveLength(4);
      // 봉인 — 8m 에서 쿨다운이 비어도 갑각 떨기가 안 나간다(걸어온다)
      boss.volleyCooldown = 0;
      tickEnemiesUntil(() => boss.ai === 'chase', 120);
      const x0 = boss.x;
      for (let i = 0; i < 30; i++) Enemies.tick(world, DT);
      expect(boss.attackMode ?? 'melee').not.toBe('volley');
      expect(boss.x).toBeLessThan(x0);
      // 예고 +10 — 낫 사거리에 두면 예고 42
      boss.x = world.player.x + 4.0;
      boss.prevX = boss.x;
      boss.closeCooldown = 9999;
      tickEnemiesUntil(() => boss.ai === 'windup', 10);
      expect(boss.timer).toBe(def.attack.windupTicks + wpc.choke.windupPenalty);
      // 질식 중 되돌아온 구슬(가상)은 분출공이 없으니 몸 피해(옛 반사 경로)로 — 여기선 hp 가 0 인 채 유지되는지만
      expect(boss.weakHp!['vent']).toBe(0);
      // 1800틱이 다하면 hp 복귀 + choke off, 갑각 떨기가 다시 나간다
      boss.ai = 'recover';
      boss.timer = 9999;
      boss.attackMode = 'melee';
      for (let i = 0; i < wpc.choke.sealTicks + 2 && (boss.chokeTicks ?? 0) > 0; i++) Enemies.tick(world, DT);
      expect(boss.chokeTicks).toBe(0);
      expect(boss.weakHp!['vent']).toBe(132);
      expect(w.status.filter((st) => st.kind === 'choke').map((st) => st.on)).toEqual([true, false]);
      boss.ai = 'chase';
      boss.timer = 0;
      boss.x = world.player.x + 8;
      boss.prevX = boss.x;
      boss.volleyCooldown = 0;
      untilVolleyWindup(boss, 5);
      expect(w.starts).toHaveLength(3);
    });

    it('갑각 떨기 예고 중 분출공 직격 누적 66(권총 4발 × 16.5) → 역류: 시전 취소(구슬 안 나감·attackMode melee·쿨다운은 문다) + head_down 60 cause backflow(눈 열림·혼절 누적 없음) + boss_status backflow{cause vent, selfDamage 0} — 자해·봉인 없음. 시전(volley) 중 직격은 역류가 아니다. 일어서며 기상 발구르기', () => {
      const boss = makeBehemoth(8.0);
      toP2(boss);
      const w = watch();
      const staggers: unknown[] = [];
      world.events.on('boss_staggered', (p) => staggers.push(p));
      untilVolleyWindup(boss, 5);
      const hp0 = boss.health;
      for (let i = 0; i < 4; i++) shootVent(boss);
      expect(boss.weakAccum!['vent']).toBeCloseTo(66, 5);
      expect(boss.ai).toBe('windup');
      Enemies.tick(world, DT);
      expect(boss.attackMode).toBe('melee');
      expect(boss.pose).toBe('head_down');
      expect(boss.poseCause).toBe('backflow');
      expect(boss.poseTicks).toBe(wpc.headDown.backflowTicks);
      expect(boss.volleyLeft ?? 0).toBe(0);
      expect(boss.volleyCooldown).toBe(volley.cooldownTicks);
      expect(boss.health).toBeCloseTo(hp0 - 66, 5); // 자해 없음
      expect(boss.weakCooldown?.['vent']).toBeUndefined(); // 봉인 없음
      expect(world.projectiles).toHaveLength(0);
      expect(w.status.map(w.tag)).toEqual(['expose:vent:true', 'expose:vent:false', 'backflow:true', 'head_down:true']);
      expect(w.status[2]).toMatchObject({ kind: 'backflow', on: true, cause: 'vent', ticks: 60, selfDamage: 0 });
      expect(w.closed).toEqual([expect.objectContaining({ id: 'vent', hits: 4 })]);
      expect(weakPointOpen(boss, wp('vent'))).toBe(false);
      expect(weakPointOpen(boss, wp('eye'))).toBe(true);
      // 머리 내림 중 눈 66 — 혼절 없음(역류 원인)
      shootEye(boss);
      shootEye(boss);
      Enemies.tick(world, DT);
      expect(staggers).toHaveLength(0);
      expect(boss.pose).toBe('head_down');
      tickEnemiesUntil(() => boss.ai === 'chase', 70);
      expect(w.status.map(w.tag).slice(4)).toEqual(['head_down:false', 'backflow:false']);
      expect(boss.wakeSlamPending).toBe(true);
      // 대조 — 시전(volley) 중 4발은 피해·정화만, 역류 없음
      world.enemies.length = 0;
      const b2 = makeBehemoth(8.0);
      toP2(b2);
      untilVolleyWindup(b2, 5);
      tickEnemiesUntil(() => b2.ai === 'volley', 60);
      for (let i = 0; i < 4; i++) shootVent(b2);
      Enemies.tick(world, DT);
      expect(b2.ai).toBe('volley');
      expect(b2.pose).toBeUndefined();
      expect(b2.weakHp!['vent']).toBeCloseTo(132 - 66, 5);
    });

    it('정화 장부 — 분출공 명중마다 오염 대기 −1, 오염 진액 부착 중 ×2, 전투당 상한 −6(넘으면 corruption_cleansed 없음·pending 그대로), applied 불변. pending 은 음수가 될 수 있고 제단 정산은 0 이하를 건너뛴다', () => {
      Corruption.init(world);
      world.corruption.pending = 2;
      world.corruption.applied = 30;
      const boss = makeBehemoth(8.0);
      toP2(boss);
      const w = watch();
      untilVolleyWindup(boss, 5);
      shootVent(boss);
      expect(w.cleansed).toEqual([expect.objectContaining({ amount: 1, total: 1 })]);
      expect(world.corruption.pending).toBe(1);
      // 부착 중 ×2
      setPlayerStatus(world.player, 'corrosive', 30);
      shootVent(boss);
      expect(w.cleansed[1]).toMatchObject({ amount: 2, total: 3 });
      expect(world.corruption.pending).toBe(-1);
      shootVent(boss);
      expect(w.cleansed[2]).toMatchObject({ amount: 2, total: 5 });
      shootVent(boss); // 상한 6 — 남은 1 만
      expect(w.cleansed[3]).toMatchObject({ amount: 1, total: 6 });
      expect(world.corruption.pending).toBe(-4);
      expect(boss.fightCleansed).toBe(6);
      // 상한 뒤 — 명중은 들어가되 정화는 없다(역류가 났으니 새 예고에서)
      Enemies.tick(world, DT); // 66 누적 → 역류
      expect(boss.pose).toBe('head_down');
      boss.exposure = { vent: 900 }; // 시험용 — 분출공을 억지로 열어 둔다(장부만 본다)
      boss.weakAccum!['vent'] = 0;
      shootVent(boss);
      expect(w.weakHits).toHaveLength(5);
      expect(w.cleansed).toHaveLength(4);
      expect(world.corruption.pending).toBe(-4);
      expect(world.corruption.applied).toBe(30);
      // 제단 정산 — 음수 pending 은 그대로 남고 applied 도 그대로
      Corruption.settle(world);
      expect(world.corruption.applied).toBe(30);
      expect(world.corruption.pending).toBe(-4);
      world.corruption.pending += 6; // 각인 하나(8~15)의 일부가 여유로 상쇄되는 그림
      Corruption.settle(world);
      expect(world.corruption.applied).toBe(32);
      expect(world.corruption.pending).toBe(0);
    });

    it('웅덩이 — P2 낫 착지점(낫끝 4.4m 앞, blade r1.6·480틱)에 웅덩이가 생겨 밟은 플레이어에게 오염 진액이 붙는다(패링하면 착지가 없으니 웅덩이도 없다), 발구르기 착지 중심 stomp r2.0, 완벽 회피 미끄러짐 자리 skid r1.6. P1 에선 셋 다 없다', () => {
      Hazards.init(world);
      const w = watch();
      // 낫 — 맞은 자리(4.0m)가 곧 낫끝, 밀린 플레이어(2.0m)는 반경 밖 근처, 여기선 넉백을 지워 웅덩이 위에 남는다
      const boss = makeBehemoth(4.0);
      toP2(boss);
      tickEnemiesUntil(() => boss.ai === 'recover', 120);
      expect(w.hits).toHaveLength(1);
      expect(w.spawned).toEqual([expect.objectContaining({ kind: 'blade', r: 1.6 })]);
      const pool = world.pools[0]!;
      expect(pool).toMatchObject({ kind: 'blade', r: 1.6, ticks: 480, duration: 480 });
      expect(pool.x).toBeCloseTo(boss.x - 4.4, 3); // 낫끝 = 사거리 끝(정면 -x)
      expect(pool.z).toBeCloseTo(boss.z, 3);
      expect(playerStatusTicks(world.player, 'corrosive')).toBe(0);
      Hazards.tick(world, DT);
      expect(playerStatusTicks(world.player, 'corrosive')).toBe(balance.status.corrosive.lingerTicks);
      // 패링 — 웅덩이 없음
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.kbTicks = 0;
      const b2 = makeBehemoth(4.0);
      toP2(b2);
      expect(normalParry(b2)).toBe('normal');
      tickEnemiesUntil(() => b2.ai === 'chase', 200);
      expect(world.pools).toHaveLength(1);
      // 발구르기 착지 — 중심에 stomp r2.0
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.kbTicks = 0;
      const b3 = makeBehemoth(5.0);
      toP2(b3);
      b3.chargeCooldown = 9999;
      tickEnemiesUntil(() => b3.ai === 'windup' && b3.attackMode === 'slam', 30);
      tickEnemiesUntil(() => b3.ai === 'recover', 60);
      expect(w.spawned.at(-1)).toMatchObject({ kind: 'stomp', r: 2.0 });
      expect(Math.hypot(w.spawned.at(-1)!.x - b3.x, w.spawned.at(-1)!.z - b3.z)).toBeLessThan(1e-6);
      // 완벽 회피 — 미끄러진 자리에 skid r1.6
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.kbTicks = 0;
      world.player.x = 6;
      world.player.prevX = 6;
      const b4 = makeBehemoth(10);
      toP2(b4);
      tickEnemiesUntil(() => b4.ai === 'charging', 300);
      const cd = Enemies.contactDist(def);
      tickEnemiesUntil(() => Math.hypot(b4.x - world.player.x, b4.z - world.player.z) <= cd + 1.0, 300);
      world.player.iframeTicks = 1e9;
      world.player.iframeSource = 'dodge';
      tickEnemiesUntil(() => b4.pose === 'skid', 60);
      world.player.iframeTicks = 0;
      expect(w.spawned.at(-1)).toMatchObject({ kind: 'skid', r: 1.6 });
      expect(Math.hypot(w.spawned.at(-1)!.x - b4.x, w.spawned.at(-1)!.z - b4.z)).toBeLessThan(1e-6);
      expect(world.pools).toHaveLength(3);
      // P1 대조 — 셋 다 없다
      Hazards.clearAll(world);
      const before = w.spawned.length;
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.kbTicks = 0;
      world.player.iframeTicks = 0;
      const p1 = makeBehemoth(4.0);
      tickEnemiesUntil(() => p1.ai === 'recover', 120);
      world.enemies.length = 0;
      world.player.health = 100;
      world.player.kbTicks = 0;
      const p1b = makeBehemoth(10);
      tickEnemiesUntil(() => p1b.ai === 'charging', 300);
      tickEnemiesUntil(() => Math.hypot(p1b.x - world.player.x, p1b.z - world.player.z) <= cd + 1.0, 300);
      world.player.iframeTicks = 1e9;
      world.player.iframeSource = 'dodge';
      tickEnemiesUntil(() => p1b.pose === 'skid', 60);
      world.player.iframeTicks = 0;
      expect(w.spawned.length).toBe(before);
      expect(world.pools).toHaveLength(0);
    });

    it('갑각 떨기는 abortRange 4 안으로 붙으면 접고(쿨다운은 문다) 분출공도 닫힌다. 페이즈 전환이 예고 중 끼면 분출공 노출을 닫고 포효로(진행 중 시전 취소). 족장 화살 세례는 분출공·웅덩이·정화 어느 것도 없다(옛 경로)', () => {
      const boss = makeBehemoth(8.0);
      toP2(boss);
      const w = watch();
      untilVolleyWindup(boss, 5);
      expect(weakPointOpen(boss, wp('vent'))).toBe(true);
      boss.x = world.player.x + 3.5;
      boss.prevX = boss.x;
      boss.closeCooldown = 9999;
      Enemies.tick(world, DT);
      expect(boss.ai).toBe('chase');
      expect(boss.attackMode).toBe('melee');
      expect(boss.volleyCooldown ?? 0).toBe(0); // 예고 중 접은 것은 옛 경로 그대로(쿨다운 없음) — 시전 중 접으면 문다
      Enemies.tick(world, DT);
      expect(weakPointOpen(boss, wp('vent'))).toBe(false);
      expect(w.closed).toEqual([expect.objectContaining({ id: 'vent' })]);
      // 페이즈 전환 — 예고 중 칸이 비면 시전 취소 + 분출공 닫힘 + 포효
      world.enemies.length = 0;
      const b2 = makeBehemoth(8.0);
      toP2(b2);
      untilVolleyWindup(b2, 5);
      b2.health = (def.health / def.healthBars!) * 1; // 500 — 2칸째가 빈다 → P3
      Enemies.tick(world, DT);
      expect(b2.phase).toBe(1);
      expect(b2.pose).toBe('roar');
      expect(b2.attackMode).toBe('melee');
      expect(weakPointOpen(b2, wp('vent'))).toBe(false);
      expect(b2.exposure?.['vent']).toBeUndefined();
      expect(world.projectiles).toHaveLength(0);
      // 족장 — 옛 경로
      world.enemies.length = 0;
      world.player.health = 100;
      const chief = spawnEnemyAt('goblin_chieftain', 6 + 9, 6, 2);
      chief.ai = 'chase';
      chief.chargeCooldown = 9999;
      world.enemies.push(chief);
      tickEnemiesUntil(() => chief.ai === 'volley', 120);
      Enemies.tick(world, DT);
      expect(world.projectiles).toHaveLength(1);
      expect(world.projectiles[0]!.kind).toBe('arrow');
      expect(world.projectiles[0]!.deflectSelfDamage).toBeUndefined();
      expect(world.projectiles[0]!.poolKind).toBeUndefined();
      expect(chief.exposure).toBeUndefined();
      expect(chief.chokeTicks).toBeUndefined();
    });
  });

  describe('B3-3 갑각판 hp 풀·골드 (기획서 §4.3·§8 P2→P3·§11)', () => {
    const sp = def.shellPlates!;
    const perBar = def.health / def.healthBars!; // 500
    const hammer = balance.weapons.hammer;
    const finisher = hammer.damage * hammer.combo.damageMul; // 36 — 3타 강타
    type Broken = { enemyId: number; enemyType: string; gold: number; platesLeft: number; count: number; ventScale: number; x: number; z: number };
    function watch() {
      const broken: Broken[] = [];
      world.events.on('plate_broken', (p) => broken.push(p as Broken));
      const sheds: { count: number }[] = [];
      world.events.on('plate_shed', (p) => sheds.push(p as { count: number }));
      const pouches: { owner?: string; tier: string; entries: number }[] = [];
      world.events.on('pouch_dropped', (p) => pouches.push(p as { owner?: string; tier: string; entries: number }));
      return { broken, sheds, pouches };
    }
    function toP2(boss: EnemyState): void {
      boss.phase = 2;
    }
    /** 해머 3타 콤보 한 번(1·2 = 15, 3 = 강타 36) — 몸 반경 안에 서 있어야 한다 */
    function hammerCombo(): void {
      for (let i = 0; i < hammer.combo.finisherStep; i++) hammerSwing();
    }
    const goldPouches = () => world.groundItems.filter((g) => g.kind === 'pouch');

    it('데이터 — shellPlates{3, 60, 6~10, ×1.15}, 스포너 platesLeft 3·plateHp 60·ventScale 없음, 활성은 P2 만(shellPlatesOn ∧ ¬shedPlates ∧ 남은 판), 분출공 반지름 = 0.3 × ventScale. 족장엔 없다', () => {
      expect(sp).toEqual({ count: 3, hpEach: 60, goldMin: 6, goldMax: 10, ventScalePerPlate: 1.15 });
      expect(resolvePhase(def, 2)!.shellPlatesOn).toBe(true);
      expect(resolvePhase(def, 1)!.shedPlates).toBe(true);
      const boss = makeBehemoth(4.0);
      expect(boss.platesLeft).toBe(3);
      expect(boss.plateHp).toBe(60);
      expect(boss.ventScale).toBeUndefined();
      expect(shellPlatesActive(def, boss)).toBe(false); // P1
      expect(shellPlatesActive(def, { phase: 2, platesLeft: 3 })).toBe(true);
      expect(shellPlatesActive(def, { phase: 2, platesLeft: 0 })).toBe(false);
      expect(shellPlatesActive(def, { phase: 1, platesLeft: 3 })).toBe(false); // P3 — 탈락
      expect(weakPointRadius(boss, wp('vent'))).toBe(0.3);
      expect(weakPointRadius({ ventScale: 1.15 }, wp('vent'))).toBeCloseTo(0.345, 6);
      expect(weakPointRadius({ ventScale: 1.15 }, wp('eye'))).toBe(0.26); // 다른 약점은 그대로
      const chief = spawnEnemyAt('goblin_chieftain', 20, 6, 2);
      expect(enemyDef('goblin_chieftain').shellPlates).toBeUndefined();
      expect(chief.platesLeft).toBeUndefined();
      expect(shellPlatesActive(enemyDef('goblin_chieftain'), chief)).toBe(false);
      world.enemies.push(chief);
      expect(hitShellPlates(world, chief, 100)).toBe(0);
    });

    it('P2 해머 강타 — 콤보 한 번에 3타(36)만 판을 깎고(1·2타 무관 — 60 → 24), 두 번째 콤보(누적 72 ≥ 60)에 판 한 장 파괴: plate_broken{gold 6~10, platesLeft 2, ventScale 1.15} + 골드 주머니(일반 등급, 낫뿔 거수의 주머니) + 넘친 12 는 다음 판으로(48). 체력은 132 그대로 깎인다', () => {
      Loot.init(world);
      const boss = makeBehemoth(3.5); // 해머 사거리 3.1 + 몸 반경 1.6 안
      toP2(boss);
      const w = watch();
      const hp0 = boss.health;
      hammerCombo();
      expect(boss.health).toBeCloseTo(hp0 - (hammer.damage * 2 + finisher), 5);
      expect(boss.platesLeft).toBe(3);
      expect(boss.plateHp).toBeCloseTo(sp.hpEach - finisher, 5); // 24 — 1·2타(30)는 판에 무관
      expect(w.broken).toHaveLength(0);
      expect(boss.ventScale).toBeUndefined();
      hammerCombo();
      expect(boss.health).toBeCloseTo(hp0 - (hammer.damage * 2 + finisher) * 2, 5);
      expect(boss.platesLeft).toBe(2);
      expect(boss.plateHp).toBeCloseTo(sp.hpEach - (finisher * 2 - sp.hpEach), 5); // 48 — 넘친 12 가 다음 판으로
      expect(boss.ventScale).toBeCloseTo(sp.ventScalePerPlate, 6);
      expect(w.broken).toHaveLength(1);
      expect(w.broken[0]).toMatchObject({ enemyId: boss.id, enemyType: TYPE, platesLeft: 2, count: 3 });
      expect(w.broken[0]!.gold).toBeGreaterThanOrEqual(sp.goldMin);
      expect(w.broken[0]!.gold).toBeLessThanOrEqual(sp.goldMax);
      expect(Number.isInteger(w.broken[0]!.gold)).toBe(true);
      // 주머니 — Loot 의 pouch 규약(pouch_dropped·groundItems), 골드만, 일반 등급(보스 금빛 아님), 주인은 거수
      expect(w.pouches).toEqual([{ id: expect.any(Number), x: expect.any(Number), z: expect.any(Number), owner: TYPE, tier: 'normal', entries: 1, merged: false }]);
      const pouch = goldPouches();
      expect(pouch).toHaveLength(1);
      expect(pouch[0]!.pouchTier).toBe('normal');
      expect(pouch[0]!.pouchOwner).toBe(TYPE);
      expect(pouch[0]!.pouchItems).toEqual([{ kind: 'gold', count: w.broken[0]!.gold }]);
      expect(Loot.pouchTitle(pouch[0])).toBe('낫뿔 거수의 주머니');
      expect(boss.alive).toBe(true); // 보스는 살아서 떨군다
    });

    it('총알은 판에 아무 영향 없음 — P2 몸통 권총 3발(81.6 > 60)에도 platesLeft 3·plateHp 60·plate_broken 없음(몸통 0.8× 는 그대로)', () => {
      Loot.init(world);
      const boss = makeBehemoth(6.0);
      toP2(boss);
      const w = watch();
      const hp0 = boss.health;
      const pistol = balance.weapons.pistol;
      for (let i = 0; i < 3; i++) shootAt(boss.x, 1.6, boss.z);
      expect(hp0 - boss.health).toBeCloseTo(pistol.damage * pistol.hitZones.bodyMul * 3, 5);
      expect(boss.platesLeft).toBe(3);
      expect(boss.plateHp).toBe(sp.hpEach);
      expect(boss.ventScale).toBeUndefined();
      expect(w.broken).toHaveLength(0);
      expect(goldPouches()).toHaveLength(0);
    });

    it('풀 — 60 마다 한 장(정확히 60 이면 파괴), 넘친 피해는 이어져 180 이면 세 장(수류탄 120 = 두 장); 3장 → 분출공 반지름 ×1.15³ 이고 판정 구체도 그만큼 크다(판정 = 그림). 골드는 goldMin~goldMax 균등(rng 0 → 6, 0.999 → 10)', () => {
      Loot.init(world);
      const boss = makeBehemoth(6.0);
      boss.yaw = 0; // 정면 −z
      toP2(boss);
      const w = watch();
      expect(hitShellPlates(world, boss, 59)).toBe(0);
      expect(boss.plateHp).toBe(1);
      expect(hitShellPlates(world, boss, 1, () => 0)).toBe(1); // 정확히 채우면 그 장이 부서진다
      expect(boss.platesLeft).toBe(2);
      expect(boss.plateHp).toBe(sp.hpEach); // 새 판
      expect(w.broken[0]!.gold).toBe(sp.goldMin);
      expect(hitShellPlates(world, boss, sp.hpEach * 2, () => 0.999)).toBe(2); // 120 → 두 장(수류탄 한 방)
      expect(boss.platesLeft).toBe(0);
      expect(w.broken).toHaveLength(3);
      expect(w.broken.map((b) => b.platesLeft)).toEqual([2, 1, 0]);
      expect(w.broken[1]!.gold).toBe(sp.goldMax);
      expect(w.broken[2]!.gold).toBe(sp.goldMax);
      expect(boss.ventScale).toBeCloseTo(Math.pow(sp.ventScalePerPlate, 3), 6); // 1.5209
      expect(w.broken.map((b) => b.ventScale)).toEqual([expect.closeTo(1.15, 6), expect.closeTo(1.3225, 6), expect.closeTo(1.520875, 6)]);
      expect(goldPouches()).toHaveLength(3);
      // 판정 — 분출공을 열고(갑각 떨기 노출 타이머) 중심에서 0.5m 위를 지나는 정면 레이: 열림 반지름 0.42(×openRadiusMul 1.4, B3-6)면 빗나가고 판 3장의 0.639 면 맞는다
      openExposure(world, boss, 'vent', 60);
      const c = weakPointWorldPos(boss, def, wp('vent'));
      const hit = rayHitsWeakPoint(c.x, c.y + 0.5, c.z - 5, 0, 0, 1, boss, def, 0);
      expect(hit?.wp.id).toBe('vent');
      expect(weakPointRadius(boss, wp('vent'))).toBeCloseTo(0.3 * wp('vent').openRadiusMul! * Math.pow(sp.ventScalePerPlate, 3), 6);
      boss.ventScale = 1;
      expect(weakPointRadius(boss, wp('vent'))).toBeCloseTo(0.3 * wp('vent').openRadiusMul!, 6);
      expect(rayHitsWeakPoint(c.x, c.y + 0.5, c.z - 5, 0, 0, 1, boss, def, 0)).toBeNull();
      // 판이 다 부서진 뒤 heavy 타격은 판과 무관
      expect(hitShellPlates(world, boss, 100)).toBe(0);
      expect(w.broken).toHaveLength(3);
    });

    it('P1 에서는 판 hp 가 깎이지 않는다 — hitShellPlates 도 해머 강타도 0, 이벤트·주머니 없음', () => {
      Loot.init(world);
      const boss = makeBehemoth(3.5);
      const w = watch();
      expect(boss.phase).toBe(3);
      expect(hitShellPlates(world, boss, 60)).toBe(0);
      hammerCombo();
      expect(boss.platesLeft).toBe(3);
      expect(boss.plateHp).toBe(sp.hpEach);
      expect(boss.ventScale).toBeUndefined();
      expect(w.broken).toHaveLength(0);
      expect(goldPouches()).toHaveLength(0);
    });

    it('수류탄(120, P2) — 폭심의 거수는 두 장(plate_broken ×2, platesLeft 1, ventScale 1.15²) / 낙석(60 × bossDamageMul 0.6 = 36)은 판 hp 를 36 깎는다 — 폭발·낙석도 heavy', () => {
      Loot.init(world);
      const boss = makeBehemoth(8.0); // 플레이어(6,6)는 수류탄 반경 5 밖
      toP2(boss);
      const w = watch();
      const hp0 = boss.health;
      world.projectiles.push({
        id: 901, owner: 'player', x: boss.x, y: 0.5, z: boss.z, prevX: boss.x, prevY: 0.5, prevZ: boss.z,
        vx: 0, vy: 0, vz: 0, lifeTicks: 1, damage: 0, burnTicks: 0, burnDamagePerTick: 0, radius: 0.2, kind: 'grenade',
      });
      Projectiles.tick(world, DT);
      const grenade = balance.weapons.grenade;
      expect(hp0 - boss.health).toBeCloseTo(grenade.damage, 5);
      expect(w.broken).toHaveLength(2);
      expect(boss.platesLeft).toBe(1);
      expect(boss.plateHp).toBe(sp.hpEach);
      expect(boss.ventScale).toBeCloseTo(sp.ventScalePerPlate ** 2, 6);
      expect(goldPouches()).toHaveLength(2);
      expect(world.player.health).toBe(100);
      // 낙석 — 거수 발밑에서 떨어진다(적이 밟아 발동, 예고 30틱)
      const cfg = balance.traps.types.trap_rockfall;
      const rock: TrapState = {
        id: 501, type: 'trap_rockfall', x: boss.x, z: boss.z, row: Math.floor(boss.z / 4), col: Math.floor(boss.x / 4),
        phase: 'armed', timer: 0, charges: cfg.charges, dirX: 0, dirZ: -1,
      };
      world.traps.push(rock);
      const hp1 = boss.health;
      for (let i = 0; i < cfg.telegraphTicks + 2 && rock.phase !== 'spent'; i++) Traps.tick(world, DT);
      expect(rock.phase).toBe('spent');
      expect(hp1 - boss.health).toBeCloseTo(cfg.enemyDamage * cfg.bossDamageMul, 5); // 36
      expect(boss.platesLeft).toBe(1);
      expect(boss.plateHp).toBeCloseTo(sp.hpEach - cfg.enemyDamage * cfg.bossDamageMul, 5); // 24
      expect(w.broken).toHaveLength(2);
    });

    it('P3 진입 — 남은 판은 골드 없이 탈락: plate_shed{count 2}(부서진 한 장은 빼고), platesLeft 0, plate_broken·주머니 추가 없음, ventScale 은 남는다(균열). 다 부서진 뒤 진입이면 plate_shed 없음. P3 에선 heavy 타격도 판에 무관', () => {
      Loot.init(world);
      const boss = makeBehemoth(6.0);
      toP2(boss);
      const w = watch();
      expect(hitShellPlates(world, boss, sp.hpEach)).toBe(1);
      expect(boss.platesLeft).toBe(2);
      boss.health = perBar; // 500 — 1칸째(P3)
      Enemies.tick(world, DT);
      expect(boss.phase).toBe(1);
      expect(boss.pose).toBe('roar');
      expect(w.sheds).toEqual([{ enemyId: boss.id, enemyType: TYPE, count: 2, x: boss.x, z: boss.z }]);
      expect(boss.platesLeft).toBe(0);
      expect(w.broken).toHaveLength(1);
      expect(goldPouches()).toHaveLength(1);
      expect(boss.ventScale).toBeCloseTo(sp.ventScalePerPlate, 6);
      expect(shellPlatesActive(def, boss)).toBe(false);
      expect(hitShellPlates(world, boss, 200)).toBe(0);
      expect(w.broken).toHaveLength(1);
      // 다 부서진 뒤 P3 — 탈락할 판이 없으니 이벤트도 없다
      world.enemies.length = 0;
      const b2 = makeBehemoth(6.0);
      toP2(b2);
      expect(hitShellPlates(world, b2, sp.hpEach * sp.count)).toBe(3);
      b2.health = perBar;
      Enemies.tick(world, DT);
      expect(b2.phase).toBe(1);
      expect(w.sheds).toHaveLength(1);
      expect(b2.platesLeft).toBe(0);
      // P1 → P3 건너뜀 — 세 장이 그대로 탈락(골드 없음)
      world.enemies.length = 0;
      const b3 = makeBehemoth(6.0);
      b3.health = perBar - 100;
      Enemies.tick(world, DT);
      expect(b3.phase).toBe(1);
      expect(w.sheds).toHaveLength(2);
      expect(w.sheds[1]!.count).toBe(3);
      expect(b3.platesLeft).toBe(0);
      expect(w.broken).toHaveLength(1 + 3); // b2 의 세 장만 — 탈락은 골드 없음
      expect(goldPouches()).toHaveLength(4);
    });
  });

  describe('B3-4 P3 기술 — 포효·위압·절망의 포효·삼연낫·탈진·광란 돌격 (기획서 §4.1 eye C·§5 backflow/exhaust·§6 cowed·§7 P3·§9.2)', () => {
    const wpc = balance.weakPoint;
    const cw = balance.status.cowed;
    const roar = def.roarAttack!;
    const chain = comboChain(def);
    const cc = def.chargeAttack!.chainCharge!;
    const perBar = def.health / def.healthBars!; // 500
    type Status = { kind: string; on: boolean; id?: string; ticks?: number; cause?: string; selfDamage?: number; despair?: boolean };
    function watch() {
      const status: Status[] = [];
      world.events.on('boss_status', (p) => status.push(p as Status));
      const hits: { amount: number; blocked?: boolean; source?: string }[] = [];
      world.events.on('player_damaged', (p) => hits.push(p as { amount: number; blocked?: boolean; source?: string }));
      const roarStarts: { despair: boolean; ticks: number }[] = [];
      world.events.on('enemy_roar_start', (p) => roarStarts.push(p as { despair: boolean; ticks: number }));
      const roars: { despair: boolean; radius: number; dist: number }[] = [];
      world.events.on('enemy_roar', (p) => roars.push(p as { despair: boolean; radius: number; dist: number }));
      const roarHits: { status?: string; pull: number; push: number; despair: boolean }[] = [];
      world.events.on('boss_roar_hit', (p) => roarHits.push(p as { status?: string; pull: number; push: number; despair: boolean }));
      const comboStarts: { steps: number }[] = [];
      world.events.on('enemy_combo_start', (p) => comboStarts.push(p as { steps: number }));
      const comboSteps: { step: number; steps: number; perfectOnly: boolean }[] = [];
      world.events.on('enemy_combo_step', (p) => comboSteps.push(p as { step: number; steps: number; perfectOnly: boolean }));
      const chainTurns: { ticks: number }[] = [];
      world.events.on('enemy_chain_turn', (p) => chainTurns.push(p as { ticks: number }));
      const windups: { telegraph: string; perfectOnly?: boolean }[] = [];
      world.events.on('enemy_windup', (p) => windups.push(p as { telegraph: string; perfectOnly?: boolean }));
      const closed: { id: string; hits: number }[] = [];
      world.events.on('exposure_closed', (p) => closed.push(p as { id: string; hits: number }));
      const weakHits: { id: string; damage: number }[] = [];
      world.events.on('weak_point_hit', (p) => weakHits.push(p as { id: string; damage: number }));
      const parries: { result: string; cowed?: boolean }[] = [];
      world.events.on('parry_attempt', (p) => parries.push(p as { result: string; cowed?: boolean }));
      const staggers: unknown[] = [];
      world.events.on('boss_staggered', (p) => staggers.push(p));
      const slamStarts: { wake: boolean; despair?: boolean }[] = [];
      world.events.on('enemy_slam_start', (p) => slamStarts.push(p as { wake: boolean; despair?: boolean }));
      const applied: { kind: string; ticks: number }[] = [];
      const ended: { kind: string; reason: string }[] = [];
      world.events.on('cowed_applied', (p) => applied.push(p as { kind: string; ticks: number }));
      world.events.on('cowed_ended', (p) => ended.push(p as { kind: string; reason: string }));
      const dodged: unknown[] = [];
      world.events.on('charge_dodged', (p) => dodged.push(p));
      const whiffs: { wall?: boolean }[] = [];
      world.events.on('enemy_whiffed', (p) => whiffs.push(p as { wall?: boolean }));
      const tag = (st: Status): string => `${st.kind}${st.id ? ':' + st.id : ''}:${st.on}`;
      return { status, hits, roarStarts, roars, roarHits, comboStarts, comboSteps, chainTurns, windups, closed, weakHits, parries, staggers, slamStarts, applied, ended, dodged, whiffs, tag };
    }
    /** P3 로 둔다(게임플레이 페이즈 = 체력 칸 index 1). 체력은 그대로라 전환은 일어나지 않는다 */
    function toP3(boss: EnemyState): void {
      boss.phase = 1;
    }
    /** 검증하려는 기술만 남긴다 — 나머지 슬롯은 쿨다운으로 잠근다(포효는 첫 선택·간격을 지운다) */
    function quietExcept(boss: EnemyState, keep: 'roar' | 'combo' | 'charge' | 'none'): void {
      boss.firstPick = undefined;
      boss.roarCooldown = 9999;
      boss.comboCooldown = 9999;
      boss.chargeCooldown = 9999;
      boss.volleyCooldown = 9999;
      boss.slamCooldown = 9999;
      boss.closeCooldown = 9999;
      if (keep === 'combo') boss.comboCooldown = 0;
      if (keep === 'charge') boss.chargeCooldown = 0;
    }
    /** 첫 선택으로 포효를 예약하고 한 틱 — 예고에 들어간다 */
    function startRoar(boss: EnemyState): void {
      boss.firstPick = 'roar';
      Enemies.tick(world, DT);
      expect(boss.attackMode).toBe('roar');
      expect(boss.ai).toBe('windup');
    }
    function untilRoarResolved(boss: EnemyState): void {
      tickEnemiesUntil(() => !(boss.ai === 'windup' && boss.attackMode === 'roar'), 80);
    }
    function startCombo(boss: EnemyState): void {
      tickEnemiesUntil(() => boss.ai === 'windup' && boss.attackMode === 'combo', 30);
    }
    function untilComboStep(boss: EnemyState, step: number): void {
      tickEnemiesUntil(() => boss.attackMode === 'combo' && boss.ai === 'windup' && boss.comboStep === step, 200);
    }
    function shootVent(boss: EnemyState): void {
      const c = weakPointWorldPos(boss, def, wp('vent'));
      shootAt(c.x, c.y, c.z);
    }
    function angleDiff(a: number, b: number): number {
      let d = a - b;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d);
    }

    it('데이터 — roarAttack(type roar·30/30·aoe 12·pushM 1.5·12틱·간격 1200·despair 0.2{36, pull 4, slam 40·rear 8~30}·cowed·빨강·패링 불가), comboAttack 3타(28/22/36, ①② 호 110·34·이음 6·continueOnParry·관절 30/60, ③ aoe 3.2 = 4.4 × 0.7273·40·perfectOnly·noParryBuffer·recover 40/whiff 60, 막으면 numb_arm, 쿨 600), chainCharge{24, 2.5, 12, red}, balance cowed{360, false, 5}·exhaustTicks 150·roarCancelThreshold 66, 눈 exposedStates roar/exhaust·분출공 exhaust·poseOffsets.exhaust = head_down, P3 해금 roar/combo/chainCharge(P2 아님)·firstPick roar, currentAttack 변형(절망 포효 36·연계 발구르기 40/8~30/28/5.5·삼연낫 타), headDownPose', () => {
      expect(roar).toMatchObject({ type: 'roar', windupTicks: 30, recoverTicks: 30, aoeRadius: 12, pushM: 1.5, playerKnockbackTicks: 12, intervalTicks: 1200, despairHealthFrac: 0.2, statusOnHit: 'cowed', telegraph: 'red', parryable: false });
      expect(roar.despair).toEqual({ windupTicks: 36, pull: 4, followUp: 'slam', followUpWindupTicks: 40, followUpRearPose: { from: 8, to: 30 } });
      expect(chain).toHaveLength(3);
      expect(chain[0]).toBe(def.comboAttack);
      expect(chain[0]).toMatchObject({ windupTicks: 28, recoverTicks: 6, arcDeg: 110, damage: 34, playerKnockback: 2.0, parryable: true, telegraph: 'blue', continueOnParry: true, cooldownTicks: 600, statusOnBlock: 'numb_arm', poolKind: 'blade' });
      expect(chain[0]!.exposeOnParry).toEqual({ joint: 'joint_r', normalTicks: 30, perfectTicks: 60 });
      expect(chain[1]).toMatchObject({ windupTicks: 22, recoverTicks: 6, arcDeg: 110, damage: 34, continueOnParry: true });
      expect(chain[1]!.exposeOnParry).toEqual({ joint: 'joint_l', normalTicks: 30, perfectTicks: 60 });
      expect(chain[2]).toMatchObject({ windupTicks: 36, recoverTicks: 40, whiffRecoverTicks: 60, aoeRadius: 3.2, damage: 40, playerKnockback: 2.0, perfectOnly: true, noParryBuffer: true, parryable: true, statusOnBlock: 'numb_arm' });
      expect(chain[2]!.exposeOnParry).toBeUndefined(); // 양낫 — 관절 짝 없음(Stage 는 이걸로 두 낫을 든다)
      expect(chain[2]!.continueOnParry).toBeUndefined();
      expect(chain[2]!.comboNext).toBeUndefined();
      expect(def.attackRange * chain[2]!.impactRangeMul).toBeCloseTo(3.2, 2); // 보이는 낫끝 = 판정 원 반지름
      expect(comboStepAttack(def, 0)).toBe(chain[0]);
      expect(comboStepAttack(def, 2)).toBe(chain[2]);
      expect(comboStepAttack(def, 3)).toBeUndefined();
      expect(cc).toEqual({ turnTicks: 24, tailRadius: 2.5, tailDamage: 12, tailTelegraph: 'red' });
      expect(cw).toEqual({ ticks: 360, normalParryOpensJoint: false, normalParryMana: 5 });
      expect(wpc.headDown.exhaustTicks).toBe(150);
      expect(wpc.roarCancelThreshold).toBe(66);
      expect(wp('eye').exposedStates).toEqual(['head_down', 'roar', 'exhaust']);
      expect(wp('vent').exposedStates).toEqual(['exhaust']);
      // 탈진 표 — 눈·관절·심장은 머리 내림과 같은 자리, 분출공만 내려온 머리에 가리지 않게 가슴 위쪽으로(열린 표적은 보여야 한다)
      const ex = def.poseOffsets!['exhaust']!;
      const hd = def.poseOffsets!['head_down']!;
      for (const id of ['eye', 'joint_r', 'joint_l', 'heart']) expect(ex[id]).toEqual(hd[id]);
      expect(ex['vent']).toEqual({ x: 0, y: 1.6, z: -1.7 });
      expect(ex['vent']!.y).toBeGreaterThan(hd['vent']!.y);
      const p3 = resolvePhase(def, 1)!;
      for (const slot of ['roar', 'combo', 'chainCharge']) {
        expect(p3.unlock.has(slot)).toBe(true);
        expect(slotUnlocked(def, { phase: 1 }, slot)).toBe(true);
        expect(slotUnlocked(def, { phase: 2 }, slot)).toBe(false);
      }
      expect(p3.firstPick).toBe('roar');
      expect(resolvePhase(def, 2)!.firstPick).toBeUndefined();
      // currentAttack 변형
      expect(currentAttack(def, { attackMode: 'roar', phase: 1 })).toBe(roar);
      expect(currentAttack(def, { attackMode: 'roar', phase: 1, despairRoar: true })).toBe(despairRoarAttack(def));
      expect(despairRoarAttack(def)).toMatchObject({ windupTicks: 36, aoeRadius: 12, statusOnHit: 'cowed' });
      expect(roar.windupTicks).toBe(30); // 원본은 그대로
      const ds = despairSlamAttack(def)!;
      expect(ds.windupTicks).toBe(40);
      expect(ds.rearPose).toEqual({ from: 8, to: 30 });
      expect(def.slamAttack!.rearPose).toEqual({ from: 8, to: 36 });
      expect(currentAttack(def, { attackMode: 'slam', phase: 1, despairSlam: true })).toMatchObject({ windupTicks: 40, damage: 28, aoeRadius: 5.5, statusOnHit: 'hobble' });
      expect(currentAttack(def, { attackMode: 'slam', phase: 1, despairSlam: true }).rearPose).toEqual({ from: 8, to: 30 });
      expect(currentAttack(def, { attackMode: 'slam', phase: 1, wakeSlam: true, despairSlam: true })).toBe(wakeSlamAttack(def)); // 기상이 이긴다
      expect(currentAttack(def, { attackMode: 'combo', phase: 1, comboStep: 0 })).toBe(chain[0]);
      expect(currentAttack(def, { attackMode: 'combo', phase: 1, comboStep: 2 })).toBe(chain[2]);
      expect(headDownPose('head_down')).toBe(true);
      expect(headDownPose('exhaust')).toBe(true);
      expect(headDownPose('roar')).toBe(false);
      expect(headDownPose(undefined)).toBe(false);
      expect(enemyDef('goblin_chieftain').roarAttack).toBeUndefined();
      expect(enemyDef('goblin_chieftain').comboAttack).toBeUndefined();
      expect(enemyDef('goblin_chieftain').chargeAttack!.chainCharge).toBeUndefined();
    });

    it('포효 — P3 복귀 첫 선택(firstPick): 전환 뒤 첫 추격 틱에 attackMode roar·예고 30·pose roar(눈 2.9m 열림)·boss_status roar on·빨강 예고; 30틱 뒤 발동(enemy_roar): 12m 안 플레이어에게 boss_roar_hit — 피해·player_damaged 없이 1.5m/12틱 밀림 + 위압 360(Status cowed_applied), 눈 노출 닫힘(exposure_closed eye), 후딜 30 → 추격. 간격 1200 이 새로 돈다', () => {
      const boss = makeBehemoth(8.0);
      const w = watch();
      boss.chargeCooldown = 9999;
      boss.volleyCooldown = 9999;
      boss.slamCooldown = 9999;
      boss.comboCooldown = 9999;
      boss.closeCooldown = 9999;
      world.player.health = 1000;
      boss.health = perBar; // 500 → P3 전환
      Enemies.tick(world, DT);
      expect(boss.phase).toBe(1);
      expect(boss.firstPick).toBe('roar');
      tickEnemiesUntil(() => boss.ai === 'chase', 200);
      expect(w.roarStarts).toHaveLength(0);
      Enemies.tick(world, DT);
      expect(boss.attackMode).toBe('roar');
      expect(boss.ai).toBe('windup');
      expect(boss.timer).toBe(roar.windupTicks);
      expect(boss.despairRoar).toBe(false);
      expect(boss.firstPick).toBeUndefined();
      expect(boss.roarCooldown).toBe(roar.intervalTicks);
      expect(boss.pose).toBe('roar');
      expect(weakPointOpen(boss, wp('eye'))).toBe(true);
      expect(weakPointWorldPos(boss, def, wp('eye')).y).toBeCloseTo(2.9, 6);
      expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
      expect(w.roarStarts).toEqual([expect.objectContaining({ despair: false, ticks: roar.windupTicks })]);
      expect(w.status.map(w.tag)).toContain('roar:true');
      expect(w.windups.at(-1)).toMatchObject({ telegraph: 'red', perfectOnly: false });
      for (let i = 0; i < roar.windupTicks - 1; i++) {
        Enemies.tick(world, DT);
        expect(boss.ai).toBe('windup');
        expect(weakPointOpen(boss, wp('eye'))).toBe(true);
      }
      expect(world.player.kbTicks ?? 0).toBe(0);
      Enemies.tick(world, DT); // 발동
      expect(w.roars).toEqual([expect.objectContaining({ despair: false, radius: roar.aoeRadius, dist: 8.0 })]);
      expect(w.roarHits).toEqual([expect.objectContaining({ status: 'cowed', push: roar.pushM, pull: 0, despair: false })]);
      expect(w.hits).toHaveLength(0);
      expect(world.player.health).toBe(1000);
      expect(world.player.cowedTicks).toBe(cw.ticks);
      expect(world.player.kbTicks).toBe(roar.playerKnockbackTicks);
      expect(world.player.kbX! * roar.playerKnockbackTicks!).toBeCloseTo(-roar.pushM!, 6); // 보스(+x)의 반대쪽으로 1.5m
      expect(world.player.kbZ! * roar.playerKnockbackTicks!).toBeCloseTo(0, 6);
      expect(boss.pose).toBeUndefined();
      expect(boss.ai).toBe('recover');
      expect(boss.timer).toBe(roar.recoverTicks);
      expect(boss.attackMode).toBe('melee');
      expect(w.closed).toEqual([expect.objectContaining({ id: 'eye', hits: 0 })]);
      expect(w.status.map(w.tag).filter((t) => t.startsWith('roar:'))).toEqual(['roar:true', 'roar:false']);
      Status.tick(world, DT);
      expect(w.applied).toEqual([expect.objectContaining({ kind: 'cowed', ticks: cw.ticks })]);
      // 간격 — 300틱 동안 두 번째 포효는 없다(1200), 간격 카운터가 줄어든다
      tickEnemiesUntil(() => boss.ai === 'chase', 60);
      for (let i = 0; i < 300; i++) Enemies.tick(world, DT);
      expect(w.roarStarts).toHaveLength(1);
      expect(boss.roarCooldown!).toBeLessThan(roar.intervalTicks!);
      expect(boss.roarCooldown!).toBeGreaterThan(0);
    });

    it('포효 판정 — 12m 밖은 아무 일 없음(boss_roar_hit·위압 없음, 소리는 난다), 방어 중이어도 걸린다(방어 판정·player_damaged 없음), 발동 틱에 회피 무적이면 안 걸린다. 전환 없이 P3 에 든 거수(첫 선택 없음)는 간격부터 센다', () => {
      const far = makeBehemoth(13.0);
      toP3(far);
      quietExcept(far, 'none');
      const w = watch();
      startRoar(far);
      untilRoarResolved(far);
      expect(w.roars).toHaveLength(1);
      expect(w.roarHits).toHaveLength(0);
      expect(world.player.cowedTicks ?? 0).toBe(0);
      // 방어 중
      world.enemies.length = 0;
      const b2 = makeBehemoth(8.0);
      toP3(b2);
      quietExcept(b2, 'none');
      world.player.blocking = true;
      startRoar(b2);
      untilRoarResolved(b2);
      expect(w.roarHits).toHaveLength(1);
      expect(w.hits).toHaveLength(0);
      expect(world.player.cowedTicks).toBe(cw.ticks);
      expect(world.player.stunTicks).toBe(0); // 방어 경직도 없다
      world.player.blocking = false;
      world.player.cowedTicks = 0;
      // 회피 무적
      world.enemies.length = 0;
      const b3 = makeBehemoth(8.0);
      toP3(b3);
      quietExcept(b3, 'none');
      startRoar(b3);
      tickEnemiesUntil(() => b3.timer === 1, 60);
      world.player.iframeTicks = 3;
      world.player.iframeSource = 'dodge';
      Enemies.tick(world, DT);
      expect(b3.attackMode).toBe('melee');
      expect(w.roars).toHaveLength(3);
      expect(w.roarHits).toHaveLength(1);
      expect(world.player.cowedTicks ?? 0).toBe(0);
      world.player.iframeTicks = 0;
      // 전환 없이 P3 — 첫 추격 틱은 포효 없이 간격만 세운다
      world.enemies.length = 0;
      const b4 = makeBehemoth(8.0);
      toP3(b4);
      b4.comboCooldown = 9999;
      b4.chargeCooldown = 9999;
      b4.volleyCooldown = 9999;
      b4.slamCooldown = 9999;
      expect(b4.roarCooldown).toBeUndefined();
      Enemies.tick(world, DT);
      expect(b4.attackMode ?? 'melee').not.toBe('roar');
      expect(b4.roarCooldown).toBe(roar.intervalTicks); // 첫 틱에 간격을 세운다(그 틱의 감소는 그 전에 지나갔다) — 다음 틱부터 1씩
      Enemies.tick(world, DT);
      expect(b4.roarCooldown).toBe(roar.intervalTicks! - 1);
    });

    it('포효 예고 중 눈 66 → 역류: 포효 취소(enemy_roar·boss_roar_hit·위압 없음) + 머리 내림 60(cause backflow — 눈 ×3.0 피해만, 혼절 누적 없음, 자해 없음) + boss_status backflow{cause eye, selfDamage 0} + exposure_closed{eye, hits 2}, 간격은 새로 센다', () => {
      const boss = makeBehemoth(8.0);
      toP3(boss);
      quietExcept(boss, 'none');
      const w = watch();
      startRoar(boss);
      for (let i = 0; i < 5; i++) Enemies.tick(world, DT);
      const hp0 = boss.health;
      shootEye(boss);
      shootEye(boss);
      expect(w.weakHits.map((h) => h.damage)).toEqual([33, 33]);
      expect(boss.health).toBe(hp0 - 66);
      boss.roarCooldown = 5; // 취소가 간격을 되돌리는지
      Enemies.tick(world, DT);
      expect(boss.pose).toBe('head_down');
      expect(boss.poseCause).toBe('backflow');
      expect(boss.poseTicks).toBe(wpc.headDown.backflowTicks);
      expect(boss.attackMode).toBe('melee');
      expect(boss.despairRoar).toBe(false);
      expect(boss.roarCooldown).toBe(roar.intervalTicks);
      expect(boss.health).toBe(hp0 - 66); // 자해 없음
      expect(w.roars).toHaveLength(0);
      expect(w.roarHits).toHaveLength(0);
      expect(world.player.cowedTicks ?? 0).toBe(0);
      expect(w.status.find((s) => s.kind === 'backflow')).toMatchObject({ on: true, cause: 'eye', selfDamage: 0, ticks: wpc.headDown.backflowTicks });
      expect(w.status.map(w.tag)).toEqual(['roar:true', 'roar:false', 'backflow:true', 'head_down:true']);
      expect(w.closed).toEqual([expect.objectContaining({ id: 'eye', hits: 2 })]);
      // 머리 내림(역류) 중 눈은 피해만 — 66 을 더 넣어도 혼절 없음
      shootEye(boss);
      shootEye(boss);
      Enemies.tick(world, DT);
      expect(boss.ai).not.toBe('staggered');
      expect(w.staggers).toHaveLength(0);
      // 취소된 뒤 눈 누적은 새 창(65 이하)에서 다시 — 다음 포효는 간격 뒤
      tickEnemiesUntil(() => boss.ai === 'chase', 200);
      expect(w.status.map(w.tag)).toContain('backflow:false');
    });

    it('위압 중 패링 — 일반 패링은 관절을 열지 못하고(expose 없음) 마나 5(parry_attempt.cowed → Mana); 완벽 패링은 관절 90 + 머리 내림 + 마나 22 + 위압 해제(cowed 0 → Status cowed_ended cured). 조기 입력 실패 규약은 그대로', () => {
      const boss = makeBehemoth(4.0);
      boss.chargeCooldown = 9999;
      boss.closeCooldown = 9999;
      Mana.init(world);
      setPlayerStatus(world.player, 'cowed', cw.ticks);
      Status.tick(world, DT);
      const w = watch();
      world.mana.value = 0;
      expect(normalParry(boss)).toBe('normal');
      expect(boss.exposure?.['joint_r'] ?? 0).toBe(0);
      expect(w.status.filter((s) => s.kind === 'expose')).toHaveLength(0);
      expect(w.parries.at(-1)).toMatchObject({ result: 'normal', cowed: true });
      expect(world.mana.value).toBeCloseTo(cw.normalParryMana * balance.chain.multipliers[0]!, 6);
      expect(playerStatusTicks(world.player, 'cowed')).toBeGreaterThan(0);
      expect(boss.ai).toBe('recover'); // 튕김 후딜은 그대로
      // 조기 입력 — 실패 규약 그대로(위압은 패링 실패를 바꾸지 않는다)
      tickEnemiesUntil(() => boss.ai === 'windup', 300);
      world.mana.value = 40;
      pressReaction();
      expect(w.parries.at(-1)).toMatchObject({ result: 'fail' });
      expect(world.mana.value).toBe(20);
      expect(world.player.stunTicks).toBe(balance.reaction.failStunTicks);
      world.player.stunTicks = 0;
      // 완벽 — 관절 90 + 머리 내림, 위압 해제
      world.mana.value = 0;
      expect(perfectParry(boss)).toBe('perfect');
      expect(boss.pose).toBe('head_down');
      expect(w.status.filter((s) => s.kind === 'expose' && s.on)).toHaveLength(1);
      expect(w.parries.at(-1)).toMatchObject({ result: 'perfect', cowed: false });
      expect(world.mana.value).toBeCloseTo(balance.mana.gain.parryPerfect * balance.chain.multipliers[0]!, 6);
      expect(playerStatusTicks(world.player, 'cowed')).toBe(0);
      Status.tick(world, DT);
      expect(w.ended).toEqual([expect.objectContaining({ kind: 'cowed', reason: 'cured' })]);
    });

    it('절망의 포효 — 체력 ≤ 20%(300): despairRoar·예고 36, 발동에 밀림 대신 4m 끌림(보스 쪽) + 위압, 곧바로 발구르기 연계(despairSlam: 예고 40·앞발 들기 8~30 심장 노출·P3 28/5.5·절뚝, 쿨다운·거리 무관, enemy_slam_start{despair}). 착지 뒤 표식은 지워진다', () => {
      const boss = makeBehemoth(10.0);
      toP3(boss);
      quietExcept(boss, 'none');
      boss.health = def.health * roar.despairHealthFrac!; // 300
      const w = watch();
      startRoar(boss);
      expect(boss.despairRoar).toBe(true);
      expect(boss.timer).toBe(roar.despair!.windupTicks);
      expect(w.roarStarts.at(-1)).toMatchObject({ despair: true, ticks: 36 });
      expect(w.status.at(-1)).toMatchObject({ kind: 'roar', on: true, despair: true });
      untilRoarResolved(boss);
      expect(w.roars).toEqual([expect.objectContaining({ despair: true })]);
      expect(w.roarHits).toEqual([expect.objectContaining({ pull: roar.despair!.pull, push: 0, despair: true, status: 'cowed' })]);
      expect(world.player.kbX! * roar.playerKnockbackTicks!).toBeCloseTo(roar.despair!.pull, 6); // 보스(+x) 쪽으로 4m
      expect(world.player.cowedTicks).toBe(cw.ticks);
      expect(w.hits).toHaveLength(0);
      // 연계 발구르기 — 발동 틱에 곧바로 예고(쿨다운 9999·거리 10m 무관)
      expect(boss.attackMode).toBe('slam');
      expect(boss.despairSlam).toBe(true);
      expect(boss.despairRoar).toBe(false);
      expect(boss.ai).toBe('windup');
      expect(boss.timer).toBe(roar.despair!.followUpWindupTicks);
      expect(currentAttack(def, boss)).toMatchObject({ windupTicks: 40, damage: 28, aoeRadius: 5.5 });
      expect(w.slamStarts).toEqual([expect.objectContaining({ wake: false, despair: true })]);
      expect(boss.wakeSlamPending ?? false).toBe(false);
      // 앞발 들기 8 ≤ t < 30 — 심장이 열린다
      const rearTicks: number[] = [];
      for (let k = 1; k <= 40; k++) {
        Enemies.tick(world, DT);
        if (boss.ai !== 'windup') break;
        if (boss.pose === 'rear') {
          rearTicks.push(40 - boss.timer);
          expect(weakPointOpen(boss, wp('heart'))).toBe(true);
        } else {
          expect(weakPointOpen(boss, wp('heart'))).toBe(false);
        }
      }
      expect(rearTicks[0]).toBe(8);
      expect(rearTicks.at(-1)).toBe(29);
      expect(rearTicks).toHaveLength(22);
      expect(boss.ai).toBe('impact');
      // 착지 — 끌려온 자리(4m)에 선 플레이어에게 28 + 절뚝, 표식 소거
      world.player.x = boss.x - 4.0;
      world.player.prevX = world.player.x;
      Enemies.tick(world, DT);
      expect(w.hits).toEqual([expect.objectContaining({ amount: 28, blocked: false })]);
      expect(world.player.hobbleTicks).toBe(balance.status.hobble.ticks);
      expect(boss.despairSlam).toBe(false);
      expect(boss.ai).toBe('recover');
      // 끌림은 몸 접촉 거리 안으로 들이지 않는다 — 3m 에서 절망의 포효를 맞으면 0.85m 만
      world.enemies.length = 0;
      world.player.x = 6;
      world.player.kbTicks = 0;
      const near = makeBehemoth(3.0);
      toP3(near);
      quietExcept(near, 'none');
      near.health = 300;
      startRoar(near);
      untilRoarResolved(near);
      expect(w.roarHits.at(-1)!.pull).toBeCloseTo(3.0 - Enemies.contactDist(def), 6);
    });

    it('삼연낫 — P3 낫 사거리 안 단발보다 먼저(attackMode combo·step 0·예고 28·쿨 600·enemy_combo_start{steps 3}); 세 타 전부 완벽 → ①② 관절 60·콤보 계속(이음 6 → 다음 타 예고 22/36, enemy_combo_step, ③ 은 perfectOnly 고음) → ③ 완벽에 탈진 150(pose exhaust: 눈 0.9m + 분출공 ×3.0 동시 열림, boss_status exhaust on); 탈진 중 분출공 한 발 33, 눈 66 → 혼절(처형 창)', () => {
      const boss = makeBehemoth(3.1);
      toP3(boss);
      quietExcept(boss, 'combo');
      const w = watch();
      startCombo(boss);
      expect(boss.comboStep).toBe(0);
      expect(boss.comboPerfects).toBe(0);
      expect(boss.timer).toBe(chain[0]!.windupTicks);
      expect(boss.comboCooldown).toBe(chain[0]!.cooldownTicks);
      expect(w.comboStarts).toEqual([expect.objectContaining({ steps: 3 })]);
      expect(w.windups.at(-1)).toMatchObject({ telegraph: 'blue', perfectOnly: false });
      expect(perfectParry(boss)).toBe('perfect');
      expect(boss.exposure?.['joint_r']).toBe(chain[0]!.exposeOnParry!.perfectTicks);
      expect(boss.comboPerfects).toBe(1);
      expect(boss.ai).toBe('recover');
      expect(boss.timer).toBe(chain[0]!.recoverTicks);
      expect(boss.attackMode).toBe('combo');
      expect(boss.pose).toBeUndefined(); // 낫이 박히지 않는다 — 콤보는 이어진다
      untilComboStep(boss, 1);
      expect(boss.timer).toBe(chain[1]!.windupTicks);
      expect(w.comboSteps.at(-1)).toMatchObject({ step: 1, steps: 3, perfectOnly: false });
      expect(perfectParry(boss)).toBe('perfect');
      expect(boss.exposure?.['joint_l']).toBe(chain[1]!.exposeOnParry!.perfectTicks);
      expect(boss.comboPerfects).toBe(2);
      untilComboStep(boss, 2);
      expect(boss.timer).toBe(chain[2]!.windupTicks);
      expect(w.comboSteps.at(-1)).toMatchObject({ step: 2, steps: 3, perfectOnly: true });
      expect(w.windups.at(-1)).toMatchObject({ telegraph: 'blue', perfectOnly: true });
      expect(perfectParry(boss)).toBe('perfect');
      expect(boss.comboPerfects).toBe(3);
      expect(boss.pose).toBe('exhaust');
      expect(boss.poseTicks).toBe(wpc.headDown.exhaustTicks);
      expect(boss.attackMode).toBe('melee');
      expect(headDownPose(boss.pose)).toBe(true);
      expect(weakPointOpen(boss, wp('eye'))).toBe(true);
      expect(weakPointWorldPos(boss, def, wp('eye')).y).toBeCloseTo(0.9, 6);
      expect(weakPointOpen(boss, wp('vent'))).toBe(true);
      expect(weakPointDamageMul(boss, wp('vent'))).toBe(3.0);
      expect(weakPointOpen(boss, wp('heart'))).toBe(false);
      expect(w.status.map(w.tag)).toContain('exhaust:true');
      // 분출공 ×3.0 — 권총 한 발 33(내구 132 → 99), 눈 두 발 → 혼절(탈진도 머리 내림이다)
      shootVent(boss);
      expect(w.weakHits.at(-1)).toMatchObject({ id: 'vent', damage: 33 });
      expect(boss.weakHp!['vent']).toBe(wp('vent').hp! - 33);
      shootEye(boss);
      shootEye(boss);
      Enemies.tick(world, DT);
      expect(boss.ai).toBe('staggered');
      expect(boss.pose).toBe('stunned');
      expect(w.staggers).toHaveLength(1);
      expect(w.status.map(w.tag)).toContain('exhaust:false');
    });

    it('탈진이 시간으로 끝나면 일어서며 기상 발구르기(wakeSlam) — 머리 내림과 같은 자리; 탈진 중 해머는 눈 집계(hammerEyeMul)·넉백 0', () => {
      const boss = makeBehemoth(3.1);
      toP3(boss);
      quietExcept(boss, 'combo');
      const w = watch();
      startCombo(boss);
      expect(perfectParry(boss)).toBe('perfect');
      untilComboStep(boss, 1);
      expect(perfectParry(boss)).toBe('perfect');
      untilComboStep(boss, 2);
      expect(perfectParry(boss)).toBe('perfect');
      expect(boss.pose).toBe('exhaust');
      // 해머(3.1m — 사거리 안) 한 타 = 눈 33, 밀리지 않는다
      const x0 = boss.x;
      hammerSwing();
      expect(w.weakHits.at(-1)).toMatchObject({ id: 'eye', damage: 15 * def.hammerEyeMul! });
      Enemies.tick(world, DT);
      expect(boss.x).toBe(x0);
      // 시간 만료 → 일어서며 기상 발구르기
      tickEnemiesUntil(() => boss.pose === undefined, 200);
      expect(boss.wakeSlamPending).toBe(true);
      Enemies.tick(world, DT);
      expect(boss.attackMode).toBe('slam');
      expect(boss.wakeSlam).toBe(true);
      expect(w.slamStarts.at(-1)).toMatchObject({ wake: true });
    });

    it('삼연낫 소표 — ①② 일반 패링은 관절 30(위압 중엔 없음)·콤보 계속, ③ 완벽인데 완벽 카운트 미달 → 탈진이 아니라 머리 내림 90(분출공 닫힘)', () => {
      const boss = makeBehemoth(3.1);
      toP3(boss);
      quietExcept(boss, 'combo');
      const w = watch();
      startCombo(boss);
      expect(normalParry(boss)).toBe('normal');
      expect(boss.exposure?.['joint_r']).toBe(chain[0]!.exposeOnParry!.normalTicks);
      expect(boss.ai).toBe('recover');
      expect(boss.timer).toBe(chain[0]!.recoverTicks); // 튕김 후딜(parryRecoilTicks) 없이 이음만
      expect(boss.attackMode).toBe('combo');
      untilComboStep(boss, 1);
      // 위압 중 일반 패링 — 관절이 열리지 않지만 콤보는 그대로 이어진다
      setPlayerStatus(world.player, 'cowed', cw.ticks);
      expect(normalParry(boss)).toBe('normal');
      expect(boss.exposure?.['joint_l'] ?? 0).toBe(0);
      expect(boss.attackMode).toBe('combo');
      world.player.cowedTicks = 0;
      untilComboStep(boss, 2);
      expect(perfectParry(boss)).toBe('perfect');
      expect(boss.comboPerfects).toBe(1);
      expect(boss.pose).toBe('head_down');
      expect(boss.poseCause).toBeUndefined();
      expect(boss.poseTicks).toBe(wpc.headDown.stuckTicks);
      expect(boss.attackMode).toBe('melee');
      expect(weakPointOpen(boss, wp('eye'))).toBe(true);
      expect(weakPointOpen(boss, wp('vent'))).toBe(false);
      expect(w.status.map(w.tag)).not.toContain('exhaust:true');
    });

    it('삼연낫 ③ 일반 대역에 누름 — perfectOnly + noParryBuffer: 패링 성립 없이 실패 규약(경직 20 + 마나 절반, 팔 저림이면 면제) → 40 피격. 이르게 눌러도(판정 창 안·완벽 대역 밖) 실패', () => {
      const boss = makeBehemoth(3.1);
      toP3(boss);
      quietExcept(boss, 'combo');
      Mana.init(world);
      world.player.health = 1000;
      const w = watch();
      startCombo(boss);
      untilComboStep(boss, 2);
      expect(w.hits.map((h) => h.amount)).toEqual([34, 34]); // ①② 는 흘려보냈다
      tickEnemiesUntil(() => boss.ai === 'active_perfect');
      const dist = Math.hypot(boss.x - world.player.x, boss.z - world.player.z);
      // 일반 대역(완벽 밖·guardDepth 안)
      boss.weaponTipDist = dist - balance.player.radius - (balance.parrySpace.perfectBand + balance.parrySpace.guardDepth) * 0.5;
      world.mana.value = 40;
      pressReaction();
      expect(w.parries.at(-1)).toMatchObject({ result: 'fail' });
      expect(world.player.stunTicks).toBe(balance.reaction.failStunTicks);
      expect(world.mana.value).toBe(20);
      expect(world.player.parryBufferTicks ?? 0).toBe(0); // 버퍼로 살아남지 않는다
      expect(boss.ai).toBe('active_perfect'); // 공격은 그대로 온다
      tickEnemiesUntil(() => boss.ai === 'recover', 30);
      expect(w.hits.at(-1)).toMatchObject({ amount: 40, blocked: false });
      expect(world.player.kbX! * balance.playerKnockback.ticks).toBeCloseTo(-chain[2]!.playerKnockback!, 6); // smash 2.0
      tickEnemiesUntil(() => boss.ai === 'chase', 120);
      expect(boss.attackMode).toBe('melee');
      // 팔 저림 중이면 마나 면제 — 새 콤보의 ③ 을 다시 일반 대역에
      world.enemies.length = 0;
      world.player.stunTicks = 0;
      const b2 = makeBehemoth(3.1);
      toP3(b2);
      quietExcept(b2, 'combo');
      startCombo(b2);
      untilComboStep(b2, 2);
      tickEnemiesUntil(() => b2.ai === 'active_perfect');
      b2.weaponTipDist = dist - balance.player.radius - (balance.parrySpace.perfectBand + balance.parrySpace.guardDepth) * 0.5;
      setPlayerStatus(world.player, 'numb_arm', balance.status.numbArm.ticks);
      world.mana.value = 40;
      pressReaction();
      expect(w.parries.at(-1)).toMatchObject({ result: 'fail', noManaLoss: true });
      expect(world.mana.value).toBe(40);
    });

    it('삼연낫 막기·미입력 — ① 막으면 칩 10.2 + 경직 10 + 팔 저림, 콤보 계속; 미입력이면 34·34·40(밀림 smash 2.0) 뒤 콤보 끝(attackMode melee) — 쿨다운 600 동안은 단발 낫', () => {
      const boss = makeBehemoth(3.1);
      toP3(boss);
      quietExcept(boss, 'combo');
      world.player.health = 1000;
      const w = watch();
      startCombo(boss);
      world.player.blocking = true;
      tickEnemiesUntil(() => boss.ai === 'recover', 80);
      expect(w.hits).toHaveLength(1);
      expect(w.hits[0]!.amount).toBeCloseTo(chain[0]!.damage! * balance.block.chipDamageRatio, 6);
      expect(w.hits[0]!.blocked).toBe(true);
      expect(world.player.stunTicks).toBe(balance.block.clashPlayerStunTicks);
      expect(world.player.numbArmTicks).toBe(balance.status.numbArm.ticks);
      expect(boss.attackMode).toBe('combo');
      expect(boss.recoiled).toBe(false); // blockCannotStagger — 튕기지 않는다
      untilComboStep(boss, 1);
      world.player.blocking = false;
      world.player.stunTicks = 0;
      tickEnemiesUntil(() => w.hits.length === 3, 300);
      expect(w.hits.map((h) => Math.round(h.amount * 10) / 10)).toEqual([10.2, 34, 40]);
      expect(w.hits[2]!.blocked).toBe(false);
      tickEnemiesUntil(() => boss.ai === 'chase', 120);
      expect(boss.attackMode).toBe('melee');
      expect(boss.comboCooldown!).toBeGreaterThan(0);
      tickEnemiesUntil(() => boss.ai === 'windup', 60);
      expect(['melee', 'alt']).toContain(boss.attackMode); // 쿨다운 중엔 단발
      expect(w.comboStarts).toHaveLength(1);
    });

    it('삼연낫은 양 낫이 자유일 때만(한 낫이 잠겼으면 단발), P2 에선 없다(슬롯 잠김); 관절이 콤보 중 터지면 콤보가 끊긴다', () => {
      const b = makeBehemoth(3.1);
      toP3(b);
      quietExcept(b, 'combo');
      b.bladeLock = { r: 600 };
      tickEnemiesUntil(() => b.ai === 'windup', 30);
      expect(b.attackMode).toBe('alt');
      world.enemies.length = 0;
      const b2 = makeBehemoth(3.1);
      b2.phase = 2;
      quietExcept(b2, 'combo');
      tickEnemiesUntil(() => b2.ai === 'windup', 30);
      expect(['melee', 'alt']).toContain(b2.attackMode);
      // 콤보 중 파열 — ① 일반 패링으로 연 오른 관절을 0 으로
      world.enemies.length = 0;
      const b3 = makeBehemoth(3.1);
      toP3(b3);
      quietExcept(b3, 'combo');
      startCombo(b3);
      expect(normalParry(b3)).toBe('normal');
      b3.weakHp!['joint_r'] = 0;
      Enemies.tick(world, DT);
      expect(b3.ruptured).toEqual({ joint_r: true });
      expect(b3.attackMode).toBe('melee');
      tickEnemiesUntil(() => b3.ai === 'windup', 300);
      expect(b3.attackMode).toBe('alt'); // 남은 왼낫 단발
    });

    it('광란 돌격 — P3 첫 질주가 끝나면(헛침) 제자리 선회 24틱(windup·chainTurn·enemy_chain_turn, 새 예고 없음) 동안 몸이 플레이어 쪽으로 돌고, 끝나면 그 자리로 두 번째 질주(charging·목표 = 새 위치, 6m 안 눈 노출), 두 번째 뒤엔 선회가 없다(P3 50 직격)', () => {
      const boss = makeBehemoth(10.0);
      toP3(boss);
      quietExcept(boss, 'charge');
      world.player.health = 1000;
      const w = watch();
      tickEnemiesUntil(() => boss.ai === 'windup' && boss.attackMode === 'charge', 30);
      expect(boss.chainLeg ?? 0).toBe(0);
      tickEnemiesUntil(() => boss.ai === 'charging', 80);
      // 비켜선다 — 옆(+z)으로 5m
      world.player.z = 6 + 5;
      world.player.prevZ = world.player.z;
      tickEnemiesUntil(() => boss.ai !== 'charging' && boss.ai !== 'impact', 120); // 질주 끝 → impact 한 틱 → 선회
      expect(boss.ai).toBe('windup');
      expect(boss.attackMode).toBe('charge');
      expect(boss.chainTurn).toBe(true);
      expect(boss.chainLeg).toBe(1);
      expect(boss.timer).toBe(cc.turnTicks);
      expect(w.chainTurns).toEqual([expect.objectContaining({ ticks: cc.turnTicks })]);
      expect(w.whiffs).toHaveLength(0);
      expect(boss.pose).toBe('charge'); // 선회도 돌격 자세
      const redWindups = w.windups.filter((x) => x.telegraph === 'red').length;
      const yaw0 = boss.yaw;
      const target = Math.atan2(-(world.player.x - boss.x), -(world.player.z - boss.z));
      expect(angleDiff(yaw0, target)).toBeGreaterThan(0.5); // 아직 옛 방향
      for (let i = 0; i < cc.turnTicks; i++) Enemies.tick(world, DT);
      expect(boss.ai).toBe('charging');
      expect(boss.chainTurn).toBe(false);
      expect(boss.chainLeg).toBe(1);
      expect(boss.chargeTargetX).toBe(world.player.x);
      expect(boss.chargeTargetZ).toBe(world.player.z);
      expect(angleDiff(boss.yaw, target)).toBeLessThan(0.05);
      expect(w.windups.filter((x) => x.telegraph === 'red')).toHaveLength(redWindups); // 두 번째 질주엔 예고가 없다
      // 두 번째 질주 — 6m 안 눈 노출, 직격 50(P3) + 진탕, 그 뒤 선회 없음
      tickEnemiesUntil(() => weakPointOpen(boss, wp('eye')), 120);
      tickEnemiesUntil(() => boss.ai === 'recover', 120);
      expect(w.hits.at(-1)).toMatchObject({ amount: 50, blocked: false });
      expect(world.player.concussionTicks).toBe(balance.status.concussion.ticks);
      expect(w.chainTurns).toHaveLength(1);
      expect(boss.chainLeg).toBe(0);
      expect(boss.chainTurn).toBe(false);
    });

    it('광란 돌격 선회 중 꼬리 채기 — 2.5m 안이면 한 번 12(패링 불가 — 판정 창 없음), 밀림 contact 0.8m, 막으면 칩 3.6 + 방어 경직(진탕 없음), 회피 무적이면 스친다', () => {
      function toTurn(): EnemyState {
        world.enemies.length = 0;
        world.player.x = 6;
        world.player.z = 6;
        world.player.prevX = 6;
        world.player.prevZ = 6;
        const boss = makeBehemoth(10.0);
        toP3(boss);
        quietExcept(boss, 'charge');
        tickEnemiesUntil(() => boss.ai === 'charging', 120);
        world.player.z = 6 + 5;
        world.player.prevZ = world.player.z;
        tickEnemiesUntil(() => boss.chainTurn === true, 120);
        // 꼬리 반경 안으로(−x 쪽 2.0m)
        world.player.x = boss.x - 2.0;
        world.player.z = boss.z;
        world.player.prevX = world.player.x;
        world.player.prevZ = world.player.z;
        return boss;
      }
      world.player.health = 1000;
      const w = watch();
      const boss = toTurn();
      Enemies.tick(world, DT);
      expect(w.hits.at(-1)).toMatchObject({ amount: cc.tailDamage, blocked: false, source: 'tail_whirl' });
      expect(world.player.kbX! * balance.playerKnockback.ticks).toBeCloseTo(-balance.playerKnockback.contact, 6);
      expect(boss.chainTailHit).toBe(true);
      expect(world.player.concussionTicks ?? 0).toBe(0);
      for (let i = 0; i < 5; i++) Enemies.tick(world, DT);
      expect(w.hits.filter((h) => h.source === 'tail_whirl')).toHaveLength(1); // 선회에 한 번
      expect(boss.ai).toBe('windup'); // 선회는 이어진다
      // 막기
      const b2 = toTurn();
      world.player.blocking = true;
      Enemies.tick(world, DT);
      const blockedHit = w.hits.at(-1)!;
      expect(blockedHit.blocked).toBe(true);
      expect(blockedHit.amount).toBeCloseTo(cc.tailDamage * balance.block.chipDamageRatio, 6);
      expect(world.player.stunTicks).toBe(balance.block.clashPlayerStunTicks);
      expect(b2.chainTailHit).toBe(true);
      world.player.blocking = false;
      world.player.stunTicks = 0;
      // 회피 무적
      const b3 = toTurn();
      world.player.iframeTicks = 5;
      const n = w.hits.length;
      Enemies.tick(world, DT);
      expect(w.hits).toHaveLength(n);
      expect(b3.chainTailHit).toBe(false);
      world.player.iframeTicks = 0;
    });

    it('광란 돌격이 없는 경우 — 첫 질주를 완벽 회피(미끄러짐)하면 두 번째가 없다; 첫 질주에서 눈멂이면 없다; P2 는 슬롯이 잠겨 헛돌격 90 그대로; 블링크 무적으로 스친 돌격은 미끄러지지 않는다(회피 무적만, B2-3 검토)', () => {
      const cd = Enemies.contactDist(def);
      // 완벽 회피
      const boss = makeBehemoth(10.0);
      toP3(boss);
      quietExcept(boss, 'charge');
      const w = watch();
      tickEnemiesUntil(() => boss.ai === 'charging', 120);
      tickEnemiesUntil(() => Math.hypot(boss.x - world.player.x, boss.z - world.player.z) <= cd + 1.0, 300);
      world.player.iframeTicks = 1e9;
      world.player.iframeSource = 'dodge';
      tickEnemiesUntil(() => boss.pose === 'skid', 60);
      world.player.iframeTicks = 0;
      expect(w.dodged).toHaveLength(1);
      expect(w.chainTurns).toHaveLength(0);
      expect(boss.chainLeg).toBe(0);
      tickEnemiesUntil(() => boss.ai === 'chase', 200);
      expect(w.chainTurns).toHaveLength(0);
      // 눈멂 — 질주 중 6m 안 눈 66
      world.enemies.length = 0;
      const b2 = makeBehemoth(10.0);
      toP3(b2);
      quietExcept(b2, 'charge');
      world.player.health = 1000;
      tickEnemiesUntil(() => b2.ai === 'charging' && weakPointOpen(b2, wp('eye')), 200);
      shootEye(b2);
      shootEye(b2);
      Enemies.tick(world, DT);
      expect(b2.blind).toBe(true);
      tickEnemiesUntil(() => b2.ai === 'recover', 300);
      expect(w.chainTurns).toHaveLength(0);
      expect(b2.chainLeg).toBe(0);
      // P2 — 슬롯 잠김
      world.enemies.length = 0;
      world.player.x = 6;
      world.player.z = 6;
      const b3 = makeBehemoth(10.0);
      b3.phase = 2;
      quietExcept(b3, 'charge');
      tickEnemiesUntil(() => b3.ai === 'charging', 120);
      world.player.z = 6 + 5;
      world.player.prevZ = world.player.z;
      tickEnemiesUntil(() => b3.ai === 'recover', 120);
      expect(b3.whiffed).toBe(true);
      expect(b3.timer).toBe(def.chargeAttack!.whiffRecoverTicks);
      expect(w.chainTurns).toHaveLength(0);
      // 블링크 무적 — 옛 경로(헛돌격)
      world.enemies.length = 0;
      world.player.z = 6;
      world.player.prevZ = 6;
      const b4 = makeBehemoth(10.0);
      b4.closeCooldown = 9999;
      const hpBeforeBlink = world.player.health; // 눈먼 돌격(위)이 닿아 50 이 들어갔다 — 그 뒤로 변화가 없어야 한다
      tickEnemiesUntil(() => b4.ai === 'charging', 120);
      tickEnemiesUntil(() => Math.hypot(b4.x - world.player.x, b4.z - world.player.z) <= cd + 1.0, 300);
      world.player.iframeTicks = 1e9;
      world.player.iframeSource = 'blink';
      tickEnemiesUntil(() => b4.ai === 'recover', 120);
      expect(b4.pose).not.toBe('skid');
      expect(b4.whiffed).toBe(true);
      expect(w.dodged).toHaveLength(1); // 위의 한 번뿐
      expect(world.player.health).toBe(hpBeforeBlink);
      world.player.iframeTicks = 0;
    });

    it('그래플 탈출 무적 접촉은 미끄러지지 않는다(헛돌격, B3-4 검토) — 구울 그립을 밀쳐낸 escapeIframeTicks 24 는 iframeSource \'escape\' 를 세워 앞선 회피의 \'dodge\' 를 덮어쓰고, 그 무적 안에 거수 돌격이 닿으면 피해 0·charge_dodged 없음·관절 안 열림·whiff 90. 무적이 다한 틱에 Reaction 이 출처를 지운다', () => {
      const cd = Enemies.contactDist(def);
      const grip = balance.ghoulGrapple;
      expect(grip.escapeIframeTicks).toBe(24);
      // 무적이 다한 틱에 출처가 지워진다 — 지난 회피의 'dodge' 가 남지 않는다
      world.player.iframeTicks = 2;
      world.player.iframeSource = 'dodge';
      Reaction.tick(world, DT);
      expect(world.player.iframeTicks).toBe(1);
      expect(world.player.iframeSource).toBe('dodge');
      Reaction.tick(world, DT);
      expect(world.player.iframeTicks).toBe(0);
      expect(world.player.iframeSource).toBeUndefined();
      // 그래도 옛 'dodge' 가 남아 있었다고 치고(검토가 지목한 경우) — 탈출이 덮어써야 한다
      world.player.iframeSource = 'dodge';
      const boss = makeBehemoth(10.0);
      boss.closeCooldown = 9999; // P1 — 돌격만, 광란 돌격 없음
      const w = watch();
      tickEnemiesUntil(() => boss.ai === 'charging', 120);
      tickEnemiesUntil(() => Math.hypot(boss.x - world.player.x, boss.z - world.player.z) <= cd + 1.0, 300);
      // 몸이 닿기 직전 구울 그립의 마지막 몸부림 — 실제 releaseGrapple(shoved) 경로가 무적 24 + 출처 'escape' 를 세운다(구울을 거수보다 먼저 처리)
      const ghoul = spawnEnemyAt('ghoul', world.player.x + 1, world.player.z, 900);
      ghoul.ai = 'latched';
      ghoul.timer = 999; // 이 틱엔 물지 않는다
      ghoul.latchDirX = 1;
      ghoul.latchDirZ = 0;
      world.enemies.unshift(ghoul);
      world.grappleEnemyId = ghoul.id;
      world.grappleMash = grip.mashToEscape - 1;
      const escapes: unknown[] = [];
      world.events.on('grapple_escape', (p) => escapes.push(p));
      const hp = world.player.health;
      world.input = { ...Input.emptySnapshot(), meleePressed: true };
      Enemies.tick(world, DT);
      world.input = Input.emptySnapshot();
      expect(escapes).toHaveLength(1);
      expect(world.grappleEnemyId).toBeNull();
      expect(world.player.iframeTicks).toBe(grip.escapeIframeTicks);
      expect(world.player.iframeSource).toBe('escape');
      world.enemies.splice(world.enemies.indexOf(ghoul), 1);
      // 남은 질주가 탈출 무적 안에 닿는다 — 회피 보상이 아니다: 헛돌격(옛 경로)
      for (let i = 0; i < 300 && boss.ai !== 'recover'; i++) {
        Enemies.tick(world, DT);
        Reaction.tick(world, DT);
      }
      expect(boss.ai).toBe('recover');
      expect(boss.whiffed).toBe(true);
      expect(boss.timer).toBe(def.chargeAttack!.whiffRecoverTicks);
      expect(boss.pose).not.toBe('skid');
      expect(w.dodged).toHaveLength(0);
      expect(w.hits).toHaveLength(0);
      expect(world.player.health).toBe(hp);
      expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
      expect(weakPointOpen(boss, wp('joint_l'))).toBe(false);
      expect(world.player.iframeSource).toBe('escape'); // 아직 무적 안
      for (let i = 0; i < grip.escapeIframeTicks; i++) Reaction.tick(world, DT);
      expect(world.player.iframeTicks).toBe(0);
      expect(world.player.iframeSource).toBeUndefined();
    });

    it('위압 해제는 어느 적의 완벽 패링이든(기획서 §6 "완벽 패링 1회", B3-4 검토) — 위압 중 시험방 고블린의 공격: 일반 패링은 풀지 않고 마나 5(cowed), 완벽 패링이 cowed 0 → Status cowed_ended cured. 위압을 건 것은 거수지만 푸는 경로는 팔 저림 해제와 같은 공용 성공 경로다', () => {
      Mana.init(world);
      setPlayerStatus(world.player, 'cowed', cw.ticks);
      Status.tick(world, DT);
      const w = watch();
      // 거수 없이 고블린만 — 고치기 전엔 expose 분기(거수) 안에서만 풀려 여기선 위압이 그대로 남았다
      const runner = spawnEnemyAt('goblin_runner', 6 + 2.0, 6, 7);
      runner.ai = 'chase';
      world.enemies.push(runner);
      world.mana.value = 0;
      expect(normalParry(runner)).toBe('normal');
      expect(w.parries.at(-1)).toMatchObject({ result: 'normal', cowed: true });
      expect(world.mana.value).toBeCloseTo(cw.normalParryMana * balance.chain.multipliers[0]!, 6);
      expect(playerStatusTicks(world.player, 'cowed')).toBeGreaterThan(0);
      Status.tick(world, DT);
      expect(w.ended).toHaveLength(0);
      // 다음 공격을 완벽 패링 — 위압이 풀린다. 고블린 쪽 결과(완벽 → 스태거)는 그대로
      expect(perfectParry(runner)).toBe('perfect');
      expect(w.parries.at(-1)).toMatchObject({ result: 'perfect', cowed: false });
      expect(world.player.cowedTicks).toBe(0);
      expect(runner.ai).toBe('staggered');
      Status.tick(world, DT);
      expect(w.ended).toEqual([expect.objectContaining({ kind: 'cowed', reason: 'cured' })]);
    });

    it('광란 돌격 선회의 비정상 종료(B3-4 검토) — 선회 중 관절 파열 → 비틀거림(recover)이 chainTurn/chainLeg/chainTailHit 을 함께 내려 다음 낫 예고에서 선회(yaw 스냅·꼬리 채기)가 이어지지 않는다; 표식이 남아 있어도 선회 틱은 돌격 예고(attackMode charge)에서만 돈다', () => {
      world.player.health = 1000;
      const w = watch();
      const boss = makeBehemoth(10.0);
      toP3(boss);
      quietExcept(boss, 'charge');
      tickEnemiesUntil(() => boss.ai === 'charging', 120);
      world.player.z = 6 + 5;
      world.player.prevZ = world.player.z;
      tickEnemiesUntil(() => boss.chainTurn === true, 120);
      expect(boss.attackMode).toBe('charge');
      expect(boss.chainLeg).toBe(1);
      // 선회 중 오른 관절 내구 0(외부 경로) → 이 틱에 파열: 비틀거림 60 으로 예고가 끊기고 연쇄 장부가 내려간다
      boss.weakHp!['joint_r'] = 0;
      Enemies.tick(world, DT);
      expect(boss.ruptured).toEqual({ joint_r: true });
      expect(boss.ai).toBe('recover');
      expect(boss.timer).toBe(wpc.rupture.staggerTicks - 1); // 파열 틱의 recover 가 한 틱 깎는다
      expect(boss.chainTurn).toBe(false);
      expect(boss.chainLeg).toBe(0);
      expect(boss.chainTailHit).toBe(false);
      expect(w.chainTurns).toHaveLength(1);
      // 비틀거림 뒤 첫 낫 예고(오른낫 잠김 → 왼낫) — 꼬리 반경 안에 서 있어도 꼬리 채기·yaw 스냅이 없다
      boss.chargeCooldown = 9999;
      tickEnemiesUntil(() => boss.ai === 'windup', 600);
      expect(boss.attackMode).toBe('alt');
      world.player.x = boss.x - 2.3;
      world.player.z = boss.z;
      world.player.prevX = world.player.x;
      world.player.prevZ = world.player.z;
      const yaw0 = boss.yaw;
      Enemies.tick(world, DT);
      expect(boss.ai).toBe('windup');
      expect(boss.yaw).toBe(yaw0);
      expect(w.hits.filter((h) => h.source === 'tail_whirl')).toHaveLength(0);
      // 게이트(a) — 표식이 남아 있더라도 낫 예고에선 선회 틱이 돌지 않는다(판정 = 그림: Stage 도 attackMode charge 를 함께 본다)
      boss.chainTurn = true;
      boss.chainTailHit = false;
      Enemies.tick(world, DT);
      expect(boss.ai).toBe('windup');
      expect(boss.yaw).toBe(yaw0);
      expect(w.hits.filter((h) => h.source === 'tail_whirl')).toHaveLength(0);
      boss.chainTurn = false;
      expect(w.chainTurns).toHaveLength(1); // 새 선회는 없었다
    });

    it('삼연낫 ③ 팔 저림 중 완벽 대역 입력(기획서 §7 소표 ③ 주석·§6 numb_arm, B3-4 검토) — 저림은 성립 대역을 두고 결과만 낮추므로 일반 패링이 성립한다(족장 perfectParryOnly 와 같은 결): 관절 노출 없음(③ 에 exposeOnParry 없음)·머리 내림/탈진 없음·③ 피격 없음·콤보 끊김(recover 40 + 튕김 36 뒤 chase, attackMode melee)·저림 해제(numb_arm_ended cured)·마나 11', () => {
      const boss = makeBehemoth(3.1);
      toP3(boss);
      quietExcept(boss, 'combo');
      Mana.init(world);
      world.player.health = 1000;
      const w = watch();
      const numbEnded: { kind: string; reason: string }[] = [];
      world.events.on('numb_arm_ended', (p) => numbEnded.push(p as { kind: string; reason: string }));
      startCombo(boss);
      untilComboStep(boss, 2);
      expect(w.hits.map((h) => h.amount)).toEqual([34, 34]); // ①② 는 흘려보냈다
      setPlayerStatus(world.player, 'numb_arm', balance.status.numbArm.ticks);
      Status.tick(world, DT);
      world.mana.value = 0;
      expect(perfectParry(boss)).toBe('normal'); // 완벽 대역 한복판인데 저림 → 일반으로 낮아진다
      expect(w.parries.at(-1)).toMatchObject({ result: 'normal', cowed: false });
      expect(world.mana.value).toBeCloseTo(balance.mana.gain.parryNormal * balance.chain.multipliers[0]!, 6);
      expect(boss.exposure?.['joint_r'] ?? 0).toBe(0);
      expect(boss.exposure?.['joint_l'] ?? 0).toBe(0);
      expect(w.status.filter((s) => s.kind === 'expose')).toHaveLength(0);
      expect(['head_down', 'exhaust']).not.toContain(boss.pose);
      expect(boss.ai).toBe('recover');
      expect(boss.recoiled).toBe(true);
      expect(boss.timer).toBe(chain[2]!.recoverTicks + balance.reaction.parryRecoilTicks); // 단발 일반 패링과 같은 튕김 후딜
      expect(world.player.numbArmTicks).toBe(0);
      Status.tick(world, DT);
      expect(numbEnded).toEqual([expect.objectContaining({ kind: 'numb_arm', reason: 'cured' })]);
      tickEnemiesUntil(() => boss.ai === 'chase', 120);
      expect(boss.attackMode).toBe('melee'); // 콤보는 여기서 끝났다
      expect(w.hits).toHaveLength(2); // ③ 은 맞지 않았다
      expect(w.comboSteps).toHaveLength(2); // 더 이어지지 않는다
    });
  });
});
