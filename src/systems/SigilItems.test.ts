// 각인 아이템화 (2026-09-04) — 가방 칸 규칙(스택 불가·퀵슬롯 없음·합치지 않음), 새기기/익히기, 떼기 → 가방, 비석 보존, 주머니 왕복
import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { addItem, addSigil, bagSigilIds, hasRoom, initInventory, moveSlot, recoverGrave, spillInventoryToGrave } from '../core/Inventory';
import { sigilDef } from '../core/SigilData';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Loot from './Loot';
import * as Sigils from './Sigils';

function makeWorld(): World {
  const level = new Level({
    id: 'arena', name: 'arena', cellSize: 4, ceiling: 4,
    grid: ['########', '#S.....#', '#......#', '#......#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const w = new World(new Events(), {
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
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  initInventory(w);
  Sigils.init(w);
  return w;
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('각인 아이템 — 가방 칸 규칙', () => {
  it('한 칸에 한 개, 같은 각인도 합치지 않고, 퀵슬롯에 자동 등록되지 않는다', () => {
    expect(addSigil(world, 'sig_dash')).toBe(true);
    expect(addSigil(world, 'sig_dash')).toBe(true);
    expect(bagSigilIds(world)).toEqual(['sig_dash', 'sig_dash']);
    expect(world.quickslots.includes('sigil')).toBe(false);
    expect(moveSlot(world, 0, 1)).toBe('swapped'); // 같은 종류라도 합치지 않는다
    expect(world.inventory[0]!.count).toBe(1);
    expect(world.inventory[1]!.count).toBe(1);
  });

  it('가방이 가득이면 못 들어간다 — hasRoom 은 빈 칸을 묻는다', () => {
    for (let i = 0; i < world.inventory.length; i++) addItem(world, 'potion');
    // 물약은 stackMax 까지 쌓이므로 칸이 남아 있다
    expect(hasRoom(world, 'sigil')).toBe(true);
    world.inventory = world.inventory.map(() => ({ kind: 'potion' as const, count: balance.items.stackMax }));
    expect(hasRoom(world, 'sigil')).toBe(false);
    expect(addSigil(world, 'sig_dash')).toBe(false);
  });

  it('죽으면 비석에 각인도 sigilId 채로 담기고, 회수하면 그대로 돌아온다', () => {
    addSigil(world, 'sig_dash');
    addSigil(world, 'sig_fireball');
    addItem(world, 'potion');
    expect(spillInventoryToGrave(world, 10, 10)).toBe(true);
    const grave = world.groundItems.find((g) => g.kind === 'grave')!;
    expect(grave.graveItems!.filter((g) => g.kind === 'sigil').map((g) => g.sigilId).sort()).toEqual(['sig_dash', 'sig_fireball']);
    expect(recoverGrave(world, grave)).toBe('all');
    expect(bagSigilIds(world).sort()).toEqual(['sig_dash', 'sig_fireball']);
  });
});

describe('새기기 · 익히기 · 떼기', () => {
  it('패시브 새기기 — 가방에서 빠져 부위에 박히고 오염이 쌓인다. 부위가 차 있으면 아이템은 그대로', () => {
    addSigil(world, 'sig_dash'); // 척추 패시브
    addSigil(world, 'sig_moment'); // 척추 패시브
    const pending = world.corruption.pending;
    expect(Sigils.learnFromBag(world, 0)).toBe('attached');
    expect(world.sigils.equipped.spine).toBe('sig_dash');
    expect(world.inventory[0]).toBeNull();
    expect(world.corruption.pending).toBe(pending + balance.corruption.slotCost.spine);
    expect(Sigils.learnFromBag(world, 1)).toBe('part_full');
    expect(world.inventory[1]!.sigilId).toBe('sig_moment'); // 그대로
    expect(world.corruption.pending).toBe(pending + balance.corruption.slotCost.spine); // 더 안 쌓인다
  });

  it('액티브 익히기 — 목록에 들고 빈 스킬 칸에 오른다. 중복은 known 으로 거부', () => {
    addSigil(world, 'sig_fireball');
    addSigil(world, 'sig_fireball');
    expect(Sigils.learnFromBag(world, 0)).toBe('learned');
    expect(world.skillSlots[0]).toBe('sig_fireball');
    expect(world.sigils.inventory).toEqual(['sig_fireball']);
    expect(Sigils.learnFromBag(world, 1)).toBe('known');
    expect(world.inventory[1]!.sigilId).toBe('sig_fireball');
  });

  it('떼기 — 가방으로 돌아오고 목록에서 빠진다. 가방이 가득이면 못 떼고 sigil_detach_denied', () => {
    addSigil(world, 'sig_dash');
    Sigils.learnFromBag(world, 0);
    world.inventory = world.inventory.map(() => ({ kind: 'potion' as const, count: balance.items.stackMax }));
    const denied: unknown[] = [];
    world.events.on('sigil_detach_denied', (p) => denied.push(p));
    expect(Sigils.detach(world, 'spine')).toBe(false);
    expect(denied).toHaveLength(1);
    expect(world.sigils.equipped.spine).toBe('sig_dash'); // 그대로 박혀 있다
    world.inventory[0] = null;
    expect(Sigils.detach(world, 'spine')).toBe(true);
    expect(world.inventory[0]!.sigilId).toBe('sig_dash');
    expect(world.sigils.inventory).not.toContain('sig_dash');
    expect(world.sigils.equipped.spine).toBeNull();
  });

  it('팔기 — 티어별 골드, 아이템은 사라진다', () => {
    addSigil(world, 'sig_lightning');
    const price = balance.sigil.sellGold[sigilDef('sig_lightning').tier as keyof typeof balance.sigil.sellGold];
    expect(Sigils.sellFromBag(world, 0)).toBe(price);
    expect(world.gold).toBe(price);
    expect(world.inventory[0]).toBeNull();
    expect(Sigils.sellFromBag(world, 0)).toBe(0);
  });
});

describe('주머니 왕복', () => {
  it('가방의 각인을 주머니에 넣으면 sigilId 줄이 되고, 다시 가져오면 가방으로 돌아온다', () => {
    addSigil(world, 'sig_dash');
    const pouch = Loot.createPlayerPouch(world);
    expect(pouch).not.toBeNull();
    world.lootOpen = { kind: 'pouch', id: pouch!.id };
    expect(Loot.stash(world, 0)).toBe(true);
    expect(pouch!.pouchItems).toEqual([expect.objectContaining({ kind: 'sigil', sigilId: 'sig_dash', count: 1 })]);
    expect(world.inventory[0]).toBeNull();
    expect(Loot.takeOne(world, 0)).toBe('taken');
    expect(bagSigilIds(world)).toEqual(['sig_dash']);
    expect(pouch!.pouchItems).toEqual([]);
  });
});
