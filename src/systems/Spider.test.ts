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
    const caught: { ticks: number }[] = [];
    world.events.on('web_caught', (p) => caught.push(p as { ticks: number }));

    const free = walk(world, 10);
    world.player.x = 10;
    world.player.z = 10;

    fireWeb(world);
    expect(world.player.webTicks).toBe(WEB.slowTicks);
    expect(caught[0]).toMatchObject({ ticks: WEB.slowTicks });

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
    expect(world.player.webTicks).toBe(WEB.slowTicks);
  });

  it('계속 움직이면 발버둥으로 끊긴다', () => {
    fireWeb(world);
    const broken: { reason: string }[] = [];
    world.events.on('web_broken', (p) => broken.push(p as { reason: string }));

    let ticks = 0;
    while ((world.player.webTicks ?? 0) > 0 && ticks < WEB.slowTicks) {
      walk(world, 1);
      ticks++;
    }
    expect(broken[0]).toMatchObject({ reason: 'struggle' });
    expect(ticks).toBeLessThan(WEB.slowTicks); // 시간 만료보다 훨씬 빠르다
  });

  it('해머를 휘두르면 몇 대에 끊긴다 — 적을 맞힐 필요는 없다', () => {
    fireWeb(world);
    const need = Math.ceil(WEB.breakNeeded / WEB.breakPerSwing);
    for (let i = 0; i < need - 1; i++) {
      swingHammer(world);
      expect(world.player.webTicks).toBeGreaterThan(0); // 아직
    }
    const broken: { reason: string }[] = [];
    world.events.on('web_broken', (p) => broken.push(p as { reason: string }));
    swingHammer(world);
    expect(world.player.webTicks).toBe(0);
    expect(broken[0]).toMatchObject({ reason: 'hammer' });
    expect(world.enemies).toHaveLength(0); // 허공을 휘둘렀는데도 끊겼다
  });

  it('가만히 있으면 지속시간이 다 흘러야 풀린다', () => {
    fireWeb(world);
    const broken: { reason: string }[] = [];
    world.events.on('web_broken', (p) => broken.push(p as { reason: string }));
    for (let i = 0; i < WEB.slowTicks - 1; i++) PlayerMove.tick(world, DT);
    expect(world.player.webTicks).toBeGreaterThan(0);
    PlayerMove.tick(world, DT);
    expect(broken[0]).toMatchObject({ reason: 'timeout' });
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
