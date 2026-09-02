// 함정 — 상태 머신(예고 틱), 가시(막기 불가·회피 무적·적 피해·재무장), 다트(3발·반사 가능·
// 오사 감쇄 없음·장전 유한), 적 트리거 제외 규칙, 소음이 닫힌 문을 못 넘는 것.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState, type TrapState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Projectiles from './Projectiles';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';
import * as Stamina from './Stamina';
import * as Traps from './Traps';

const DT = 1 / 60;
const T = balance.traps.types;

/** 한 줄 복도. door=true 면 col 8 에 닫힌 문 — 소음 차단 검증용 */
function makeWorld(door = false): World {
  const mid = door ? '#S' + '.'.repeat(6) + 'D' + '.'.repeat(10) + '#' : '#S' + '.'.repeat(17) + '#';
  const level = new Level({
    id: 'traprange',
    name: 'traprange',
    cellSize: 4,
    ceiling: 4,
    grid: ['#'.repeat(20), mid, '#'.repeat(20)],
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: -Math.PI / 2, pitch: 0, health: balance.player.healthMax, // +X 를 본다
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
  Stamina.init(world);
  return world;
}

let nextId = 1;
function putTrap(world: World, type: string, x: number, z: number, dir: 'N' | 'S' | 'E' | 'W' = 'N'): TrapState {
  const vec = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[dir];
  const cfg = (T as unknown as Record<string, { charges: number }>)[type]!;
  const trap: TrapState = {
    id: nextId++, type, x, z, row: Math.floor(z / 4), col: Math.floor(x / 4),
    phase: 'armed', timer: 0, charges: cfg.charges, dirX: vec[0]!, dirZ: vec[1]!,
  };
  world.traps.push(trap);
  return trap;
}

function addEnemy(world: World, type: string, x: number, z: number): EnemyState {
  const e = spawnEnemyAt(type, x, z, 7000 + world.enemies.length);
  world.enemies.push(e);
  return e;
}

function tickTraps(world: World, n: number): void {
  for (let i = 0; i < n; i++) Traps.tick(world, DT);
}

describe('함정 — 가시 압력판', () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
  });

  it('밟으면 딸깍 예고 뒤 정확히 telegraphTicks 틱에 가시가 솟는다 — 막아도 그대로 28', () => {
    const trap = putTrap(world, 'trap_spike', 6, 6); // 플레이어 발밑
    const log: string[] = [];
    world.events.on('trap_triggered', () => log.push('trig'));
    world.events.on('trap_telegraph', () => log.push('tele'));
    world.events.on('trap_fired', () => log.push('fire'));
    world.player.blocking = true; // 방패를 들고 있어도 아래서 온다
    tickTraps(world, 1);
    expect(log).toEqual(['trig', 'tele']);
    expect(trap.phase).toBe('telegraph');
    tickTraps(world, T.trap_spike.telegraphTicks - 1);
    expect(log).toEqual(['trig', 'tele']); // 아직
    tickTraps(world, 1);
    expect(log).toEqual(['trig', 'tele', 'fire']);
    expect(world.player.health).toBe(balance.player.healthMax - T.trap_spike.damage);
    expect(trap.phase).toBe('firing');
  });

  it('회피 무적(iframe) 중에는 안 맞는다, 피해 source 는 trap_spike', () => {
    putTrap(world, 'trap_spike', 6, 6);
    const sources: string[] = [];
    world.events.on('player_damaged', (p) => sources.push((p as { source: string }).source));
    world.player.iframeTicks = 999;
    tickTraps(world, T.trap_spike.telegraphTicks + 1);
    expect(world.player.health).toBe(balance.player.healthMax);
    world.player.iframeTicks = 0;
    // 재무장 뒤 다시 밟는다
    tickTraps(world, T.trap_spike.upTicks + T.trap_spike.cooldownTicks + T.trap_spike.telegraphTicks + 2);
    expect(sources).toEqual(['trap_spike']);
  });

  it('적도 걸린다 — enemyDamage, 피해 숫자, 처치는 trap_kill + enemy_died(마나 없음), 쿨 뒤 재무장', () => {
    const trap = putTrap(world, 'trap_spike', 30, 6);
    const e = addEnemy(world, 'goblin_runner', 30, 6);
    e.ai = 'chase';
    const hp = e.health;
    const ev: string[] = [];
    world.events.on('damage_pop', () => ev.push('pop'));
    world.events.on('trap_kill', () => ev.push('kill'));
    world.events.on('enemy_died', (p) => ev.push(`died:${(p as { enemyId?: number }).enemyId}`));
    world.events.on('melee_kill', () => ev.push('MANA!'));
    world.events.on('weapon_kill', () => ev.push('WEAPON!'));
    tickTraps(world, T.trap_spike.telegraphTicks + 1);
    if (hp > T.trap_spike.enemyDamage) {
      expect(e.health).toBeCloseTo(hp - T.trap_spike.enemyDamage, 5);
      expect(ev).toEqual(['pop']);
    } else {
      expect(e.alive).toBe(false);
      expect(ev).toEqual(['pop', 'kill', `died:${e.id}`]);
    }
    // 가시가 내려가고 쿨이 돌면 다시 armed
    tickTraps(world, T.trap_spike.upTicks);
    expect(trap.phase).toBe('cooldown');
    tickTraps(world, T.trap_spike.cooldownTicks);
    expect(trap.phase).toBe('armed');
    expect(trap.charges).toBe(-1); // 무한
  });

  it('보스는 bossDamageMul 만큼만 받는다', () => {
    putTrap(world, 'trap_spike', 30, 6);
    const boss = addEnemy(world, 'goblin_chieftain', 30, 6);
    const hp = boss.health;
    tickTraps(world, T.trap_spike.telegraphTicks + 1);
    expect(boss.health).toBeCloseTo(hp - T.trap_spike.enemyDamage * T.trap_spike.bossDamageMul, 5);
  });

  it('천장 거머리·죽은 척 구울·공중·매달린 놈은 판을 못 밟는다', () => {
    const trap = putTrap(world, 'trap_spike', 30, 6);
    const leech = addEnemy(world, 'leech', 30, 6);
    leech.lurking = true;
    const ghoul = addEnemy(world, 'ghoul', 30, 6);
    ghoul.feigning = true;
    const bat = addEnemy(world, 'bat', 30, 6);
    bat.jumpY = balance.flyoverHeight + 1;
    const latched = addEnemy(world, 'leech', 30, 6);
    latched.ai = 'latched';
    tickTraps(world, 5);
    expect(trap.phase).toBe('armed');
    // 걸을 수 있는 놈이 오면 즉시
    addEnemy(world, 'goblin_runner', 30, 6);
    tickTraps(world, 1);
    expect(trap.phase).toBe('telegraph');
    expect(trap.triggeredBy).toBe('enemy');
  });

  it('그림자 질주 중엔 무게가 없다 — 판이 눌리지 않는다', () => {
    const trap = putTrap(world, 'trap_spike', 6, 6);
    world.player.blinkLeft = 5;
    tickTraps(world, 3);
    expect(trap.phase).toBe('armed');
  });
});

describe('함정 — 다트 벽', () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
  });

  it('예고 뒤 다트 dartCount 발 — 적 소유·반사 가능·trapShot·화살 종. 장전 charges 회 뒤 spent', () => {
    const trap = putTrap(world, 'trap_dart', 30, 6, 'W'); // 서쪽(플레이어 쪽)으로 난다
    const spent: string[] = [];
    world.events.on('trap_spent', () => spent.push('spent'));
    // 1회: 적이 밟는다
    const e = addEnemy(world, 'goblin_runner', 30, 6);
    tickTraps(world, T.trap_dart.telegraphTicks + 1);
    const darts = world.projectiles.filter((pr) => pr.trapShot);
    expect(darts).toHaveLength(T.trap_dart.dartCount);
    for (const d of darts) {
      expect(d.owner).toBe('enemy');
      expect(d.deflectable).toBe(true);
      expect(d.kind).toBe('arrow');
      expect(d.vx).toBeLessThan(0); // -X 로 난다
    }
    expect(trap.charges).toBe(T.trap_dart.charges - 1);
    expect(trap.phase).toBe('cooldown');
    // 2회: 쿨 뒤 여전히 밟고 있으면 또 — 그리고 빈 노즐
    world.projectiles.length = 0;
    e.x = 30;
    tickTraps(world, T.trap_dart.cooldownTicks + T.trap_dart.telegraphTicks + 1);
    expect(world.projectiles.filter((pr) => pr.trapShot)).toHaveLength(T.trap_dart.dartCount);
    expect(trap.phase).toBe('spent');
    expect(spent).toEqual(['spent']);
    tickTraps(world, T.trap_dart.cooldownTicks + 30);
    expect(trap.phase).toBe('spent'); // 재장전 없음
  });

  it('다트가 적을 맞히면 오사 감쇄 없이 풀 피해 + 피해 숫자, 처치는 trap_kill', () => {
    // 노즐(x=32 근처)에서 -X 로 나가 30 에 서 있는 적을 곧장 맞힌다
    putTrap(world, 'trap_dart', 30, 6, 'W');
    const e = addEnemy(world, 'goblin_runner', 30, 6);
    e.ai = 'chase';
    const hp = e.health;
    const pops: number[] = [];
    world.events.on('damage_pop', (p) => pops.push((p as { amount: number }).amount));
    tickTraps(world, T.trap_dart.telegraphTicks + 1);
    for (let i = 0; i < 20; i++) Projectiles.tick(world, DT);
    expect(pops.length).toBeGreaterThan(0);
    expect(pops[0]).toBeCloseTo(T.trap_dart.damage, 5); // 0.4 배 오사 감쇄가 아니다
    expect(e.health).toBeLessThanOrEqual(hp - T.trap_dart.damage);
  });

  it('플레이어가 방패를 들면 화살 종은 완전히 막힌다(chip 0), 안 들면 8 씩', () => {
    const trap = putTrap(world, 'trap_dart', 12, 6, 'W'); // 노즐 x≈14 → 플레이어(6)로 6m
    const hits: string[] = [];
    world.events.on('player_damaged', (p) => hits.push(String((p as { blocked?: boolean }).blocked)));
    world.events.on('block_hit', () => hits.push('block'));
    trap.phase = 'telegraph';
    trap.timer = 1;
    world.player.blocking = true;
    tickTraps(world, 1);
    for (let i = 0; i < 40; i++) Projectiles.tick(world, DT);
    expect(world.player.health).toBe(balance.player.healthMax);
    expect(hits.some((h) => h === 'block')).toBe(true);
  });

  it('반사 — 시전자 없는 다트도 반응 버튼에 되돌아간다 (owner 가 player 로)', () => {
    const trap = putTrap(world, 'trap_dart', 12, 6, 'W');
    trap.phase = 'telegraph';
    trap.timer = 1;
    tickTraps(world, 1);
    // 반응 반경(4.6m) 안까지 날아오길 기다린다
    for (let i = 0; i < 30; i++) {
      Projectiles.tick(world, DT);
      const d = world.projectiles.find((pr) => pr.trapShot);
      if (d && Math.hypot(d.x - 6, d.z - 6) <= balance.reaction.radius) break;
    }
    const before = world.projectiles.filter((pr) => pr.trapShot);
    expect(before.length).toBeGreaterThan(0);
    world.input = { ...Input.emptySnapshot(), reactionPressed: true };
    Reaction.tick(world, DT);
    world.input = Input.emptySnapshot();
    const deflected = world.projectiles.find((pr) => pr.trapShot && pr.owner === 'player');
    expect(deflected).toBeTruthy();
    expect(deflected!.vx).toBeGreaterThan(0); // 되돌아간다
  });
});

describe('함정 — 소음', () => {
  it('작동음은 열린 칸을 따라 퍼진다 — 닫힌 문 너머 대기 적은 못 듣는다', () => {
    // 문 없는 복도: 다트(x=30) 소음 8m — 38 의 적이 깬다
    const open = makeWorld(false);
    putTrap(open, 'trap_dart', 30, 6, 'W');
    const trigger = addEnemy(open, 'goblin_runner', 30, 6);
    trigger.ai = 'chase';
    const listener = addEnemy(open, 'goblin_runner', 38, 6);
    listener.homeYaw = 0;
    tickTraps(open, T.trap_dart.telegraphTicks + 1);
    expect(listener.ai).toBe('chase');
    // 닫힌 문(col 8 = x 32~36) 이 사이에 있으면 못 듣는다
    const doored = makeWorld(true);
    putTrap(doored, 'trap_dart', 30, 6, 'W');
    const t2 = addEnemy(doored, 'goblin_runner', 30, 6);
    t2.ai = 'chase';
    const deaf = addEnemy(doored, 'goblin_runner', 38, 6);
    deaf.homeYaw = 0;
    tickTraps(doored, T.trap_dart.telegraphTicks + 1);
    expect(deaf.ai).toBe('idle');
  });
});
