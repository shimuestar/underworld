// 제단·오염 검증 — 상한 SET 보급(반직관 핵심), 공격성 보너스, 우회 계측, 정산·임계, 흉터.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Altar from './Altar';
import * as Corruption from './Corruption';
import * as Sigils from './Sigils';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['######', '#S.A.#', '######'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: 0, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { active: 'pistol', mag: 5, reserve: 12, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0 },
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
  Altar.init(world);
  Corruption.init(world);
  return world;
}

function pressInteract(world: World): void {
  world.input = { ...Input.emptySnapshot(), interactPressed: true };
  Altar.tick(world, DT);
  world.input = Input.emptySnapshot();
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('제단 보급', () => {
  it('잔탄과 무관하게 상한으로 SET — 더하기가 아니다 (하드 룰)', () => {
    world.player.x = world.level.altarPos!.x; // 제단 위
    world.player.z = world.level.altarPos!.z;
    Altar.tick(world, DT); // 접근 감지
    pressInteract(world);
    const pistol = balance.weapons.pistol;
    expect(world.weapon.mag).toBe(pistol.magSize);
    expect(world.weapon.reserve).toBe(pistol.ammoMax); // 5+12 잔탄은 그냥 사라진다
    expect(world.respawn).toEqual(world.level.altarPos);
  });

  it('공격성 보너스: 근접 위주 + 완벽 패링이면 상한 배율 상승, 진입 후 통계 리셋', () => {
    const stats = world.combatStats;
    stats.totalKills = 4;
    stats.meleeKills = 4; // meleeRatio 1.0 → 0.5
    stats.perfectParries = 10; // cap 도달 → 0.3
    stats.encounters = 2;
    stats.cleanEncounters = 2; // → 0.2
    expect(Altar.aggressionMultiplier(world)).toBeCloseTo(
      balance.altar.aggressionBonus.maxMultiplier,
    );

    world.player.x = world.level.altarPos!.x;
    world.player.z = world.level.altarPos!.z;
    Altar.tick(world, DT);
    pressInteract(world);
    expect(world.weapon.reserve).toBe(
      Math.round(balance.weapons.pistol.ammoMax * balance.altar.aggressionBonus.maxMultiplier),
    );
    expect(world.combatStats.totalKills).toBe(0); // 누적되지 않는다
  });

  it('접근 후 진입 없이 벗어나면 altar_bypassed', () => {
    const bypassed: unknown[] = [];
    world.events.on('altar_bypassed', (payload) => bypassed.push(payload));

    world.player.x = world.level.altarPos!.x;
    world.player.z = world.level.altarPos!.z;
    Altar.tick(world, DT); // 접근
    world.player.x = 6; // 멀어짐
    Altar.tick(world, DT);
    expect(bypassed).toHaveLength(1);
    expect(bypassed[0]).toMatchObject({
      ammoLeftRatio: (5 + 12) / (balance.weapons.pistol.magSize + balance.weapons.pistol.ammoMax),
    });
  });
});

describe('오염 정산과 임계', () => {
  it('제단 진입 시 pending → applied, corruption_applied 발행', () => {
    world.corruption.pending = 13;
    world.player.x = world.level.altarPos!.x;
    world.player.z = world.level.altarPos!.z;
    Altar.tick(world, DT);
    pressInteract(world);
    expect(world.corruption.applied).toBe(13);
    expect(world.corruption.pending).toBe(0);
  });

  it('임계 25를 넘는 순간 corruption_threshold + 문자 해독 활성화', () => {
    const thresholds: unknown[] = [];
    world.events.on('corruption_threshold', (payload) => thresholds.push(payload));
    world.corruption.applied = 20;
    world.corruption.pending = 10;
    Corruption.settle(world);
    expect(thresholds).toEqual([{ threshold: 25 }]);
    expect(world.canReadGlyphs).toBe(true);
  });

  it('임계는 걸치지 않으면 발행되지 않는다', () => {
    const thresholds: unknown[] = [];
    world.events.on('corruption_threshold', (payload) => thresholds.push(payload));
    world.corruption.applied = 26;
    world.corruption.pending = 5;
    Corruption.settle(world);
    expect(thresholds).toHaveLength(0);
  });
});

describe('흉터', () => {
  it('해제 시 페널티 절반 잔존, 재부착/해제해도 무한히 쌓이지 않는다', () => {
    world.sigils.inventory.push('sig_fireball');
    Sigils.attach(world, 'sig_fireball');
    const fullPenalty = world.modifiers.reloadTimeMul;

    Sigils.detach(world, 'rightArm');
    const scarPenalty = world.modifiers.reloadTimeMul;
    expect(scarPenalty).toBeCloseTo(1 + (fullPenalty - 1) * balance.sigil.scarRatio);
    expect(scarPenalty).toBeGreaterThan(1);

    Sigils.attach(world, 'sig_fireball');
    expect(world.modifiers.reloadTimeMul).toBeCloseTo(fullPenalty); // 부착 중엔 전체
    Sigils.detach(world, 'rightArm');
    expect(world.modifiers.reloadTimeMul).toBeCloseTo(scarPenalty); // 그대로
    expect(world.sigils.scars.rightArm).toBe(balance.sigil.scarRatio);
  });
});
