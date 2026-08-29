// 잠긴 문 — E 채널, 이탈 시 초기화, 미닫이가 다 밀린 뒤에야 통행이 열린다.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { alertNearbyAt, World, type EnemyState } from '../core/World';
import { addDoorFrameBlockers, Level } from '../level/GridLoader';
import * as Door from './Door';
import * as Lever from './Lever';
import * as Sigils from './Sigils';

const DT = 1 / 60;
const CFG = balance.door;

/** 세로 벽(열 5) 한가운데 문 하나. 통로는 동서로 뚫려 있다 */
function makeLevel(): Level {
  return new Level({
    id: 'doorway',
    name: 'doorway',
    cellSize: 4,
    ceiling: 4,
    grid: [
      '###########',
      '#S...#....#',
      '#....D....#',
      '#....#....#',
      '###########',
    ],
    lighting: { ambient: 0.04, torches: [] },
  });
}

/** 같은 배치인데 문이 관문(G)이고, 레버가 서쪽 방 [1,2] 에 있다 */
function makeGateLevel(): Level {
  return new Level({
    id: 'gateway',
    name: 'gateway',
    cellSize: 4,
    ceiling: 4,
    grid: [
      '###########',
      '#SL..#....#',
      '#....G....#',
      '#....#....#',
      '###########',
    ],
    lighting: { ambient: 0.04, torches: [] },
    triggers: [{ type: 'lever', cell: [1, 2], opens: [2, 5] }],
  });
}

function makeWorld(level: Level = makeLevel()): World {
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      // 문([2,5] → x 22, z 10) 서쪽에서 +X 를 본다
      x: 20, y: 0, z: 10, prevX: 20, prevY: 0, prevZ: 10,
      yaw: -Math.PI / 2, pitch: 0, health: 100,
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

/** E 한 번 누른 틱 (문·레버 둘 다 돌린다 — main 의 순서와 같다) */
function press(world: World): void {
  world.input = { ...Input.emptySnapshot(), interactPressed: true };
  Door.tick(world, DT);
  Lever.tick(world, DT);
  world.input = Input.emptySnapshot();
}

/** 손 안 대고 n 틱 */
function idle(world: World, n: number): void {
  for (let i = 0; i < n; i++) {
    Door.tick(world, DT);
    Lever.tick(world, DT);
  }
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('문 찾기', () => {
  it('레벨 격자에서 D 를 찾아 문 하나를 만든다', () => {
    expect(world.doors).toHaveLength(1);
    expect(world.doors[0]!.row).toBe(2);
    expect(world.doors[0]!.col).toBe(5);
  });

  it('미닫이는 벽이 이어지는 축으로 민다 — 세로 벽이면 세로(Z)로', () => {
    const door = world.doors[0]!;
    expect(door.dirX).toBe(0);
    expect(Math.abs(door.dirZ)).toBe(1);
  });

  it('반경 안에서 문을 보면 안내 대상이 된다', () => {
    Door.tick(world, DT);
    expect(world.doorInView).toBe(world.doors[0]);
  });

  it('멀면 대상이 아니다', () => {
    world.player.x = 22 - CFG.radius - 1;
    Door.tick(world, DT);
    expect(world.doorInView).toBeNull();
  });

  it('등지고 서 있으면 대상이 아니다 — 제단·상자와 같은 규약', () => {
    world.player.yaw = Math.PI / 2; // −X 를 본다
    Door.tick(world, DT);
    expect(world.doorInView).toBeNull();
  });
});

describe('E 채널', () => {
  it('E 를 눌러야 시작한다 — 서 있기만 해서는 안 열린다', () => {
    idle(world, 30);
    expect(world.doors[0]!.progress).toBe(0);

    press(world);
    expect(world.doors[0]!.progress).toBe(1);
  });

  it('한 번 시작하면 계속 누르지 않아도 오른다', () => {
    press(world);
    idle(world, 29);
    expect(world.doors[0]!.progress).toBe(30);
  });

  it('openTicks 를 채우면 잠금이 풀린다 — 그 전에는 아직 벽이다', () => {
    const unlocked: unknown[] = [];
    world.events.on('door_unlocked', (p) => unlocked.push(p));

    press(world);
    idle(world, CFG.openTicks - 2);
    expect(unlocked).toHaveLength(0);
    expect(world.level.solidAt(5, 2)).toBe(true);

    idle(world, 1);
    expect(unlocked).toHaveLength(1);
  });

  it('닫힌 문은 방을 밀봉한다 — 벽 너머 직선이라도 소리가 못 들어가고, 열리면 들린다', () => {
    const world = makeWorld();
    // 동쪽 방(문 너머)의 적 — 직선은 문이 아니라 벽(열 5)을 지나는 자리
    const enemy = {
      id: 1, type: 'spider_large', x: 28, z: 6, prevX: 28, prevZ: 6,
      yaw: 0, homeYaw: 0, health: 75, alive: true, ai: 'idle',
      timer: 0, noticeTicks: 0, burnTicks: 0, burnDamagePerTick: 0,
    } as EnemyState;
    world.enemies.push(enemy);
    alertNearbyAt(world, 18, 10, 12, 0); // 서쪽 방에서 권총 총성 몫의 소음
    expect(enemy.ai).toBe('idle'); // 닫힌 문 — 방이 밀봉됐다 (벽도 이제 소리를 막는다)
    world.level.openCell(5, 2); // 문이 열렸다 (Door 가 미닫이 끝에 하는 일)
    alertNearbyAt(world, 18, 10, 12, 0);
    expect(enemy.ai).toBe('chase'); // 열린 문으로 소리가 돌아 들어간다
  });

  it('문에서 떨어지면 처음부터 — 진행이 남지 않는다', () => {
    press(world);
    idle(world, 40);
    expect(world.doors[0]!.progress).toBe(41);

    const broken: unknown[] = [];
    world.events.on('door_channel_broken', (p) => broken.push(p));
    world.player.x = 5; // 멀리
    Door.tick(world, DT);
    expect(world.doors[0]!.progress).toBe(0);
    expect(broken).toHaveLength(1);

    // 돌아와도 이어지지 않는다
    world.player.x = 20;
    idle(world, 10);
    expect(world.doors[0]!.progress).toBe(0);
  });

  it('등을 돌려도 끊긴다 — 만지던 손이 떨어진 것과 같다', () => {
    press(world);
    idle(world, 20);
    world.player.yaw = Math.PI / 2;
    Door.tick(world, DT);
    expect(world.doors[0]!.progress).toBe(0);
  });

  it('channelFrac 는 0~1 로 진행을 알려 준다', () => {
    expect(Door.channelFrac(world)).toBe(0);
    press(world);
    idle(world, Math.round(CFG.openTicks / 2) - 1);
    expect(Door.channelFrac(world)).toBeCloseTo(0.5, 1);
  });
});

describe('미닫이', () => {
  /** 잠금이 풀릴 때까지 민다 */
  function unlock(world: World): void {
    press(world);
    idle(world, CFG.openTicks - 1);
  }

  it('다 밀린 틱에야 통행이 열린다 — 반쯤 열린 문은 못 지나간다', () => {
    const opened: unknown[] = [];
    world.events.on('door_opened', (p) => opened.push(p));
    unlock(world);

    idle(world, CFG.slideTicks - 1);
    expect(world.doors[0]!.slide).toBeLessThan(1);
    expect(world.level.solidAt(5, 2)).toBe(true); // 아직 벽
    expect(opened).toHaveLength(0);

    idle(world, 1);
    expect(world.doors[0]!.slide).toBe(1);
    expect(world.level.solidAt(5, 2)).toBe(false); // 이제 지나간다
    expect(opened).toHaveLength(1);
  });

  it('잠금이 풀린 뒤에는 손을 떼도 알아서 밀린다', () => {
    unlock(world);
    world.player.x = 5; // 문에서 떨어진다
    idle(world, CFG.slideTicks);
    expect(world.doors[0]!.opened).toBe(true);
  });

  it('열린 문은 다시 안내 대상이 되지 않는다', () => {
    unlock(world);
    idle(world, CFG.slideTicks);
    Door.tick(world, DT);
    expect(world.doorInView).toBeNull();
    expect(Door.channelFrac(world)).toBe(0);
  });

  it('prevSlide 로 렌더 보간용 직전 값을 남긴다', () => {
    unlock(world);
    idle(world, 3);
    const door = world.doors[0]!;
    expect(door.prevSlide).toBeLessThan(door.slide);
    expect(door.slide - door.prevSlide).toBeCloseTo(1 / CFG.slideTicks, 5);
  });
});

describe('관문(G)과 레버', () => {
  /** 레버 [1,2] → x 10, z 6 / 관문 [2,5] → x 22, z 10 */
  function gateWorld(): World {
    const w = makeWorld(makeGateLevel());
    w.player.x = 20; w.player.z = 10; w.player.prevX = 20; w.player.prevZ = 10;
    w.player.yaw = -Math.PI / 2; // +X = 관문 쪽
    return w;
  }
  /** 레버 앞(서쪽 2m)에 서서 레버를 본다 */
  function standAtLever(w: World): void {
    w.player.x = 8.5; w.player.z = 6; w.player.prevX = 8.5; w.player.prevZ = 6;
    w.player.yaw = -Math.PI / 2;
  }

  it('관문은 byLever 로 표시되고 레버도 읽힌다', () => {
    const w = gateWorld();
    expect(w.doors).toHaveLength(1);
    expect(w.doors[0]!.byLever).toBe(true);
    expect(w.level.levers).toHaveLength(1);
  });

  it('관문 앞에서 E 를 눌러도 안 열린다 — 이유를 알려 준다', () => {
    const w = gateWorld();
    const needs: unknown[] = [];
    w.events.on('door_needs_lever', (p) => needs.push(p));

    Door.tick(w, DT);
    expect(w.doorInView).toBe(w.doors[0]); // 안내 대상은 된다
    press(w);
    idle(w, CFG.openTicks + CFG.slideTicks);
    expect(w.doors[0]!.progress).toBe(0);
    expect(w.doors[0]!.opened).toBe(false);
    expect(w.level.solidAt(5, 2)).toBe(true);
    expect(needs.length).toBeGreaterThan(0);
    expect(Door.channelFrac(w)).toBe(0); // 게이지도 안 찬다
  });

  it('레버를 당기면 관문이 열린다 — 미닫이는 문과 같은 경로로 돈다', () => {
    const w = gateWorld();
    standAtLever(w);
    const pulled: unknown[] = [];
    const opened: unknown[] = [];
    w.events.on('lever_pulled', (p) => pulled.push(p));
    w.events.on('door_opened', (p) => opened.push(p));

    Lever.tick(w, DT);
    expect(w.leverInView).toEqual({ row: 1, col: 2 }); // 안내가 뜰 조건

    press(w);
    expect(pulled).toHaveLength(1);
    expect(w.doors[0]!.progress).toBe(CFG.openTicks); // 잠금이 통째로 풀렸다

    idle(w, CFG.slideTicks - 1);
    expect(w.level.solidAt(5, 2)).toBe(true); // 다 밀리기 전엔 아직 벽
    idle(w, 1);
    expect(w.doors[0]!.opened).toBe(true);
    expect(w.level.solidAt(5, 2)).toBe(false);
    expect(opened).toHaveLength(1);
  });

  it('레버는 1회용 — 두 번째 E 는 아무 일도 없다', () => {
    const w = gateWorld();
    standAtLever(w);
    press(w);
    const pulled: unknown[] = [];
    w.events.on('lever_pulled', (p) => pulled.push(p));
    press(w);
    expect(pulled).toHaveLength(0);
    Lever.tick(w, DT);
    expect(w.leverInView).toBeNull(); // 안내도 사라진다
  });

  it('멀거나 등지고 있으면 안 당겨진다 — 제단·상자와 같은 규약', () => {
    const w = gateWorld();
    standAtLever(w);
    w.player.x = 10 - CFG.leverRadius - 1;
    press(w);
    expect(w.doors[0]!.progress).toBe(0);

    standAtLever(w);
    w.player.yaw = Math.PI / 2; // 등진다
    press(w);
    expect(w.doors[0]!.progress).toBe(0);
  });
});

describe('레벨 데이터 — 로비·방·복도 문법 (세 층 공통)', () => {
  const FLOORS = ['z01_f1', 'z01_f2', 'z01_f3'] as const;
  const load = async (id: string): Promise<Level> =>
    new Level((await import(`../../data/levels/${id}.json`)).default as never);

  it('모든 문이 밀려 들어갈 벽을 찾는다 — 허공으로 밀면 판이 드러난다', async () => {
    for (const id of FLOORS) {
      const level = await load(id);
      for (const door of level.doors) {
        // 축은 하나만 잡히고, 미는 쪽은 벽이어야 한다
        expect(Math.abs(door.dirX) + Math.abs(door.dirZ), `${id} 문 [${door.row},${door.col}]`).toBe(1);
        expect(level.charAt(door.col + door.dirX, door.row + door.dirZ)).toBe('#');
      }
    }
  });

  it('로비↔방 문(D)이 층마다 있고, 관문(G)은 아레나 층(2·3층)에만 있다', async () => {
    // 1층은 문 2짝(제단 방·보물 방)으로 문법을 가르치고, 2·3층은 레버 관문이 더해진다
    const expected = { z01_f1: { hand: 3, gate: 0 }, z01_f2: { hand: 4, gate: 1 }, z01_f3: { hand: 4, gate: 1 } };
    for (const id of FLOORS) {
      const level = await load(id);
      expect(level.doors.filter((d) => !d.byLever), `${id} 손 문`).toHaveLength(expected[id].hand);
      expect(level.doors.filter((d) => d.byLever), `${id} 관문`).toHaveLength(expected[id].gate);
    }
  });

  it('관문마다 그걸 여는 레버가 실제로 있고, 레버 칸은 벽 안이 아니다', async () => {
    for (const id of FLOORS) {
      const level = await load(id);
      for (const gate of level.doors.filter((d) => d.byLever)) {
        const lever = level.levers.find(
          (l) => l.opens?.[0] === gate.row && l.opens?.[1] === gate.col,
        );
        expect(lever, `${id} 관문 [${gate.row},${gate.col}] 을 여는 레버가 없다`).toBeTruthy();
        expect(level.solidAt(lever!.cell[1]!, lever!.cell[0]!)).toBe(false);
      }
    }
  });
});

describe('열린 문 — 문틀은 그대로 서 있다', () => {
  /** 좌우로 뚫린 복도 한가운데 문 하나 (위아래가 벽이라 문은 X 축을 향한다) */
  function doorLevel(): Level {
    return new Level({
      id: 'doortest',
      name: 'doortest',
      cellSize: 4,
      ceiling: 4,
      grid: ['#####', '#S.D.', '#####'],
      lighting: { ambient: 0.04, torches: [] },
    });
  }

  it('문을 연 뒤 가운데로는 지나가고, 석조 문설주는 여전히 몸을 막는다', () => {
    const level = doorLevel();
    const doorCol = level.doors[0]!.col;
    const doorRow = level.doors[0]!.row;
    const cs = level.cellSize;
    const gapZ = (doorRow + 0.5) * cs; // 개구부 한가운데
    const start = (doorCol - 1 + 0.5) * cs;

    // 열기 전 — 셀이 solid 라 가운데도 막힌다
    const before = { x: start, z: gapZ };
    level.slideMove(before, 0.4, cs * 1.5, 0);
    expect(before.x).toBeLessThan((doorCol + 0.5) * cs);

    level.openCell(doorCol, doorRow);
    addDoorFrameBlockers(level, doorCol, doorRow);

    // 가운데 — 문이 열렸으니 지나간다
    const through = { x: start, z: gapZ };
    level.slideMove(through, 0.4, cs * 1.5, 0);
    expect(through.x).toBeGreaterThan((doorCol + 0.5) * cs);

    // 문설주 자리 — 셀은 열렸어도 돌기둥은 그대로다
    const intoJamb = { x: start, z: gapZ - cs * 0.4 };
    level.slideMove(intoJamb, 0.4, cs * 1.5, 0);
    expect(intoJamb.x).toBeLessThan((doorCol + 0.5) * cs);
  });

  it('열린 문의 문설주는 화살·마법도 받아 낸다 — 가운데 개구부만 지나간다', () => {
    const level = doorLevel();
    const door = level.doors[0]!;
    level.openCell(door.col, door.row);
    addDoorFrameBlockers(level, door.col, door.row);
    const cs = level.cellSize;
    const gapZ = (door.row + 0.5) * cs;
    const startX = (door.col - 1 + 0.5) * cs;
    // 가운데 — 문 셀 너머까지 지나간다
    expect(level.wallRayT(startX, gapZ, 1, 0)).toBeGreaterThan(cs * 1.2);
    // 문설주 선상 — 돌기둥이 받아 낸다 (문 셀 앞면에서 끊긴다)
    expect(level.wallRayT(startX, gapZ - cs * 0.4, 1, 0)).toBeLessThan(cs * 1.2);
    // 시야선도 같은 규칙 — 문설주 뒤의 적은 안 보인다
    expect(level.hasLineOfSight(startX, gapZ - cs * 0.4, (door.col + 1.5) * cs, gapZ - cs * 0.4)).toBe(false);
  });
});

describe('문은 당기지 않고 민다', () => {
  it('여는 사람 반대쪽으로 젖혀진다 — 서쪽에서 열면 동쪽으로', () => {
    press(world);
    idle(world, CFG.openTicks); // 잠금 해제 + 첫 여닫이 틱
    expect(world.doors[0]!.swingDir).toBe(-1);
  });

  it('반대쪽에서 열면 반대로 젖혀진다', () => {
    world.player.x = 24;
    world.player.yaw = Math.PI / 2; // -X 를 본다
    press(world);
    idle(world, CFG.openTicks);
    expect(world.doors[0]!.swingDir).toBe(1);
  });
});
