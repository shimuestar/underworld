// 잠긴 문 — E 채널, 이탈 시 초기화, 미닫이가 다 밀린 뒤에야 통행이 열린다.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Door from './Door';
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

function makeWorld(): World {
  const level = makeLevel();
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
      scars: { eye: 0, rightArm: 0, leftArm: 0, heart: 0, spine: 0 },
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
}

/** E 한 번 누른 틱 */
function press(world: World): void {
  world.input = { ...Input.emptySnapshot(), interactPressed: true };
  Door.tick(world, DT);
  world.input = Input.emptySnapshot();
}

/** 손 안 대고 n 틱 */
function idle(world: World, n: number): void {
  for (let i = 0; i < n; i++) Door.tick(world, DT);
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

describe('레벨 데이터', () => {
  it('레버는 폐지됐다 — z01_f1 에 lever 트리거도, L 칸도 없다', async () => {
    const level = (await import('../../data/levels/z01_f1.json')).default;
    expect(level.grid.some((row: string) => row.includes('L'))).toBe(false);
    expect((level.triggers ?? []).some((t: { type: string }) => t.type === 'lever')).toBe(false);
  });

  it('z01_f1 의 문 두 짝 모두 밀려 들어갈 벽을 찾는다', async () => {
    const levelJson = (await import('../../data/levels/z01_f1.json')).default;
    const level = new Level(levelJson as never);
    expect(level.doors).toHaveLength(2);
    for (const door of level.doors) {
      // 축은 하나만 잡히고, 미는 쪽은 벽이어야 한다 (허공으로 밀면 판이 드러난다)
      expect(Math.abs(door.dirX) + Math.abs(door.dirZ)).toBe(1);
      expect(level.charAt(door.col + door.dirX, door.row + door.dirZ)).toBe('#');
    }
  });
});
