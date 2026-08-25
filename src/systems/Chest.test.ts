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
      active: null,
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

  it('한 번 열면 끝 — 두 번째 E 는 아무 일도 없다', () => {
    putChest(world, 6 + 1.5, 6);
    interact(world);
    const loot = world.groundItems.length;
    expect(loot).toBeGreaterThan(0);

    interact(world);
    expect(world.groundItems).toHaveLength(loot); // 더 쏟아지지 않는다
    Chest.tick(world, DT);
    expect(world.chestInView).toBeNull(); // 안내도 사라진다
  });
});

describe('전리품', () => {
  it('골드를 여러 무더기로 쏟는다 — 합계는 min~max 안', () => {
    const chest = putChest(world, 6 + 1.5, 6);
    const opened: { gold: number }[] = [];
    world.events.on('chest_opened', (p) => opened.push(p as { gold: number }));
    interact(world);

    const piles = world.groundItems.filter((i) => i.kind === 'gold');
    expect(piles.length).toBe(CFG.goldPiles);
    const total = piles.reduce((sum, i) => sum + (i.amount ?? 0), 0);
    expect(total).toBe(opened[0]!.gold);
    expect(total).toBeGreaterThanOrEqual(CFG.gold.min);
    expect(total).toBeLessThanOrEqual(CFG.gold.max);
    // 일반 적 드랍(3~9)과는 자릿수가 다르다 — "많은 골드"
    expect(CFG.gold.min).toBeGreaterThan(balance.pickups.gold.max * 10);

    // 상자 주변에 흩어진다 (한 점에 겹치지 않는다)
    for (const pile of piles) {
      const d = Math.hypot(pile.x - chest.x, pile.z - chest.z);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(CFG.scatterRadius + 0.001);
    }
  });

  it('각인을 정확히 1개 준다', () => {
    putChest(world, 6 + 1.5, 6);
    const dropped: { id: string }[] = [];
    world.events.on('sigil_dropped', (p) => dropped.push(p as { id: string }));
    interact(world);

    const sigils = world.groundItems.filter((i) => i.kind === 'sigil');
    expect(sigils).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(sigils[0]!.sigilId).toBe(dropped[0]!.id);
    expect(() => sigilDef(sigils[0]!.sigilId!)).not.toThrow();
  });

  it('이미 가진 각인은 나오지 않는다', () => {
    // slice 각인을 전부 들고 있으면 나머지에서 뽑는다
    const sliceIds = (sigilsJson.sigils as { id: string; slice: boolean }[])
      .filter((s) => s.slice)
      .map((s) => s.id);
    world.sigils.inventory.push(...sliceIds.slice(1));
    world.sigils.inventory.push(sliceIds[0]!);

    putChest(world, 6 + 1.5, 6);
    interact(world);
    const got = world.groundItems.find((i) => i.kind === 'sigil')!.sigilId!;
    expect(sliceIds).not.toContain(got);
  });

  it('이 빌드에서 도는 slice 각인을 먼저 준다', () => {
    putChest(world, 6 + 1.5, 6);
    interact(world);
    const got = world.groundItems.find((i) => i.kind === 'sigil')!.sigilId!;
    expect(sigilDef(got).slice).toBe(true);
  });

  it('가진 각인이 24종을 다 채웠으면 골드만 나온다', () => {
    world.sigils.inventory.push(...(sigilsJson.sigils as { id: string }[]).map((s) => s.id));
    putChest(world, 6 + 1.5, 6);
    const opened: { sigilId: string | null }[] = [];
    world.events.on('chest_opened', (p) => opened.push(p as { sigilId: string | null }));
    interact(world);
    expect(world.groundItems.some((i) => i.kind === 'sigil')).toBe(false);
    expect(world.groundItems.some((i) => i.kind === 'gold')).toBe(true);
    expect(opened[0]!.sigilId).toBeNull();
  });

  it('드랍 id 는 각인·픽업 대역과 겹치지 않는다', () => {
    putChest(world, 6 + 1.5, 6, 1);
    putChest(world, 6 - 1.5, 6, 2);
    interact(world);
    world.player.yaw = Math.PI / 2; // 두 번째 상자 쪽을 본다
    interact(world);
    const ids = world.groundItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length); // 전부 다른 id
    for (const id of ids) expect(id).toBeGreaterThan(500000);
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
