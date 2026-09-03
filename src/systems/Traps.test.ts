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

  it('밟고 1초 안에 벗어나면(뛰기·대시) 안 맞는다 — 가시는 빈 판 위로 솟는다', () => {
    const trap = putTrap(world, 'trap_spike', 6, 6);
    tickTraps(world, 1);
    expect(trap.phase).toBe('telegraph');
    world.player.x = 6 + T.trap_spike.hitRadius + 0.5; // 뛰어서 벗어났다
    tickTraps(world, T.trap_spike.telegraphTicks);
    expect(trap.phase).toBe('firing');
    expect(world.player.health).toBe(balance.player.healthMax);
  });

  it('대시(회피)·그림자 이동으로 지나가는 몸은 판을 누르지 않는다', () => {
    const trap = putTrap(world, 'trap_spike', 6, 6);
    world.player.dodgeTicks = 4;
    tickTraps(world, 3);
    expect(trap.phase).toBe('armed');
    world.player.dodgeTicks = 0;
    world.player.blinkLeft = 5;
    tickTraps(world, 3);
    expect(trap.phase).toBe('armed');
    world.player.blinkLeft = 0;
    tickTraps(world, 1);
    expect(trap.phase).toBe('telegraph'); // 그냥 걸으면 눌린다
  });

  it('서 있는 가시에 들어가면 대시 무적도 소용없다(몸당 1회, 나갔다 오면 또), 그림자 이동만 면제', () => {
    const trap = putTrap(world, 'trap_spike', 30, 6);
    const trigger = addEnemy(world, 'goblin_runner', 30, 6);
    trigger.ai = 'chase';
    tickTraps(world, T.trap_spike.telegraphTicks + 1);
    expect(trap.phase).toBe('firing');
    const sources: string[] = [];
    world.events.on('player_damaged', (p) => sources.push((p as { source: string }).source));
    // 대시 무적을 켜고 들어간다 — 그래도 맞는다
    world.player.iframeTicks = 8;
    world.player.x = 30;
    tickTraps(world, 5);
    expect(sources).toEqual(['trap_spike']);
    // 서 있어도 더는 안 맞는다
    tickTraps(world, 30);
    expect(sources).toHaveLength(1);
    // 나갔다 다시 들어오면 또
    world.player.x = 6;
    tickTraps(world, 2);
    world.player.x = 30;
    tickTraps(world, 2);
    expect(sources).toHaveLength(2);
    // 그림자 이동으로 통과 — 면제
    world.player.x = 6;
    tickTraps(world, 2);
    world.player.blinkLeft = 3;
    world.player.x = 30;
    tickTraps(world, 2);
    expect(sources).toHaveLength(2);
  });

  it('회수 중(cooldown)에는 밟아도 피해·재트리거가 없고, 걸쇠가 물린 뒤에야 다시 밟힌다', () => {
    const trap = putTrap(world, 'trap_spike', 6, 6);
    world.player.x = 6;
    tickTraps(world, T.trap_spike.telegraphTicks + 1); // 솟음 — 1회 피해
    const hp = world.player.health;
    world.player.x = 20;
    tickTraps(world, T.trap_spike.upTicks); // 5초 뒤 회수 시작
    expect(trap.phase).toBe('cooldown');
    world.player.x = 6; // 들어가는 도중 밟는다
    tickTraps(world, T.trap_spike.cooldownTicks - 1);
    expect(world.player.health).toBe(hp);
    expect(trap.phase).toBe('cooldown');
    tickTraps(world, 1); // 걸쇠 철컥 — armed
    expect(trap.phase).toBe('armed');
    tickTraps(world, 1); // 서 있으니 다시 눌린다
    expect(trap.phase).toBe('telegraph');
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
    // 가시가 내려가고(회수 소리) 쿨이 돌면 다시 armed(재장전 소리)
    const cycle: string[] = [];
    world.events.on('trap_retract', () => cycle.push('retract'));
    world.events.on('trap_rearmed', () => cycle.push('rearmed'));
    tickTraps(world, T.trap_spike.upTicks);
    expect(trap.phase).toBe('cooldown');
    expect(cycle).toEqual(['retract']);
    tickTraps(world, T.trap_spike.cooldownTicks);
    expect(trap.phase).toBe('armed');
    expect(cycle).toEqual(['retract', 'rearmed']);
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

describe('함정 — 그물 덫', () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
  });

  it('밟으면 플레이어는 거미줄 상태(web_caught 1회), 적은 완전 둔화, 1회용', () => {
    const trap = putTrap(world, 'trap_net', 6, 6, 'E');
    const e = addEnemy(world, 'goblin_runner', 6.5, 6);
    const caught: number[] = [];
    world.events.on('web_caught', (p) => caught.push((p as { swings: number }).swings));
    tickTraps(world, 1);
    expect(caught).toEqual([balance.web.breakSwings]);
    expect(world.player.webSwingsLeft).toBe(balance.web.breakSwings);
    expect(e.slowTicks).toBe(T.trap_net.enemySlowTicks);
    expect(e.slowMul).toBe(T.trap_net.enemySlowMul);
    expect(trap.phase).toBe('firing'); // 떨어지는 연출 시간
    tickTraps(world, T.trap_net.dropTicks + 1);
    expect(trap.phase).toBe('spent');
    expect(caught).toHaveLength(1); // 한 번만
  });

  it('서리가 쌓인 적은 함정 둔화가 덮지 않는다 — 서리 콤보를 깎아먹지 않게', () => {
    putTrap(world, 'trap_net', 30, 6, 'E');
    const e = addEnemy(world, 'goblin_runner', 30, 6);
    e.frostStacks = 2;
    e.slowTicks = 40;
    e.slowMul = 0.7;
    tickTraps(world, 1);
    expect(e.slowTicks).toBe(40);
    expect(e.slowMul).toBe(0.7);
  });

  it('해머로 줄을 끊으면 해체된다 — 그 뒤엔 밟아도 안 떨어진다', async () => {
    const Weapons = await import('./Weapons');
    const trap = putTrap(world, 'trap_net', 7.6, 6, 'E'); // 정면 1.6m
    const ev: string[] = [];
    world.events.on('trap_disarmed', (p) => ev.push((p as { how: string }).how));
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    for (let i = 0; i < 30 && trap.phase === 'armed'; i++) {
      world.input = Input.emptySnapshot();
      Weapons.tick(world, DT);
    }
    expect(trap.phase).toBe('disarmed');
    expect(ev).toEqual(['hammer']);
    world.player.x = 7.6; // 밟아도
    tickTraps(world, 5);
    expect(trap.phase).toBe('disarmed');
    expect(world.player.webSwingsLeft ?? 0).toBe(0);
  });
});

describe('함정 — 기름 웅덩이', () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
  });

  it('밟는 것으론 안 터진다 — 폭발이 닿으면 붙고, burnTicks 뒤 다 탄다', async () => {
    const { explodeAt } = await import('../core/Explosion');
    const oil = putTrap(world, 'trap_oil', 30, 6);
    world.player.x = 30;
    tickTraps(world, 10);
    expect(oil.phase).toBe('armed');
    world.player.x = 6;
    const ev: string[] = [];
    world.events.on('trap_ignited', () => ev.push('ignite'));
    explodeAt(world, 33, 6, {
      radius: 5, damage: 0, damageFalloffMin: 1, enemyKnockback: 0,
      playerKnockback: 0, playerKnockbackTicks: 0, noiseRadius: 0, fxHeight: 0.5,
    });
    expect(oil.phase).toBe('firing');
    expect(ev).toEqual(['ignite']);
    tickTraps(world, T.trap_oil.burnTicks);
    expect(oil.phase).toBe('spent');
  });

  it('불타는 적이 밟으면 옮겨붙고, 타는 기름은 근처 기름으로 연쇄한다', () => {
    const a = putTrap(world, 'trap_oil', 30, 6);
    const b = putTrap(world, 'trap_oil', 32, 6); // chainRadius 2.5 안
    const far = putTrap(world, 'trap_oil', 50, 6);
    const e = addEnemy(world, 'goblin_runner', 30, 6);
    e.burnTicks = 60;
    tickTraps(world, 1);
    expect(a.phase).toBe('firing');
    tickTraps(world, 1);
    expect(b.phase).toBe('firing');
    expect(far.phase).toBe('armed');
  });

  it('화염 지대 — 플레이어는 간격마다 4(막기 불가·source trap_fire), 적은 화상이 붙는다', () => {
    const oil = putTrap(world, 'trap_oil', 6, 6);
    oil.phase = 'firing';
    oil.timer = T.trap_oil.burnTicks;
    world.player.blocking = true;
    const srcs: string[] = [];
    world.events.on('player_damaged', (p) => srcs.push((p as { source: string }).source));
    const e = addEnemy(world, 'goblin_runner', 6.5, 6);
    tickTraps(world, T.trap_oil.playerDamageIntervalTicks * 2);
    expect(srcs.length).toBe(2);
    expect(srcs[0]).toBe('trap_fire');
    expect(world.player.health).toBe(balance.player.healthMax - T.trap_oil.playerDamagePerHit * 2);
    expect(e.burnTicks).toBeGreaterThan(0);
    expect(e.burnDamagePerTick).toBe(T.trap_oil.enemyBurnDamagePerTick);
  });

  it('둔화 — 기름 위에서 느리고, 점액과 겹쳐도 더 센 하나만 (곱하지 않는다)', async () => {
    const PlayerMove = await import('./PlayerMove');
    world.stamina.value = 100;
    const run = (oil: boolean, goo: boolean): number => {
      world.player.x = 20; world.player.z = 6; world.player.prevX = 20; world.player.prevZ = 6;
      world.traps = oil ? [{ id: 900, type: 'trap_oil', x: 20, z: 6, row: 1, col: 5, phase: 'armed', timer: 0, charges: -1, dirX: 0, dirZ: -1 }] : [];
      world.gooPuddles = goo ? [{ id: 1, x: 20, z: 6, ticks: 600 }] : [];
      world.input = { ...Input.emptySnapshot(), moveForward: 1 };
      for (let i = 0; i < 3; i++) PlayerMove.tick(world, DT);
      world.input = Input.emptySnapshot();
      return Math.hypot(world.player.x - 20, world.player.z - 6);
    };
    const free = run(false, false);
    const oiled = run(true, false);
    const both = run(true, true);
    expect(oiled).toBeLessThan(free * 0.7);
    expect(both).toBeCloseTo(Math.min(oiled, run(false, true)), 4); // 하나만
  });
});

describe('함정 — 저주 문양', () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
  });

  it('플레이어가 밟으면 오염 pending 만 오르고 피해·연쇄 끊김은 없다, 시야가 흔들린다, 1회용', () => {
    const g = putTrap(world, 'trap_glyph', 6, 6);
    const dmg: unknown[] = [];
    world.events.on('player_damaged', (p) => dmg.push(p));
    const burst: string[] = [];
    world.events.on('trap_glyph_burst', (p) => burst.push((p as { victim: string }).victim));
    tickTraps(world, 1);
    expect(world.corruption.pending).toBe(T.trap_glyph.corruptionPending);
    expect(dmg).toHaveLength(0);
    expect(world.player.aimShakeTicks).toBe(T.trap_glyph.shakeTicks);
    expect(burst).toEqual(['player']);
    expect(g.phase).toBe('spent');
    tickTraps(world, 5);
    expect(world.corruption.pending).toBe(T.trap_glyph.corruptionPending); // 한 번만
  });

  it('적이 밟으면 경직 — 처형 대상이 된다. 보스는 절반', () => {
    putTrap(world, 'trap_glyph', 30, 6);
    const e = addEnemy(world, 'goblin_runner', 30, 6);
    e.ai = 'windup';
    e.attackFreezeTicks = 20;
    tickTraps(world, 1);
    expect(e.ai).toBe('staggered');
    expect(e.timer).toBe(T.trap_glyph.enemyStaggerTicks);
    expect(e.attackFreezeTicks).toBe(0);
    putTrap(world, 'trap_glyph', 40, 6);
    const boss = addEnemy(world, 'goblin_chieftain', 40, 6);
    tickTraps(world, 1);
    expect(boss.ai).toBe('staggered');
    expect(boss.timer).toBe(Math.round(T.trap_glyph.enemyStaggerTicks * T.trap_glyph.bossStaggerMul));
  });

  it('비명이 10m 안 대기 적을 깨운다', () => {
    putTrap(world, 'trap_glyph', 6, 6);
    const far = addEnemy(world, 'goblin_runner', 14, 6); // 8m
    far.homeYaw = 0;
    tickTraps(world, 1);
    expect(far.ai).toBe('chase');
  });
});

describe('함정 — 독가스 배기구', () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
  });

  it('다가가면 쉬익 뒤 구름 — 안에서는 스태미너가 닳고 시야가 흔들리고 기침이 적을 깨운다, 피해 0', () => {
    const gas = putTrap(world, 'trap_gas', 6, 6);
    const listener = addEnemy(world, 'goblin_runner', 11, 6); // 5m — 기침 소음 6m 안, 배기구 소음 4m 밖
    listener.homeYaw = 0;
    const coughs: number[] = [];
    world.events.on('trap_gas_cough', () => coughs.push(1));
    world.stamina.value = 100;
    tickTraps(world, 1);
    expect(gas.phase).toBe('telegraph');
    tickTraps(world, T.trap_gas.telegraphTicks);
    expect(gas.phase).toBe('firing');
    tickTraps(world, T.trap_gas.coughIntervalTicks * 2);
    expect(world.stamina.value).toBeLessThan(100 - T.trap_gas.staminaDrainPerTick * 60);
    expect(world.player.aimShakeTicks).toBeGreaterThan(0);
    expect(coughs.length).toBeGreaterThanOrEqual(2);
    expect(listener.ai).toBe('chase'); // 기침을 들었다
    // 구름 자체는 피해가 없다 — 깎인 건 독의 초기 피해(+ 미세 도트)만
    expect(world.player.health).toBeLessThanOrEqual(balance.player.healthMax - T.trap_gas.poisonInitial);
    expect(world.player.health).toBeGreaterThan(balance.player.healthMax - T.trap_gas.poisonInitial - 1);
  });

  it('구름 안의 적은 경둔화, 구름이 걷히면 식물은 시든 채 남는다(1회성)', () => {
    const gas = putTrap(world, 'trap_gas', 30, 6);
    const e = addEnemy(world, 'goblin_runner', 30.5, 6);
    tickTraps(world, T.trap_gas.telegraphTicks + 2);
    expect(e.slowMul).toBe(T.trap_gas.enemySlowMul);
    tickTraps(world, T.trap_gas.cloudTicks);
    expect(gas.phase).toBe('spent'); // 한 번 터진 식물은 끝 — 다시 피지 않는다
    tickTraps(world, 120);
    expect(gas.phase).toBe('spent');
  });
});

describe('함정 — 낙석', () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
  });

  it('우르릉 뒤 반경 안 전원 감쇠 피해 — 인접 칸(4m)은 맞고 대각(5.7m)은 안 맞는다. 잔해가 몸·경로를 막는다', () => {
    const rock = putTrap(world, 'trap_rockfall', 30, 6, 'N');
    const near = addEnemy(world, 'goblin_runner', 34, 6); // 4m
    const nearHp = near.health;
    const diag = addEnemy(world, 'goblin_runner', 34, 10); // 5.66m — 벽 안이지만 판정만 본다
    const diagHp = diag.health;
    world.player.x = 30;
    const before = world.level.props.length;
    tickTraps(world, 1);
    expect(rock.phase).toBe('telegraph');
    tickTraps(world, T.trap_rockfall.telegraphTicks);
    expect(rock.phase).toBe('spent');
    expect(world.player.health).toBe(balance.player.healthMax - T.trap_rockfall.damage); // 폭심 — 감쇠 없음
    const f = 1 - (1 - T.trap_rockfall.damageFalloffMin) * (4 / T.trap_rockfall.damageRadius);
    expect(nearHp - near.health).toBeCloseTo(T.trap_rockfall.enemyDamage * f, 3);
    expect(diag.health).toBe(diagHp);
    expect(world.level.props.length).toBe(before + 1);
    expect(rock.blocker).toBeTruthy();
    expect(world.level.pathBlockedAt(rock.col, rock.row)).toBe(true);
  });

  it('낙석 피해 source 는 trap_rockfall (폭발 결 진동), 막기 불가', () => {
    putTrap(world, 'trap_rockfall', 6, 6, 'N');
    world.player.blocking = true;
    const srcs: string[] = [];
    world.events.on('player_damaged', (p) => srcs.push((p as { source: string }).source));
    tickTraps(world, T.trap_rockfall.telegraphTicks + 1);
    expect(srcs).toEqual(['trap_rockfall']);
    expect(world.player.health).toBe(balance.player.healthMax - T.trap_rockfall.damage);
  });
});

describe('함정 — 진자 칼날', () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
  });

  it('항시 흔들린다 — 서 있으면 반주기마다 한 번씩 맞는다, 몸당 1회', () => {
    putTrap(world, 'trap_pendulum', 6, 6, 'E');
    const hits: number[] = [];
    world.events.on('trap_hit_player', () => hits.push(world.tick));
    tickTraps(world, T.trap_pendulum.periodTicks);
    expect(hits).toHaveLength(2); // 두 최저점
    expect(world.player.health).toBe(balance.player.healthMax - T.trap_pendulum.damage * 2);
  });

  it('최저점 직전(parryLeadTicks)에 반응을 누르면 완벽 패링 — 피해 0·히트스톱·마나 이벤트', () => {
    const pend = putTrap(world, 'trap_pendulum', 6, 6, 'E');
    const parries: string[] = [];
    world.events.on('parry_attempt', (p) => parries.push((p as { result: string }).result));
    world.events.on('trap_parried', () => parries.push('trap_parried'));
    const half = T.trap_pendulum.periodTicks / 2;
    // 진자는 진폭 끝(half/2)에서 시작 → 첫 최저점까지 half/2 틱. 리드 안(5틱 전)에 누른다
    const toLowest = half - Math.floor(half / 2);
    tickTraps(world, toLowest - 6);
    world.input = { ...Input.emptySnapshot(), reactionPressed: true };
    tickTraps(world, 1);
    world.input = Input.emptySnapshot();
    tickTraps(world, 8);
    expect(parries).toEqual(['perfect', 'trap_parried']);
    expect(world.player.health).toBe(balance.player.healthMax);
    expect(world.freezeTicks).toBeGreaterThan(0);
    expect(pend.phase).toBe('firing'); // 계속 돈다
  });

  it('적도 잘린다 — enemyDamage, 보스는 bossDamageMul', () => {
    putTrap(world, 'trap_pendulum', 30, 6, 'E');
    const e = addEnemy(world, 'goblin_runner', 30, 6);
    e.ai = 'chase';
    const hp = e.health;
    tickTraps(world, T.trap_pendulum.periodTicks / 2 + 1);
    expect(hp - e.health).toBeGreaterThanOrEqual(Math.min(hp, T.trap_pendulum.enemyDamage) - 0.001);
    putTrap(world, 'trap_pendulum', 42, 6, 'E');
    const boss = addEnemy(world, 'goblin_chieftain', 42, 6);
    const bhp = boss.health;
    tickTraps(world, T.trap_pendulum.periodTicks / 2 + 1);
    expect(bhp - boss.health).toBeCloseTo(T.trap_pendulum.enemyDamage * T.trap_pendulum.bossDamageMul, 3);
  });
});

describe('함정 감지 각인', () => {
  it('반경 안에 들어온 함정을 한 번 알아채고(trap_revealed 1회), 각인이 없으면 알아채지 못한다', () => {
    const world = makeWorld();
    const near = putTrap(world, 'trap_spike', 14, 6); // 8m
    const far = putTrap(world, 'trap_spike', 30, 6); // 24m
    const ev: number[] = [];
    world.events.on('trap_revealed', (p) => ev.push((p as { id: number }).id));
    tickTraps(world, 3);
    expect(near.revealed ?? false).toBe(false); // 각인 없음
    world.modifiers.revealTrapsRadius = 12;
    tickTraps(world, 3);
    expect(near.revealed).toBe(true);
    expect(far.revealed ?? false).toBe(false);
    expect(ev).toEqual([near.id]); // 한 번만
    // 각인을 빼도 이미 알아챈 것은 잊지 않는다
    world.modifiers.revealTrapsRadius = 0;
    tickTraps(world, 1);
    expect(near.revealed).toBe(true);
  });

  it('recompute — 눈 부위에 새기면 revealTrapsRadius 가 잡힌다', () => {
    const world = makeWorld();
    world.sigils.equipped.eye = 'sig_trapsense';
    Sigils.recompute(world);
    expect(world.modifiers.revealTrapsRadius).toBe(12);
    world.sigils.equipped.eye = null;
    Sigils.recompute(world);
    expect(world.modifiers.revealTrapsRadius).toBe(0);
  });
});

describe('함정 — 자동 순환 가시판', () => {
  it('밟지 않아도 내려감→덜컹→가시→회수를 돌고, 서 있는 가시에 닿으면 맞는다', () => {
    const world = makeWorld();
    const a = putTrap(world, 'trap_spike_auto', 30, 6);
    const c = T.trap_spike_auto;
    const ev: string[] = [];
    for (const n of ['trap_telegraph', 'trap_fired', 'trap_retract', 'trap_rearmed'] as const) {
      world.events.on(n, () => ev.push(n));
    }
    // (row+col) = 1+7 = 8 → 짝 → 위상 0: 처음 downTicks 동안 내려가 있다
    tickTraps(world, c.downTicks);
    expect(ev).toEqual(['trap_telegraph']);
    expect(a.phase).toBe('telegraph');
    tickTraps(world, c.telegraphTicks);
    expect(ev).toEqual(['trap_telegraph', 'trap_fired']);
    expect(a.phase).toBe('firing');
    // 서 있는 가시로 걸어 들어간다 — 맞는다
    world.player.x = 30;
    tickTraps(world, 2);
    expect(world.player.health).toBe(balance.player.healthMax - c.damage);
    world.player.x = 6;
    tickTraps(world, c.upTicks);
    expect(a.phase).toBe('cooldown');
    expect(ev.at(-1)).toBe('trap_retract');
    tickTraps(world, c.cooldownTicks);
    expect(a.phase).toBe('armed');
    expect(ev.at(-1)).toBe('trap_rearmed');
  });

  it('인접 판은 반주기 어긋난다 — 한쪽이 서 있을 때 다른 쪽은 내려가 있다', () => {
    const world = makeWorld();
    const even = putTrap(world, 'trap_spike_auto', 30, 6); // (1,7) 짝
    const odd = putTrap(world, 'trap_spike_auto', 34, 6); // (1,8) 홀
    const c = T.trap_spike_auto;
    tickTraps(world, c.downTicks + c.telegraphTicks + 10);
    expect(even.phase).toBe('firing');
    expect(odd.phase).not.toBe('firing');
    // 배치 phase 플래그가 있으면 그것이 우선
    const forced = putTrap(world, 'trap_spike_auto', 38, 6);
    forced.phaseOffset = 0;
    tickTraps(world, 1);
    expect(forced.cycleTick).toBe(1);
  });
});

describe('함정 — 자동 순환 다트 발사기', () => {
  it('트리거 없이 idle → 예고 → 발사를 돈다, 위상 플래그가 있으면 그것부터', () => {
    const world = makeWorld();
    const auto = putTrap(world, 'trap_dart_auto', 30, 6, 'W');
    auto.phaseOffset = 0;
    const c = T.trap_dart_auto;
    const ev: string[] = [];
    world.events.on('trap_telegraph', () => ev.push('tele'));
    world.events.on('trap_fired', () => ev.push('fire'));
    tickTraps(world, c.idleTicks);
    expect(ev).toEqual(['tele']);
    expect(auto.phase).toBe('telegraph');
    tickTraps(world, c.telegraphTicks);
    expect(ev).toEqual(['tele', 'fire']);
    expect(world.projectiles.filter((pr) => pr.trapShot)).toHaveLength(c.dartCount);
    expect(auto.phase).toBe('armed');
    // 다음 주기에 또
    world.projectiles.length = 0;
    tickTraps(world, c.idleTicks + c.telegraphTicks);
    expect(ev).toEqual(['tele', 'fire', 'tele', 'fire']);
  });

  it('밟는 다트 판은 0.5초(30틱) 예고 뒤 쏜다', () => {
    expect(T.trap_dart.telegraphTicks).toBe(30);
  });
});

describe('함정 — 포자 식물 원거리 도발', () => {
  it('권총으로 멀리서 맞히면 개화(예고)로 넘어간다 — 총알은 거기서 멈춘다', async () => {
    const Weapons = await import('./Weapons');
    const world = makeWorld();
    const plant = putTrap(world, 'trap_gas', 14, 6); // 8m 앞
    const behind = addEnemy(world, 'goblin_runner', 20, 6); // 식물 뒤 — 맞으면 안 된다
    const hp = behind.health;
    world.player.pitch = -0.08; // 주머니 높이로 살짝 내려 겨눈다
    const ev: string[] = [];
    world.events.on('trap_triggered', (p) => ev.push((p as { how?: string }).how ?? '?'));
    world.input = { ...Input.emptySnapshot(), rangedPressed: true };
    Weapons.tick(world, DT);
    expect(plant.phase).toBe('telegraph');
    expect(ev).toEqual(['pistol']);
    expect(behind.health).toBe(hp);
  });

  it('화살이 맞혀도 터진다', () => {
    const world = makeWorld();
    const plant = putTrap(world, 'trap_gas', 14, 6);
    world.projectiles.push({
      id: 4242, owner: 'player', x: 8, y: 1.0, z: 6, prevX: 8, prevY: 1.0, prevZ: 6,
      vx: 30, vy: 0, vz: 0, lifeTicks: 90, damage: 10, burnTicks: 0, burnDamagePerTick: 0, radius: 0.1, kind: 'arrow',
    });
    for (let i = 0; i < 30 && plant.phase === 'armed'; i++) Projectiles.tick(world, DT);
    expect(plant.phase).toBe('telegraph');
    expect(world.projectiles).toHaveLength(0); // 화살은 식물에 박혔다
  });
});

describe('함정 — 포자 식물: 1초 떨림, 1회성, 독 상태', () => {
  it('구름에 닿으면 초기 피해 뒤 독이 들고, 30초 동안 poisonTotal 이 조금씩 깎이고, 재접촉은 시간만 갱신한다', () => {
    const world = makeWorld();
    const plant = putTrap(world, 'trap_gas', 6, 6);
    const c = T.trap_gas;
    const ev: string[] = [];
    world.events.on('poison_applied', () => ev.push('applied'));
    world.events.on('poison_ended', () => ev.push('ended'));
    const dmg: string[] = [];
    world.events.on('player_damaged', (p) => dmg.push((p as { source: string }).source));
    let dot = 0;
    world.events.on('poison_tick', (p) => (dot += (p as { amount: number }).amount));
    tickTraps(world, c.telegraphTicks + 2); // 떨림 1초 뒤 터짐 — 구름 안에 서 있다
    expect(plant.phase).toBe('firing');
    expect(ev).toEqual(['applied']);
    expect(dmg).toEqual(['poison']);
    expect(world.player.health).toBeCloseTo(balance.player.healthMax - c.poisonInitial, 3);
    // 구름 안에 계속 있어도 초기 피해는 다시 없다 (시간만 갱신된다)
    tickTraps(world, 60);
    expect(dmg).toHaveLength(1);
    expect(world.player.poisonTicks).toBe(c.poisonDurationTicks); // 매 틱 갱신 — 꽉 찬 채
    // 구름을 나와 30초를 채운다 — 나온 뒤의 도트 총량 ≈ poisonTotal (머문 60틱치는 그 위에 조금 더)
    const dotBefore = dot;
    world.player.x = 30;
    tickTraps(world, c.poisonDurationTicks + 5);
    // 머문 60틱 동안 쌓인 누적분(시간은 갱신됐지만 독은 계속 흐른다)이 그 위에 더해진다
    const perTick = c.poisonTotal / c.poisonDurationTicks;
    expect(dot - dotBefore).toBeCloseTo(c.poisonTotal + 60 * perTick, 1);
    expect(ev).toEqual(['applied', 'ended']);
    expect(world.player.poisonTicks ?? 0).toBe(0);
  });

  it('한 번 터진 식물은 끝이다 — spent, 다시 다가가도 안 터진다', () => {
    const world = makeWorld();
    const plant = putTrap(world, 'trap_gas', 6, 6);
    const c = T.trap_gas;
    tickTraps(world, c.telegraphTicks + c.cloudTicks + 3);
    expect(plant.phase).toBe('spent');
    world.player.x = 30;
    tickTraps(world, 5);
    world.player.x = 6;
    tickTraps(world, 5);
    expect(plant.phase).toBe('spent');
  });
});

describe('함정 — 재생성 레버 (시험방)', () => {
  it('당기면 터진 포자 식물이 다시 서고, 레버는 다시 당길 수 있다', async () => {
    const Lever = await import('./Lever');
    const level = new Level({
      id: 'leverrange', name: 'leverrange', cellSize: 4, ceiling: 4,
      grid: ['#'.repeat(20), '#S' + '.'.repeat(17) + '#', '#'.repeat(20)],
      lighting: { ambient: 0.04, torches: [] },
      triggers: [{ type: 'lever', cell: [1, 4], resets: [1, 3] }],
    });
    const world = makeWorld();
    world.level = level;
    expect(level.levers).toHaveLength(1); // opens 없는 레버도 등록된다
    const plant = putTrap(world, 'trap_gas', 14, 6); // (1,3)
    plant.phase = 'spent';
    plant.charges = 0;
    const ev: string[] = [];
    world.events.on('lever_pulled', (p) => ev.push((p as { resets?: { type: string } }).resets?.type ?? 'door'));
    world.events.on('trap_reset', () => ev.push('reset'));
    // 레버(1,4 → x 18) 앞 1.5m 에서 마주 본다 (+X 시선)
    world.player.x = 16.5;
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Lever.tick(world, DT);
    expect(ev).toEqual(['trap_gas', 'reset']);
    expect(plant.phase).toBe('armed');
    expect(plant.charges).toBe(T.trap_gas.charges);
    // 다시 터뜨리고 다시 당긴다 — 재사용
    plant.phase = 'spent';
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Lever.tick(world, DT);
    expect(plant.phase).toBe('armed');
    expect(world.pulledLevers.size).toBe(0); // 1회성 목록에 들지 않는다
  });
});

describe('함정 — 포자 식물은 모든 공격에 터진다', () => {
  it('해머 부채꼴에 맞으면 개화(예고)로', async () => {
    const Weapons = await import('./Weapons');
    const world = makeWorld();
    const plant = putTrap(world, 'trap_gas', 7.6, 6); // 정면 1.6m
    const ev: string[] = [];
    world.events.on('trap_triggered', (p) => ev.push((p as { how?: string }).how ?? '?'));
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    for (let i = 0; i < 30 && plant.phase === 'armed'; i++) {
      world.input = Input.emptySnapshot();
      Weapons.tick(world, DT);
    }
    expect(plant.phase).toBe('telegraph');
    expect(ev).toEqual(['hammer']);
  });

  it('폭발(explodeAt) 반경 안이면 터진다', async () => {
    const { explodeAt } = await import('../core/Explosion');
    const world = makeWorld();
    const plant = putTrap(world, 'trap_gas', 30, 6);
    const far = putTrap(world, 'trap_gas', 50, 6);
    explodeAt(world, 33, 6, {
      radius: 5, damage: 0, damageFalloffMin: 1, enemyKnockback: 0,
      playerKnockback: 0, playerKnockbackTicks: 0, noiseRadius: 0, fxHeight: 0.5,
    });
    expect(plant.phase).toBe('telegraph');
    expect(far.phase).toBe('armed');
  });
});

describe('함정 — 포자 식물: 뇌창(빔)에도 터진다', () => {
  it('빔이 식물에 닿으면 개화(예고)로', async () => {
    const { allSigilIds, sigilDef } = await import('../core/SigilData');
    const world = makeWorld();
    const beamId = allSigilIds().find((id) => sigilDef(id).cast === 'beam');
    expect(beamId).toBeTruthy();
    Sigils.acquire(world, beamId!);
    world.mana.value = 100;
    const plant = putTrap(world, 'trap_gas', 12, 6); // 정면 6m
    world.player.pitch = -0.1;
    const slot = world.skillSlots.indexOf(beamId!) + 1;
    world.input = { ...Input.emptySnapshot(), castPressed: true, useSkill: slot };
    Projectiles.tick(world, DT);
    world.input = Input.emptySnapshot();
    Projectiles.endChannel(world);
    expect(plant.phase).toBe('telegraph');
  });
});
