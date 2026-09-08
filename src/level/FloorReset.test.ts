// 던전 초기화 — 로비에 들어오면 몬스터 부활(잡은 보스 제외)·함정 재무장·바닥 아이템 삭제(비석 포함, stash.md §3)·연 상자는 빈 채로.

import { describe, expect, it } from 'vitest';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import * as Sigils from '../systems/Sigils';
import { World } from '../core/World';
import { Level } from './GridLoader';
import { resetFloor, resetFloorDiff, isBossKey } from './FloorReset';
import { spawnChests, spawnEnemies, spawnTraps, type EntityPlacement } from './Spawner';
import type { FloorDiff } from '../core/Save';

const GRID = ['##########', '#S.......#', '#........#', '#........#', '##########'];
function makeLevel(): Level {
  return new Level({ id: 't', name: 't', cellSize: 4, ceiling: 4, grid: GRID, lighting: { ambient: 0.04, torches: [] } });
}
const PLACEMENTS: EntityPlacement[] = [
  { type: 'goblin_runner', cell: [1, 4] },
  { type: 'goblin_runner', cell: [1, 7] },
  { type: 'goblin_runner', cell: [2, 7], boss: true } as EntityPlacement, // 층의 주인 (배치 플래그)
  { type: 'chest', cell: [2, 2] },
  { type: 'trap_rockfall', cell: [3, 4] },
];

function makeFloor() {
  const level = makeLevel();
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: { x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6, yaw: 0, pitch: 0, health: 100, stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0, iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0 },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: spawnEnemies(PLACEMENTS, level),
    chests: spawnChests(PLACEMENTS, level),
    traps: spawnTraps(PLACEMENTS, level),
    level,
  });
  return { world, level };
}

describe('resetFloor', () => {
  it('몬스터는 배치대로 전부 돌아오고, 함정은 재무장(잔해 차단 걷힘), 바닥은 비석까지 전부 비우고, 연 상자는 빈 채로', () => {
    const { world, level } = makeFloor();
    world.enemies[0]!.alive = false;
    world.enemies.splice(1, 1); // 시체가 치워진 적
    const trap = world.traps[0]!;
    trap.phase = 'spent';
    trap.blocker = level.addBlocker(trap.x, trap.z, 1.7);
    level.setPathBlocked(trap.col, trap.row);
    world.chests[0]!.opened = true;
    world.chests[0]!.chestItems = [{ kind: 'gold', count: 7, searched: true }];
    world.groundItems.push({ id: 1, kind: 'pouch', x: 20, z: 6, pouchItems: [{ kind: 'gold', count: 5 }] });
    world.groundItems.push({ id: 2, kind: 'gold', x: 21, z: 6, amount: 3 });
    world.groundItems.push({ id: 3, kind: 'grave', x: 22, z: 6, graveItems: [{ kind: 'potion', count: 1 }] });
    world.lifeMotes.push({ id: 1, x: 20, z: 6, life: 100 } as unknown as World['lifeMotes'][number]);
    level.openCell(3, 2); // 부서진 균열벽처럼 격자를 바꿔 둔다 — 초기화가 되돌리지 않아야 한다

    resetFloor(world, PLACEMENTS, level, false);
    expect(world.enemies).toHaveLength(3); // 셋 다 배치대로 — 보스를 잡지 않은 층은 보스도
    expect(world.enemies.every((e) => e.alive)).toBe(true);
    expect(world.traps[0]!.phase).toBe('armed');
    expect(world.traps[0]!.blocker).toBeUndefined();
    expect(world.chests[0]!.opened).toBe(true);
    expect(world.chests[0]!.chestItems).toEqual([]);
    expect(world.groundItems).toEqual([]);
    expect(world.lifeMotes).toEqual([]);
    expect(level.charAt(3, 2)).toBe('.'); // 격자 변경은 그대로
  });

  it('보스를 잡은 층(bossSlain)은 보스만 돌아오지 않는다', () => {
    const { world, level } = makeFloor();
    world.enemies.length = 0;
    resetFloor(world, PLACEMENTS, level, true);
    expect(world.enemies).toHaveLength(2);
    expect(world.enemies.some((e) => e.floorBoss)).toBe(false);
  });
});

describe('resetFloorDiff (세이브의 미방문 층)', () => {
  const diff: FloorDiff = {
    slain: ['goblin_runner@18,6', 'goblin_runner@30,10', 'slime_mother@10,10'],
    chests: [{ key: '10,10', items: [{ kind: 'gold', count: 4 }] }],
    levers: ['1-1'], doorsUnlocked: ['1,2'], barrelsBroken: ['a'], propsBroken: ['b'],
    traps: [{ key: 'trap_rockfall@18,14', phase: 'spent', charges: 0, rubble: true }],
    groundItems: [
      { id: 1, kind: 'pouch', x: 1, z: 1 },
      { id: 2, kind: 'grave', x: 2, z: 2, graveItems: [] },
    ],
  };

  it('보스 키 판정 — 종이 보스(slime_mother)거나 그 칸 배치에 boss 플래그', () => {
    expect(isBossKey('slime_mother@10,10', PLACEMENTS, 4)).toBe(true);
    expect(isBossKey('goblin_runner@30,10', PLACEMENTS, 4)).toBe(true); // [2,7] boss 배치 → x=30, z=10
    expect(isBossKey('goblin_runner@18,6', PLACEMENTS, 4)).toBe(false);
  });

  it('보스를 잡은 층은 보스 처치만 남고, 함정·바닥(비석 포함)은 비우고, 상자는 빈 채로, 문·레버·통은 그대로', () => {
    const r = resetFloorDiff(diff, PLACEMENTS, 4, true);
    expect(r.slain).toEqual(['goblin_runner@30,10', 'slime_mother@10,10']);
    expect(r.traps).toEqual([]);
    expect(r.groundItems).toEqual([]);
    expect(r.chests).toEqual([{ key: '10,10', items: [] }]);
    expect(r).toMatchObject({ levers: ['1-1'], doorsUnlocked: ['1,2'], barrelsBroken: ['a'], propsBroken: ['b'] });
  });

  it('보스를 잡지 않은 층은 처치 기록이 전부 사라진다', () => {
    expect(resetFloorDiff(diff, PLACEMENTS, 4, false).slain).toEqual([]);
  });
});
