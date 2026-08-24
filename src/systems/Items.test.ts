// 소모품 가방·퀵슬롯 — 쌓기, 자리 없음, 자동 등록, 맞바꾸기, 사용 조건, 버리기.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import {
  addItem,
  bindQuickslot,
  countOf,
  dropSlot,
  hasRoom,
  initInventory,
  isUseful,
  itemDef,
  takeItem,
  unbindQuickslot,
} from '../core/Inventory';
import { ITEM_KINDS, World, type ItemKind } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Items from './Items';
import * as Pickups from './Pickups';
import * as Sigils from './Sigils';

const DT = 1 / 60;
const CFG = balance.items;

function makeWorld(): World {
  const level = new Level({
    id: 'arena', name: 'arena', cellSize: 4, ceiling: 4,
    grid: ['########', '#S.....#', '#......#', '#......#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
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
      scars: { eye: 0, rightArm: 0, leftArm: 0, heart: 0, spine: 0 },
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  initInventory(world);
  return world;
}

/** 퀵슬롯 키를 한 틱 누른다 */
function press(world: World, slot: number): void {
  world.input = { ...Input.emptySnapshot(), useSlot: slot };
  Items.tick(world, DT);
  world.input = Input.emptySnapshot();
}

/** 손 놓고 n 틱 (쿨다운 돌리기) */
function idle(world: World, n: number): void {
  for (let i = 0; i < n; i++) Items.tick(world, DT);
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('가방 칸', () => {
  it('요청대로 5×2 = 10칸, 퀵슬롯 5칸', () => {
    expect(CFG.cols).toBe(5);
    expect(CFG.rows).toBe(2);
    expect(world.inventory).toHaveLength(10);
    expect(world.quickslots).toHaveLength(5);
    expect(world.inventory.every((s) => s === null)).toBe(true);
  });

  it('같은 종류는 한 칸에 stackMax 까지 쌓인다', () => {
    for (let i = 0; i < CFG.stackMax; i++) addItem(world, 'potion');
    expect(world.inventory.filter((s) => s !== null)).toHaveLength(1);
    expect(world.inventory[0]).toEqual({ kind: 'potion', count: CFG.stackMax });

    addItem(world, 'potion'); // 넘치면 다음 칸
    expect(world.inventory.filter((s) => s !== null)).toHaveLength(2);
    expect(countOf(world, 'potion')).toBe(CFG.stackMax + 1);
  });

  it('빈 칸보다 쌓을 자리를 먼저 쓴다 — 같은 물약이 칸을 여럿 먹지 않게', () => {
    addItem(world, 'potion');
    addItem(world, 'mana');
    addItem(world, 'potion');
    expect(world.inventory[0]).toEqual({ kind: 'potion', count: 2 });
    expect(world.inventory[1]).toEqual({ kind: 'mana', count: 1 });
    expect(world.inventory[2]).toBeNull();
  });

  it('가득 차면 더 못 받는다 — 이때만 hasRoom 이 false', () => {
    const total = world.inventory.length * CFG.stackMax;
    for (let i = 0; i < total; i++) {
      expect(addItem(world, ITEM_KINDS[Math.floor(i / CFG.stackMax) % ITEM_KINDS.length]!)).toBe(true);
    }
    for (const kind of ITEM_KINDS) {
      expect(hasRoom(world, kind)).toBe(false);
      expect(addItem(world, kind)).toBe(false);
    }
    expect(countOf(world, 'potion') + countOf(world, 'mana') + countOf(world, 'food')).toBe(total);
  });

  it('덜 찬 무더기가 있으면 칸이 다 차 있어도 자리가 있다', () => {
    // 10칸을 전부 쓰되 마지막 무더기만 한 개 모자라게 채운다
    const per = CFG.stackMax;
    for (let i = 0; i < per * 3; i++) addItem(world, 'potion'); // 3칸 꽉
    for (let i = 0; i < per * 3; i++) addItem(world, 'mana'); // 3칸 꽉
    for (let i = 0; i < per * 4 - 1; i++) addItem(world, 'food'); // 3칸 꽉 + 1칸 덜 참
    expect(world.inventory.includes(null)).toBe(false); // 칸은 전부 찼지만
    expect(hasRoom(world, 'food')).toBe(true); // 덜 찬 무더기에 한 개 더 들어간다
    expect(hasRoom(world, 'potion')).toBe(false); // 다른 종류는 들어갈 데가 없다
  });

  it('작은 무더기부터 헐어 칸을 먼저 비운다', () => {
    for (let i = 0; i < CFG.stackMax + 1; i++) addItem(world, 'potion');
    expect(world.inventory[1]).toEqual({ kind: 'potion', count: 1 });
    takeItem(world, 'potion');
    expect(world.inventory[1]).toBeNull(); // 칸이 하나 났다
    expect(world.inventory[0]).toEqual({ kind: 'potion', count: CFG.stackMax });
  });
});

describe('퀵슬롯 등록', () => {
  it('등록 안 된 종류를 처음 주우면 빈 칸에 자동으로 꽂힌다', () => {
    expect(world.quickslots.every((k) => k === null)).toBe(true);
    addItem(world, 'potion');
    expect(world.quickslots[0]).toBe('potion');
    addItem(world, 'mana');
    expect(world.quickslots[1]).toBe('mana');
    addItem(world, 'potion'); // 이미 등록된 종류는 칸을 더 먹지 않는다
    expect(world.quickslots.filter((k) => k === 'potion')).toHaveLength(1);
  });

  it('칸이 아니라 종류를 기억한다 — 다 써도 등록이 남는다', () => {
    addItem(world, 'potion');
    world.player.health = 10;
    press(world, 1);
    expect(countOf(world, 'potion')).toBe(0);
    expect(world.quickslots[0]).toBe('potion'); // 등록은 그대로

    addItem(world, 'potion'); // 다시 주우면 바로 쓸 수 있다
    world.itemCooldown = 0;
    expect(Items.use(world, 0)).toBe(true);
  });

  it('이미 다른 칸에 있는 종류를 옮기면 자리를 맞바꾼다 — 중복 등록은 없다', () => {
    addItem(world, 'potion'); // → 0번
    addItem(world, 'mana'); // → 1번
    bindQuickslot(world, 1, 'potion');
    expect(world.quickslots[1]).toBe('potion');
    expect(world.quickslots[0]).toBe('mana'); // 밀려난 것이 빈 자리로
    expect(world.quickslots.filter((k) => k === 'potion')).toHaveLength(1);
  });

  it('빈 칸으로 옮기면 원래 자리는 비워진다', () => {
    addItem(world, 'potion');
    bindQuickslot(world, 3, 'potion');
    expect(world.quickslots[3]).toBe('potion');
    expect(world.quickslots[0]).toBeNull();
  });

  it('등록을 풀 수 있다', () => {
    addItem(world, 'potion');
    unbindQuickslot(world, 0);
    expect(world.quickslots[0]).toBeNull();
    expect(Items.use(world, 0)).toBe(false); // 빈 칸은 안 나간다
  });

  it('퀵슬롯이 다 차 있으면 자동 등록은 조용히 넘어간다', () => {
    for (let i = 0; i < world.quickslots.length; i++) bindQuickslot(world, i, 'potion');
    // bind 는 중복을 막으므로 실제로는 한 칸만 potion — 나머지를 손으로 막는다
    world.quickslots.fill('mana');
    addItem(world, 'food');
    expect(world.quickslots.includes('food')).toBe(false);
    expect(countOf(world, 'food')).toBe(1); // 가방에는 들어갔다
  });
});

describe('사용', () => {
  it('1~5 키로 등록된 것을 마신다 — 회복량은 items.kinds', () => {
    addItem(world, 'potion');
    world.player.health = 10;
    const used: { healed: number; left: number }[] = [];
    world.events.on('item_used', (p) => used.push(p as { healed: number; left: number }));

    press(world, 1);
    expect(world.player.health).toBe(10 + itemDef('potion').heal);
    expect(countOf(world, 'potion')).toBe(0);
    expect(used[0]).toMatchObject({ healed: itemDef('potion').heal, left: 0 });
  });

  it('음식은 HP·마나를 동시에 — 각 물약의 절반', () => {
    expect(itemDef('food').heal).toBeCloseTo(itemDef('potion').heal / 2, 5);
    expect(itemDef('food').restore).toBeCloseTo(itemDef('mana').restore / 2, 5);

    addItem(world, 'food');
    world.player.health = 40;
    world.mana.value = 10;
    press(world, 1);
    expect(world.player.health).toBeCloseTo(40 + itemDef('food').heal, 5);
    expect(world.mana.value).toBeCloseTo(10 + itemDef('food').restore, 5);
  });

  it('상한을 넘지 않는다', () => {
    addItem(world, 'potion');
    world.player.health = balance.player.healthMax - 5;
    press(world, 1);
    expect(world.player.health).toBe(balance.player.healthMax);
  });

  it('가득 찬 자원에는 안 나간다 — 그냥 버리는 것이므로', () => {
    addItem(world, 'potion');
    world.player.health = balance.player.healthMax;
    const denied: { reason: string }[] = [];
    world.events.on('item_denied', (p) => denied.push(p as { reason: string }));

    press(world, 1);
    expect(countOf(world, 'potion')).toBe(1); // 안 줄었다
    expect(denied[0]).toMatchObject({ reason: 'full' });
  });

  it('음식은 둘 중 하나만 모자라도 마실 수 있다', () => {
    addItem(world, 'food');
    world.player.health = balance.player.healthMax;
    world.mana.value = balance.mana.max;
    expect(isUseful(world, 'food')).toBe(false);
    world.mana.value = balance.mana.max - 1;
    expect(isUseful(world, 'food')).toBe(true);
  });

  it('공용 쿨다운 — 한 프레임에 들이붓지 못한다', () => {
    for (let i = 0; i < 3; i++) addItem(world, 'potion');
    world.player.health = 1;
    press(world, 1);
    expect(countOf(world, 'potion')).toBe(2);
    expect(world.itemCooldown).toBe(CFG.useCooldownTicks);

    press(world, 1); // 곧바로 또 눌러도
    expect(countOf(world, 'potion')).toBe(2); // 안 나간다

    idle(world, CFG.useCooldownTicks);
    press(world, 1);
    expect(countOf(world, 'potion')).toBe(1); // 쿨다운이 끝나면 다시 나간다
  });

  it('다 쓴 칸을 누르면 이유를 알려 준다', () => {
    addItem(world, 'potion');
    world.player.health = 1;
    press(world, 1);
    idle(world, CFG.useCooldownTicks);

    const denied: { reason: string }[] = [];
    world.events.on('item_denied', (p) => denied.push(p as { reason: string }));
    press(world, 1);
    expect(denied[0]).toMatchObject({ reason: 'none' });
  });

  it('없는 번호를 눌러도 아무 일도 없다', () => {
    world.player.health = 1;
    world.input = { ...Input.emptySnapshot(), useSlot: 9 };
    expect(() => Items.tick(world, DT)).not.toThrow();
    expect(world.player.health).toBe(1);
  });
});

describe('버리기', () => {
  it('칸을 통째로 발밑에 떨구고, 잠깐은 자석이 안 문다', () => {
    for (let i = 0; i < 3; i++) addItem(world, 'potion');
    const dropped: { count: number }[] = [];
    world.events.on('item_dropped', (p) => dropped.push(p as { count: number }));

    dropSlot(world, 0);
    expect(world.inventory[0]).toBeNull();
    expect(countOf(world, 'potion')).toBe(0);
    expect(world.groundItems).toHaveLength(3); // 개수만큼 바닥에
    expect(dropped[0]).toMatchObject({ count: 3 });
    for (const item of world.groundItems) {
      expect(item.kind).toBe('potion');
      expect(item.noMagnetTicks).toBe(CFG.dropNoMagnetTicks);
      expect(Math.hypot(item.x - world.player.x, item.z - world.player.z)).toBeLessThan(1.5);
    }
  });

  it('빈 칸을 버려도 아무 일도 없다', () => {
    dropSlot(world, 4);
    expect(world.groundItems).toHaveLength(0);
  });

  it('버린 것 id 는 다른 드랍 대역과 겹치지 않는다', () => {
    addItem(world, 'mana');
    dropSlot(world, 0);
    const id = world.groundItems[0]!.id;
    expect(id).toBeGreaterThanOrEqual(700000);
    expect(id).toBeLessThan(800000); // 각인(800000~)·상자 골드(900000~) 앞
  });
});

describe('가방이 가득일 때 안내', () => {
  it('코앞까지 갔는데 못 줍는 아이템이 있으면 inventory_full 을 알린다', () => {
    const per = CFG.stackMax;
    const total = world.inventory.length * per;
    for (let i = 0; i < total; i++) addItem(world, ITEM_KINDS[Math.floor(i / per) % 3]!);
    expect(hasRoom(world, 'potion')).toBe(false);

    const full: unknown[] = [];
    world.events.on('inventory_full', (p) => full.push(p));
    world.groundItems.push({ id: 1, kind: 'potion', x: world.player.x + 0.5, z: world.player.z });
    Pickups.tick(world, DT);
    expect(full).toHaveLength(1);
    expect(world.groundItems).toHaveLength(1); // 바닥에 그대로
  });

  it('반경 밖이면 조용하다 — 지나갈 때마다 뜨면 시끄럽다', () => {
    const per = CFG.stackMax;
    for (let i = 0; i < world.inventory.length * per; i++) {
      addItem(world, ITEM_KINDS[Math.floor(i / per) % 3]!);
    }
    const full: unknown[] = [];
    world.events.on('inventory_full', (p) => full.push(p));
    world.groundItems.push({
      id: 1, kind: 'potion',
      x: world.player.x + balance.pickups.potion.magnetRadius + 1, z: world.player.z,
    });
    Pickups.tick(world, DT);
    expect(full).toHaveLength(0);
  });

  it('여러 개가 깔려 있어도 틱당 한 번만 알린다', () => {
    const per = CFG.stackMax;
    for (let i = 0; i < world.inventory.length * per; i++) {
      addItem(world, ITEM_KINDS[Math.floor(i / per) % 3]!);
    }
    const full: unknown[] = [];
    world.events.on('inventory_full', (p) => full.push(p));
    for (let i = 0; i < 4; i++) {
      world.groundItems.push({
        id: i, kind: 'potion', x: world.player.x + 0.3 * i, z: world.player.z,
      });
    }
    Pickups.tick(world, DT);
    expect(full).toHaveLength(1);
  });
});

describe('데이터', () => {
  it('세 종류 모두 이름·색·효과가 있다', () => {
    for (const kind of ITEM_KINDS) {
      const def = itemDef(kind as ItemKind);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(def.heal + def.restore).toBeGreaterThan(0); // 아무것도 안 하는 소모품은 없다
    }
  });

  it('색은 서로 다르다 — 아이콘만 보고 구분해야 한다', () => {
    const colors = ITEM_KINDS.map((k) => itemDef(k as ItemKind).color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
