// NPC(로비의 사제·상인) — 접근·시선 규약, 상호작용 이벤트, 사제의 축복.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { damagePlayer, World } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnNpcs } from '../level/Spawner';
import * as Sigils from './Sigils';
import * as Npc from './Npc';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'lobby-test',
    name: 'lobby-test',
    cellSize: 4,
    ceiling: 6,
    grid: ['#######', '#S....#', '#.....#', '#######'],
    lighting: { ambient: 0.6, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: 0, pitch: 0, health: 40,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 5, reserve: 12, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  // 사제 [1,3] (x=14,z=6) 남쪽을 본다 / 상인 [2,5] (x=22,z=10) 서쪽을 본다
  world.npcs = spawnNpcs(
    [
      { type: 'npc_priest', cell: [1, 3], facing: 'S' } as never,
      { type: 'npc_merchant', cell: [2, 5], facing: 'W' } as never,
    ],
    level,
  );
  return world;
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

function press(): string[] {
  const talked: string[] = [];
  world.events.on('npc_talked', (p) => talked.push((p as { kind: string }).kind));
  world.input = { ...Input.emptySnapshot(), interactPressed: true };
  Npc.tick(world, DT);
  world.input = Input.emptySnapshot();
  return talked;
}

describe('NPC 스폰', () => {
  it('npc_* 배치가 종류·자리·방향으로 서고, 몸으로 막는 차단 상자를 남긴다', () => {
    expect(world.npcs.map((n) => n.kind)).toEqual(['priest', 'merchant']);
    const priest = world.npcs[0]!;
    expect(priest.x).toBe(14);
    expect(priest.z).toBe(6);
    // facing S = (0,+1) → yaw = atan2(0, -1) = π
    expect(Math.abs(Math.abs(priest.yaw) - Math.PI)).toBeLessThan(1e-9);
    const body = { x: 10, z: 6 };
    world.level.slideMove(body, 0.4, 6, 0); // 사제를 향해 6m
    expect(body.x).toBeLessThan(14 - balance.lobby.npc.collisionRadius - 0.4 + 0.01);
  });
});

describe('접근·상호작용', () => {
  it('반경 안에서 바라보면 npcInView, 상호작용을 누르면 npc_talked(kind)', () => {
    world.player.x = 14 - 1.5;
    world.player.z = 6;
    world.player.yaw = -Math.PI / 2; // +X 를 본다
    Npc.tick(world, DT);
    expect(world.npcInView?.kind).toBe('priest');
    expect(press()).toEqual(['priest']);
  });

  it('등지면 대상이 아니다 — 눌러도 아무 일 없다', () => {
    world.player.x = 14 - 1.5;
    world.player.z = 6;
    world.player.yaw = Math.PI / 2; // -X 를 본다 (등짐)
    Npc.tick(world, DT);
    expect(world.npcInView).toBeNull();
    expect(press()).toEqual([]);
  });

  it('반경 밖이면 대상이 아니다', () => {
    world.player.x = 14 - balance.lobby.npc.radius - 0.5;
    world.player.z = 6;
    world.player.yaw = -Math.PI / 2;
    Npc.tick(world, DT);
    expect(world.npcInView).toBeNull();
  });

  it('창이 열려 있거나 죽었으면 상호작용이 새지 않는다', () => {
    world.player.x = 14 - 1.5;
    world.player.z = 6;
    world.player.yaw = -Math.PI / 2;
    world.uiOpen = true;
    expect(press()).toEqual([]);
    world.uiOpen = false;
    world.dead = true;
    expect(press()).toEqual([]);
  });
});

describe('사제의 축복', () => {
  it('체력·마나를 가득 채우고 독·상태를 씻고, durationTicks 동안 받는 피해가 damageTakenMul 배', () => {
    const b = balance.lobby.blessing;
    world.player.dots = { poison: { ticks: 100, perTick: 1 } } as never;
    world.gold = b.cost;
    const events: string[] = [];
    world.events.on('blessed', () => events.push('blessed'));
    expect(Npc.bless(world)).toBe(true);
    expect(events).toEqual(['blessed']);
    expect(world.player.health).toBe(balance.player.healthMax);
    expect(world.mana.value).toBe(balance.mana.max);
    expect(world.player.dots).toEqual({});
    expect(world.blessingTicks).toBe(b.durationTicks);
    expect(world.gold).toBe(0);
    const applied = damagePlayer(world, 10);
    expect(applied).toBeCloseTo(10 * b.damageTakenMul, 6);
  });

  it('축복은 틱마다 줄고 0 이 되는 틱에 blessing_ended — 그 뒤 피해는 원래대로', () => {
    Npc.bless(world);
    const ended: number[] = [];
    world.events.on('blessing_ended', () => ended.push(world.blessingTicks));
    world.blessingTicks = 2;
    Npc.tick(world, DT);
    expect(ended).toEqual([]);
    Npc.tick(world, DT);
    expect(ended).toEqual([0]);
    expect(damagePlayer(world, 10)).toBe(10);
  });

  it('값이 있으면 골드가 모자라면 거절 — blessing_denied, 체력 그대로', () => {
    (balance.lobby.blessing as { cost: number }).cost = 30;
    try {
      world.gold = 10;
      const denied: number[] = [];
      world.events.on('blessing_denied', (p) => denied.push((p as { cost: number }).cost));
      expect(Npc.bless(world)).toBe(false);
      expect(denied).toEqual([30]);
      expect(world.player.health).toBe(40);
      expect(world.gold).toBe(10);
    } finally {
      (balance.lobby.blessing as { cost: number }).cost = 0;
    }
  });
});
