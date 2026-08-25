// 처치 드랍(HP 포션 / 골드)과 자동 획득 검증. 드랍 굴림은 Math.random을 고정해 결정적으로 본다.
// 2026-08: 소모품은 주워도 즉시 먹지 않는다 — 효과는 Items.test 가 본다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { addItem, countOf, initInventory } from '../core/Inventory';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Pickups from './Pickups';
import * as Progression from './Progression';
import * as Sigils from './Sigils';

const DT = 1 / 60;
const cfg = balance.pickups;

function makeWorld(): World {
  const level = new Level({
    id: 'arena', name: 'arena', cellSize: 4, ceiling: 4,
    grid: ['########', '#S.....#', '#......#', '#......#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 10, y: 0, z: 10, prevX: 10, prevY: 0, prevZ: 10,
      yaw: 0, pitch: 0, health: balance.player.healthMax,
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
}

let world: World;
beforeEach(() => {
  world = makeWorld();
  initInventory(world); // 가방 칸 잡기 — main 의 시작 순서와 같다
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 가방을 빈틈없이 채운다 — 칸이 다 차는 것만으로는 부족하다.
 *  무더기가 하나라도 덜 찼으면 그 종류는 아직 들어갈 자리가 있다 */
function fillBag(world: World): void {
  const kinds = ['potion', 'mana', 'food'] as const;
  const stackMax = balance.items.stackMax;
  const total = world.inventory.length * stackMax;
  // stackMax 개씩 묶어 종류를 바꾼다 — 묶음 하나가 칸 하나를 정확히 채운다
  for (let i = 0; i < total; i++) {
    if (!addItem(world, kinds[Math.floor(i / stackMax) % kinds.length]!)) break;
  }
  const full = world.inventory.every((slot) => slot !== null && slot.count === stackMax);
  if (!full) throw new Error('가방을 못 채웠다 — stackMax/칸 수 확인');
}

/** Math.random을 고정값으로 */
function fixRandom(value: number): void {
  vi.spyOn(Math, 'random').mockReturnValue(value);
}

describe('처치 드랍', () => {
  it('굴림이 확률 안이면 포션과 골드가 함께 떨어진다', () => {
    fixRandom(0.01); // potion(0.18)·gold(0.65) 둘 다 통과
    Pickups.rollDrops(world, 'goblin_runner', 12, 10);
    const kinds = world.groundItems.map((i) => i.kind);
    expect(kinds).toContain('potion');
    expect(kinds).toContain('gold');
    const gold = world.groundItems.find((i) => i.kind === 'gold')!;
    expect(gold.amount).toBe(cfg.gold.min); // random 0 → 최소치
  });

  it('굴림이 빗나가면 아무것도 떨어지지 않는다', () => {
    fixRandom(0.99);
    Pickups.rollDrops(world, 'goblin_runner', 12, 10);
    expect(world.groundItems).toHaveLength(0);
  });

  it('마나 물약도 함께 떨어진다', () => {
    fixRandom(0.01);
    Pickups.rollDrops(world, 'goblin_runner', 12, 10);
    expect(world.groundItems.map((i) => i.kind)).toContain('mana');
  });

  it('음식도 함께 떨어진다', () => {
    fixRandom(0.01); // food(0.15) 통과
    Pickups.rollDrops(world, 'goblin_runner', 12, 10);
    expect(world.groundItems.map((i) => i.kind)).toContain('food');
  });

  it('보스는 확률과 무관하게 포션 확정 + 골드 ×배율', () => {
    fixRandom(0.99);
    Pickups.rollDrops(world, 'goblin_chieftain', 12, 10);
    const gold = world.groundItems.find((i) => i.kind === 'gold')!;
    expect(world.groundItems.some((i) => i.kind === 'potion')).toBe(true);
    expect(gold.amount).toBe(cfg.gold.max * cfg.gold.bossMul); // random 0.99 → 최대치
  });
});

describe('자석 흡수', () => {
  /** 흡수될 때까지(또는 maxTicks) 돌린다. 걸린 틱 수 반환 */
  function absorb(maxTicks = 120): number {
    for (let i = 1; i <= maxTicks; i++) {
      Pickups.tick(world, DT);
      if (world.groundItems.length === 0) return i;
    }
    return -1;
  }

  it('포션 — 날아와 가방으로 들어간다. 줍는 것만으로는 회복되지 않는다', () => {
    world.player.health = balance.player.healthMax - 10;
    world.groundItems.push({ id: 1, kind: 'potion', x: 12, z: 10 }); // 2m 앞
    const events: unknown[] = [];
    world.events.on('item_picked', (payload) => events.push(payload));

    Pickups.tick(world, DT); // 첫 틱 — 자석에 걸려 공중으로
    const item = world.groundItems[0]!;
    expect(item.magnet).toBe(true);
    expect(item.y).toBeGreaterThan(0.5); // 바닥이 아니라 공중

    const ticks = absorb();
    expect(ticks).toBeGreaterThan(1); // 즉시가 아니라 날아온다
    expect(ticks).toBeLessThan(20); // 아주 빠르게 (0.33초 이내)
    expect(countOf(world, 'potion')).toBe(1);
    expect(world.player.health).toBe(balance.player.healthMax - 10); // 마셔야 찬다
    expect(events[0]).toMatchObject({ kind: 'potion' });
  });

  it('자원이 가득이어도 줍는다 — 기준은 체력이 아니라 가방 자리다', () => {
    world.player.health = balance.player.healthMax;
    world.mana.value = balance.mana.max;
    world.groundItems.push({ id: 1, kind: 'potion', x: 10.5, z: 10 });
    world.groundItems.push({ id: 2, kind: 'food', x: 10, z: 10.5 });
    expect(absorb()).toBeGreaterThan(0);
    expect(countOf(world, 'potion')).toBe(1);
    expect(countOf(world, 'food')).toBe(1);
  });

  it('가방이 가득이면 자석이 안 문다 — 바닥에 그대로 남는다', () => {
    fillBag(world);
    world.groundItems.push({ id: 1, kind: 'potion', x: 10.5, z: 10 });
    for (let i = 0; i < 30; i++) Pickups.tick(world, DT);
    expect(world.groundItems).toHaveLength(1);
    expect(world.groundItems[0]!.magnet).toBeUndefined();
  });

  it('버린 직후에는 자석이 안 문다 — 도로 주워지면 가방을 비울 수가 없다', () => {
    world.groundItems.push({
      id: 1, kind: 'potion', x: 10.2, z: 10,
      noMagnetTicks: balance.items.dropNoMagnetTicks,
    });
    for (let i = 0; i < balance.items.dropNoMagnetTicks - 1; i++) Pickups.tick(world, DT);
    expect(world.groundItems[0]!.magnet).toBeUndefined();
    expect(countOf(world, 'potion')).toBe(0);

    expect(absorb()).toBeGreaterThan(0); // 유예가 끝나면 다시 주울 수 있다
    expect(countOf(world, 'potion')).toBe(1);
  });

  it('반경 밖이면 걸리지 않는다', () => {
    world.groundItems.push({ id: 1, kind: 'potion', x: 10 + cfg.potion.magnetRadius + 0.5, z: 10 });
    Pickups.tick(world, DT);
    expect(world.groundItems[0]!.magnet).toBeUndefined();
    expect(countOf(world, 'potion')).toBe(0);
  });

  it('골드 — 날아와 누적되고, 한 번 걸리면 멀어져도 따라온다', () => {
    world.groundItems.push({ id: 1, kind: 'gold', amount: 7, x: 13, z: 10 });
    world.groundItems.push({ id: 2, kind: 'gold', amount: 3, x: 10, z: 13 });
    Pickups.tick(world, DT);
    expect(world.groundItems.every((i) => i.magnet)).toBe(true);

    world.player.x = 40; // 멀리 도망쳐도
    world.player.z = 40;
    expect(absorb(600)).toBeGreaterThan(0); // 끝까지 쫓아와 흡수된다
    expect(world.gold).toBe(10);
  });

  it('각인은 Pickups가 건드리지 않는다 (Sigils 담당)', () => {
    world.groundItems.push({ id: 1, kind: 'sigil', sigilId: 'sig_fireball', x: 10, z: 10 });
    Pickups.tick(world, DT);
    expect(world.groundItems).toHaveLength(1);

    Sigils.tick(world, DT);
    expect(world.groundItems).toHaveLength(0);
    expect(world.sigils.active).toBe('sig_fireball'); // 주우면 바로 Q 스킬
  });
});

describe('경험치', () => {
  it('처치한 적의 xp 만큼 누적되고 xp_gained 를 발행한다', () => {
    Progression.init(world);
    const events: unknown[] = [];
    world.events.on('xp_gained', (payload) => events.push(payload));

    world.events.emit('enemy_died', { enemyType: 'goblin_runner', x: 0, z: 0 });
    world.events.emit('enemy_died', { enemyType: 'goblin_spear', x: 0, z: 0 });
    const expected = enemyDef('goblin_runner').xp + enemyDef('goblin_spear').xp;
    expect(world.xp).toBe(expected);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ enemyType: 'goblin_spear', total: expected });
  });

  it('강한 적일수록 많이 준다', () => {
    expect(enemyDef('goblin_chieftain').xp).toBeGreaterThan(enemyDef('warden').xp);
    expect(enemyDef('warden').xp).toBeGreaterThan(enemyDef('goblin_spear').xp);
    expect(enemyDef('goblin_spear').xp).toBeGreaterThan(enemyDef('goblin_runner').xp);
  });
});

describe('가방이 가득 찬 뒤', () => {
  it('자석에 걸린 뒤 가방이 차 버리면 발밑에 도로 놓인다 — 사라지지 않는다', () => {
    world.groundItems.push({ id: 1, kind: 'potion', x: 10.5, z: 10 });
    Pickups.tick(world, DT); // 자석에 문다
    expect(world.groundItems[0]!.magnet).toBe(true);

    fillBag(world); // 날아오는 도중에 가방이 찼다
    const full: unknown[] = [];
    world.events.on('inventory_full', (payload) => full.push(payload));
    for (let i = 0; i < 60; i++) Pickups.tick(world, DT);

    expect(world.groundItems).toHaveLength(1); // 증발하지 않았다
    expect(world.groundItems[0]!.magnet).toBe(false); // 자석은 풀렸다
    expect(full.length).toBeGreaterThan(0);
    expect(Math.hypot(world.groundItems[0]!.x - 10, world.groundItems[0]!.z - 10)).toBeLessThan(0.1);
  });
});
