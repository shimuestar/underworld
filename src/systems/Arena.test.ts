// 보스 아레나(거수 「무저갱 우리」, B3-5 — docs/systems/boss_scythe_behemoth.md §9.3·§9.4·§10) — 봉쇄 조건, 홈 대기, 사망·부활 해제, 기둥 내구·붕괴·낙석 피해,
// 잔해 헛돌격, 반캠핑(시야 없음 300틱 → 그 기둥 돌격·실신 30 / 12m 밖 480틱 → 이속 ×1.5·쿨 리셋), 경계 클램프.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, breakCrackWalls, type EnemyState } from '../core/World';
import { Level, addDoorFrameBlockers } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Arena from './Arena';
import * as Door from './Door';
import * as Enemies from './Enemies';
import * as Sigils from './Sigils';

const DT = 1 / 60;
const TYPE = 'scythe_behemoth';
const def = enemyDef(TYPE);
const cfg = balance.arena;

/** 기획서 §10.1 격자를 그대로 심은 시험 층(17×16칸, 셀 4m). 아레나 안쪽 rows 2~10 · cols 3~13 = x 12~56 · z 8~44, 홈 (3,8) = (34, 14),
 *  기둥 (4,5)(4,11)(8,5)(8,11) = (22,18)(46,18)(22,34)(46,34), 균열벽 (9,2)(9,14) 뒤 벽감 (9,1)(9,15) = (6,38)(62,38), 문 D (11,8) = (34, 46), 그 아래 복도·스폰 방 */
const ARENA_GRID = [
  '#################',
  '########X########',
  '###...........###',
  '###...........###',
  '###..P.....P..###',
  '###...........###',
  '###...........###',
  '###...........###',
  '###..P.....P..###',
  '#.C...........C.#',
  '###...........###',
  '########D########',
  '########.########',
  '###....S......###',
  '###...........###',
  '#################',
];
const HOME = { x: 34, z: 14 };
const DOOR = { row: 11, col: 8, x: 34, z: 46 };
const PILLAR = { row: 4, col: 5, x: 22, z: 18 };

function makeArenaWorld(): World {
  const level = new Level({
    id: 'arena_test',
    name: 'arena_test',
    cellSize: 4,
    ceiling: 4,
    grid: [...ARENA_GRID],
    lighting: { ambient: 0.04, torches: [] },
    bossArena: true,
    arena: { bounds: [2, 3, 10, 13], home: [3, 8] },
  });
  const w = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 30, y: 0, z: 54, prevX: 30, prevY: 0, prevZ: 54, // 스폰 방 — 문 밖
      yaw: 0, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: false, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  Arena.init(w);
  Arena.ensure(w);
  return w;
}

let world: World;
let boss: EnemyState;
beforeEach(() => {
  world = makeArenaWorld();
  boss = spawnEnemyAt(TYPE, HOME.x, HOME.z, 1);
  boss.floorBoss = true; // 배치 플래그 boss:true — 출구 봉인·아레나 주인
  world.enemies.push(boss);
});

function placePlayer(x: number, z: number): void {
  const p = world.player;
  p.x = x;
  p.z = z;
  p.prevX = x;
  p.prevZ = z;
}
/** boss.ai 를 함수로 읽는다 — 대입 직후 리터럴로 좁혀진 타입과 비교하지 않게(TS2367) */
const aiOf = (): EnemyState['ai'] => boss.ai;
function placeBoss(x: number, z: number): void {
  boss.x = x;
  boss.z = z;
  boss.prevX = x;
  boss.prevZ = z;
}
/** main 의 순서대로 — Enemies → Arena → … → Door */
function tickAll(n = 1): void {
  for (let i = 0; i < n; i++) {
    Enemies.tick(world, DT);
    Arena.tick(world, DT);
    Door.tick(world, DT);
    world.tick++;
  }
}
function watch() {
  const sealed: unknown[] = [];
  const unsealed: { reason: string }[] = [];
  const holds: unknown[] = [];
  const damaged: { row: number; col: number; hp: number; max: number }[] = [];
  const collapsed: { row: number; col: number; playerHit: boolean; enemyHits: number }[] = [];
  const pillars: { anticamp?: boolean }[] = [];
  const hits: { amount: number; source?: string }[] = [];
  const whiffs: { ticks: number; wall?: boolean }[] = [];
  const status: { kind: string; on: boolean }[] = [];
  const anticamp: string[] = [];
  const doorEv: string[] = [];
  world.events.on('arena_sealed', (p) => sealed.push(p));
  world.events.on('arena_unsealed', (p) => unsealed.push(p as { reason: string }));
  world.events.on('arena_hold', (p) => holds.push(p));
  world.events.on('pillar_damaged', (p) => damaged.push(p as { row: number; col: number; hp: number; max: number }));
  world.events.on('pillar_collapsed', (p) => collapsed.push(p as { row: number; col: number; playerHit: boolean; enemyHits: number }));
  world.events.on('pillar_hit', (p) => pillars.push(p as { anticamp?: boolean }));
  world.events.on('player_damaged', (p) => hits.push(p as { amount: number; source?: string }));
  world.events.on('enemy_whiffed', (p) => whiffs.push(p as { ticks: number; wall?: boolean }));
  world.events.on('boss_status', (p) => status.push(p as { kind: string; on: boolean }));
  world.events.on('anticamp_charge', () => anticamp.push('charge'));
  world.events.on('anticamp_stun', () => anticamp.push('stun'));
  world.events.on('anticamp_far', (p) => anticamp.push((p as { on: boolean }).on ? 'far:on' : 'far:off'));
  for (const name of ['door_closing', 'door_closed', 'door_sealed', 'door_reopened', 'door_channel_started']) world.events.on(name, () => doorEv.push(name));
  return { sealed, unsealed, holds, damaged, collapsed, pillars, hits, whiffs, status, anticamp, doorEv };
}
/** 문을 열린 상태로 세운다(자물쇠는 이미 부서짐 — 한 번 연 문) */
function openDoor(): void {
  const door = world.doors[0]!;
  door.opened = true;
  door.unlockedOnce = true;
  door.slide = 1;
  door.prevSlide = 1;
  door.progress = balance.door.openTicks;
  world.level.openCell(door.col, door.row);
  door.frameBlockers = addDoorFrameBlockers(world.level, door.col, door.row);
}
function pressInteract(): void {
  world.input = { ...Input.emptySnapshot(), interactPressed: true };
  Door.tick(world, DT);
  world.input = Input.emptySnapshot();
}

describe('아레나 — 데이터·경계', () => {
  it('데이터 — balance.arena{pillarHp 3, noLosTicks 300, farTicks 480, farM 12, farNearM 8, farSpeedMul 1.5, pillarStunTicks 30, rubbleHalf 1.7, rockfallDamage 40, rockfallEnemyDamage 60 × traps.bossDamageMul 0.6 = 36}', () => {
    expect(cfg.pillarHp).toBe(3);
    expect(cfg.noLosTicks).toBe(300);
    expect(cfg.farTicks).toBe(480);
    expect(cfg.farM).toBe(12);
    expect(cfg.farNearM).toBe(8);
    expect(cfg.farSpeedMul).toBe(1.5);
    expect(cfg.pillarStunTicks).toBe(30);
    expect(cfg.rubbleHalf).toBe(1.7);
    expect(cfg.rubbleBreakable).toBe(true);
    expect(cfg.rockfallDamage).toBe(40);
    expect(cfg.rockfallEnemyDamage * balance.traps.bossDamageMul).toBeCloseTo(36, 6);
    // 잔해 반폭은 셀 안(4m) — 몸 폭 3.2 의 거수가 옆 칸으로 스쳐 지나갈 틈은 없다
    expect(cfg.rubbleHalf * 2).toBeLessThanOrEqual(4);
  });

  it('레벨의 arena{bounds, home} → World.arena — 경계 사각(x 12~56 · z 8~44), 홈 (34, 14), 기둥 넷 내구 3, 봉쇄 문 (11, 8). 아레나 없는 층은 null', () => {
    const a = world.arena!;
    expect(a).not.toBeNull();
    expect(a.bounds).toEqual({ minX: 12, maxX: 56, minZ: 8, maxZ: 44 });
    expect([a.homeX, a.homeZ]).toEqual([HOME.x, HOME.z]);
    expect(Object.keys(a.pillarHp).sort()).toEqual(['4-11', '4-5', '8-11', '8-5']);
    expect(Object.values(a.pillarHp)).toEqual([3, 3, 3, 3]);
    expect(a.door).toEqual({ row: DOOR.row, col: DOOR.col });
    expect(a.sealed).toBe(false);
    const plain = new Level({ id: 'plain', name: 'plain', cellSize: 4, ceiling: 4, grid: ['#####', '#S..#', '#####'], lighting: { ambient: 0, torches: [] } });
    expect(Arena.fromLevel(plain)).toBeNull();
  });

  it("'안' 판정 — 안쪽·기둥 칸·균열벽 뒤 상자 벽감·출구 벽감 X·문 칸은 안, 문 밖 복도·스폰 방은 밖", () => {
    const a = world.arena!;
    expect(Arena.insideAt(a, 34, 26)).toBe(true); // 안쪽 한복판
    expect(Arena.insideAt(a, PILLAR.x, PILLAR.z)).toBe(true);
    expect(Arena.insideAt(a, 62, 38)).toBe(true); // 동쪽 벽감(균열벽 뒤)
    expect(Arena.insideAt(a, 6, 38)).toBe(true); // 서쪽 벽감
    expect(Arena.insideAt(a, 34, 6)).toBe(true); // 출구 벽감 X
    expect(Arena.insideAt(a, DOOR.x, DOOR.z)).toBe(true); // 문 칸
    expect(Arena.insideAt(a, 34, 50)).toBe(false); // 문 밖 복도
    expect(Arena.insideAt(a, 30, 54)).toBe(false); // 스폰 방
  });
});

describe('아레나 — 봉쇄 조건 (기획서 §10.1 결정 25)', () => {
  it('밖에서 깨웠을 때 봉쇄 안 됨 — 보스는 홈으로 돌아가 기다린다(holdHome·arena_hold, 공격 없음, 플레이어를 노려본다)', () => {
    const w = watch();
    placeBoss(34, 30); // 홈에서 16m 남쪽
    boss.ai = 'chase'; // 총격·소음으로 깼다
    tickAll();
    expect(world.arena!.sealed).toBe(false);
    expect(world.doors[0]!.sealed ?? false).toBe(false);
    expect(boss.holdHome).toBe(true);
    expect(w.holds).toHaveLength(1);
    expect(w.sealed).toHaveLength(0);
    const d0 = Math.hypot(boss.x - HOME.x, boss.z - HOME.z);
    tickAll(60);
    const d1 = Math.hypot(boss.x - HOME.x, boss.z - HOME.z);
    expect(d1).toBeLessThan(d0); // 홈으로 걸어간다
    expect(boss.ai).toBe('chase'); // 공격 예고 없음
    tickAll(400);
    expect(Math.hypot(boss.x - HOME.x, boss.z - HOME.z)).toBeLessThanOrEqual(0.35);
    // 서서는 플레이어 쪽을 본다
    expect(boss.yaw).toBeCloseTo(Math.atan2(-(world.player.x - boss.x), -(world.player.z - boss.z)), 3);
    expect(w.holds).toHaveLength(1); // 한 번만 알린다
    expect(w.sealed).toHaveLength(0);
  });

  it('밖에서 깨웠는데 문이 열려 있으면 문을 닫아 시야를 끊는다 — door_closing{sealed:false}, 봉쇄는 아니다(E 로 다시 열 수 있다) (B3-5 잔여 메모: 문 밖 저격 캠핑 방지)', () => {
    const door = world.doors[0]!;
    door.opened = true; // 플레이어가 열어 두고 복도로 물러났다
    const closingLog: { sealed?: boolean }[] = [];
    world.events.on('door_closing', (p) => closingLog.push(p as { sealed?: boolean }));
    placeBoss(34, 30);
    boss.ai = 'chase'; // 밖에서 총격으로 깼다
    tickAll();
    expect(world.arena!.sealed).toBe(false);
    expect(door.sealed ?? false).toBe(false); // 봉쇄가 아니다
    // Arena 가 닫기를 걸고(door_closing) 같은 틱의 Door.tick 이 되민다 — 미닫이가 0 이면 그 틱에 벽이 된다(opened false), 아니면 closing 중
    expect(closingLog).toHaveLength(1);
    expect(closingLog[0]!.sealed).toBe(false);
    const after = world.doors[0]!; // 새 참조 — 위의 opened = true 대입으로 좁혀진 타입을 피한다
    expect(after.closing === true || after.opened === false).toBe(true);
    tickAll(5);
    expect(closingLog).toHaveLength(1); // 한 번만 — 닫힌 문을 다시 닫지 않는다
    expect(world.doors[0]!.sealed ?? false).toBe(false);
  });

  it('진입 시 봉쇄 — 경계를 넘는 틱에 arena_sealed + door.sealed, 홈 대기 해제. 이미 안에서 깨웠어도 같다', () => {
    const w = watch();
    boss.ai = 'chase';
    tickAll(); // 밖 — 홈 대기
    expect(boss.holdHome).toBe(true);
    placePlayer(34, 40); // 문 안쪽 첫 줄
    tickAll();
    expect(world.arena!.sealed).toBe(true);
    expect(world.doors[0]!.sealed).toBe(true);
    expect(boss.holdHome).toBe(false);
    expect(w.sealed).toHaveLength(1);
    expect(w.sealed[0]).toMatchObject({ row: DOOR.row, col: DOOR.col, x: DOOR.x, z: DOOR.z, enemyId: boss.id });
    // 잠든 보스(idle)는 안에 들어와도 봉쇄하지 않는다 — 각성 && 안
    const w2 = makeArenaWorld();
    const b2 = spawnEnemyAt(TYPE, HOME.x, HOME.z, 2);
    b2.floorBoss = true;
    w2.enemies.push(b2);
    w2.player.x = 34;
    w2.player.z = 40;
    Arena.tick(w2, DT);
    expect(w2.arena!.sealed).toBe(false);
    b2.ai = 'chase';
    Arena.tick(w2, DT);
    expect(w2.arena!.sealed).toBe(true);
  });

  it('열린 문은 닫힌다(Door closing 규약) → 다 닫힌 뒤 벽·E 무시(door_sealed) → 보스 사망에 해제(arena_unsealed boss_dead) → 부서진 자물쇠라 E 한 번에 다시 열린다', () => {
    openDoor();
    const w = watch();
    boss.ai = 'chase';
    placePlayer(34, 40);
    tickAll();
    const door = world.doors[0]!;
    expect(door.sealed).toBe(true);
    expect(door.closing).toBe(true);
    expect(w.doorEv).toEqual(['door_closing']);
    tickAll(balance.door.closeTicks + 2);
    expect(door.opened).toBe(false);
    expect(door.closing).toBe(false);
    expect(world.level.solidAt(DOOR.col, DOOR.row)).toBe(true); // 다시 벽
    expect(w.doorEv).toEqual(['door_closing', 'door_closed']);
    // 문 안쪽에서 문을 보고 E — 손이 먹지 않는다
    placePlayer(34, 43);
    world.player.yaw = Math.PI; // +z(남쪽 문)을 본다
    pressInteract();
    expect(door.progress).toBe(0);
    expect(door.opened).toBe(false);
    expect(w.doorEv).toEqual(['door_closing', 'door_closed', 'door_sealed']);
    expect(world.doorInView).toBeNull();
    // 주인 사망 → 봉쇄 해제
    boss.alive = false;
    boss.health = 0;
    tickAll();
    expect(world.arena!.sealed).toBe(false);
    expect(door.sealed).toBe(false);
    expect(w.unsealed.map((u) => u.reason)).toEqual(['boss_dead']);
    pressInteract();
    expect(w.doorEv.at(-1)).toBe('door_reopened');
    expect(door.progress).toBe(balance.door.openTicks); // 채널 없이 바로 밀린다
  });

  it('봉쇄 중 플레이어가 경계 밖으로 나가면 해제(left) + 홈 대기, 다시 들어오면 다시 봉쇄 — 문 밖에 갇히는 소프트락이 없다', () => {
    const w = watch();
    boss.ai = 'chase';
    placePlayer(34, 40);
    tickAll();
    expect(world.arena!.sealed).toBe(true);
    placePlayer(34, 50); // 문 밖 복도(문이 닫히기 전에 빠져나갔다)
    tickAll();
    expect(world.arena!.sealed).toBe(false);
    expect(w.unsealed.map((u) => u.reason)).toEqual(['left']);
    expect(boss.holdHome).toBe(true);
    placePlayer(34, 40);
    tickAll();
    expect(world.arena!.sealed).toBe(true);
    expect(boss.holdHome).toBe(false);
    expect(w.sealed).toHaveLength(2);
  });

  it('플레이어 사망 → 봉쇄 해제(death) + 보스 홈 대기. 부활(carryOver) — 새 몸은 홈에 잠든 채, 체력·페이즈·약점 내구·낫 잠김·갑각판은 그대로', () => {
    const w = watch();
    boss.ai = 'chase';
    placePlayer(34, 40);
    tickAll();
    expect(world.arena!.sealed).toBe(true);
    boss.health = 700;
    boss.phase = 2;
    boss.weakHp = { joint_r: 0, joint_l: 132, vent: 132 };
    boss.ruptured = { joint_r: true }; // 파열 처리 표식도 함께 — 없으면 새 몸이 hp 0 관절을 다시 파열시킨다(비틀거림 recover = 각성)
    boss.bladeLock = { r: 300 };
    boss.platesLeft = 2;
    boss.plateHp = 20;
    boss.ventScale = 1.15;
    boss.dazeCooldown = 200;
    world.dead = true;
    world.events.emit('player_died', { tick: world.tick });
    expect(world.arena!.sealed).toBe(false);
    expect(world.doors[0]!.sealed).toBe(false);
    expect(w.unsealed.map((u) => u.reason)).toEqual(['death']);
    expect(boss.holdHome).toBe(true);
    // 부활 — main 이 spawnEnemies 로 새 몸을 세우고 carryOver 로 지속 상태를 옮긴다
    const reborn = spawnEnemyAt(TYPE, HOME.x, HOME.z, 7);
    reborn.floorBoss = true;
    Arena.carryOver(boss, reborn);
    expect(reborn.health).toBe(700);
    expect(reborn.phase).toBe(2);
    expect(reborn.weakHp).toEqual({ joint_r: 0, joint_l: 132, vent: 132 });
    expect(reborn.ruptured).toEqual({ joint_r: true });
    expect(reborn.bladeLock).toEqual({ r: 300 });
    expect(reborn.platesLeft).toBe(2);
    expect(reborn.plateHp).toBe(20);
    expect(reborn.ventScale).toBe(1.15);
    expect(reborn.dazeCooldown).toBe(200);
    expect(reborn.ai).toBe('idle');
    expect([reborn.x, reborn.z]).toEqual([HOME.x, HOME.z]);
    expect(reborn.holdHome ?? false).toBe(false);
    world.enemies = [reborn];
    world.dead = false;
    tickAll();
    expect(world.arena!.bossId).toBe(reborn.id); // 새 몸을 주인으로 다시 찾는다
    expect(world.arena!.sealed).toBe(false); // 잠든 채 — 깨우면 다시 봉쇄
  });
});

describe('아레나 — 기둥 내구·붕괴·잔해 (기획서 §9.3·§10.1)', () => {
  it('pillar_hit 3회 → 내구 3→2→1(pillar_damaged, 기둥은 남는다) → 0 에 붕괴: 칸이 열리고(총알·시야 통과) 잔해 차단(rubbleHalf 1.7) + 경로 차단, 반경 5m 안 플레이어 40 / 보스 36(heavy), 밀림. 같은 칸은 더 안 깎인다', () => {
    const w = watch();
    boss.ai = 'chase';
    placeBoss(PILLAR.x, PILLAR.z + 4); // 기둥 남쪽 4m — 반경 안
    placePlayer(PILLAR.x + 4, PILLAR.z); // 기둥 동쪽 4m — 반경 안
    Arena.tick(world, DT);
    const hit = (): void => world.events.emit('pillar_hit', { enemyId: boss.id, enemyType: TYPE, row: PILLAR.row, col: PILLAR.col, x: PILLAR.x, z: PILLAR.z });
    hit();
    expect(world.arena!.pillarHp['4-5']).toBe(2);
    expect(w.damaged).toEqual([{ row: 4, col: 5, hp: 2, max: 3, x: PILLAR.x, z: PILLAR.z }]);
    expect(world.level.charAt(PILLAR.col, PILLAR.row)).toBe('P');
    hit();
    expect(world.arena!.pillarHp['4-5']).toBe(1);
    expect(world.level.solidAt(PILLAR.col, PILLAR.row)).toBe(true);
    expect(w.collapsed).toHaveLength(0);
    expect(world.player.health).toBe(100);
    hit();
    expect(world.arena!.pillarHp['4-5']).toBe(0);
    expect(w.damaged.at(-1)).toMatchObject({ hp: 0, max: 3 });
    expect(w.collapsed).toEqual([{ row: 4, col: 5, x: PILLAR.x, z: PILLAR.z, playerHit: true, enemyHits: 1 }]);
    // 잔해 — 격자는 바닥, 몸만 막는 상자(props), 적 경로 차단
    expect(world.level.charAt(PILLAR.col, PILLAR.row)).toBe('.');
    expect(world.level.solidAt(PILLAR.col, PILLAR.row)).toBe(false);
    expect(world.level.pathBlockedAt(PILLAR.col, PILLAR.row)).toBe(true);
    expect(world.level.hasLineOfSight(PILLAR.x, PILLAR.z - 6, PILLAR.x, PILLAR.z + 6)).toBe(true); // 시야·총알은 잔해를 넘어간다
    const rubble = world.arena!.rubble;
    expect(rubble).toHaveLength(1);
    expect(rubble[0]!.blocker).toEqual({ minX: PILLAR.x - 1.7, maxX: PILLAR.x + 1.7, minZ: PILLAR.z - 1.7, maxZ: PILLAR.z + 1.7 });
    expect(world.level.props).toContain(rubble[0]!.blocker);
    expect(world.level.rayBlockers).not.toContain(rubble[0]!.blocker);
    // 낙석 피해 — 플레이어 40(막기 불가), 보스 60 × 0.6 = 36
    expect(world.player.health).toBe(60);
    expect(w.hits).toEqual([expect.objectContaining({ amount: 40, source: 'pillar_rockfall', blocked: false })]);
    expect(world.player.kbTicks).toBe(cfg.rockfallKnockbackTicks);
    expect((world.player.kbX ?? 0) * cfg.rockfallKnockbackTicks).toBeCloseTo(cfg.rockfallPlayerKnockback, 6); // 동쪽(기둥 반대)으로 2.5m
    expect(boss.health).toBeCloseTo(def.health - 36, 6);
    expect(w.pillars).toHaveLength(3);
    // 붕괴한 자리를 다시 쳐도 아무 일 없다
    hit();
    expect(w.damaged).toHaveLength(3);
    expect(w.collapsed).toHaveLength(1);
    expect(world.player.health).toBe(60);
  });

  it('낙석은 회피 무적을 존중하고(플레이어 0), 반경 밖은 무사하다. 보스 아닌 적은 60 그대로', () => {
    const w = watch();
    boss.ai = 'chase';
    placeBoss(46, 34); // 다른 기둥 곁 — 반경 밖
    placePlayer(PILLAR.x + 3, PILLAR.z);
    world.player.iframeTicks = 5;
    world.player.iframeSource = 'dodge';
    const goblin = spawnEnemyAt('goblin_spear', PILLAR.x - 3, PILLAR.z, 3);
    world.enemies.push(goblin);
    world.arena!.pillarHp['4-5'] = 1;
    world.events.emit('pillar_hit', { enemyId: boss.id, enemyType: TYPE, row: PILLAR.row, col: PILLAR.col, x: PILLAR.x, z: PILLAR.z });
    expect(w.collapsed[0]).toMatchObject({ playerHit: false, enemyHits: 1 });
    expect(world.player.health).toBe(100);
    expect(boss.health).toBe(def.health);
    expect(goblin.health).toBe(enemyDef('goblin_spear').health - 60);
  });

  it('잔해에 박히는 돌격은 충돌이 아니다 — 질주가 잔해 앞에 서서 시간이 다하면 헛돌격 90(whiffRecoverTicks, wall 아님), pillar_hit·전도 없음 (기획서 §9.3 표)', () => {
    world.arena!.pillarHp['4-5'] = 1;
    world.events.emit('pillar_hit', { enemyId: boss.id, enemyType: TYPE, row: PILLAR.row, col: PILLAR.col, x: PILLAR.x, z: PILLAR.z });
    const w = watch();
    placePlayer(50, 40); // 멀리 — 접촉 없음
    placeBoss(PILLAR.x, 30); // 잔해 남쪽 12m
    Arena.tick(world, DT);
    boss.ai = 'charging';
    boss.attackMode = 'charge';
    boss.timer = def.chargeAttack!.chargeRunTicks!;
    boss.chargeTargetX = PILLAR.x;
    boss.chargeTargetZ = 6; // 잔해 너머 북쪽을 겨눴다
    boss.yaw = 0;
    for (let i = 0; i < 200 && aiOf() === 'charging'; i++) Enemies.tick(world, DT);
    if (aiOf() === 'impact') Enemies.tick(world, DT); // 질주 시간이 다한 다음 틱에 impact 가 정산된다
    expect(boss.ai).toBe('recover');
    expect(boss.whiffed).toBe(true);
    expect(boss.timer).toBe(def.chargeAttack!.whiffRecoverTicks);
    expect(w.whiffs).toEqual([{ enemyId: boss.id, enemyType: TYPE, ticks: def.chargeAttack!.whiffRecoverTicks }]); // wall 표식 없음
    expect(w.pillars).toHaveLength(0);
    expect(w.status.find((s) => s.kind === 'topple' || s.kind === 'head_down')).toBeUndefined();
    expect(boss.pose).toBe('charge');
    expect(boss.z).toBeCloseTo(PILLAR.z + 1.7 + def.radius, 1); // 잔해 면 앞에 섰다
  });

  it('폭발이 잔해에 닿으면 치운다(arena_rubble_broken) — 차단·경로 차단이 풀리고, 두 번 치우지 않는다', () => {
    world.arena!.pillarHp['4-5'] = 1;
    world.events.emit('pillar_hit', { enemyId: boss.id, enemyType: TYPE, row: PILLAR.row, col: PILLAR.col, x: PILLAR.x, z: PILLAR.z });
    const broken: unknown[] = [];
    world.events.on('arena_rubble_broken', (p) => broken.push(p));
    const blocker = world.arena!.rubble[0]!.blocker!;
    world.events.emit('explosion', { x: PILLAR.x + 6, y: 1, z: PILLAR.z, radius: 3, kind: 'fireball' }); // 잔해 면(x 23.7)까지 4.3 > 3 — 안 닿는다
    expect(broken).toHaveLength(0);
    world.events.emit('explosion', { x: PILLAR.x + 5, y: 1, z: PILLAR.z, radius: 3.5, kind: 'implode' }); // 내파는 불이 아니다
    expect(broken).toHaveLength(0);
    world.events.emit('explosion', { x: PILLAR.x + 5, y: 1, z: PILLAR.z, radius: 3.5 }); // 수류탄 — 3.3 ≤ 3.5
    expect(broken).toEqual([{ row: 4, col: 5, x: PILLAR.x, z: PILLAR.z }]);
    expect(world.arena!.rubble[0]!.broken).toBe(true);
    expect(world.arena!.rubble[0]!.blocker).toBeUndefined();
    expect(world.level.props).not.toContain(blocker);
    expect(world.level.pathBlockedAt(PILLAR.col, PILLAR.row)).toBe(false);
    world.events.emit('explosion', { x: PILLAR.x, y: 1, z: PILLAR.z, radius: 3.5 });
    expect(broken).toHaveLength(1);
  });
});

describe('아레나 — 반캠핑 (기획서 §9.4 결정 15)', () => {
  /** 봉쇄된 전투 — 보스 깨어 있고 플레이어 안 */
  function engage(bossX: number, bossZ: number, px: number, pz: number): ReturnType<typeof watch> {
    const w = watch();
    boss.ai = 'chase';
    placeBoss(bossX, bossZ);
    placePlayer(px, pz);
    Arena.tick(world, DT);
    expect(world.arena!.sealed).toBe(true);
    world.arena!.noLosTicks = 0; // 봉쇄 틱에도 한 번 셌다 — 아래 셈은 0 부터
    world.arena!.farTicks = 0;
    return w;
  }

  it('시야선 없이 300틱(기둥 뒤) → 시야를 가린 그 기둥으로 자발 돌격(anticamp_charge, 돌격 예고 → 기둥 칸 중심을 겨눈 질주) → 박히면 pillar_hit{anticamp} 내구 −1 + 실신 30(recover, 전도·눈 노출 없음)', () => {
    const w = engage(PILLAR.x, 30, PILLAR.x, 10); // 기둥(22,18) 남쪽 12m ↔ 북쪽 8m — 기둥이 시야를 가린다
    expect(world.level.hasLineOfSight(boss.x, boss.z, world.player.x, world.player.z)).toBe(false);
    for (let i = 0; i < cfg.noLosTicks - 1; i++) Arena.tick(world, DT);
    expect(boss.anticampTarget).toBeUndefined();
    expect(world.arena!.noLosTicks).toBe(cfg.noLosTicks - 1);
    Arena.tick(world, DT);
    expect(boss.anticampTarget).toEqual({ x: PILLAR.x, z: PILLAR.z, row: PILLAR.row, col: PILLAR.col });
    expect(world.arena!.noLosTicks).toBe(0);
    // 다음 추격 틱 — 돌격 예고(쿨다운 무관), 기둥 쪽을 본다
    boss.chargeCooldown = 400;
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('windup');
    expect(boss.attackMode).toBe('charge');
    expect(boss.anticampCharge).toBe(true);
    expect(w.anticamp).toEqual(['charge']);
    expect(boss.yaw).toBeCloseTo(0, 6); // 북쪽(−z)의 기둥
    for (let i = 0; i < 100 && boss.ai !== 'charging'; i++) Enemies.tick(world, DT);
    expect(boss.ai).toBe('charging');
    expect([boss.chargeTargetX, boss.chargeTargetZ]).toEqual([PILLAR.x, PILLAR.z]); // 플레이어가 아니라 기둥 칸 중심
    for (let i = 0; i < 200 && boss.ai === 'charging'; i++) Enemies.tick(world, DT);
    expect(boss.ai).toBe('recover');
    expect(boss.timer).toBe(cfg.pillarStunTicks);
    expect(boss.whiffed).toBe(true);
    expect(boss.pose).not.toBe('head_down');
    expect(boss.poseTicks ?? 0).toBe(0);
    expect(w.pillars).toEqual([expect.objectContaining({ row: PILLAR.row, col: PILLAR.col, anticamp: true })]);
    expect(world.arena!.pillarHp['4-5']).toBe(2);
    expect(w.damaged).toEqual([{ row: 4, col: 5, hp: 2, max: 3, x: PILLAR.x, z: PILLAR.z }]);
    expect(w.anticamp).toEqual(['charge', 'stun']);
    expect(w.status.find((s) => s.kind === 'topple' || s.kind === 'head_down')).toBeUndefined();
    expect(w.status.find((s) => s.kind === 'expose')).toBeUndefined(); // 눈 안 열림(플레이어 6m 밖)
    expect(boss.anticampCharge ?? false).toBe(false);
    expect(boss.anticampTarget).toBeUndefined();
    // 실신이 끝나면 추격으로 — 카운터는 다시 0 부터
    for (let i = 0; i < cfg.pillarStunTicks + 1; i++) Enemies.tick(world, DT);
    expect(boss.ai).toBe('chase');
  });

  it('시야가 다시 트이면 카운터가 0 으로 — 벽·문설주에 가렸을 때는(기둥이 아니다) 돌격을 요청하지 않는다', () => {
    engage(PILLAR.x, 30, PILLAR.x, 10);
    for (let i = 0; i < 100; i++) Arena.tick(world, DT);
    expect(world.arena!.noLosTicks).toBe(100);
    placePlayer(34, 30); // 시야 트임
    Arena.tick(world, DT);
    expect(world.arena!.noLosTicks).toBe(0);
    // 벽감 안(균열벽 C 뒤) — 시야를 가린 것은 균열벽이라 요청 없음
    placePlayer(62, 38);
    placeBoss(40, 38);
    for (let i = 0; i < cfg.noLosTicks + 5; i++) Arena.tick(world, DT);
    expect(boss.anticampTarget).toBeUndefined();
  });

  it('시야는 있는데 12m 밖 480틱 → 접근 이속 ×1.5(anticampBoost) + 돌격 쿨 즉시 리셋, 8m 안에 들면 풀린다(anticamp_far on/off)', () => {
    const w = engage(HOME.x, HOME.z, HOME.x, 40); // 26m, 시야 트임(기둥은 x 22·46)
    expect(world.level.hasLineOfSight(boss.x, boss.z, world.player.x, world.player.z)).toBe(true);
    boss.chargeCooldown = 300;
    for (let i = 0; i < cfg.farTicks - 1; i++) Arena.tick(world, DT);
    expect(boss.anticampBoost ?? false).toBe(false);
    expect(boss.chargeCooldown).toBe(300);
    Arena.tick(world, DT);
    expect(boss.anticampBoost).toBe(true);
    expect(boss.chargeCooldown).toBe(0);
    expect(w.anticamp).toEqual(['far:on']);
    // 걷기 한 틱 — 3.2 × 1.5 / 60 (26m 는 돌격 maxRange 15 밖이라 걸어온다)
    const bx = boss.x;
    const bz = boss.z;
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('chase');
    expect(Math.hypot(boss.x - bx, boss.z - bz)).toBeCloseTo((def.speed * cfg.farSpeedMul) / 60, 3);
    // 8m 안 — 가속 해제
    placePlayer(boss.x, boss.z + 7);
    Arena.tick(world, DT);
    expect(boss.anticampBoost).toBe(false);
    expect(w.anticamp).toEqual(['far:on', 'far:off']);
    const bx2 = boss.x;
    const bz2 = boss.z;
    boss.closeCooldown = 999; // 들이받기(3.0m) 말고 걷기만 보게
    Enemies.tick(world, DT);
    if (boss.ai === 'chase') expect(Math.hypot(boss.x - bx2, boss.z - bz2)).toBeCloseTo(def.speed / 60, 3);
  });

  it('반캠핑은 봉쇄 중(전투 중)에만 센다 — 홈 대기(밖에서 깸)·잠든 보스는 카운터 0', () => {
    boss.ai = 'chase';
    placeBoss(PILLAR.x, 30);
    placePlayer(30, 54); // 밖
    for (let i = 0; i < cfg.noLosTicks + 10; i++) Arena.tick(world, DT);
    expect(boss.anticampTarget).toBeUndefined();
    expect(world.arena!.noLosTicks).toBe(0);
    expect(boss.holdHome).toBe(true);
  });
});

describe('아레나 — 경계 클램프 (기획서 §9.2·§9.4 벽감 규칙)', () => {
  it('플레이어가 균열벽 뒤 벽감에 있으면 보스는 경계 안 가장 가까운 점(벽감 입구 앞)까지만 따라와 서고, 몸 중심은 늘 경계 안(x ≤ 56 − 1.6)', () => {
    breakCrackWalls(world, 58, 38, 0); // 동쪽 균열벽 개방 — 벽감이 열렸다
    expect(world.level.charAt(14, 9)).toBe('.');
    boss.ai = 'chase';
    boss.chargeCooldown = 9999; // 걷기만
    placeBoss(40, 38);
    placePlayer(62, 38); // 벽감 안쪽
    Arena.tick(world, DT);
    expect(world.arena!.sealed).toBe(true); // 벽감도 아레나 안 — 봉쇄는 그대로
    let maxX = boss.x;
    for (let i = 0; i < 600; i++) {
      Enemies.tick(world, DT);
      Arena.tick(world, DT);
      maxX = Math.max(maxX, boss.x);
    }
    const limit = world.arena!.bounds.maxX - def.radius; // 54.4
    expect(maxX).toBeLessThanOrEqual(limit + 1e-6);
    expect(boss.x).toBeGreaterThan(limit - 0.35); // 입구 앞에 닿아 섰다
    expect(boss.z).toBeCloseTo(38, 0);
    expect(boss.ai).toBe('chase'); // 낫(4.4)·들이받기(3.0) 사거리 밖(7.6m) — 벽감 안쪽 끝은 안전
    expect(Math.hypot(world.player.x - boss.x, world.player.z - boss.z)).toBeGreaterThan(def.attackRange);
  });

  it('돌격 목표도 경계 안으로 — 벽감 안 플레이어를 겨눈 돌격은 입구 앞에서 끝나 헛돌격, 질주 중에도 경계를 넘지 않는다', () => {
    breakCrackWalls(world, 58, 38, 0);
    boss.ai = 'chase';
    placeBoss(48, 38);
    placePlayer(62, 38); // 14m — 돌격 사거리(4.5~15) 안, 열린 균열벽 너머로 시야 트임
    Arena.tick(world, DT);
    expect(world.level.hasLineOfSight(boss.x, boss.z, world.player.x, world.player.z)).toBe(true);
    for (let i = 0; i < 60 && aiOf() !== 'windup'; i++) Enemies.tick(world, DT);
    expect(boss.ai).toBe('windup');
    expect(boss.attackMode).toBe('charge');
    for (let i = 0; i < 100 && aiOf() !== 'charging'; i++) Enemies.tick(world, DT);
    const limit = world.arena!.bounds.maxX - def.radius;
    expect(boss.chargeTargetX).toBeCloseTo(limit, 6); // 62 가 아니라 54.4
    expect(boss.chargeTargetZ).toBe(38);
    let maxX = boss.x;
    for (let i = 0; i < 200 && aiOf() === 'charging'; i++) {
      Enemies.tick(world, DT);
      maxX = Math.max(maxX, boss.x);
    }
    if (aiOf() === 'impact') Enemies.tick(world, DT);
    expect(maxX).toBeLessThanOrEqual(limit + 1e-6);
    expect(boss.ai).toBe('recover');
    expect(boss.whiffed).toBe(true); // 플레이어(7.6m)에 닿지 않았다
  });

  it('아레나 주인이 아닌 적·아레나 없는 층은 그대로 — 클램프가 걸리지 않는다', () => {
    const goblin = spawnEnemyAt('goblin_spear', 58, 38, 5); // 균열벽 칸(벽 안이지만 검사엔 무관) — 경계 밖 좌표
    goblin.ai = 'chase';
    world.enemies.push(goblin);
    Arena.tick(world, DT);
    expect(world.arena!.bossId).toBe(boss.id);
    Enemies.tick(world, DT);
    expect(goblin.x).toBeGreaterThan(world.arena!.bounds.maxX - enemyDef('goblin_spear').radius);
  });
});
