// 거미 — 검은 거미(도약 근접) / 흰 거미(거미줄 구속)와 거미줄 해제 규칙.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Enemies from './Enemies';
import * as PlayerMove from './PlayerMove';
import * as Projectiles from './Projectiles';
import * as Sigils from './Sigils';
import * as Stamina from './Stamina';
import * as Weapons from './Weapons';

const DT = 1 / 60;
const WEB = balance.web;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['##########', '#S.......#', '#........#', '#........#', '##########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 10, y: 0, z: 10, prevX: 10, prevY: 0, prevZ: 10,
      yaw: -Math.PI / 2, pitch: 0, health: balance.player.healthMax, // +X 를 본다
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
  Stamina.init(world);
  return world;
}

/** 거미줄 탄을 플레이어에게 날린다 */
function fireWeb(world: World): void {
  const p = world.player;
  world.projectiles.push({
    id: 900, owner: 'enemy',
    x: p.x + 6, y: 1.2, z: p.z, prevX: p.x + 6, prevY: 1.2, prevZ: p.z,
    vx: -17, vy: 0, vz: 0,
    lifeTicks: 120, damage: 0, burnTicks: 0, burnDamagePerTick: 0,
    radius: 0.26, kind: 'web', appliesWeb: true,
  });
  for (let i = 0; i < 40 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
}

/** 앞으로 n틱 걷고 실제 이동 거리를 돌려준다 */
function walk(world: World, ticks: number): number {
  const from = { x: world.player.x, z: world.player.z };
  for (let i = 0; i < ticks; i++) {
    world.input = { ...Input.emptySnapshot(), moveForward: 1 };
    PlayerMove.tick(world, DT);
    world.input = Input.emptySnapshot();
  }
  return Math.hypot(world.player.x - from.x, world.player.z - from.z);
}

function swingHammer(world: World): void {
  world.weapon.meleeCooldown = 0;
  world.weapon.swingImpact = 0;
  world.input = { ...Input.emptySnapshot(), meleePressed: true };
  Weapons.tick(world, DT);
  world.input = Input.emptySnapshot();
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('거미줄', () => {
  it('맞으면 걸리고 느려진다', () => {
    const caught: { swings: number }[] = [];
    world.events.on('web_caught', (p) => caught.push(p as { swings: number }));

    const free = walk(world, 10);
    world.player.x = 10;
    world.player.z = 10;

    fireWeb(world);
    expect(world.player.webSwingsLeft).toBe(WEB.breakSwings);
    expect(caught[0]).toMatchObject({ swings: WEB.breakSwings });

    // 피격 밀림이 섞이면 이동 거리가 오염된다 — 걷기 속도만 비교한다
    world.player.kbTicks = 0;
    world.player.x = 10;
    world.player.z = 10;
    const webbed = walk(world, 10);
    expect(webbed).toBeLessThan(free);
    expect(webbed / free).toBeCloseTo(WEB.moveSpeedMul, 2);
  });

  it('방패로 막아도 들러붙는다 — 끈끈이는 못 막는다', () => {
    world.player.blocking = true;
    fireWeb(world);
    expect(world.player.webSwingsLeft).toBe(WEB.breakSwings);
  });

  it('아무리 움직여도, 시간이 지나도 풀리지 않는다', () => {
    fireWeb(world);
    const broken: unknown[] = [];
    world.events.on('web_broken', (p) => broken.push(p));

    for (let i = 0; i < 600; i++) {
      walk(world, 1);
      world.player.x = 10; // 벽에 안 막히게 제자리로 되돌리며 계속 이동 입력
      world.player.z = 10;
    }
    expect(world.player.webSwingsLeft).toBe(WEB.breakSwings);
    expect(broken).toHaveLength(0);
  });

  it('해머로 정확히 breakSwings 번 걷어내야 벗겨진다 — 적을 맞힐 필요는 없다', () => {
    fireWeb(world);
    const torn: { left: number; total: number }[] = [];
    const broken: { reason: string }[] = [];
    world.events.on('web_torn', (p) => torn.push(p as { left: number; total: number }));
    world.events.on('web_broken', (p) => broken.push(p as { reason: string }));

    for (let i = 1; i < WEB.breakSwings; i++) {
      swingHammer(world);
      expect(world.player.webSwingsLeft).toBe(WEB.breakSwings - i);
      expect(broken).toHaveLength(0); // 아직
    }
    swingHammer(world);
    expect(world.player.webSwingsLeft).toBe(0);
    expect(broken[0]).toMatchObject({ reason: 'hammer' });
    // 한 대마다 한 번씩 알려 준다 (마지막 한 대 포함)
    expect(torn.map((t) => t.left)).toEqual([2, 1, 0]);
    expect(world.enemies).toHaveLength(0); // 허공을 휘둘렀는데도 벗겨졌다
  });

  it('벗겨진 뒤에는 해머를 더 휘둘러도 이벤트가 나가지 않는다', () => {
    fireWeb(world);
    for (let i = 0; i < WEB.breakSwings; i++) swingHammer(world);
    const torn: unknown[] = [];
    world.events.on('web_torn', (p) => torn.push(p));
    swingHammer(world);
    expect(torn).toHaveLength(0);
  });
});

describe('검은 거미 (근접·도약)', () => {
  it('중거리에서 도약한다 — 예고 시점 좌표로만 날아가 비키면 헛짚는다', () => {
    const leap = enemyDef('spider_small').chargeAttack!;
    const mid = ((leap.minRange ?? 0) + leap.maxRange!) / 2;
    const spider: EnemyState = spawnEnemyAt('spider_small', 10 + mid, 10, 1);
    spider.ai = 'chase';
    world.enemies.push(spider);

    for (let i = 0; i < 300 && (spider.ai as string) !== 'charging'; i++) Enemies.tick(world, DT);
    expect(spider.attackMode).toBe('charge');
    const lockX = spider.chargeTargetX!;

    world.player.z += 6; // 옆으로 비킨다
    const hits: unknown[] = [];
    world.events.on('player_damaged', (p) => hits.push(p));
    for (let i = 0; i < 300 && (spider.ai as string) !== 'recover'; i++) Enemies.tick(world, DT);
    expect(spider.chargeTargetX).toBe(lockX); // 따라오지 않았다
    expect(hits).toHaveLength(0);
  });

  it('공중으로 뛰어올라 몸을 던진다 — 착지하는 순간 판정', () => {
    const leap = enemyDef('spider_small').chargeAttack!;
    expect(leap.leapHeight).toBeGreaterThan(0);
    const mid = ((leap.minRange ?? 0) + leap.maxRange!) / 2;
    const spider: EnemyState = spawnEnemyAt('spider_small', 10 + mid, 10, 1);
    spider.ai = 'chase';
    world.enemies.push(spider);

    for (let i = 0; i < 300 && (spider.ai as string) !== 'charging'; i++) Enemies.tick(world, DT);
    expect(spider.jumpY ?? 0).toBe(0); // 예고 중에는 땅에 붙어 있다

    let peak = 0;
    for (let i = 0; i < 300 && (spider.ai as string) === 'charging'; i++) {
      Enemies.tick(world, DT);
      peak = Math.max(peak, spider.jumpY ?? 0);
      expect(spider.jumpY ?? 0).toBeGreaterThanOrEqual(0); // 땅 밑으로 꺼지지 않는다
    }
    expect(peak).toBeGreaterThan(leap.leapHeight! * 0.7); // 실제로 꽤 뜬다
    expect(peak).toBeLessThanOrEqual(leap.leapHeight!);
    expect(spider.jumpY).toBe(0); // 타격 시점엔 착지해 있다
  });

  it('가벼워서 해머 마무리에 잘 날아간다', () => {
    expect(enemyDef('spider_small').weight).toBe('light');
    expect(balance.weapons.hammer.combo.knockbackByWeight.light).toBe(1);
  });
});

describe('흰 거미 (거미줄 시전)', () => {
  it('거리를 두고 거미줄을 쏜다 — 반사 불가', () => {
    const spider = spawnEnemyAt('spider_large', 10 + 12, 10, 1);
    spider.ai = 'chase';
    world.enemies.push(spider);

    for (let i = 0; i < 400 && world.projectiles.length === 0; i++) Enemies.tick(world, DT);
    expect(world.projectiles).toHaveLength(1);
    const web = world.projectiles[0]!;
    expect(web.kind).toBe('web');
    expect(web.appliesWeb).toBe(true);
    expect(web.deflectable).toBe(false);
  });

  it('발사 간격은 예고+후딜 그대로 — 피할 틈이 있어야 한다', () => {
    const def = enemyDef('spider_large');
    const spider = spawnEnemyAt('spider_large', 10 + 10, 10, 1);
    spider.ai = 'chase';
    world.enemies.push(spider);
    const shots: number[] = [];
    let t = 0;
    world.events.on('enemy_cast', () => shots.push(t));
    for (; t < 400; t++) {
      spider.x = 10 + 10; // 카이팅으로 거리가 변하면 간격이 흔들린다 — 고정하고 잰다
      spider.z = 10;
      Enemies.tick(world, DT);
      world.projectiles.length = 0;
    }
    const gaps = shots.slice(1).map((v, i) => v - shots[i]!);
    const cycle = def.attack.windupTicks + 1 + def.attack.recoverTicks;
    expect(gaps.length).toBeGreaterThan(1);
    expect(new Set(gaps).size).toBe(1); // 일정하다
    expect(gaps[0]).toBe(cycle);
    expect(cycle / 60).toBeGreaterThan(1.8); // 1.8초 밑으로 내려가면 회피가 안 된다
  });

  it('플레이어가 붙으면 물러난다 (kiteMinRange)', () => {
    const def = enemyDef('spider_large');
    const spider = spawnEnemyAt('spider_large', 10 + 3, 10, 1); // kiteMinRange 안
    spider.ai = 'chase';
    world.enemies.push(spider);
    const before = spider.x - world.player.x;
    for (let i = 0; i < 60; i++) Enemies.tick(world, DT);
    expect(spider.x - world.player.x).toBeGreaterThan(before); // 멀어졌다
    expect(def.kiteMinRange).toBeGreaterThan(0);
  });
});
