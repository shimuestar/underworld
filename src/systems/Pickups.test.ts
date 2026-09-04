// 바닥 아이템 자동 획득(자석) 검증. 처치 드랍 굴림·주머니는 Loot.test 가 본다 (2026-09-04).
// 2026-08: 소모품은 주워도 즉시 먹지 않는다 — 효과는 Items.test 가 본다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { addItem, countOf, initInventory } from '../core/Inventory';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Loot from './Loot';
import * as Pickups from './Pickups';
import * as Progression from './Progression';
import * as Sigils from './Sigils';

const DT = 1 / 60;

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


/** 바라보며 E 한 번 (다음 틱들은 손을 뗀다) */
function press(w: World): void {
  w.input = { ...Input.emptySnapshot(), interactPressed: true };
  Pickups.tick(w, DT);
  w.input = Input.emptySnapshot();
}

describe('소모품 E 집기 (2026-09-04: 자석이 아니다)', () => {
  /** 흡수될 때까지(또는 maxTicks) 돌린다. 걸린 틱 수 반환 */
  function absorb(maxTicks = 120): number {
    for (let i = 1; i <= maxTicks; i++) {
      Pickups.tick(world, DT);
      if (world.groundItems.length === 0) return i;
    }
    return 0;
  }

  it('포션 — 바라보고 서 있으면 itemInView, E 를 누르면 날아와 가방으로 들어간다. 줍는 것만으로는 회복되지 않는다', () => {
    world.player.health = balance.player.healthMax - 10;
    world.groundItems.push({ id: 1, kind: 'potion', x: 10, z: 8.5 }); // 1.5m 앞 (yaw 0 → -Z)
    const events: unknown[] = [];
    world.events.on('item_picked', (payload) => events.push(payload));

    for (let i = 0; i < 30; i++) Pickups.tick(world, DT);
    expect(world.groundItems[0]!.magnet).toBeUndefined(); // 서 있기만 해서는 안 온다
    expect(world.itemInView).toEqual({ id: 1, kind: 'potion' });

    press(world); // E — 자석 비행으로 출발
    const item = world.groundItems[0]!;
    expect(item.magnet).toBe(true);
    expect(item.y).toBeGreaterThan(0.5);
    const ticks = absorb();
    expect(ticks).toBeGreaterThan(1);
    expect(ticks).toBeLessThan(20);
    expect(countOf(world, 'potion')).toBe(1);
    expect(world.player.health).toBe(balance.player.healthMax - 10); // 마셔야 찬다
    expect(events[0]).toMatchObject({ kind: 'potion' });
  });

  it('자원이 가득이어도 집는다 — 기준은 체력이 아니라 가방 자리다. 한 번에 하나(가장 가까운 것)', () => {
    world.player.health = balance.player.healthMax;
    world.mana.value = balance.mana.max;
    world.groundItems.push({ id: 1, kind: 'potion', x: 10, z: 8.5 });
    world.groundItems.push({ id: 2, kind: 'food', x: 10, z: 8.3 });
    press(world);
    expect(world.groundItems.filter((i) => i.magnet)).toHaveLength(1); // 가까운 것 하나만
    for (let i = 0; i < 60 && world.groundItems.length > 1; i++) Pickups.tick(world, DT);
    expect(countOf(world, 'potion')).toBe(1);
    press(world);
    expect(absorb()).toBeGreaterThan(0);
    expect(countOf(world, 'food')).toBe(1);
  });

  it('가방이 가득이면 E 로 날아왔다가 원자리로 튕겨 돌아간다 — pickup_bounced 한 번, 사라지지 않는다', () => {
    fillBag(world);
    const potionsBefore = countOf(world, 'potion'); // 칸 수는 데이터(5×4) — 채운 뒤의 실제 수와 비교한다
    world.groundItems.push({ id: 1, kind: 'potion', x: 10, z: 8.5 });
    const bounced: unknown[] = [];
    world.events.on('pickup_bounced', (p) => bounced.push(p));
    press(world);
    expect(world.groundItems[0]!.magnet).toBe(true);
    let peak = 0;
    let sawBounce = false;
    for (let i = 0; i < 120; i++) {
      Pickups.tick(world, DT);
      const it = world.groundItems[0]!;
      if ((it.bounceTicks ?? 0) > 0) { sawBounce = true; peak = Math.max(peak, it.y ?? 0); }
      if (bounced.length > 0) break;
    }
    expect(sawBounce).toBe(true);
    expect(peak).toBeGreaterThan(0.55); // 포물선으로 튀어오른다
    expect(bounced).toEqual([{ kind: 'potion', x: 10, z: 8.5 }]);
    const it = world.groundItems[0]!;
    expect(world.groundItems).toHaveLength(1);
    expect(it.magnet).toBe(false);
    expect(it.x).toBe(10);
    expect(it.z).toBe(8.5);
    expect(it.y).toBeUndefined();
    expect(it.noMagnetTicks).toBe(balance.items.dropNoMagnetTicks); // 바로 다시 집으려 들지 않는다
    expect(countOf(world, 'potion')).toBe(potionsBefore); // 가방은 그대로
  });

  it('버린 직후에는 E 도 안 먹는다 — 도로 주워지면 가방을 비울 수가 없다', () => {
    world.groundItems.push({
      id: 1, kind: 'potion', x: 10, z: 8.5,
      noMagnetTicks: balance.items.dropNoMagnetTicks,
    });
    for (let i = 0; i < balance.items.dropNoMagnetTicks - 1; i++) press(world);
    expect(world.groundItems[0]!.magnet).toBeUndefined();
    expect(countOf(world, 'potion')).toBe(0);
    press(world); // 유예가 끝났다
    press(world);
    expect(absorb()).toBeGreaterThan(0);
    expect(countOf(world, 'potion')).toBe(1);
  });

  it('반경 밖이거나 등지고 있으면 대상이 아니다 — E 를 눌러도 아무 일 없다', () => {
    world.groundItems.push({ id: 1, kind: 'potion', x: 10, z: 10 - balance.loot.pickup.radius - 0.5 });
    press(world);
    expect(world.itemInView).toBeNull();
    expect(world.groundItems[0]!.magnet).toBeUndefined();
    world.groundItems[0]!.z = 11.5; // 등 뒤 1.5m
    press(world);
    expect(world.itemInView).toBeNull();
    expect(world.groundItems[0]!.magnet).toBeUndefined();
  });

  it('상자·주머니가 대상이면 바닥 아이템은 양보한다 (우선순위)', () => {
    world.groundItems.push({ id: 1, kind: 'potion', x: 10, z: 8.5 });
    world.lootInView = { kind: 'pouch', id: 99 };
    Pickups.tick(world, DT);
    expect(world.itemInView).toBeNull();
    world.lootInView = null;
    Pickups.tick(world, DT);
    expect(world.itemInView).toEqual({ id: 1, kind: 'potion' });
  });
});

describe('자석 흡수 — 골드·화살·각인', () => {
  /** 흡수될 때까지(또는 maxTicks) 돌린다. 걸린 틱 수 반환 */
  function absorb(maxTicks = 120): number {
    for (let i = 1; i <= maxTicks; i++) {
      Pickups.tick(world, DT);
      if (world.groundItems.length === 0) return i;
    }
    return 0;
  }

  it('골드 — 다가가야 걸리고(반경 1.2m), 한 번 걸리면 멀어져도 따라온다', () => {
    // 2026-08-30: 자석 반경 4.5→1.2 — 멀리서 자동으로 빨려 오지 않고 밟아 먹는 방식
    world.groundItems.push({ id: 1, kind: 'gold', amount: 7, x: 11, z: 10 });
    world.groundItems.push({ id: 2, kind: 'gold', amount: 3, x: 10, z: 11 });
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
    expect(world.skillSlots[0]).toBe('sig_fireball'); // 주우면 바로 스킬 퀵슬롯 1(Z)
  });
});

describe('보스 소환수(noLoot)', () => {
  it('죽어도 드랍·골드·경험치가 없다 — 생명 입자만 나온다', async () => {
    const LifeMotes = await import('./LifeMotes');
    Loot.init(world);
    Progression.init(world);
    LifeMotes.init(world);
    const orig = Math.random;
    Math.random = () => 0; // 드랍 롤 확정 구간 — 보상이 있었다면 반드시 떨어졌을 값
    world.events.emit('enemy_died', { enemyType: 'slime_small', x: 30, z: 30, noLoot: true });
    Math.random = orig;
    expect(world.groundItems).toHaveLength(0); // 주머니도 없다
    expect(world.xp).toBe(0); // 경험치도 없다
    expect(world.lifeMotes.length).toBeGreaterThan(0); // 회복 입자는 나온다
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
  it('날아오는 도중에 가방이 차 버리면 원자리로 튕겨 돌아간다 — 사라지지 않는다', () => {
    world.groundItems.push({ id: 1, kind: 'potion', x: 10, z: 8.5 });
    press(world); // E — 출발
    expect(world.groundItems[0]!.magnet).toBe(true);

    fillBag(world); // 날아오는 도중에 가방이 찼다
    const bounced: unknown[] = [];
    world.events.on('pickup_bounced', (payload) => bounced.push(payload));
    for (let i = 0; i < 120 && bounced.length === 0; i++) Pickups.tick(world, DT);

    expect(world.groundItems).toHaveLength(1); // 증발하지 않았다
    expect(world.groundItems[0]!.magnet).toBe(false);
    expect(bounced).toHaveLength(1);
    expect(Math.hypot(world.groundItems[0]!.x - 10, world.groundItems[0]!.z - 8.5)).toBeLessThan(0.001); // 원자리
  });
});
