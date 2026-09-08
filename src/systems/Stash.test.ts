// 창고(성물함) — 칸 수·옮기기·전부 넣기·안전 칸·확장·열쇠 자동 보관 (stash.md)

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { addEquip, addItem, addSigil, countOf, initInventory, spillInventoryToGrave } from '../core/Inventory';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Sigils from './Sigils';
import * as Stash from './Stash';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 't', name: 't', cellSize: 4, ceiling: 6,
    grid: ['#######', '#S....#', '#.....#', '#######'],
    lighting: { ambient: 0.6, torches: [] },
    stash: { cell: [2, 5], dir: 'W' },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6, yaw: 0, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0, iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 5, reserve: 12, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  initInventory(world);
  Stash.initStash(world);
  return world;
}

let world: World;
const cfg = balance.lobby.stash;
beforeEach(() => {
  world = makeWorld();
});

describe('칸 수', () => {
  it('시작 창고는 baseSlots, 안전 칸은 secure.baseSlots — 성물함 자리는 Level 이 잡고 차단 상자를 남긴다', () => {
    expect(world.stash).toHaveLength(cfg.baseSlots);
    expect(world.secure).toHaveLength(cfg.secure.baseSlots);
    expect(world.level.stashPos).toEqual({ x: 22, z: 10, dirX: -1, dirZ: 0 });
    // dir W — 긴 축(x 반폭)은 세로(Z)로 놓이고, 다가오는 X 축으로는 깊이(z 반폭)가 막는다
    const body = { x: 22 - 3, z: 10 };
    world.level.slideMove(body, 0.4, 5, 0);
    expect(body.x).toBeLessThan(22 - cfg.collisionHalf.z - 0.4 + 0.01);
    expect(body.x).toBeGreaterThan(22 - cfg.collisionHalf.z - 0.4 - 0.05);
  });
});

describe('접근', () => {
  it('반경 안에서 바라보고 상호작용하면 stash_opened — 등지면 안 된다, 재진입 가드 중엔 무시', () => {
    const opened: unknown[] = [];
    world.events.on('stash_opened', (p) => opened.push(p));
    world.player.x = 22 - 1.6;
    world.player.z = 10;
    world.player.yaw = -Math.PI / 2; // +X
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Stash.tick(world, DT);
    expect(world.stashInView).toBe(true);
    expect(opened).toHaveLength(1);
    world.npcReopenGuard = 2;
    Stash.tick(world, DT);
    expect(opened).toHaveLength(1);
    world.npcReopenGuard = 0;
    world.player.yaw = Math.PI / 2; // 등짐
    Stash.tick(world, DT);
    expect(world.stashInView).toBe(false);
    expect(opened).toHaveLength(1);
  });
});

describe('옮기기', () => {
  it('가방 → 창고 한 개·통째로, 창고 → 가방. 창고는 stackMax 까지 한 칸에 쌓인다', () => {
    for (let i = 0; i < 7; i++) addItem(world, 'potion'); // 가방 5+2
    const moved: unknown[] = [];
    world.events.on('stash_moved', (p) => moved.push(p));
    expect(Stash.move(world, 'bag', 0, 'stash')).toBe(1);
    expect(world.stash[0]).toEqual({ kind: 'potion', count: 1 });
    expect(Stash.move(world, 'bag', 0, 'stash', true)).toBe(4);
    expect(world.inventory[0]).toBeNull();
    expect(world.stash[0]!.count).toBe(5);
    expect(Stash.move(world, 'bag', 1, 'stash', true)).toBe(2);
    expect(world.stash[0]!.count).toBe(7); // 가방 상한(5)을 넘어 한 칸에 쌓인다
    expect(world.stash.filter((s) => s)).toHaveLength(1);
    expect(Stash.move(world, 'stash', 0, 'bag')).toBe(1);
    expect(countOf(world, 'potion')).toBe(1);
    expect(moved).toHaveLength(4);
  });

  it('각인·장비는 한 칸에 한 개 — 그대로 옮겨진다', () => {
    addSigil(world, 'sig_darkvision');
    addEquip(world, 'helm_leather');
    expect(Stash.move(world, 'bag', 0, 'stash')).toBe(1);
    expect(Stash.move(world, 'bag', 1, 'stash')).toBe(1);
    expect(world.stash[0]).toEqual({ kind: 'sigil', count: 1, sigilId: 'sig_darkvision' });
    expect(world.stash[1]).toEqual({ kind: 'equip', count: 1, equipId: 'helm_leather' });
  });

  it('받는 쪽이 가득이면 stash_denied full, 빈 칸을 옮기면 empty', () => {
    world.stash = world.stash.map(() => ({ kind: 'food', count: cfg.stackMax }));
    addItem(world, 'potion');
    const denied: unknown[] = [];
    world.events.on('stash_denied', (p) => denied.push(p));
    expect(Stash.move(world, 'bag', 0, 'stash')).toBe(0);
    expect(Stash.move(world, 'bag', 3, 'stash')).toBe(0);
    expect(denied).toEqual([
      { reason: 'full', from: 'bag', to: 'stash', kind: 'potion' },
      { reason: 'empty', from: 'bag', to: 'stash' },
    ]);
  });

  it('가방 전부 넣기 — 들어가는 만큼 전부, 옮긴 개수 합', () => {
    for (let i = 0; i < 3; i++) addItem(world, 'potion');
    addItem(world, 'food');
    addSigil(world, 'sig_darkvision');
    expect(Stash.depositAll(world)).toBe(5);
    expect(world.inventory.every((s) => s === null)).toBe(true);
    expect(world.stash.filter((s) => s)).toHaveLength(3);
  });
});

describe('그 칸에 놓기 (place — 가방 탭 드래그·집어 옮기기)', () => {
  it('빈 칸이면 옮기고, 같은 종류면 합치고(상한까지), 다른 종류면 맞바꾼다 — 가방 ↔ 안전 주머니', () => {
    Stash.unlockSecureSlot(world); // 두 칸으로 — 1번 칸에 놓는다
    for (let i = 0; i < 4; i++) addItem(world, 'potion');
    addItem(world, 'food');
    expect(Stash.place(world, 'bag', 0, 'secure', 1)).toBe('moved');
    expect(world.secure[1]).toEqual({ kind: 'potion', count: 4 });
    expect(world.inventory[0]).toBeNull();
    addItem(world, 'potion');
    addItem(world, 'potion');
    const idx = world.inventory.findIndex((s) => s?.kind === 'potion');
    expect(Stash.place(world, 'bag', idx, 'secure', 1)).toBe('merged'); // 4+2 → 5, 1 남음
    expect(world.secure[1]!.count).toBe(balance.items.stackMax);
    expect(world.inventory[idx]).toEqual({ kind: 'potion', count: 1 });
    const foodIdx = world.inventory.findIndex((s) => s?.kind === 'food');
    expect(Stash.place(world, 'bag', foodIdx, 'secure', 1)).toBe('swapped');
    expect(world.secure[1]).toEqual({ kind: 'food', count: 1 });
    expect(world.inventory[foodIdx]).toEqual({ kind: 'potion', count: balance.items.stackMax });
    expect(Stash.place(world, 'secure', 1, 'bag', foodIdx)).toBe('swapped');
    expect(Stash.place(world, 'secure', 0, 'bag', 0)).toBe('none'); // 빈 칸을 들었다
    expect(Stash.place(world, 'bag', 0, 'bag', 0)).toBe('none');
  });
});

describe('창고 → 퀵슬롯 (toBagAndBind)', () => {
  it('창고 칸을 퀵슬롯에 올리면 가방으로 들어오며 등록된다 — 가방에 자리가 없으면 거절, 열쇠·장비는 못 올린다', () => {
    world.stash[0] = { kind: 'mana', count: 3 };
    const bound: unknown[] = [];
    world.events.on('stash_quickbound', (p) => bound.push(p));
    expect(Stash.toBagAndBind(world, 0, 2)).toBe(true);
    expect(world.stash[0]).toBeNull();
    expect(countOf(world, 'mana')).toBe(3);
    expect(world.quickslots[2]).toBe('mana');
    expect(bound).toEqual([{ kind: 'mana', index: 2 }]);
    // 가방이 가득 — 거절
    world.inventory = world.inventory.map(() => ({ kind: 'food', count: balance.items.stackMax }));
    world.stash[1] = { kind: 'potion', count: 1 };
    const denied: unknown[] = [];
    world.events.on('stash_denied', (p) => denied.push(p));
    expect(Stash.toBagAndBind(world, 1, 0)).toBe(false);
    expect(world.stash[1]).toEqual({ kind: 'potion', count: 1 });
    expect(world.quickslots[0]).toBeNull();
    expect(denied[0]).toMatchObject({ reason: 'full', from: 'stash', to: 'bag' });
    // 열쇠·장비는 퀵슬롯에 못 올린다
    world.inventory = world.inventory.map(() => null);
    world.stash[2] = { kind: 'key_s', count: 1 };
    world.stash[3] = { kind: 'equip', count: 1, equipId: 'helm_leather' };
    expect(Stash.toBagAndBind(world, 2, 0)).toBe(false);
    expect(Stash.toBagAndBind(world, 3, 0)).toBe(false);
    expect(world.stash[2]).not.toBeNull();
    expect(denied.slice(1).every((d) => (d as { reason: string }).reason === 'not_bindable')).toBe(true);
    expect(Stash.isBindable('potion')).toBe(true);
    expect(Stash.isBindable('key_m')).toBe(false);
  });
});

describe('안전 주머니', () => {
  it('열쇠는 주우면(addItem) 안전 칸으로 먼저 — item_secured. 가득이면 가방으로', () => {
    const secured: unknown[] = [];
    world.events.on('item_secured', (p) => secured.push(p));
    expect(addItem(world, 'key_s')).toBe(true);
    expect(world.secure[0]).toEqual({ kind: 'key_s', count: 1 });
    expect(world.inventory.every((s) => s === null)).toBe(true);
    expect(secured).toHaveLength(1);
    // 안전 주머니가 다른 종류로 가득이면 가방으로
    world.secure = world.secure.map(() => ({ kind: 'key_m', count: 1 }));
    expect(addItem(world, 'key_s')).toBe(true);
    expect(world.inventory[0]).toEqual({ kind: 'key_s', count: 1 });
  });

  it('안전 칸은 죽어도 비석으로 떨어지지 않는다', () => {
    addItem(world, 'key_s');
    addItem(world, 'potion');
    addItem(world, 'food');
    // 지금은 한 칸만 열려 있다 — 잠긴 칸을 하나 열고(나중의 조건이 부르는 길) 물약을 넣는다. 고기는 가방에 남는다
    expect(Stash.lockedSecureSlots(world)).toBe(cfg.secure.maxSlots - cfg.secure.baseSlots);
    expect(Stash.unlockSecureSlot(world)).toBe(true);
    expect(world.secure).toHaveLength(cfg.secure.baseSlots + 1);
    Stash.move(world, 'bag', 0, 'secure');
    spillInventoryToGrave(world, 6, 6);
    expect(world.inventory.every((s) => s === null)).toBe(true);
    expect(world.secure.filter((s) => s)).toHaveLength(2);
    expect(world.groundItems[0]!.kind).toBe('grave');
    expect(world.groundItems[0]!.graveItems).toEqual([{ kind: 'food', count: 1 }]);
  });

  it('열쇠는 퀵슬롯에 오르지 않는다', () => {
    addItem(world, 'key_s');
    world.secure = world.secure.map(() => ({ kind: 'food', count: 1 }));
    addItem(world, 'key_m'); // 가방으로
    expect(world.quickslots.every((q) => q === null)).toBe(true);
  });

  it('잠긴 칸은 maxSlots 까지만 열린다 — 다 열리면 false', () => {
    let opened = 0;
    while (Stash.unlockSecureSlot(world)) opened++;
    expect(opened).toBe(cfg.secure.maxSlots - cfg.secure.baseSlots);
    expect(world.secure).toHaveLength(cfg.secure.maxSlots);
    expect(Stash.lockedSecureSlots(world)).toBe(0);
  });
});

describe('확장', () => {
  it('단계마다 골드(와 열쇠)를 내고 slots 만큼 넓어진다 — 열쇠는 안전 칸·가방·창고 어디서든 하나 소모', () => {
    const t = cfg.tiers;
    world.gold = 100;
    expect(Stash.canExpand(world)).toMatchObject({ ok: false, reason: 'no_gold' });
    world.gold = t[0]!.gold + t[1]!.gold;
    expect(Stash.expand(world)).toBe(true);
    expect(world.stashTier).toBe(1);
    expect(world.stash).toHaveLength(cfg.baseSlots + t[0]!.slots);
    expect(world.gold).toBe(t[1]!.gold);
    // 2단계는 열쇠 小가 필요
    expect(Stash.canExpand(world)).toMatchObject({ ok: false, reason: 'no_key' });
    world.stash[0] = { kind: t[1]!.key as 'key_s', count: 1 };
    expect(Stash.expand(world)).toBe(true);
    expect(world.stash).toHaveLength(cfg.baseSlots + t[0]!.slots + t[1]!.slots);
    expect(world.stash[0]).toBeNull(); // 열쇠 소모
    expect(world.gold).toBe(0);
  });

  it('든 것은 확장 뒤에도 그대로, 마지막 단계 뒤엔 max', () => {
    addItem(world, 'potion');
    Stash.move(world, 'bag', 0, 'stash');
    world.gold = 1e6;
    for (const tier of cfg.tiers) {
      if (tier.key) world.secure[0] = { kind: tier.key as 'key_s', count: 1 };
      expect(Stash.expand(world)).toBe(true);
    }
    expect(world.stashTier).toBe(cfg.tiers.length);
    expect(Stash.canExpand(world)).toMatchObject({ ok: false, reason: 'max' });
    expect(world.stash.filter((s) => s)).toEqual([{ kind: 'potion', count: 1 }]);
    expect(Stash.expand(world)).toBe(false);
  });
});
