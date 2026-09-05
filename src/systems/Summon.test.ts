// 몬스터 시험방 소환 — 시선 앞 부채꼴 배치 · noLoot · 종족별 목표 수 · 자동 재소환(규칙 A) · 모두 죽이기 · 초기화
import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Sigils from './Sigils';
import * as Summon from './Summon';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'hall', name: 'hall', cellSize: 4, ceiling: 4,
    grid: ['##########', '#........#', '#........#', '#........#', '#........#', '#........#', '#........#', '#........#', '#...S....#', '##########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const w = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 20, y: 0, z: 34, prevX: 20, prevY: 0, prevZ: 34,
      yaw: 0, pitch: 0, health: balance.player.healthMax, // yaw 0 → -Z 를 본다 (앞이 z 24~32)
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  w.monsterRoom = true;
  Summon.init(w);
  return w;
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('몬스터 시험방 소환', () => {
  it('n 마리가 시선 앞 부채꼴(2~10m) 바닥에 놓이고 전리품·경험치가 없다(noLoot)', () => {
    const cfg = balance.monsterRoom.summon;
    expect(Summon.summon(world, 'goblin_runner', 3)).toBe(3);
    expect(world.enemies).toHaveLength(3);
    for (const e of world.enemies) {
      expect(e.noLoot).toBe(true);
      const dx = e.x - world.player.x;
      const dz = e.z - world.player.z;
      const dist = Math.hypot(dx, dz);
      expect(dist).toBeGreaterThanOrEqual(cfg.minPlayerDist);
      expect(dist).toBeLessThanOrEqual(cfg.maxDist + 0.01);
      expect(dz).toBeLessThan(0); // 앞(-Z)
      expect(world.level.solidAt(Math.floor(e.x / 4), Math.floor(e.z / 4))).toBe(false);
    }
    expect(world.summonTargets.goblin_runner).toBe(3);
  });

  it('박쥐는 공중에서, 거머리는 바닥에서, 구울은 죽은 척 없이 시작한다', () => {
    Summon.summon(world, 'bat', 1);
    Summon.summon(world, 'leech', 1);
    Summon.summon(world, 'ghoul', 1);
    const bat = world.enemies.find((e) => e.type === 'bat')!;
    const leech = world.enemies.find((e) => e.type === 'leech')!;
    const ghoul = world.enemies.find((e) => e.type === 'ghoul')!;
    expect(bat.jumpY).toBeGreaterThan(0);
    expect(leech.lurking ?? false).toBe(false);
    expect(leech.jumpY ?? 0).toBe(0);
    expect(ghoul.feigning ?? false).toBe(false);
  });

  it('자동 소환 ON — 죽은 마리당 autoRespawnDelayTicks 뒤 같은 종족 1마리가 되채워진다 (규칙 A)', () => {
    Summon.summon(world, 'goblin_runner', 2);
    Summon.summon(world, 'bat', 1);
    world.summonAuto = true;
    const runner = world.enemies.find((e) => e.type === 'goblin_runner')!;
    runner.alive = false;
    world.events.emit('enemy_died', { enemyId: runner.id, enemyType: 'goblin_runner', x: runner.x, z: runner.z, noLoot: true });
    expect(world.summonQueue).toHaveLength(1);
    const delay = balance.monsterRoom.autoRespawnDelayTicks;
    for (let i = 0; i < delay - 1; i++) {
      world.tick++;
      Summon.tick(world, DT);
    }
    expect(world.enemies.filter((e) => e.alive && e.type === 'goblin_runner')).toHaveLength(1); // 아직
    world.tick++;
    Summon.tick(world, DT);
    expect(world.enemies.filter((e) => e.alive && e.type === 'goblin_runner')).toHaveLength(2); // 되채워졌다
    expect(world.enemies.filter((e) => e.alive && e.type === 'bat')).toHaveLength(1); // 다른 종족은 그대로
    expect(world.summonQueue).toHaveLength(0);
  });

  it('자동 소환 OFF 면 죽어도 대기열에 들지 않고, 소환하지 않은 종족의 죽음도 무시한다', () => {
    Summon.summon(world, 'goblin_runner', 1);
    world.events.emit('enemy_died', { enemyId: 1, enemyType: 'goblin_runner', x: 20, z: 28, noLoot: true });
    expect(world.summonQueue).toHaveLength(0);
    world.summonAuto = true;
    world.events.emit('enemy_died', { enemyId: 2, enemyType: 'slime', x: 20, z: 28, noLoot: true }); // 소환한 적 없는 종족
    expect(world.summonQueue).toHaveLength(0);
  });

  it('모두 죽이기는 enemy_died 를 내 자동 소환이 켜져 있으면 되살아나고, 초기화는 전부 비우고 자동 소환을 끈다', () => {
    Summon.summon(world, 'goblin_runner', 3);
    world.summonAuto = true;
    expect(Summon.killAll(world)).toBe(3);
    expect(world.enemies.every((e) => !e.alive)).toBe(true);
    expect(world.summonQueue).toHaveLength(3);
    world.tick += balance.monsterRoom.autoRespawnDelayTicks;
    Summon.tick(world, DT);
    expect(world.enemies.filter((e) => e.alive)).toHaveLength(3);
    Summon.reset(world);
    expect(world.enemies).toHaveLength(0);
    expect(world.summonQueue).toHaveLength(0);
    expect(world.summonTargets).toEqual({});
    expect(world.summonAuto).toBe(false);
  });

  it('시험방이 아니면 자동 소환 대기열·틱이 돌지 않는다', () => {
    Summon.summon(world, 'goblin_runner', 1);
    world.summonAuto = true;
    world.monsterRoom = false;
    world.events.emit('enemy_died', { enemyId: 1, enemyType: 'goblin_runner', x: 20, z: 28, noLoot: true });
    expect(world.summonQueue).toHaveLength(0);
  });
});
