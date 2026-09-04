// 반동 — 권총은 연사할수록, 활은 강하게 당길수록 조준이 더 크게 튄다. 튄 조준은 되돌아온다(일부는 남는다).
// Weapons 가 예약(kick)하고 PlayerMove 가 시선에 얹는 두 단계라, 둘을 이어서 검사한다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as PlayerMove from './PlayerMove';
import * as Sigils from './Sigils';
import * as Weapons from './Weapons';

const DT = 1 / 60;
const PISTOL = balance.weapons.pistol;
const BOW = balance.weapons.bow;
const RAD = Math.PI / 180;

function makeWorld(ranged: 'pistol' | 'bow'): World {
  const level = new Level({
    id: 'range',
    name: 'range',
    cellSize: 4,
    ceiling: 4,
    grid: ['#'.repeat(40), '#S' + '.'.repeat(37) + '#', '#'.repeat(40)],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: -Math.PI / 2, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: {
      melee: 'hammer', ranged, mag: 12, reserve: 60, cooldown: 0, reloading: 0,
      muzzleFlash: 0, grenades: 3, arrows: 10, bowDraw: 0, meleeCooldown: 0,
      grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false,
    },
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
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // 좌우 무작위를 0 으로 — 세로만 본다
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 권총 한 발 (쿨다운은 호출 쪽이 관리) */
function firePistol(): void {
  world.input = { ...Input.emptySnapshot(), rangedPressed: true, rangedHeld: true };
  Weapons.tick(world, DT);
  world.input = Input.emptySnapshot();
}

/** 조용히 n 틱 — 되돌림만 진행 */
function settle(n: number): void {
  for (let i = 0; i < n; i++) {
    world.input = Input.emptySnapshot();
    PlayerMove.tick(world, DT);
    Weapons.tick(world, DT);
  }
}

describe('권총 반동', () => {
  beforeEach(() => {
    world = makeWorld('pistol');
  });

  it('쏘면 다음 틱에 조준이 pitchDeg 만큼 위로 밀린다', () => {
    firePistol();
    expect(world.weapon.mag).toBe(11);
    expect(world.player.recoilKickPitch).toBeCloseTo(PISTOL.recoil.pitchDeg * RAD, 6);
    expect(world.player.pitch).toBe(0); // 이 발은 원래 시선으로 나갔다
    PlayerMove.tick(world, DT);
    expect(world.player.pitch).toBeCloseTo(PISTOL.recoil.pitchDeg * RAD, 6);
    expect(world.player.recoilKickPitch).toBe(0);
  });

  it('연사하면 열이 쌓여 발마다 더 크게 튄다 — 쉬면 식어서 첫 발 크기로 돌아온다', () => {
    firePistol();
    const first = world.player.recoilKickPitch!;
    world.player.recoilKickPitch = 0;
    for (let i = 0; i < PISTOL.fireIntervalTicks; i++) Weapons.tick(world, DT); // 쿨다운만 소화 (열은 조금 식는다)
    firePistol();
    const second = world.player.recoilKickPitch!;
    expect(second).toBeGreaterThan(first);
    // 열은 상한이 있다 (발사 틱에 먼저 heatDecayPerTick 만큼 식은 뒤 쏜다)
    world.weapon.recoilHeat = PISTOL.recoil.heatMax;
    world.weapon.cooldown = 0;
    world.player.recoilKickPitch = 0;
    firePistol();
    expect(world.weapon.recoilHeat).toBe(PISTOL.recoil.heatMax);
    const heatAtShot = PISTOL.recoil.heatMax - PISTOL.recoil.heatDecayPerTick;
    expect(world.player.recoilKickPitch).toBeCloseTo(PISTOL.recoil.pitchDeg * (1 + heatAtShot * PISTOL.recoil.heatMul) * RAD, 6);
    // 한참 쉬면 식는다
    world.player.recoilKickPitch = 0;
    for (let i = 0; i < 400; i++) Weapons.tick(world, DT);
    expect(world.weapon.recoilHeat).toBe(0);
    firePistol();
    expect(world.player.recoilKickPitch).toBeCloseTo(first, 6);
  });

  it('밀린 조준은 되돌아온다 — recoverFrac 만큼만, 나머지는 남는다', () => {
    firePistol();
    PlayerMove.tick(world, DT);
    const kicked = world.player.pitch;
    settle(300);
    const residual = kicked * (1 - PISTOL.recoil.recoverFrac);
    expect(world.player.pitch).toBeLessThan(kicked);
    expect(world.player.pitch).toBeCloseTo(residual, 4);
    expect(world.player.recoilPitch).toBe(0);
  });
});

describe('활 반동', () => {
  beforeEach(() => {
    world = makeWorld('bow');
  });

  function loose(drawTicks: number): number {
    for (let i = 0; i < drawTicks; i++) {
      world.input = { ...Input.emptySnapshot(), rangedHeld: true };
      Weapons.tick(world, DT);
    }
    world.input = Input.emptySnapshot();
    Weapons.tick(world, DT);
    const kick = world.player.recoilKickPitch ?? 0;
    world.player.recoilKickPitch = 0;
    world.weapon.cooldown = 0;
    return kick;
  }

  it('살짝 당겨 쏘면 pitchDegMin, 끝까지 당겨 쏘면 pitchDegMax 만큼 튄다', () => {
    const weak = loose(BOW.minDrawTicks);
    expect(weak).toBeCloseTo(BOW.recoil.pitchDegMin * RAD, 6);
    const strong = loose(BOW.maxDrawTicks + 5);
    expect(strong).toBeCloseTo(BOW.recoil.pitchDegMax * RAD, 6);
    expect(strong).toBeGreaterThan(weak);
    expect(world.weapon.arrows).toBe(8);
  });

  it('덜 당기고 놓으면 화살도 반동도 없다', () => {
    const none = loose(BOW.minDrawTicks - 2);
    expect(none).toBe(0);
    expect(world.weapon.arrows).toBe(10);
  });
});
