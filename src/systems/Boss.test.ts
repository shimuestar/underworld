// M7 검증 — warden(방어막·시전·반사), 보스 2페이즈 교대, 출구 잠금/클리어.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Enemies from './Enemies';
import * as Exit from './Exit';
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
      scars: { eye: 0, rightArm: 0, leftArm: 0, heart: 0, spine: 0 },
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

  it('melee 페이즈: 3연속 패링해야 스태거, 그 전엔 recover', () => {
    const boss = makeBoss();
    const def = enemyDef('goblin_chieftain');

    for (let n = 1; n <= def.parriesToStagger!; n++) {
      tickEnemiesUntil(() => boss.ai === 'active_perfect');
      pressReaction();
      if (n < def.parriesToStagger!) {
        expect(boss.ai).toBe('recover');
        expect(boss.parryStreak).toBe(n);
      }
    }
    expect(boss.ai).toBe('staggered');
    expect(boss.parryStreak).toBe(0);
  });

  it('스태거 중 처형 → executeDamage 타격 → 스태거 종료 후 armored 페이즈', () => {
    const boss = makeBoss();
    const def = enemyDef('goblin_chieftain');
    boss.ai = 'staggered';
    boss.timer = 90;

    pressReaction(); // 처형 타격
    expect(boss.health).toBe(def.health - def.executeDamage!);
    expect(boss.alive).toBe(true);

    // 처형 연출 동안은 적 전체가 멈춘다 — 그 시간을 지나야 스태거가 끝난다
    for (let i = 0; i < balance.reaction.executeFocusTicks + 1; i++) Enemies.tick(world, DT);
    expect(boss.phase).toBe('armored');
    expect(boss.armorHealth).toBe(def.armorHealth);
  });

  it('armored 페이즈: 총알이 장갑을 깎고, 파괴되면 melee 복귀. 마법은 튕긴다', () => {
    const boss = makeBoss();
    const def = enemyDef('goblin_chieftain');
    boss.phase = 'armored';
    boss.armorHealth = def.armorHealth!;

    // 마법 무효
    const blocked: unknown[] = [];
    world.events.on('barrier_blocked', (payload) => blocked.push(payload));
    world.projectiles.push({
      id: 1, owner: 'player', x: 7, y: 1.2, z: 6, prevX: 7, prevY: 1.2, prevZ: 6,
      vx: 26, vy: 0, vz: 0, lifeTicks: 60, damage: 45,
      burnTicks: 0, burnDamagePerTick: 0, radius: 0.35,
    });
    for (let i = 0; i < 30 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(blocked[0]).toMatchObject({ kind: 'armor' });
    expect(boss.health).toBe(def.health);

    // 실탄으로 장갑 파괴 — 몸통 판정 27.2/발 × 5발 = 136 > 120
    const phases: unknown[] = [];
    world.events.on('boss_phase', (payload) => phases.push(payload));
    for (let shot = 0; shot < 5; shot++) {
      world.weapon.cooldown = 0;
      world.input = { ...Input.emptySnapshot(), rangedPressed: true };
      Weapons.tick(world, DT);
      world.input = Input.emptySnapshot();
    }
    expect(boss.phase).toBe('melee');
    expect(boss.health).toBe(def.health); // 장갑이 전부 흡수
    expect(phases).toContainEqual({ enemyId: 1, phase: 'melee' });
  });

  it('armored 공격은 판정 창 없이 windup → impact (패링 불가)', () => {
    const boss = makeBoss();
    boss.phase = 'armored';
    tickEnemiesUntil(() => boss.ai === 'windup');
    tickEnemiesUntil(() => boss.ai === 'recover'); // active_* 없이 impact를 거침
    expect(world.player.health).toBe(100 - enemyDef('goblin_chieftain').damage);
  });
});

describe('goblin_chieftain 원거리 공격', () => {
  it('원거리(minRange 이상)에서는 바위 투척 — 반사 불가 투사체', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1); // dist 12 ≥ minRange 7
    boss.ai = 'chase';
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

  it('근접 거리에서는 기존 스매시 (melee 모드)', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 8.4, 6, 1); // dist 2.4 < minRange
    boss.ai = 'chase';
    world.enemies.push(boss);
    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('melee');
    expect(world.projectiles).toHaveLength(0);
  });
});

describe('출구 (7.4)', () => {
  it('보스 생존 시 잠김, 처치 후 밟으면 zone_cleared', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 8, 6, 1);
    world.enemies.push(boss);
    const events: string[] = [];
    world.events.on('exit_locked', () => events.push('locked'));
    world.events.on('zone_cleared', () => events.push('cleared'));

    world.player.x = world.level.exitPos!.x;
    world.player.z = world.level.exitPos!.z;
    Exit.tick(world, DT);
    expect(events).toEqual(['locked']);
    expect(world.cleared).toBe(false);

    boss.alive = false;
    Exit.tick(world, DT);
    expect(events).toEqual(['locked', 'cleared']);
    expect(world.cleared).toBe(true);
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
