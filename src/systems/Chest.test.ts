// 보물상자 — 상호작용 조건(반경·시선), 골드 무더기, 각인 1개, 1회성.

import { beforeEach, describe, expect, it } from 'vitest';
import sigilsJson from '../../data/sigils.json';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { sigilDef } from '../core/SigilData';
import { World, type ChestState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnChests } from '../level/Spawner';
import * as Chest from './Chest';
import * as Loot from './Loot';
import * as Sigils from './Sigils';

const DT = 1 / 60;
const CFG = balance.chest;

function makeLevel(): Level {
  return new Level({
    id: 'range',
    name: 'range',
    cellSize: 4,
    ceiling: 4,
    grid: ['#'.repeat(30), '#S' + '.'.repeat(27) + '#', '#'.repeat(30)],
    lighting: { ambient: 0.04, torches: [] },
  });
}

function makeWorld(): World {
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: -Math.PI / 2, pitch: 0, health: 100, // +X 를 본다
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
    level: makeLevel(),
  });
  return world;
}

function putChest(world: World, x: number, z: number, id = 1): ChestState {
  const chest: ChestState = { id, x, z, opened: false };
  chest.blocker = world.level.addBlocker(x, z, CFG.collisionRadius);
  world.chests.push(chest);
  return chest;
}

/** E 한 번 */
function interact(world: World): void {
  world.input = { ...Input.emptySnapshot(), interactPressed: true };
  Chest.tick(world, DT);
  world.input = Input.emptySnapshot();
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('상호작용', () => {
  it('반경 안에서 상자를 보고 E — 열린다', () => {
    const chest = putChest(world, 6 + CFG.radius - 0.3, 6);
    Chest.tick(world, DT);
    expect(world.chestInView).toBe(chest); // 안내가 뜰 조건

    interact(world);
    expect(chest.opened).toBe(true);
  });

  it('멀면 안 열린다', () => {
    const chest = putChest(world, 6 + CFG.radius + 1, 6);
    Chest.tick(world, DT);
    expect(world.chestInView).toBeNull();
    interact(world);
    expect(chest.opened).toBe(false);
  });

  it('등지고 서 있으면 안 열린다 — 제단과 같은 규약', () => {
    const chest = putChest(world, 6 + 1.5, 6);
    world.player.yaw = Math.PI / 2; // −X 를 본다 = 상자를 등진다
    Chest.tick(world, DT);
    expect(world.chestInView).toBeNull();
    interact(world);
    expect(chest.opened).toBe(false);
  });

  it('처음 E — 뚜껑이 열리고(1회 롤) 루팅 창이 열린다. 닫고 다시 E 하면 재롤 없이 다시 열리고, 다 비우면 대상에서 빠진다', () => {
    const chest = putChest(world, 6 + 1.5, 6);
    const opened: unknown[] = [];
    world.events.on('chest_opened', (p) => opened.push(p));
    const lootOpened: { first?: boolean }[] = [];
    world.events.on('loot_opened', (p) => lootOpened.push(p as { first?: boolean }));
    interact(world);
    expect(chest.opened).toBe(true);
    expect(world.groundItems).toHaveLength(0); // 바닥에 흩어지지 않는다
    expect(world.lootOpen).toEqual({ kind: 'chest', id: chest.id });
    expect(opened).toHaveLength(1);
    expect(lootOpened).toEqual([expect.objectContaining({ kind: 'chest', first: true })]);
    const items = JSON.stringify(chest.chestItems);

    Loot.closeLoot(world);
    interact(world); // 닫은 E 가 새 틱에 들어와도 가드가 막는다
    expect(world.lootOpen).toBeNull();
    for (let i = 0; i <= balance.loot.pouch.reopenGuardTicks; i++) Loot.tick(world, DT);
    interact(world);
    expect(world.lootOpen).toEqual({ kind: 'chest', id: chest.id });
    expect(opened).toHaveLength(1); // 재롤 없다
    expect(JSON.stringify(chest.chestItems)).toBe(items);
    expect(lootOpened[1]!.first).toBe(false);

    Loot.takeAll(world);
    Loot.closeLoot(world);
    for (let i = 0; i <= balance.loot.pouch.reopenGuardTicks; i++) Loot.tick(world, DT);
    Chest.tick(world, DT);
    expect(world.chestInView).toBeNull(); // 다 비운 상자 — 안내도 사라진다
    expect(chest.opened).toBe(true); // 뚜껑은 열린 채 남는다
  });
});

describe('전리품 — 상자 속(chestItems)', () => {
  it('골드 한 줄 — 합계는 min~max 안이고 chest_opened 의 gold 와 같다', () => {
    const chest = putChest(world, 6 + 1.5, 6);
    const opened: { gold: number }[] = [];
    world.events.on('chest_opened', (p) => opened.push(p as { gold: number }));
    interact(world);
    const gold = chest.chestItems!.find((e) => e.kind === 'gold')!;
    expect(gold.count).toBe(opened[0]!.gold);
    expect(gold.count).toBeGreaterThanOrEqual(CFG.gold.min);
    expect(gold.count).toBeLessThanOrEqual(CFG.gold.max);
    // 일반 적 드랍(3~9)과는 자릿수가 다르다 — "많은 골드"
    expect(CFG.gold.min).toBeGreaterThan(balance.pickups.gold.max * 10);
    // 가져가면 곧장 골드로 — 상자 자리에서 ◆ 팝
    const golds: { x: number; z: number }[] = [];
    world.events.on('gold_picked', (g) => golds.push(g as { x: number; z: number }));
    expect(Loot.takeOne(world, 0)).toBe('taken');
    expect(world.gold).toBe(opened[0]!.gold);
    expect(golds[0]).toEqual(expect.objectContaining({ x: chest.x, z: chest.z }));
  });

  it('각인을 정확히 1줄 준다 — 가져가면 Sigils 가 습득시킨다 (바닥에 안 떨어진다)', () => {
    Sigils.init(world);
    const chest = putChest(world, 6 + 1.5, 6);
    const acquired: { id: string }[] = [];
    world.events.on('sigil_acquired', (p) => acquired.push(p as { id: string }));
    interact(world);
    const sigils = chest.chestItems!.filter((e) => e.kind === 'sigil');
    expect(sigils).toHaveLength(1);
    expect(() => sigilDef(sigils[0]!.sigilId!)).not.toThrow();
    expect(world.groundItems.some((g) => g.kind === 'sigil')).toBe(false);
    const idx = chest.chestItems!.indexOf(sigils[0]!);
    expect(Loot.takeOne(world, idx)).toBe('taken');
    expect(acquired.map((a) => a.id)).toEqual([sigils[0]!.sigilId]);
    expect(world.sigils.inventory).toContain(sigils[0]!.sigilId);
    expect(chest.chestItems!.some((e) => e.kind === 'sigil')).toBe(false);
  });

  it('이미 가진 각인은 나오지 않는다', () => {
    // slice 각인을 전부 들고 있으면 나머지에서 뽑는다
    const sliceIds = (sigilsJson.sigils as { id: string; slice: boolean }[])
      .filter((s) => s.slice)
      .map((s) => s.id);
    world.sigils.inventory.push(...sliceIds.slice(1));
    world.sigils.inventory.push(sliceIds[0]!);

    const chest = putChest(world, 6 + 1.5, 6);
    interact(world);
    const got = chest.chestItems!.find((e) => e.kind === 'sigil')!.sigilId!;
    expect(sliceIds).not.toContain(got);
  });

  it('이 빌드에서 도는 slice 각인을 먼저 준다', () => {
    const chest = putChest(world, 6 + 1.5, 6);
    interact(world);
    const got = chest.chestItems!.find((e) => e.kind === 'sigil')!.sigilId!;
    expect(sigilDef(got).slice).toBe(true);
  });

  it('가진 각인이 24종을 다 채웠으면 골드만 나온다', () => {
    world.sigils.inventory.push(...(sigilsJson.sigils as { id: string }[]).map((s) => s.id));
    const chest = putChest(world, 6 + 1.5, 6);
    const opened: { sigilId: string | null }[] = [];
    world.events.on('chest_opened', (p) => opened.push(p as { sigilId: string | null }));
    interact(world);
    expect(chest.chestItems!.some((e) => e.kind === 'sigil')).toBe(false);
    expect(chest.chestItems!.some((e) => e.kind === 'gold')).toBe(true);
    expect(opened[0]!.sigilId).toBeNull();
  });

  it('상자 속을 바닥에 버리면 Loot 대역(1200000~)의 서로 다른 id 로 놓인다', () => {
    const chest = putChest(world, 6 + 1.5, 6);
    interact(world);
    while (chest.chestItems!.length > 0) Loot.dropToFloor(world, 'container', 0);
    const ids = world.groundItems.map((i) => i.id);
    expect(ids.length).toBeGreaterThanOrEqual(2); // 골드 + 각인
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toBeGreaterThanOrEqual(1200000);
    expect(world.groundItems.some((g) => g.kind === 'sigil')).toBe(true);
  });
});

describe('레벨 배치', () => {
  it('벽 안의 상자는 걸러지고, 살아남은 상자는 몸을 막는다', () => {
    const level = makeLevel();
    const chests = spawnChests(
      [
        { type: 'chest', cell: [1, 5] },
        { type: 'chest', cell: [0, 5] }, // 벽
        { type: 'barrel', cell: [1, 7] }, // 상자가 아니다
      ],
      level,
    );
    expect(chests).toHaveLength(1);
    expect(level.props).toHaveLength(1);
    expect(chests[0]!.x).toBeCloseTo(5.5 * 4, 5);
  });
});
