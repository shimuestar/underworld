// 생명 입자 — 흩뿌리기 / 자석 흡수·회복 / 원거리 잔류·소멸
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as LifeMotes from './LifeMotes';
import * as Sigils from './Sigils';

const CFG = balance.lifeMotes;
const DT = 1 / 60;

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

let world: World;
beforeEach(() => {
  world = makeWorld();
  LifeMotes.init(world);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function ticks(n: number): void {
  for (let i = 0; i < n; i++) LifeMotes.tick(world, DT);
}

describe('흩뿌리기', () => {
  it('처치 이벤트로 체급만큼 흩뿌린다 — 가벼운 적과 중간 적이 다르다', () => {
    world.events.emit('enemy_died', { enemyType: 'goblin_runner', x: 30, z: 30 });
    expect(world.lifeMotes.length).toBe(CFG.countByWeight.light);
    world.events.emit('enemy_died', { enemyType: 'goblin_spear', x: 30, z: 30 });
    expect(world.lifeMotes.length).toBe(CFG.countByWeight.light + CFG.countByWeight.medium);
    expect(CFG.countByWeight.medium).toBeGreaterThan(CFG.countByWeight.light);
  });

  it('scatterRadius 안에 떨어지고, 처음엔 자석에 안 걸려 있다', () => {
    LifeMotes.spawn(world, 'goblin_runner', 30, 30);
    for (const m of world.lifeMotes) {
      expect(Math.hypot(m.x - 30, m.z - 30)).toBeLessThanOrEqual(CFG.scatterRadius + 1e-9);
      expect(m.homing).toBe(false);
      expect(m.ageTicks).toBe(0);
    }
  });
});

describe('자석', () => {
  it('가까이서 죽이면 빨려 들어와 healPerMote × 개수만큼 회복한다', () => {
    world.player.health = 50;
    let healedTotal = 0;
    world.events.on('life_mote_absorbed', (p) => {
      healedTotal += (p as { healed: number }).healed;
    });
    LifeMotes.spawn(world, 'goblin_runner', world.player.x + 1.5, world.player.z); // 반경 안
    ticks(120);
    expect(world.lifeMotes.length).toBe(0);
    const gain = CFG.countByWeight.light * CFG.healPerMote;
    expect(world.player.health).toBe(50 + gain);
    expect(healedTotal).toBe(gain);
  });

  it('최대 체력을 넘지 않는다', () => {
    world.player.health = balance.player.healthMax - 1;
    LifeMotes.spawn(world, 'goblin_runner', world.player.x + 1.5, world.player.z);
    ticks(120);
    expect(world.player.health).toBe(balance.player.healthMax);
  });

  it('한번 걸리면 물러나도 끝까지 따라온다 — 따라오는 동안은 늙지 않는다', () => {
    world.player.health = 50;
    LifeMotes.spawn(world, 'goblin_runner', world.player.x + 2, world.player.z);
    ticks(1);
    expect(world.lifeMotes.every((m) => m.homing)).toBe(true);
    world.player.x += 20; // 멀리 물러난다
    ticks(CFG.lifeTicks + 60); // 수명보다 오래 기다려도 사라지지 않고 도착한다
    expect(world.lifeMotes.length).toBe(0);
    expect(world.player.health).toBe(50 + CFG.countByWeight.light * CFG.healPerMote);
  });
});

describe('멀리서 죽이면', () => {
  it('자석 반경 밖이면 제자리에 남는다', () => {
    LifeMotes.spawn(world, 'goblin_runner', world.player.x + 10, world.player.z);
    const before = world.lifeMotes.map((m) => [m.x, m.z]);
    ticks(60);
    expect(world.lifeMotes.map((m) => [m.x, m.z])).toEqual(before);
    expect(world.lifeMotes.every((m) => !m.homing)).toBe(true);
    expect(world.player.health).toBe(balance.player.healthMax);
  });

  it('lifeTicks 뒤 사라지고 life_mote_expired 로 개수를 알린다', () => {
    let expired = 0;
    world.events.on('life_mote_expired', (p) => {
      expired += (p as { count: number }).count;
    });
    LifeMotes.spawn(world, 'goblin_runner', world.player.x + 10, world.player.z);
    ticks(CFG.lifeTicks - 1);
    expect(world.lifeMotes.length).toBe(CFG.countByWeight.light);
    ticks(1);
    expect(world.lifeMotes.length).toBe(0);
    expect(expired).toBe(CFG.countByWeight.light);
  });

  it('사라지기 전에 다가가면 여전히 빨려 온다', () => {
    world.player.health = 50;
    LifeMotes.spawn(world, 'goblin_runner', world.player.x + 10, world.player.z);
    ticks(CFG.lifeTicks - 30);
    world.player.x += 10; // 입자 곁으로
    ticks(120);
    expect(world.lifeMotes.length).toBe(0);
    expect(world.player.health).toBe(50 + CFG.countByWeight.light * CFG.healPerMote);
  });
});
