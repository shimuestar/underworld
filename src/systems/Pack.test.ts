// 무리 전투 AI — 산개 접근(부채꼴), 교대 공격(동시 예고 상한 + 옆걸음 포위)

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Enemies from './Enemies';
import * as Sigils from './Sigils';

const DT = 1 / 60;

function makeWorld(): World {
  // 3칸 높이(z 4~16) 넓은 방 — 옆으로 벌어질 공간이 있어야 산개를 잴 수 있다
  const level = new Level({
    id: 'packrange',
    name: 'packrange',
    cellSize: 4,
    ceiling: 4,
    grid: ['#'.repeat(10), '#S' + '.'.repeat(7) + '#', '#' + '.'.repeat(8) + '#', '#' + '.'.repeat(8) + '#', '#'.repeat(10)],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 8, y: 0, z: 10, prevX: 8, prevY: 0, prevZ: 10,
      yaw: -Math.PI / 2, pitch: 0, health: balance.player.healthMax,
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
    level,
  });
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

function add(type: string, x: number, z: number, id: number): EnemyState {
  const e = spawnEnemyAt(type, x, z, id);
  e.ai = 'chase';
  world.enemies.push(e);
  return e;
}

function ticks(n: number): void {
  for (let i = 0; i < n; i++) {
    world.input = Input.emptySnapshot();
    Enemies.tick(world, DT);
  }
}

describe('산개 접근 — 부채꼴로 벌어져 다가온다', () => {
  it('같은 직선에서 출발한 둘이 서로 다른 편각으로 갈라진다', () => {
    // id 해시 편향: 3 → +0.97, 12 → -0.88 (반대쪽 강한 편각 짝)
    const a = add('goblin_runner', 28, 10, 3);
    const b = add('goblin_runner', 28, 10.4, 12);
    ticks(45); // 0.75초 — 약 5.6m 전진
    expect(Math.abs(a.z - 10)).toBeGreaterThan(1); // 직선(z=10)에서 벗어났다
    expect(Math.abs(b.z - 10.4)).toBeGreaterThan(1);
    expect(Math.abs(a.z - b.z)).toBeGreaterThan(2.5); // 서로 반대쪽으로 — 한 줄이 아니다
  });

  it('수렴 거리 안에서는 편각이 사라진다 — 마지막엔 정면으로 파고든다', () => {
    const fl = balance.enemyAi.flank;
    // 수렴 거리 안(3m)에서 출발 — 편각 없이 곧장 다가와 사거리에서 예고에 들어간다
    const a = add('goblin_runner', 8 + fl.convergeRange - 0.5, 10, 3);
    let wound = false;
    world.events.on('enemy_windup', () => (wound = true));
    ticks(30);
    expect(Math.abs(a.z - 10)).toBeLessThan(0.4); // 옆으로 새지 않았다
    expect(wound).toBe(true); // 사거리 진입 — 공격 개시
  });
});

describe('교대 공격 — 동시 예고 상한과 옆걸음 포위', () => {
  it('셋이 사거리 안이라도 동시에 예고에 드는 건 최대 인원뿐, 남은 하나는 돈다', () => {
    world.player.health = 100000; // 얻어맞으며 재는 테스트 — 죽음 배제
    const a = add('goblin_runner', 10, 10, 21);
    const b = add('goblin_runner', 8, 12, 22);
    const c = add('goblin_runner', 6.2, 10, 23);
    Enemies.tick(world, DT);
    const winding = [a, b, c].filter((e) => e.ai === 'windup');
    expect(winding.length).toBe(balance.enemyAi.engage.maxSimultaneous);
    const waiter = [a, b, c].find((e) => e.ai === 'chase')!;
    expect(waiter).toBeTruthy();
    // 기다리는 놈은 붙박이가 아니다 — 옆걸음으로 돌며 자리를 옮긴다
    const wx = waiter.x;
    const wz = waiter.z;
    ticks(12);
    expect(Math.hypot(waiter.x - wx, waiter.z - wz)).toBeGreaterThan(0.25);
    // 돌면서도 플레이어 곁을 떠나지 않는다
    const d = Math.hypot(waiter.x - world.player.x, waiter.z - world.player.z);
    expect(d).toBeLessThan(4);
  });

  it('긴 난전에서도 동시 예고가 상한을 넘는 틱이 없다', () => {
    world.player.health = 100000;
    add('goblin_runner', 10, 10, 21);
    add('goblin_runner', 8, 12, 22);
    add('goblin_runner', 6.2, 10, 23);
    add('goblin_runner', 8, 8.2, 24);
    let maxWinding = 0;
    for (let i = 0; i < 400; i++) {
      world.input = Input.emptySnapshot();
      Enemies.tick(world, DT);
      const n = world.enemies.filter(
        (e) => e.alive && (e.ai === 'windup' || e.ai === 'charging'),
      ).length;
      maxWinding = Math.max(maxWinding, n);
    }
    expect(maxWinding).toBeGreaterThan(0); // 실제로 공격은 나온다
    expect(maxWinding).toBeLessThanOrEqual(balance.enemyAi.engage.maxSimultaneous);
  });

  it('보스는 자리를 기다리지 않는다 — 상한이 꽉 차도 바로 예고에 든다', () => {
    world.player.health = 100000;
    add('goblin_runner', 10, 10, 21);
    add('goblin_runner', 8, 12, 22);
    Enemies.tick(world, DT); // 둘이 자리를 채운다
    const boss = add('goblin_chieftain', 6, 10, 25); // 사거리 안(2m)
    boss.chargeCooldown = 99999; // 돌진 말고 근접 예고 경로를 잰다
    boss.volleyCooldown = 99999;
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('windup');
  });
});
