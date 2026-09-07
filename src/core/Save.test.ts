// 세이브/로드 — 진행 왕복, 층 차이 뜨기/덧씌우기, 검증, 저장소 다듬기.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from './Balance';
import { Events } from './Events';
import { Input } from './Input';
import { addItem, initInventory } from './Inventory';
import { Level } from '../level/GridLoader';
import { spawnBarrels, spawnChests, spawnEnemies, spawnProps, spawnTraps, type EntityPlacement } from '../level/Spawner';
import * as Sigils from '../systems/Sigils';
import * as Save from './Save';
import * as SaveStorage from './SaveStorage';
import { World } from './World';

const GRID = [
  '##########',
  '#S.......#',
  '#........#',
  '####D#####',
  '#........#',
  '#........#',
  '##########',
];

function makeLevel(): Level {
  return new Level({ id: 't', name: 't', cellSize: 4, ceiling: 4, grid: GRID, lighting: { ambient: 0.04, torches: [] } });
}

const PLACEMENTS: EntityPlacement[] = [
  { type: 'goblin_runner', cell: [1, 4] },
  { type: 'goblin_runner', cell: [1, 7] },
  { type: 'chest', cell: [2, 2] },
  { type: 'chest', cell: [2, 7] },
  { type: 'barrel', cell: [4, 2] },
  { type: 'barrel', cell: [4, 7] },
  { type: 'trap_rockfall', cell: [5, 4] },
];

function makeWorld(): World {
  const level = makeLevel();
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6, yaw: 0, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: spawnEnemies(PLACEMENTS, level),
    chests: spawnChests(PLACEMENTS, level),
    barrels: spawnBarrels(PLACEMENTS, level),
    props: spawnProps(PLACEMENTS, level),
    traps: spawnTraps(PLACEMENTS, level),
    level,
  });
  initInventory(world);
  return world;
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('캐릭터 진행 — 왕복', () => {
  it('골드·XP·가방·장비·각인·탄약·오염·제단·상점 재고가 JSON 을 거쳐 그대로 돌아온다', () => {
    world.gold = 123;
    world.xp = 456;
    world.tick = 60 * 90;
    world.player.health = 37;
    world.mana.value = 21;
    world.weapon.mag = 3;
    world.weapon.reserve = 17;
    world.weapon.grenades = 1;
    world.weapon.arrows = 9;
    world.lantern.battery = 42;
    world.lantern.spares = 2;
    addItem(world, 'potion');
    addItem(world, 'mana');
    world.sigils.inventory.push('sig_frost');
    world.equipment.head = 'eq_dummy';
    world.corruption.applied = 30;
    world.corruption.pending = 7;
    world.altars.push({ floor: 1, x: 10, z: 12 });
    world.respawn = { floor: 1, x: 10, z: 12 };
    world.shopStock = { heal: 2 };
    world.shopReadyTick = { heal: 5400 };
    world.floorIndex = 2;
    world.player.x = 30; world.player.z = 22; world.player.yaw = 1.2; world.player.pitch = -0.1;

    const data = Save.serialize(world, { kind: 'manual', floorLabel: '지하 3층', floors: {}, unlockedFloors: [0, 1], barsCineSeen: [1], now: 1000 });
    const back = JSON.parse(JSON.stringify(data)) as Save.SaveData;
    expect(Save.isSaveData(back)).toBe(true);

    const fresh = makeWorld();
    Save.restoreProgress(fresh, back);
    Save.applyPlayerPose(fresh, back);
    expect(fresh.gold).toBe(123);
    expect(fresh.xp).toBe(456);
    expect(fresh.tick).toBe(60 * 90);
    expect(fresh.player.health).toBe(37);
    expect(fresh.mana.value).toBe(21);
    expect(fresh.weapon).toMatchObject({ mag: 3, reserve: 17, grenades: 1, arrows: 9 });
    expect(fresh.lantern).toMatchObject({ battery: 42, spares: 2 });
    expect(fresh.inventory).toEqual(world.inventory);
    expect(fresh.quickslots).toEqual(world.quickslots);
    expect(fresh.sigils).toEqual(world.sigils);
    expect(fresh.equipment.head).toBe('eq_dummy');
    expect(fresh.corruption).toEqual({ applied: 30, pending: 7 });
    expect(fresh.altars).toEqual([{ floor: 1, x: 10, z: 12 }]);
    expect(fresh.respawn).toEqual({ floor: 1, x: 10, z: 12 });
    expect(fresh.shopStock).toEqual({ heal: 2 });
    expect(fresh.shopReadyTick).toEqual({ heal: 5400 });
    expect(fresh.floorIndex).toBe(2);
    expect(fresh.player).toMatchObject({ x: 30, z: 22, prevX: 30, prevZ: 22, yaw: 1.2, pitch: -0.1 });
    expect(fresh.dead).toBe(false);
    expect(back.unlockedFloors).toEqual([0, 1]);
    expect(back.barsCineSeen).toEqual([1]);
    expect(back.version).toBe(balance.save.version);
  });

  it('복사본이다 — 저장 뒤 원본을 바꿔도 저장 데이터는 그대로', () => {
    addItem(world, 'potion');
    const data = Save.serialize(world, { kind: 'auto', floorLabel: '', floors: {}, unlockedFloors: [], barsCineSeen: [] });
    world.inventory[0]!.count = 99;
    expect(data.inventory[0]!.count).toBe(1);
  });
});

describe('층 차이 — 뜨고 덧씌우기', () => {
  it('죽인 적·연 상자(남은 속)·부순 통·발동한 함정(잔해)·부서진 자물쇠·당긴 레버·바닥 아이템이 새로 지은 층에 돌아온다', () => {
    // 살아 있는 층을 바꾼다
    world.enemies[0]!.alive = false;
    world.chests[0]!.opened = true;
    world.chests[0]!.chestItems = [{ kind: 'gold', count: 12, searched: true }];
    const barrel = world.barrels[1]!;
    barrel.alive = false;
    world.level.removeBlocker(barrel.blocker!);
    barrel.blocker = undefined;
    const trap = world.traps[0]!;
    trap.phase = 'spent';
    trap.charges = 0;
    trap.blocker = world.level.addBlocker(trap.x, trap.z, 1.7);
    world.level.setPathBlocked(trap.col, trap.row);
    world.doors[0]!.unlockedOnce = true;
    world.pulledLevers.add('2-3');
    world.groundItems.push({ id: 1200000, kind: 'pouch', x: 20, z: 6, pouchItems: [{ kind: 'gold', count: 5 }], pouchTier: 'normal', pouchOwner: 'goblin_runner', speed: 3, noMagnetTicks: 20 });
    world.groundItems.push({ id: 960000, kind: 'grave', x: 22, z: 6, graveItems: [{ kind: 'potion', count: 2 }] });

    const diff = Save.captureFloorDiff(world);
    expect(diff.slain).toEqual([Save.enemyKey(world.enemies[0] as { type: string; homeX: number; homeZ: number })]);
    expect(diff.chests).toHaveLength(1);
    expect(diff.barrelsBroken).toEqual([Save.posKey(barrel)]);
    expect(diff.traps).toEqual([{ key: Save.trapKey(trap), phase: 'spent', charges: 0, rubble: true }]);
    expect(diff.doorsUnlocked).toEqual([Save.doorKey(world.doors[0]!)]);
    expect(diff.levers).toEqual(['2-3']);
    expect(diff.groundItems).toHaveLength(2);
    expect(diff.groundItems[0]).not.toHaveProperty('speed'); // 순간 상태는 뺀다
    expect(diff.groundItems[0]).not.toHaveProperty('noMagnetTicks');

    // JSON 을 거쳐 새 층에 덧씌운다
    const back = JSON.parse(JSON.stringify(diff)) as Save.FloorDiff;
    const fresh = makeWorld();
    const before = fresh.enemies.length;
    Save.applyFloorDiff(fresh, fresh.level, back);
    expect(fresh.enemies).toHaveLength(before - 1);
    expect(fresh.enemies.every((e) => e.alive)).toBe(true); // 살아 있던 적은 만피로 그대로
    expect(fresh.chests[0]!.opened).toBe(true);
    expect(fresh.chests[0]!.chestItems).toEqual([{ kind: 'gold', count: 12, searched: true }]);
    expect(fresh.chests[1]!.opened).toBe(false);
    expect(fresh.barrels[1]!.alive).toBe(false);
    expect(fresh.barrels[1]!.blocker).toBeUndefined();
    expect(fresh.barrels[0]!.alive).toBe(true);
    expect(fresh.traps[0]!.phase).toBe('spent');
    expect(fresh.traps[0]!.blocker).toBeTruthy(); // 잔해가 다시 선다
    expect(fresh.doors[0]!.unlockedOnce).toBe(true);
    expect(fresh.doors[0]!.opened).toBe(false); // 문은 닫힌 채
    expect(fresh.pulledLevers.has('2-3')).toBe(true);
    expect(fresh.groundItems).toHaveLength(2);
    expect(fresh.groundItems[0]!.kind).toBe('pouch');
    expect(fresh.groundItems[0]!.pouchItems).toEqual([{ kind: 'gold', count: 5 }]);
    for (const g of fresh.groundItems) expect(g.id).toBeGreaterThanOrEqual(balance.save.restoredItemIdBase); // 새 id 대역
    expect(fresh.groundItems[0]!.id).not.toBe(fresh.groundItems[1]!.id);
  });

  it('잔해를 치운 낙석은 rubbleBroken 으로 돌아온다 — 다시 막지 않는다', () => {
    const trap = world.traps[0]!;
    trap.phase = 'spent';
    trap.charges = 0;
    trap.rubbleBroken = true;
    const diff = Save.captureFloorDiff(world);
    expect(diff.traps[0]).toMatchObject({ phase: 'spent', rubble: false });
    const fresh = makeWorld();
    Save.applyFloorDiff(fresh, fresh.level, diff);
    expect(fresh.traps[0]!.blocker).toBeUndefined();
    expect(fresh.traps[0]!.rubbleBroken).toBe(true);
  });

  it('아무것도 안 바꾼 층의 차이는 비어 있고, 덧씌워도 원본 그대로다', () => {
    const diff = Save.captureFloorDiff(world);
    expect(diff).toEqual({ slain: [], chests: [], levers: [], doorsUnlocked: [], barrelsBroken: [], propsBroken: [], traps: [], groundItems: [] });
    const fresh = makeWorld();
    const n = fresh.enemies.length;
    Save.applyFloorDiff(fresh, fresh.level, diff);
    expect(fresh.enemies).toHaveLength(n);
  });
});

describe('검증', () => {
  it('깨진 것·다른 버전·빈 값은 저장 데이터가 아니다', () => {
    expect(Save.isSaveData(null)).toBe(false);
    expect(Save.isSaveData({})).toBe(false);
    expect(Save.isSaveData('x')).toBe(false);
    const ok = Save.serialize(world, { kind: 'auto', floorLabel: '', floors: {}, unlockedFloors: [], barsCineSeen: [] });
    expect(Save.isSaveData(ok)).toBe(true);
    expect(Save.isSaveData({ ...ok, version: ok.version + 1 })).toBe(false);
    expect(Save.isSaveData({ ...ok, kind: 'quick' })).toBe(false);
  });

  it('시간 표기 — 시:분:초 두 자리', () => {
    expect(Save.formatPlayTime(0)).toBe('00:00:00');
    expect(Save.formatPlayTime(60 * (3600 + 2 * 60 + 34))).toBe('01:02:34');
  });
});

describe('저장소 — 목록·다듬기', () => {
  function memStorage(): SaveStorage.StorageLike {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
  function save(kind: Save.SaveKind, now: number): Save.SaveData {
    return Save.serialize(world, { kind, floorLabel: '', floors: {}, unlockedFloors: [], barsCineSeen: [], now });
  }

  it('최신이 앞이고, 개수 제한 없이 전부 남는다 (2026-09-07 사용자: 목록에서 직접 지운다)', () => {
    const st = memStorage();
    for (let i = 0; i < 25; i++) expect(SaveStorage.putSave(save(i % 2 ? 'auto' : 'manual', 1000 + i), st)).toBe(true);
    const list = SaveStorage.listSaves(st);
    expect(list).toHaveLength(25);
    expect(list.map((d) => d.savedAt)).toEqual(Array.from({ length: 25 }, (_, k) => 1024 - k)); // 최신이 앞
  });

  it('이름 — 목록 한 줄과 저장 완료 문구가 같은 이름을 쓴다', () => {
    const d = save('manual', new Date(2026, 8, 7, 21, 43).getTime());
    d.floorLabel = '지하 1층';
    expect(Save.displayName(d)).toBe('수동 · 지하 1층 · 09-07 21:43');
  });

  it('깨진 JSON·낯선 항목은 걸러 내고, 지우기·비우기가 된다', () => {
    const st = memStorage();
    st.setItem(balance.save.storageKey, 'not json');
    expect(SaveStorage.listSaves(st)).toEqual([]);
    st.setItem(balance.save.storageKey, JSON.stringify([{ junk: true }, save('manual', 10)]));
    expect(SaveStorage.listSaves(st)).toHaveLength(1);
    const only = SaveStorage.listSaves(st)[0]!;
    SaveStorage.deleteSave(only.id, st);
    expect(SaveStorage.listSaves(st)).toEqual([]);
    SaveStorage.putSave(save('auto', 20), st);
    SaveStorage.clearSaves(st);
    expect(SaveStorage.listSaves(st)).toEqual([]);
  });
});
