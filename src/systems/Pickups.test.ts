// 처치 드랍(HP 포션 / 골드)과 자동 획득 검증. 드랍 굴림은 Math.random을 고정해 결정적으로 본다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Pickups from './Pickups';
import * as Sigils from './Sigils';

const DT = 1 / 60;
const cfg = balance.pickups;

function makeWorld(): World {
  const level = new Level({
    id: 'arena', name: 'arena', cellSize: 4, ceiling: 4,
    grid: ['########', '#S.....#', '#......#', '#......#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 10, y: 0, z: 10, prevX: 10, prevY: 0, prevZ: 10,
      yaw: 0, pitch: 0, health: balance.player.healthMax,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { active: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0 },
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

let world: World;
beforeEach(() => {
  world = makeWorld();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Math.random을 고정값으로 */
function fixRandom(value: number): void {
  vi.spyOn(Math, 'random').mockReturnValue(value);
}

describe('처치 드랍', () => {
  it('굴림이 확률 안이면 포션과 골드가 함께 떨어진다', () => {
    fixRandom(0.01); // potion(0.18)·gold(0.65) 둘 다 통과
    Pickups.rollDrops(world, 'goblin_runner', 12, 10);
    const kinds = world.groundItems.map((i) => i.kind);
    expect(kinds).toContain('potion');
    expect(kinds).toContain('gold');
    const gold = world.groundItems.find((i) => i.kind === 'gold')!;
    expect(gold.amount).toBe(cfg.gold.min); // random 0 → 최소치
  });

  it('굴림이 빗나가면 아무것도 떨어지지 않는다', () => {
    fixRandom(0.99);
    Pickups.rollDrops(world, 'goblin_runner', 12, 10);
    expect(world.groundItems).toHaveLength(0);
  });

  it('보스는 확률과 무관하게 포션 확정 + 골드 ×배율', () => {
    fixRandom(0.99);
    Pickups.rollDrops(world, 'goblin_chieftain', 12, 10);
    const gold = world.groundItems.find((i) => i.kind === 'gold')!;
    expect(world.groundItems.some((i) => i.kind === 'potion')).toBe(true);
    expect(gold.amount).toBe(cfg.gold.max * cfg.gold.bossMul); // random 0.99 → 최대치
  });
});

describe('자동 획득', () => {
  it('포션 — 반경 안에 들어가면 즉시 회복, 상한을 넘지 않는다', () => {
    world.player.health = balance.player.healthMax - 10; // 회복 여력 10
    world.groundItems.push({ id: 1, kind: 'potion', x: 10.5, z: 10 });
    const events: unknown[] = [];
    world.events.on('potion_picked', (payload) => events.push(payload));

    Pickups.tick(world, DT);
    expect(world.player.health).toBe(balance.player.healthMax);
    expect(events[0]).toMatchObject({ healed: 10 }); // 상한 초과분은 버려진다
    expect(world.groundItems).toHaveLength(0);
  });

  it('포션 — 체력이 가득이면 줍지 않고 남는다', () => {
    world.groundItems.push({ id: 1, kind: 'potion', x: 10.5, z: 10 });
    Pickups.tick(world, DT);
    expect(world.groundItems).toHaveLength(1);
  });

  it('포션 — 반경 밖이면 줍지 않는다', () => {
    world.player.health = 50;
    world.groundItems.push({ id: 1, kind: 'potion', x: 10 + cfg.potion.pickupRadius + 0.5, z: 10 });
    Pickups.tick(world, DT);
    expect(world.player.health).toBe(50);
    expect(world.groundItems).toHaveLength(1);
  });

  it('골드 — 반경 안이면 누적되고 한 번만 먹힌다', () => {
    world.groundItems.push({ id: 1, kind: 'gold', amount: 7, x: 10.5, z: 10 });
    world.groundItems.push({ id: 2, kind: 'gold', amount: 3, x: 10, z: 10.5 });
    Pickups.tick(world, DT);
    expect(world.gold).toBe(10);
    Pickups.tick(world, DT);
    expect(world.gold).toBe(10);
  });

  it('각인은 Pickups가 건드리지 않는다 (Sigils 담당)', () => {
    world.groundItems.push({ id: 1, kind: 'sigil', sigilId: 'sig_fireball', x: 10, z: 10 });
    Pickups.tick(world, DT);
    expect(world.groundItems).toHaveLength(1);

    Sigils.tick(world, DT);
    expect(world.groundItems).toHaveLength(0);
    expect(world.sigils.inventory).toContain('sig_fireball');
  });
});
