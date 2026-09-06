// B3-2 검증 — 진액 웅덩이(Hazards.ts) + 오염 진액(Status.ts corrosive) (docs/systems/boss_scythe_behemoth.md §6·§10.2).
// 웅덩이 생성·상한·자연 소멸·불(폭발·불붙은 기름) 증발·질식 증발, 접촉 → corrosive(lingerTicks) → 이속 ×0.6·도트(corrosive_tick, player_damaged 없음)·
// 오염 대기 +1/60틱(전투당 상한 8, 보스 fightPendingIn)·회피 무적 중엔 안 붙음·clearAll.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, playerStatusTicks, type EnemyState, type TrapState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Hazards from './Hazards';
import * as PlayerMove from './PlayerMove';
import * as Sigils from './Sigils';
import * as Status from './Status';

const DT = 1 / 60;
const HZ = balance.hazards;
const CC = balance.status.corrosive;

/** 경기장 12×7칸(안쪽 x 4~44 · z 4~24) — 웅덩이를 벽에서 멀리 놓는다 */
function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['############', '#S.........#', '#..........#', '#..........#', '#..........#', '#.........X#', '############'],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 20, y: 0, z: 12, prevX: 20, prevY: 0, prevZ: 12,
      yaw: -Math.PI / 2, pitch: 0, health: 100,
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
}

let world: World;
beforeEach(() => {
  world = makeWorld();
  Hazards.init(world);
});

type PoolEv = { id: number; x: number; z: number; r: number; kind: string; reason?: string };
function watch() {
  const spawned: PoolEv[] = [];
  world.events.on('pool_spawned', (p) => spawned.push(p as PoolEv));
  const evaporated: PoolEv[] = [];
  world.events.on('pool_evaporated', (p) => evaporated.push(p as PoolEv));
  const applied: unknown[] = [];
  world.events.on('corrosive_applied', (p) => applied.push(p));
  const ended: { reason: string }[] = [];
  world.events.on('corrosive_ended', (p) => ended.push(p as { reason: string }));
  const ticks: { amount: number; health: number }[] = [];
  world.events.on('corrosive_tick', (p) => ticks.push(p as { amount: number; health: number }));
  const damaged: unknown[] = [];
  world.events.on('player_damaged', (p) => damaged.push(p));
  const pending: { amount: number; total: number; cap: number }[] = [];
  world.events.on('corrosive_pending', (p) => pending.push(p as { amount: number; total: number; cap: number }));
  return { spawned, evaporated, applied, ended, ticks, damaged, pending };
}
/** 한 틱 — main 의 순서에서 이 검증에 필요한 것: 이동 → 상태 → 웅덩이 */
function step(): void {
  PlayerMove.tick(world, DT);
  Status.tick(world, DT);
  Hazards.tick(world, DT);
}
function addBoss(): EnemyState {
  const boss = spawnEnemyAt('scythe_behemoth', 36, 12, 1);
  boss.ai = 'chase';
  world.enemies.push(boss);
  return boss;
}
function oilAt(x: number, z: number, phase: TrapState['phase']): TrapState {
  const trap: TrapState = { id: 900, type: 'trap_oil', x, z, row: Math.floor(z / 4), col: Math.floor(x / 4), phase, timer: 300, charges: -1, dirX: 0, dirZ: -1 };
  world.traps.push(trap);
  return trap;
}

describe('Hazards — 진액 웅덩이 (기획서 §10.2)', () => {
  it('데이터 — pools{blade 1.6, stomp 2.0, orb 1.2, skid 1.6 / 480}·poolMax 12, corrosive{0.6, 2/30, linger 30, +1/60, cap 8}', () => {
    expect(HZ.pools).toEqual({ blade: { radius: 1.6, ticks: 480 }, stomp: { radius: 2.0, ticks: 480 }, orb: { radius: 1.2, ticks: 480 }, skid: { radius: 1.6, ticks: 480 } });
    expect(HZ.poolMax).toBe(12);
    expect(CC).toEqual({ moveSpeedMul: 0.6, dotPerTick: 2, dotIntervalTicks: 30, lingerTicks: 30, pendingPerTicks: 60, pendingCap: 8 });
    expect(CC.dotIntervalTicks * 8).toBe(240); // 4초 부착 = 16 피해
  });

  it('spawn_pool 이벤트/함수로 생긴다 — 종류별 반경·지속, 모르는 종류는 무시, pool_spawned. 자연 소멸은 ticks 뒤 pool_evaporated{expired}', () => {
    const w = watch();
    world.events.emit('spawn_pool', { kind: 'blade', x: 10, z: 10 });
    const orb = Hazards.spawnPool(world, 30, 20, 'orb');
    expect(Hazards.spawnPool(world, 1, 1, 'lava')).toBeNull();
    expect(world.pools).toHaveLength(2);
    expect(world.pools[0]).toMatchObject({ x: 10, z: 10, r: 1.6, ticks: 480, duration: 480, kind: 'blade' });
    expect(orb).toMatchObject({ x: 30, z: 20, r: 1.2, ticks: 480, kind: 'orb' });
    expect(w.spawned.map((s) => s.kind)).toEqual(['blade', 'orb']);
    expect(Hazards.poolAt(world, 11.5, 10)?.kind).toBe('blade'); // 반경 안(중심 거리 ≤ r)
    expect(Hazards.poolAt(world, 11.7, 10)).toBeUndefined();
    for (let i = 0; i < 479; i++) Hazards.tick(world, DT);
    expect(world.pools).toHaveLength(2);
    expect(world.pools[0]!.ticks).toBe(1);
    Hazards.tick(world, DT);
    expect(world.pools).toHaveLength(0);
    expect(w.evaporated.map((e) => e.reason)).toEqual(['expired', 'expired']);
  });

  it('동시 상한 poolMax(12) — 넘치면 오래된 것부터 증발(overflow)', () => {
    const w = watch();
    for (let i = 0; i < HZ.poolMax + 2; i++) Hazards.spawnPool(world, 6 + i * 2.5, 10, 'orb');
    expect(world.pools).toHaveLength(HZ.poolMax);
    expect(world.pools[0]!.x).toBeCloseTo(6 + 2 * 2.5, 6); // 첫 둘이 밀려났다
    expect(w.evaporated.map((e) => e.reason)).toEqual(['overflow', 'overflow']);
    expect(w.evaporated.map((e) => e.x)).toEqual([6, 8.5]);
  });

  it('불로 증발 — 폭발(explosion: 화염구·수류탄·폭발통)은 반경에 닿는 웅덩이(원끼리 겹침)를 즉시, 내파(implode)는 아니다. 불붙은 기름 함정(firing)은 매 틱 그 반경, 안 붙은 기름(armed)은 아니다', () => {
    const w = watch();
    Hazards.spawnPool(world, 10, 10, 'blade'); // r1.6
    Hazards.spawnPool(world, 16, 10, 'blade');
    Hazards.spawnPool(world, 30, 20, 'orb');
    world.events.emit('explosion', { x: 12.5, y: 1, z: 10, radius: 2.0, kind: 'fireball' }); // 10 까지 2.5 ≤ 2.0 + 1.6 / 16 까지 3.5 ≤ 3.6
    expect(world.pools.map((p) => p.x)).toEqual([30]);
    expect(w.evaporated.map((e) => `${e.x}:${e.reason}`)).toEqual(['10:fire', '16:fire']);
    world.events.emit('explosion', { x: 30, y: 1, z: 20, radius: 3, kind: 'implode' });
    expect(world.pools).toHaveLength(1);
    // 기름 함정 — armed 는 그대로, firing 이면 다음 Hazards 틱에 증발
    const oil = oilAt(31, 20, 'armed');
    Hazards.tick(world, DT);
    expect(world.pools).toHaveLength(1);
    oil.phase = 'firing';
    Hazards.tick(world, DT);
    expect(world.pools).toHaveLength(0);
    expect(w.evaporated.at(-1)).toMatchObject({ x: 30, reason: 'fire' });
    // 타는 자리에 새로 생겨도 그 틱에 마른다
    Hazards.spawnPool(world, 31.5, 20, 'orb');
    Hazards.tick(world, DT);
    expect(world.pools).toHaveLength(0);
  });

  it('질식(boss_status choke on)이면 전부 증발(reason choke). clearAll 은 이벤트 없이 비운다', () => {
    const w = watch();
    Hazards.spawnPool(world, 10, 10, 'blade');
    Hazards.spawnPool(world, 30, 20, 'orb');
    world.events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'choke', on: true, ticks: 1800 });
    expect(world.pools).toHaveLength(0);
    expect(w.evaporated.map((e) => e.reason)).toEqual(['choke', 'choke']);
    Hazards.spawnPool(world, 10, 10, 'blade');
    Hazards.clearAll(world);
    expect(world.pools).toHaveLength(0);
    expect(w.evaporated).toHaveLength(2);
  });

  it('접촉 — 웅덩이 위(중심 거리 ≤ r)면 매 틱 corrosive 를 lingerTicks 로 세운다(다음 Status 틱에 corrosive_applied 한 번), 나오면 lingerTicks 뒤 corrosive_ended{expired}. 회피 무적·그림자 이동 중엔 안 붙는다', () => {
    const w = watch();
    const p = world.player;
    Hazards.spawnPool(world, 20, 12, 'blade');
    step();
    expect(playerStatusTicks(p, 'corrosive')).toBe(CC.lingerTicks);
    step();
    expect(w.applied).toHaveLength(1);
    expect(playerStatusTicks(p, 'corrosive')).toBe(CC.lingerTicks); // Status 가 깎고 Hazards 가 되살린다 — 위에 서 있는 동안 꽉 찬 채
    for (let i = 0; i < 10; i++) step();
    expect(w.applied).toHaveLength(1); // 다시 알리지 않는다
    // 나간다 — 남은 lingerTicks 만큼 뒤 풀린다
    p.x = 25;
    p.prevX = 25;
    let n = 0;
    while (w.ended.length === 0 && n < 100) {
      step();
      n++;
    }
    expect(n).toBe(CC.lingerTicks);
    expect(w.ended).toEqual([{ kind: 'corrosive', reason: 'expired' }]);
    expect(playerStatusTicks(p, 'corrosive')).toBe(0);
    // 회피 무적 — 위에 서 있어도 안 붙는다. 그림자 이동도
    p.x = 20;
    p.prevX = 20;
    p.iframeTicks = 5;
    Hazards.tick(world, DT);
    expect(playerStatusTicks(p, 'corrosive')).toBe(0);
    p.iframeTicks = 0;
    p.blinkLeft = 2;
    Hazards.tick(world, DT);
    expect(playerStatusTicks(p, 'corrosive')).toBe(0);
    p.blinkLeft = 0;
    Hazards.tick(world, DT);
    expect(playerStatusTicks(p, 'corrosive')).toBe(CC.lingerTicks);
    // 죽었으면 아무것도 안 한다
    world.dead = true;
    p.corrosiveTicks = 0;
    Hazards.tick(world, DT);
    expect(playerStatusTicks(p, 'corrosive')).toBe(0);
  });

  it('효과 — 이속 ×0.6(PlayerMove, 웅덩이에서 나와도 붙어 있는 동안), 도트 30틱마다 2(corrosive_tick — player_damaged 없음), 상태가 풀리면 박자는 처음부터', () => {
    const w = watch();
    const p = world.player;
    world.input = { ...Input.emptySnapshot(), moveForward: 1 }; // -x 로 걷는다(yaw −π/2 = +x 를 본다 → moveForward 는 시선 방향)
    const x0 = p.x;
    PlayerMove.tick(world, DT);
    const normal = Math.abs(p.x - x0);
    expect(normal).toBeCloseTo(balance.player.moveSpeed / 60, 4);
    Hazards.spawnPool(world, p.x, p.z, 'stomp'); // r2.0 — 몇 걸음은 안에 있다
    Hazards.tick(world, DT);
    const x1 = p.x;
    PlayerMove.tick(world, DT);
    expect(Math.abs(p.x - x1)).toBeCloseTo(normal * CC.moveSpeedMul, 4);
    world.input = Input.emptySnapshot();
    // 도트 — 붙은 뒤 30 Status 틱에 첫 피해 2, 60 에 둘째. player_damaged 는 나지 않는다
    p.x = 20;
    p.prevX = 20;
    for (let i = 0; i < CC.dotIntervalTicks - 1; i++) step();
    expect(w.ticks).toHaveLength(0);
    step();
    expect(w.ticks).toEqual([{ amount: CC.dotPerTick, health: 100 - CC.dotPerTick }]);
    expect(p.health).toBe(98);
    for (let i = 0; i < CC.dotIntervalTicks; i++) step();
    expect(w.ticks).toHaveLength(2);
    expect(p.health).toBe(96);
    expect(w.damaged).toHaveLength(0);
    // 나가서 풀리면 누적이 0 — 다시 붙으면 30틱 뒤에 첫 도트
    p.x = 30;
    p.prevX = 30;
    for (let i = 0; i < CC.lingerTicks + 1; i++) step();
    expect(w.ended).toHaveLength(1);
    expect(p.corrosiveAccum).toBe(0);
    const before = w.ticks.length;
    p.x = 20;
    p.prevX = 20;
    for (let i = 0; i < CC.dotIntervalTicks; i++) step();
    expect(w.ticks).toHaveLength(before);
    step();
    expect(w.ticks).toHaveLength(before + 1);
  });

  it('오염 대기 — 붙어 있는 60틱마다 +1(corrosive_pending), 전투당 상한 8 은 살아 있는 보스의 fightPendingIn 이 센다. 보스가 없으면(전투 끝) 오르지 않고, 새 보스(부활·재소환)면 0 부터. 도트로 죽으면 player_died', () => {
    const w = watch();
    const p = world.player;
    const boss = addBoss();
    const keepOn = (): void => {
      if (!Hazards.poolAt(world, p.x, p.z)) Hazards.spawnPool(world, p.x, p.z, 'blade');
      step();
    };
    for (let i = 0; i < CC.pendingPerTicks; i++) keepOn();
    expect(w.pending).toHaveLength(0); // 붙은 다음 Status 틱부터 세니 한 틱 늦다
    keepOn();
    expect(w.pending).toEqual([{ amount: 1, total: 1, cap: CC.pendingCap, enemyId: boss.id }]);
    expect(world.corruption.pending).toBe(1);
    expect(boss.fightPendingIn).toBe(1);
    for (let i = 0; i < CC.pendingPerTicks * 9; i++) keepOn();
    expect(world.corruption.pending).toBe(CC.pendingCap); // 8 에서 멈춘다
    expect(boss.fightPendingIn).toBe(CC.pendingCap);
    expect(w.pending).toHaveLength(CC.pendingCap);
    expect(world.corruption.applied).toBe(0);
    // 보스가 죽으면 더 오르지 않는다(도트는 계속)
    boss.alive = false;
    const hp = p.health;
    for (let i = 0; i < CC.pendingPerTicks * 2; i++) keepOn();
    expect(world.corruption.pending).toBe(CC.pendingCap);
    expect(p.health).toBeLessThan(hp);
    // 새 보스 — 장부 0 부터 다시 +1
    world.enemies.length = 0;
    const b2 = addBoss();
    for (let i = 0; i < CC.pendingPerTicks; i++) keepOn();
    expect(b2.fightPendingIn).toBe(1);
    expect(world.corruption.pending).toBe(CC.pendingCap + 1);
    // 도트 사망
    p.health = 1;
    for (let i = 0; i < CC.dotIntervalTicks + 1 && !world.dead; i++) keepOn();
    expect(world.dead).toBe(true);
    expect(p.health).toBe(0);
  });

  it('Status.clearAll(부활·층 이동)은 오염 진액·누적도 비운다', () => {
    const p = world.player;
    Hazards.spawnPool(world, 20, 12, 'blade');
    for (let i = 0; i < 12; i++) step();
    expect(playerStatusTicks(p, 'corrosive')).toBeGreaterThan(0);
    expect(p.corrosiveAccum).toBeGreaterThan(0);
    Status.clearAll(world);
    expect(playerStatusTicks(p, 'corrosive')).toBe(0);
    expect(p.corrosiveAccum).toBe(0);
  });
});
