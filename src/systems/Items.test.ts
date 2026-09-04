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
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  initInventory(world);
  return world;
}

/** 퀵슬롯 키를 한 틱 누른다 (시전 시작만 — 효과는 아직) */
function press(world: World, slot: number): void {
  world.input = { ...Input.emptySnapshot(), useSlot: slot };
  Items.tick(world, DT);
  world.input = Input.emptySnapshot();
}

/** 손 놓고 n 틱 (시전·쿨다운 돌리기) */
function idle(world: World, n: number): void {
  for (let i = 0; i < n; i++) Items.tick(world, DT);
}

/** 누르고 시전이 끝날 때까지 — 실제로 마신다 */
function drink(world: World, slot: number): void {
  press(world, slot);
  idle(world, CFG.channelTicks);
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('가방 칸', () => {
  it('5×4 = 20칸 (2026-09-04 요청으로 5×2 에서 확장), 퀵슬롯 4칸 (HUD 마름모 넷)', () => {
    expect(CFG.cols).toBe(5);
    expect(CFG.rows).toBe(4);
    expect(world.inventory).toHaveLength(20);
    expect(world.quickslots).toHaveLength(4);
    expect(world.quickslots.length).toBeGreaterThanOrEqual(ITEM_KINDS.length); // 종류가 셋이라 남는다
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
    // 칸을 전부 쓰되 마지막 무더기만 한 개 모자라게 채운다 (칸 수는 데이터 — 5×4 면 6·6·8칸)
    const per = CFG.stackMax;
    const slots = world.inventory.length;
    const third = Math.floor(slots / 3);
    for (let i = 0; i < per * third; i++) addItem(world, 'potion'); // third칸 꽉
    for (let i = 0; i < per * third; i++) addItem(world, 'mana'); // third칸 꽉
    for (let i = 0; i < per * (slots - 2 * third) - 1; i++) addItem(world, 'food'); // 나머지 칸 꽉 + 마지막 1칸 덜 참
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
    drink(world, 1);
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

    drink(world, 1);
    expect(world.player.health).toBe(10 + itemDef('potion').heal);
    expect(countOf(world, 'potion')).toBe(0);
    expect(used[0]).toMatchObject({ healed: itemDef('potion').heal, left: 0 });
  });

  it('음식 — 먹자마자 조금만 차고, 30초 동안 아주 천천히 이어서 찬다', () => {
    const food = itemDef('food');
    expect(food.restore).toBe(0); // 마나는 더 이상 안 준다 (2026-08-30 개념 변경)
    expect(food.regen).toBeTruthy();
    expect(food.heal).toBeLessThan(itemDef('potion').heal * 0.3); // 초기 회복은 응급이 아니다

    addItem(world, 'food');
    world.player.health = 40;
    world.mana.value = 10;
    drink(world, 1);
    expect(world.player.health).toBeCloseTo(40 + food.heal, 5); // 초기 회복
    expect(world.mana.value).toBe(10); // 마나 무변
    expect(world.foodRegenTicks).toBe(food.regen!.durationTicks);

    idle(world, 600); // 10초 — 미세 회복 누적
    expect(world.player.health).toBeCloseTo(40 + food.heal + 600 * food.regen!.healPerTick, 1);

    idle(world, food.regen!.durationTicks); // 지속시간 소진
    expect(world.foodRegenTicks).toBe(0);
    const settled = world.player.health;
    idle(world, 120);
    expect(world.player.health).toBe(settled); // 끝나면 더 안 찬다
  });

  it('상한을 넘지 않는다', () => {
    addItem(world, 'potion');
    world.player.health = balance.player.healthMax - 5;
    drink(world, 1);
    expect(world.player.health).toBe(balance.player.healthMax);
  });

  it('가득 찬 자원에는 안 나간다 — 그냥 버리는 것이므로', () => {
    addItem(world, 'potion');
    world.player.health = balance.player.healthMax;
    const denied: { reason: string }[] = [];
    world.events.on('item_denied', (p) => denied.push(p as { reason: string }));

    drink(world, 1);
    expect(countOf(world, 'potion')).toBe(1); // 안 줄었다
    expect(denied[0]).toMatchObject({ reason: 'full' });
  });

  it('음식 — 만피여도 지속 효과가 없으면 값어치가 있고, 버프 중엔 낭비라 막힌다', () => {
    addItem(world, 'food');
    world.player.health = balance.player.healthMax;
    world.mana.value = balance.mana.max;
    expect(isUseful(world, 'food')).toBe(true); // 30초 지속 회복 + 스태미너 가속
    world.foodRegenTicks = 100; // 이미 씹는 중
    expect(isUseful(world, 'food')).toBe(false);
    world.foodRegenTicks = 0;
    world.player.health = 50;
    expect(isUseful(world, 'food')).toBe(true);
  });

  it('공용 쿨다운 — 다 마시자마자 또 마시지 못한다', () => {
    for (let i = 0; i < 3; i++) addItem(world, 'potion');
    world.player.health = 1;
    drink(world, 1);
    expect(countOf(world, 'potion')).toBe(2);
    expect(world.itemCooldown).toBe(CFG.useCooldownTicks);

    press(world, 1); // 곧바로 또 눌러도
    expect(world.itemChannel).toBeNull(); // 시전조차 시작되지 않는다
    idle(world, CFG.channelTicks);
    expect(countOf(world, 'potion')).toBe(2);

    idle(world, CFG.useCooldownTicks);
    drink(world, 1);
    expect(countOf(world, 'potion')).toBe(1); // 쿨다운이 끝나면 다시 나간다
  });

  it('다 쓴 칸을 누르면 이유를 알려 준다', () => {
    addItem(world, 'potion');
    world.player.health = 1;
    drink(world, 1);
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

describe('시전 시간', () => {
  it('누른 즉시가 아니라 channelTicks 를 다 채워야 효과가 난다', () => {
    addItem(world, 'potion');
    world.player.health = 10;
    press(world, 1);
    expect(world.itemChannel).toMatchObject({ kind: 'potion', index: 0, total: CFG.channelTicks });

    idle(world, CFG.channelTicks - 1);
    expect(world.player.health).toBe(10); // 아직 안 마셨다
    expect(countOf(world, 'potion')).toBe(1); // 아직 안 줄었다

    idle(world, 1);
    expect(world.itemChannel).toBeNull();
    expect(world.player.health).toBe(10 + itemDef('potion').heal);
    expect(countOf(world, 'potion')).toBe(0);
  });

  it('맞아서 굳으면 끊긴다 — 아이템은 그대로 남는다', () => {
    addItem(world, 'potion');
    world.player.health = 10;
    const broken: unknown[] = [];
    world.events.on('item_channel_broken', (p) => broken.push(p));

    press(world, 1);
    idle(world, 10);
    world.player.stunTicks = 12; // 피격
    idle(world, 1);

    expect(world.itemChannel).toBeNull();
    expect(broken).toHaveLength(1);
    expect(countOf(world, 'potion')).toBe(1); // 잃은 것은 시간뿐
    expect(world.itemCooldown).toBe(0); // 쿨다운도 안 걸린다
  });

  it('공격하면 끊긴다', () => {
    addItem(world, 'potion');
    world.player.health = 10;
    press(world, 1);
    idle(world, 5);
    world.input = { ...Input.emptySnapshot(), rangedPressed: true };
    Items.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(world.itemChannel).toBeNull();
    expect(countOf(world, 'potion')).toBe(1);
  });

  it('회피해도 끊긴다', () => {
    addItem(world, 'potion');
    world.player.health = 10;
    press(world, 1);
    idle(world, 5);
    world.player.dodgeTicks = 6;
    idle(world, 1);
    expect(world.itemChannel).toBeNull();
  });

  it('방패를 들고 있으면 아예 시작되지 않는다 — 가드를 내려야 마신다', () => {
    addItem(world, 'potion');
    world.player.health = 10;
    world.player.blocking = true;
    const denied: { reason: string }[] = [];
    world.events.on('item_denied', (p) => denied.push(p as { reason: string }));

    press(world, 1);
    expect(world.itemChannel).toBeNull();
    expect(denied[0]).toMatchObject({ reason: 'blocking' });
  });

  it('마시는 중에 또 누르면 무시된다 (겹쳐 마시지 않는다)', () => {
    for (let i = 0; i < 2; i++) addItem(world, 'potion');
    world.player.health = 10;
    press(world, 1);
    const denied: { reason: string }[] = [];
    world.events.on('item_denied', (p) => denied.push(p as { reason: string }));
    press(world, 1);
    expect(denied[0]).toMatchObject({ reason: 'busy' });
    expect(world.itemChannel!.ticks).toBeGreaterThan(0); // 처음 것이 계속 돈다
  });

  it('channelFrac 이 0→1 로 진행을 알려 준다', () => {
    addItem(world, 'potion');
    world.player.health = 10;
    expect(Items.channelFrac(world)).toBe(0);
    press(world, 1);
    idle(world, Math.round(CFG.channelTicks / 2));
    expect(Items.channelFrac(world)).toBeCloseTo(0.5, 1);
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
      expect(Math.hypot(item.x - world.player.x, item.z - world.player.z)).toBeLessThanOrEqual(balance.items.dropScatter * 2.6 + 1e-6);
    }
  });

  it('버린 것들은 서로·기존 바닥 아이템과 겹치지 않는다 (items.dropSpacing)', () => {
    for (let i = 0; i < CFG.stackMax; i++) addItem(world, 'potion');
    for (let i = 0; i < CFG.stackMax; i++) addItem(world, 'mana');
    dropSlot(world, 0);
    dropSlot(world, 1);
    const items = world.groundItems;
    expect(items).toHaveLength(CFG.stackMax * 2);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        expect(Math.hypot(items[i]!.x - items[j]!.x, items[i]!.z - items[j]!.z)).toBeGreaterThanOrEqual(CFG.dropSpacing - 1e-6);
      }
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

describe('가방이 가득일 때 안내 (2026-09-04: 소모품은 E 로 집는다 — 가득이면 튕겨 돌아온다)', () => {
  function fill(): void {
    const per = CFG.stackMax;
    for (let i = 0; i < world.inventory.length * per; i++) addItem(world, ITEM_KINDS[Math.floor(i / per) % 3]!);
    expect(hasRoom(world, 'potion')).toBe(false);
  }

  it('옆에 서 있기만 하면 조용하다 — 자석이 아니라 손으로 집는 것이라 지나갈 때마다 뜨지 않는다', () => {
    fill();
    const full: unknown[] = [];
    world.events.on('inventory_full', (p) => full.push(p));
    world.groundItems.push({ id: 1, kind: 'potion', x: world.player.x + 0.5, z: world.player.z });
    for (let i = 0; i < 30; i++) Pickups.tick(world, DT);
    expect(full).toHaveLength(0);
    expect(world.groundItems).toHaveLength(1); // 바닥에 그대로
    expect(world.groundItems[0]!.magnet).toBeUndefined();
  });

  it('바라보며 E 를 누르면 날아왔다가 원자리로 튕겨 돌아간다 — pickup_bounced 한 번', () => {
    fill();
    world.player.yaw = -Math.PI / 2; // +X 를 본다
    const bounced: unknown[] = [];
    world.events.on('pickup_bounced', (p) => bounced.push(p));
    world.groundItems.push({ id: 1, kind: 'potion', x: world.player.x + 1.2, z: world.player.z });
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Pickups.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(world.groundItems[0]!.magnet).toBe(true);
    for (let i = 0; i < 120 && bounced.length === 0; i++) Pickups.tick(world, DT);
    expect(bounced).toHaveLength(1);
    expect(world.groundItems).toHaveLength(1);
    expect(world.groundItems[0]!.x).toBeCloseTo(world.player.x + 1.2, 5);
    expect(hasRoom(world, 'potion')).toBe(false); // 가방은 그대로 가득
  });

  it('반경 밖이면 대상이 아니다 — E 를 눌러도 조용하다', () => {
    fill();
    world.player.yaw = -Math.PI / 2;
    world.groundItems.push({
      id: 1, kind: 'potion',
      x: world.player.x + balance.loot.pickup.radius + 1, z: world.player.z,
    });
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Pickups.tick(world, DT);
    expect(world.itemInView).toBeNull();
    expect(world.groundItems[0]!.magnet).toBeUndefined();
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
