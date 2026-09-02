// 활 — 패드에서 조준(LT)을 놓으면 쏘지 않고 시위를 내린다 (RT 를 쥔 채여도)

import { describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Sigils from './Sigils';
import * as Stamina from './Stamina';
import * as Weapons from './Weapons';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'bowrange', name: 'bowrange', cellSize: 4, ceiling: 4,
    grid: ['#'.repeat(20), '#S' + '.'.repeat(17) + '#', '#'.repeat(20)],
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6, yaw: -Math.PI / 2, pitch: 0,
      health: balance.player.healthMax, stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'bow', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false, arrows: 10 },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  Stamina.init(world);
  return world;
}

describe('활 — 조준 해제 취소', () => {
  it('충분히 당긴 뒤 LT 를 놓으면(aimReleased) 화살이 나가지 않고 시위만 내려간다', () => {
    const world = makeWorld();
    const ev: string[] = [];
    world.events.on('bow_draw_released', (p) => ev.push((p as { cancelled?: boolean }).cancelled ? 'cancel' : 'release'));
    world.events.on('arrow_shot', () => ev.push('shot'));
    for (let i = 0; i < balance.weapons.bow.minDrawTicks + 6; i++) {
      world.input = { ...Input.emptySnapshot(), rangedHeld: true, padAiming: true };
      Weapons.tick(world, DT);
    }
    expect(world.weapon.bowDraw).toBeGreaterThan(balance.weapons.bow.minDrawTicks);
    // LT 를 놓는 틱 — RT 는 아직 쥐고 있어도(패드는 rangedHeld 가 함께 꺼진다) 취소다
    world.input = { ...Input.emptySnapshot(), rangedHeld: false, padAiming: false, aimReleased: true };
    Weapons.tick(world, DT);
    expect(world.weapon.bowDraw).toBe(0);
    expect(ev).toEqual(['cancel']);
    expect(world.projectiles).toHaveLength(0);
    expect(world.weapon.arrows).toBe(10); // 화살은 그대로
  });

  it('마우스는 그대로 — 좌클릭을 놓으면 쏜다', () => {
    const world = makeWorld();
    for (let i = 0; i < balance.weapons.bow.minDrawTicks + 6; i++) {
      world.input = { ...Input.emptySnapshot(), rangedHeld: true };
      Weapons.tick(world, DT);
    }
    world.input = Input.emptySnapshot();
    Weapons.tick(world, DT);
    expect(world.projectiles.length).toBeGreaterThan(0);
  });
});
