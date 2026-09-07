// 상인 매입 — 소모품 매입가·한 개/통째로 팔기·못 파는 종류 (2026-09-07 로비 상인)

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { addEquip, addItem, addSigil, countOf, initInventory } from '../core/Inventory';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Sigils from './Sigils';
import * as Merchant from './Merchant';

function makeWorld(): World {
  const level = new Level({
    id: 't', name: 't', cellSize: 4, ceiling: 4,
    grid: ['#####', '#S..#', '#####'],
    lighting: { ambient: 0.1, torches: [] },
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
  return world;
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('매입가', () => {
  it('제단 상점에 있는 소모품은 그 값 × sellRatio (버림), 말린 고기는 basePrice 에서', () => {
    const r = balance.lobby.merchant.sellRatio;
    expect(Merchant.unitSellPrice('potion')).toBe(Math.floor(balance.altar.shop.heal.price * r));
    expect(Merchant.unitSellPrice('mana_large')).toBe(Math.floor(balance.altar.shop.manaLarge.price * r));
    expect(Merchant.unitSellPrice('food')).toBe(Math.floor(balance.lobby.merchant.basePrice.food * r));
  });

  it('각인·장비는 여기서 값을 매기지 않는다 (각 시스템 규칙) — null', () => {
    expect(Merchant.unitSellPrice('sigil')).toBeNull();
    expect(Merchant.unitSellPrice('equip')).toBeNull();
    expect(Merchant.slotSellPrice(null)).toBeNull();
    expect(Merchant.slotSellPrice({ kind: 'potion', count: 3 })).toBe(Merchant.unitSellPrice('potion')! * 3);
  });
});

describe('팔기', () => {
  it('한 개 팔면 수량 하나 줄고 골드가 그만큼 는다 — item_sold', () => {
    for (let i = 0; i < 3; i++) addItem(world, 'potion');
    const idx = world.inventory.findIndex((s) => s?.kind === 'potion');
    const sold: unknown[] = [];
    world.events.on('item_sold', (p) => sold.push(p));
    const unit = Merchant.unitSellPrice('potion')!;
    expect(Merchant.sellConsumable(world, idx)).toBe(unit);
    expect(world.gold).toBe(unit);
    expect(countOf(world, 'potion')).toBe(2);
    expect(sold).toEqual([{ kind: 'potion', count: 1, gold: unit, total: unit }]);
  });

  it('통째로 팔면 칸이 비고 골드는 개수만큼', () => {
    for (let i = 0; i < 4; i++) addItem(world, 'mana');
    const idx = world.inventory.findIndex((s) => s?.kind === 'mana');
    const unit = Merchant.unitSellPrice('mana')!;
    expect(Merchant.sellConsumable(world, idx, true)).toBe(unit * 4);
    expect(world.inventory[idx]).toBeNull();
    expect(world.gold).toBe(unit * 4);
  });

  it('마지막 한 개를 팔면 칸이 빈다', () => {
    addItem(world, 'food');
    const idx = world.inventory.findIndex((s) => s?.kind === 'food');
    Merchant.sellConsumable(world, idx);
    expect(world.inventory[idx]).toBeNull();
  });

  it('각인·장비 칸은 소모품 매입이 건드리지 않는다 (0, 가방 그대로) — 창이 각 시스템으로 보낸다', () => {
    addSigil(world, 'sig_darkvision');
    addEquip(world, 'helm_leather');
    const sIdx = world.inventory.findIndex((s) => s?.kind === 'sigil');
    const eIdx = world.inventory.findIndex((s) => s?.kind === 'equip');
    expect(Merchant.sellConsumable(world, sIdx)).toBe(0);
    expect(Merchant.sellConsumable(world, eIdx, true)).toBe(0);
    expect(world.inventory[sIdx]?.kind).toBe('sigil');
    expect(world.inventory[eIdx]?.kind).toBe('equip');
    expect(world.gold).toBe(0);
  });

  it('빈 칸은 0', () => {
    expect(Merchant.sellConsumable(world, 0)).toBe(0);
    expect(world.gold).toBe(0);
  });
});
