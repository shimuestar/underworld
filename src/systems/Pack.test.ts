// 무리 전투 AI — 산개 접근(부채꼴), 교대 공격(동시 예고 상한 + 옆걸음 포위)

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { addDoorFrameBlockers, Level } from '../level/GridLoader';
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

describe('벽 너머 추격 — 흐름장을 따라 통로로 돌아온다', () => {
  function makeMazeWorld(): World {
    // 세로 벽(col5, 4m 폭)이 방을 둘로 가르고 아래 행만 뚫려 있다 — 1칸 통로
    const level = new Level({
      id: 'mazerange',
      name: 'mazerange',
      cellSize: 4,
      ceiling: 4,
      grid: [
        '##########',
        '#S...#...#',
        '#....#...#',
        '#....#...#',
        '#........#',
        '##########',
      ],
      lighting: { ambient: 0.04, torches: [] },
    });
    const w = makeWorld();
    // makeWorld 의 방 대신 미로 레벨로 교체 — 플레이어 (6,6)
    return new World(w.events, {
      input: Input.emptySnapshot(),
      player: { ...w.player, x: 6, z: 6, prevX: 6, prevZ: 6 },
      lantern: w.lantern,
      weapon: w.weapon,
      mana: w.mana,
      sigils: w.sigils,
      modifiers: w.modifiers,
      corruption: w.corruption,
      enemies: [],
      level,
    });
  }

  it('시야가 벽에 막힌 적이 아래 통로로 돌아 플레이어에게 닿는다', () => {
    world = makeMazeWorld();
    world.player.health = 100000;
    const e = add('goblin_runner', 30, 6, 7); // 벽 반대편 — 직선은 col5 벽에 막힌다
    expect(world.level.hasLineOfSight(e.x, e.z, 6, 6)).toBe(false);
    let reached = false;
    for (let i = 0; i < 900 && !reached; i++) {
      world.input = Input.emptySnapshot();
      Enemies.tick(world, DT);
      if (Math.hypot(e.x - world.player.x, e.z - world.player.z) < 3) reached = true;
    }
    expect(reached).toBe(true); // 벽에 갈리지 않고 통로(4행)로 돌아왔다
  });

  it('흐름장이 안 닿는 곳(닫힌 성역 밖)은 예전처럼 직진 폴백 — 오류 없이 벽에 붙는다', () => {
    world = makeMazeWorld();
    const e = add('goblin_runner', 30, 6, 8);
    // 흐름장 범위를 임시로 0 으로 — 장이 비어 폴백 경로를 탄다
    const saved = balance.enemyAi.pursuit.range;
    (balance.enemyAi.pursuit as { range: number }).range = 0;
    try {
      for (let i = 0; i < 60; i++) {
        world.input = Input.emptySnapshot();
        Enemies.tick(world, DT);
      }
    } finally {
      (balance.enemyAi.pursuit as { range: number }).range = saved;
    }
    expect(e.x).toBeLessThan(30); // 직진으로 벽 쪽까지는 갔다 (끼임은 예전과 같음)
  });
});

describe('문 통과 — 문설주(개구부 2.1m)에 끼지 않고 빠져나온다', () => {
  function makeDoorWorld(): World {
    // 세로 벽(col5) 가운데(row2)만 뚫리고, 실제 문처럼 문설주 블로커를 세운다
    const level = new Level({
      id: 'doorrange',
      name: 'doorrange',
      cellSize: 4,
      ceiling: 4,
      grid: [
        '##########',
        '#....#...#',
        '#S.......#',
        '#....#...#',
        '##########',
      ],
      lighting: { ambient: 0.04, torches: [] },
    });
    addDoorFrameBlockers(level, 5, 2); // 개구부 z 8.95~11.05 (2.1m)
    const w = makeWorld();
    return new World(w.events, {
      input: Input.emptySnapshot(),
      player: { ...w.player, x: 6, z: 10, prevX: 6, prevZ: 10 },
      lantern: w.lantern,
      weapon: w.weapon,
      mana: w.mana,
      sigils: w.sigils,
      modifiers: w.modifiers,
      corruption: w.corruption,
      enemies: [],
      level,
    });
  }

  it('중앙선에서 벗어난 채 와도 문설주에 갈리다 끼임 탈출로 통과한다', () => {
    world = makeDoorWorld();
    world.player.health = 100000;
    const e = add('goblin_runner', 30, 10.6, 3); // id 3 — 강한 편각(+0.97)이 벽을 향한다
    let reached = false;
    for (let i = 0; i < 600 && !reached; i++) {
      world.input = Input.emptySnapshot();
      Enemies.tick(world, DT);
      if (Math.hypot(e.x - world.player.x, e.z - world.player.z) < 3) reached = true;
    }
    expect(reached).toBe(true);
  });

  it('슬라임 셋이 몰려와도 서로 밀치다 전원이 문을 빠져나온다', () => {
    world = makeDoorWorld();
    world.player.health = 100000;
    const pack = [
      add('slime', 28, 10, 31),
      add('slime', 30, 11.4, 32),
      add('slime', 29, 8.8, 33),
    ];
    const reached = [false, false, false];
    for (let i = 0; i < 2400 && !reached.every(Boolean); i++) {
      world.input = Input.emptySnapshot();
      Enemies.tick(world, DT);
      pack.forEach((e, k) => {
        if (Math.hypot(e.x - world.player.x, e.z - world.player.z) < 4.5) reached[k] = true;
      });
    }
    expect(reached).toEqual([true, true, true]);
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
