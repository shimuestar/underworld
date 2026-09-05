// 닿는 순간 판정(hitOnContact) — 구울 할퀴기는 무기 끝이 몸에 닿으면 창이 끝나길 기다리지 않고 치고,
// 물어뜯기(돌격)는 달리는 동안 몸이 부딛친 순간 물며 옆을 스쳐 지나가면 물지 않는다. 플래그가 없는 적은 그대로
import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Enemies from './Enemies';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'hall', name: 'hall', cellSize: 4, ceiling: 4,
    grid: ['##########', '#........#', '#........#', '#........#', '#........#', '#........#', '#........#', '#........#', '#...S....#', '##########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 20, y: 0, z: 20, prevX: 20, prevY: 0, prevZ: 20,
      yaw: 0, pitch: 0, health: 100000,
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
});

function step(): void {
  world.input = Input.emptySnapshot();
  Enemies.tick(world, DT);
  world.tick++;
}

/** 적을 플레이어 북쫙(-Z) dist 에 두고 정면으로 마주 세운다 */
function faceOff(type: string, dist: number) {
  const e = spawnEnemyAt(type, world.player.x, world.player.z - dist, 1);
  e.yaw = Math.PI; // 정면 = +Z (플레이어 쪽)
  e.ai = 'chase';
  world.enemies.push(e);
  return e;
}

/** 휘두르기 시작(active_perfect 진입)부터 피해가 들어오기까지 걸린 틱 */
function ticksFromSwingToHit(type: string, dist: number): number {
  const e = faceOff(type, dist);
  const hp0 = world.player.health;
  for (let i = 0; i < 300 && e.ai !== 'active_perfect'; i++) step();
  expect(e.ai).toBe('active_perfect');
  let n = 0;
  while (world.player.health === hp0 && n < 100) { step(); n++; }
  expect(world.player.health).toBeLessThan(hp0);
  return n;
}

describe('닿는 순간 판정 — hitOnContact', () => {
  it('구울 할퀴기는 무기 끝이 몸에 닿으면 곧바로 친다 — 6+12 틱 창을 다 기다리지 않는다 (코앞이라도 minActiveTicks 는 남긴다)', () => {
    const n = ticksFromSwingToHit('ghoul', 1.0);
    const full = balance.reaction.windowPerfectTicks + balance.reaction.windowNormalTicks;
    expect(n).toBeLessThan(full);
    expect(n).toBeLessThanOrEqual(balance.contact.minActiveTicks + 2); // 최소 창이 지나면 접촉 → 다음 틱 impact → 피해
    expect(n).toBeGreaterThanOrEqual(balance.contact.minActiveTicks); // 그 전엔 치지 않는다 — 패링할 틈
  });

  it('코앞의 할퀴기라도 최소 창 안에 반응하면 패링이 성립한다 (완벽 — 창끝이 이미 몸 안)', () => {
    const e = faceOff('ghoul', 1.0);
    for (let i = 0; i < 300 && e.ai !== 'active_perfect'; i++) step();
    for (let i = 0; i < 3; i++) step();
    world.input = { ...Input.emptySnapshot(), reactionPressed: true };
    Reaction.tick(world, DT);
    expect(e.ai).toBe('staggered');
    expect(world.freezeTicks).toBe(balance.reaction.hitstopPerfectTicks);
  });

  it('플래그가 없는 족장 내려찍기(바닥 범위 공격)는 지금처럼 창(6+12틱)이 끝난 뒤에 친다', () => {
    const n = ticksFromSwingToHit('goblin_chieftain', 1.5);
    const full = balance.reaction.windowPerfectTicks + balance.reaction.windowNormalTicks;
    expect(n).toBeGreaterThanOrEqual(full);
  });

  it('구울 물어뜯기 — 서 있으면 몸이 부딛친 순간(contactDist 안) 붙잡히고, 사거리 2m 에서 미리 물지 않는다', () => {
    const def = enemyDef('ghoul');
    const e = faceOff('ghoul', 2.8); // 달려들기 사거리 [2.6, 3] 안
    e.chargeCooldown = 0;
    for (let i = 0; i < 300 && e.ai !== 'charging'; i++) step();
    expect(e.ai).toBe('charging');
    let latchDist = -1;
    for (let i = 0; i < 60 && world.grappleEnemyId === null; i++) {
      step();
      if (world.grappleEnemyId !== null) latchDist = Math.hypot(e.x - world.player.x, e.z - world.player.z);
    }
    expect(world.grappleEnemyId).toBe(e.id);
    expect(latchDist).toBeLessThanOrEqual(Enemies.contactDist(def) + 0.3); // 몸이 닿아서 물었다 (2m 사거리가 아니다)
  });

  it('구울 물어뜯기 — 옆으로 1.5m 비켜 서 있으면 스쳐 지나가고 물지 않는다 (옆 회피 성립)', () => {
    const e = faceOff('ghoul', 2.8);
    e.chargeCooldown = 0;
    for (let i = 0; i < 300 && e.ai !== 'charging'; i++) step();
    expect(e.ai).toBe('charging');
    // 겨냥은 예고가 끝난 자리로 고정됐다 — 이제 옆으로 비킨다 (옆 대시 3.5×0.5 = 1.75m 보다 짧은 1.5m)
    world.player.x += 1.5;
    world.player.prevX = world.player.x;
    const hp0 = world.player.health;
    for (let i = 0; i < 90 && (e.ai as string) !== 'recover'; i++) step();
    expect(world.grappleEnemyId).toBeNull();
    expect(world.player.health).toBe(hp0);
    expect(e.ai).toBe('recover');
    expect(e.whiffed).toBe(true); // 헛물켜 반격 창
  });
});
