// 장비 (2026-09-04) — 걸치기/맞바꾸기/벗기, 반지 두 칸, 짐칸이 가방 칸을 바꾸는 규칙(줄어들면 든 것이 들어가야), 파생 수치 합산과 피해·가격·골드 훅
import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { addEquip, addItem, bagBaseSlots, initInventory } from '../core/Inventory';
import { equipDef } from '../core/EquipData';
import { damagePlayer, World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Altar from './Altar';
import * as Equipment from './Equipment';
import * as Sigils from './Sigils';

function makeWorld(): World {
  const level = new Level({
    id: 'arena', name: 'arena', cellSize: 4, ceiling: 4,
    grid: ['########', '#S.....#', '#......#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const w = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 10, y: 0, z: 6, prevX: 10, prevY: 0, prevZ: 6,
      yaw: 0, pitch: 0, health: balance.player.healthMax,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  initInventory(w);
  Equipment.init(w);
  return w;
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('걸치기 · 벗기', () => {
  it('가방의 갑옷을 걸치면 칸이 차고 가방에서 빠지며 받는 피해 배율이 바뀐다. 다른 갑옷을 걸치면 맞바꿔 옛것이 같은 칸으로', () => {
    addEquip(world, 'armor_padded');
    addEquip(world, 'armor_chain');
    expect(Equipment.equipFromBag(world, 0)).toBe('equipped');
    expect(world.equipment.body).toBe('armor_padded');
    expect(world.inventory[0]).toBeNull();
    expect(world.modifiers.damageTakenMul).toBeCloseTo(equipDef('armor_padded').effects['damageTakenMul']!);
    expect(Equipment.equipFromBag(world, 1)).toBe('swapped');
    expect(world.equipment.body).toBe('armor_chain');
    expect(world.inventory[1]!.equipId).toBe('armor_padded'); // 옛 갑옷이 그 칸으로
    expect(world.modifiers.moveSpeedMul).toBeCloseTo(equipDef('armor_chain').effects['moveSpeedMul']!);
  });

  it('반지는 빈 칸(1 → 2)에 차례로 가고, 둘 다 차 있으면 1번과 맞바꾼다. 효과는 곱해 겹친다', () => {
    addEquip(world, 'ring_greed');
    addEquip(world, 'ring_mana');
    addEquip(world, 'ring_grit');
    expect(Equipment.equipFromBag(world, 0)).toBe('equipped');
    expect(Equipment.equipFromBag(world, 1)).toBe('equipped');
    expect(world.equipment.ring1).toBe('ring_greed');
    expect(world.equipment.ring2).toBe('ring_mana');
    expect(Equipment.equipFromBag(world, 2)).toBe('swapped');
    expect(world.equipment.ring1).toBe('ring_grit');
    expect(world.inventory[2]!.equipId).toBe('ring_greed');
    // 탐욕 반지가 빠졌으니 goldMul 은 1, 마력 반지·인내 반지 효과는 살아 있다
    expect(world.modifiers.goldMul).toBe(1);
    expect(world.modifiers.manaRegenMul).toBeCloseTo(1.3);
    expect(world.modifiers.stunMul).toBeCloseTo(0.75);
  });

  it('벗으면 가방으로 돌아오고 효과가 사라진다. 가방에 자리가 없으면 못 벗는다', () => {
    addEquip(world, 'helm_leather');
    Equipment.equipFromBag(world, 0);
    expect(world.modifiers.perfectBandBonus).toBeCloseTo(0.1);
    expect(Equipment.unequip(world, 'head')).toBe('ok');
    expect(world.equipment.head).toBeNull();
    expect(world.modifiers.perfectBandBonus).toBe(0);
    expect(world.inventory.some((s) => s?.equipId === 'helm_leather')).toBe(true);
    Equipment.equipFromBag(world, world.inventory.findIndex((s) => s?.equipId === 'helm_leather'));
    world.inventory = world.inventory.map(() => ({ kind: 'potion' as const, count: balance.items.stackMax }));
    const denied: unknown[] = [];
    world.events.on('equip_denied', (p) => denied.push(p));
    expect(Equipment.unequip(world, 'head')).toBe('bag_full');
    expect(world.equipment.head).toBe('helm_leather');
    expect(denied).toHaveLength(1);
  });
});

describe('짐칸 — 가방 칸 수', () => {
  it('기본 15칸, 작은 벨트 +5, 큰 가방 +15. 바꾸면 그만큼 늘고 줄어든다', () => {
    expect(bagBaseSlots()).toBe(balance.items.cols * balance.items.rows);
    expect(world.inventory).toHaveLength(bagBaseSlots());
    addEquip(world, 'belt_small');
    Equipment.equipFromBag(world, 0);
    expect(world.inventory).toHaveLength(bagBaseSlots() + 5);
    expect(world.modifiers.itemChannelMul).toBeCloseTo(0.8);
    addEquip(world, 'bag_large');
    Equipment.equipFromBag(world, world.inventory.findIndex((s) => s?.equipId === 'bag_large'));
    expect(world.equipment.pack).toBe('bag_large');
    expect(world.inventory).toHaveLength(bagBaseSlots() + 15);
    expect(world.inventory.some((s) => s?.equipId === 'belt_small')).toBe(true); // 벨트는 가방으로
    expect(world.modifiers.itemChannelMul).toBe(1);
  });

  it('짐칸을 벗어 칸이 줄어드는데 든 것이 안 들어가면 벗지 못한다 (결정 6-A). 비우면 벗겨지고 앞으로 모인다', () => {
    addEquip(world, 'bag_small');
    Equipment.equipFromBag(world, 0);
    expect(world.inventory).toHaveLength(bagBaseSlots() + 10);
    // 뒤쪽 칸까지 채운다 — 기본 15칸 + 가방 1칸이 안 들어가게
    for (let i = 0; i < world.inventory.length - 1; i++) world.inventory[i] = { kind: 'potion', count: 1 };
    expect(Equipment.unequip(world, 'pack')).toBe('bag_full');
    expect(world.equipment.pack).toBe('bag_small');
    expect(world.inventory).toHaveLength(bagBaseSlots() + 10); // 되돌렸다
    // 비운다 — 뒤쪽에 하나만 남기고
    world.inventory = world.inventory.map((_, i) => (i === world.inventory.length - 2 ? { kind: 'food' as const, count: 2 } : null));
    expect(Equipment.unequip(world, 'pack')).toBe('ok');
    expect(world.inventory).toHaveLength(bagBaseSlots());
    expect(world.inventory.filter((s) => s !== null).map((s) => s!.kind).sort()).toEqual(['equip', 'food']); // 밀려난 고기와 벗은 가방
  });

  it('작은 짐칸으로 바꾸려는데 든 것이 안 들어가면 걸치지 못하고 되돌린다', () => {
    addEquip(world, 'bag_large');
    Equipment.equipFromBag(world, 0);
    for (let i = 0; i < world.inventory.length; i++) if (!world.inventory[i]) world.inventory[i] = { kind: 'potion', count: 1 };
    world.inventory[0] = { kind: 'equip', count: 1, equipId: 'belt_small' };
    expect(Equipment.equipFromBag(world, 0)).toBe('bag_full');
    expect(world.equipment.pack).toBe('bag_large');
    expect(world.inventory[0]!.equipId).toBe('belt_small');
    expect(world.inventory).toHaveLength(bagBaseSlots() + 15);
  });
});

describe('훅', () => {
  it('damagePlayer — 갑옷 배율, 함정은 부츠 배율까지', () => {
    addEquip(world, 'armor_chain');
    addEquip(world, 'boots_spiked');
    Equipment.equipFromBag(world, 0);
    Equipment.equipFromBag(world, 1);
    const hp = world.player.health;
    expect(damagePlayer(world, 20)).toBeCloseTo(20 * 0.85);
    expect(world.player.health).toBeCloseTo(hp - 17);
    expect(damagePlayer(world, 20, { trap: true })).toBeCloseTo(20 * 0.85 * 0.5);
  });

  it('상인의 목걸이 — 제단 가격 20% 할인', () => {
    const base = Altar.shopState(world, 'heal').price;
    addEquip(world, 'neck_merchant');
    Equipment.equipFromBag(world, 0);
    expect(Altar.shopState(world, 'heal').price).toBe(Math.round(base * 0.8));
  });

  it('장비는 각인 새기기와 무관하고, 장비 효과와 각인 효과가 함께 살아 있다', () => {
    Sigils.acquire(world, 'sig_dash'); // 척추 패시브 — 회피 거리 배율
    const sigilDodge = world.modifiers.dodgeDistanceMul;
    addEquip(world, 'boots_light');
    Equipment.equipFromBag(world, 0);
    expect(world.modifiers.dodgeDistanceMul).toBeCloseTo(sigilDodge * 1.15);
    expect(world.corruption.pending).toBe(balance.corruption.slotCost.spine); // 장비는 오염을 더하지 않는다
    addItem(world, 'potion');
    expect(world.inventory.some((s) => s?.kind === 'potion')).toBe(true);
  });
});
