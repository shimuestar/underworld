// 권총 부위 판정 + 거리 감쇠 검증.
// 부위: 명중 높이 / 키 비율 — head(≥0.82) ×1.5, body(≥0.45) ×0.8, limb ×0.6
// 감쇠: startDist까지 100%, endDist에서 minMul(60%)로 선형

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Projectiles from './Projectiles';
import * as Sigils from './Sigils';
import * as Weapons from './Weapons';

const DT = 1 / 60;
const pistol = balance.weapons.pistol;

function makeWorld(): World {
  const level = new Level({
    id: 'range',
    name: 'range',
    cellSize: 4,
    ceiling: 4,
    // 사격장 — 길이 300u 복도
    grid: ['#'.repeat(75), '#S' + '.'.repeat(72) + '#', '#'.repeat(75)],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: -Math.PI / 2, pitch: 0, health: 100, // +X를 바라봄
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

function runnerAt(x: number): EnemyState {
  const enemy = spawnEnemyAt('goblin_runner', x, 6, 1);
  enemy.health = 1000; // 즉사 방지 — 피해량만 본다
  world.enemies.push(enemy);
  return enemy;
}

/** 목표 높이 targetY를 겨냥해 1발 발사 */
function fireAt(dist: number, targetY: number): void {
  const eye = balance.player.eyeHeight;
  world.player.pitch = Math.atan2(targetY - eye, dist);
  world.weapon.cooldown = 0;
  world.input = { ...Input.emptySnapshot(), firePressed: true };
  Weapons.tick(world, DT);
  world.input = Input.emptySnapshot();
}

describe('해머 (슬롯 1)', () => {
  function swing(): void {
    world.weapon.active = 'hammer';
    world.weapon.meleeCooldown = 0;
    world.input = { ...Input.emptySnapshot(), firePressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
  }

  it('전방 부채꼴 적중 — 처치 시 melee_kill(비처형) → 마나 지급 경로', () => {
    const hammer = balance.weapons.hammer;
    const enemy = spawnEnemyAt('goblin_runner', 6 + hammer.range - 0.2, 6, 1);
    world.enemies.push(enemy);
    const kills: unknown[] = [];
    world.events.on('melee_kill', (payload) => kills.push(payload));

    swing();
    expect(enemy.alive).toBe(false); // 55 > 30
    expect(kills[0]).toMatchObject({ enemyType: 'goblin_runner', execution: false });
  });

  it('후방·사거리 밖은 맞지 않는다', () => {
    const behind = spawnEnemyAt('goblin_runner', 4, 6, 1); // 등 뒤 (+X를 보는 중)
    const far = spawnEnemyAt('goblin_runner', 6 + 5, 6, 2); // 사거리 밖
    world.enemies.push(behind, far);
    swing();
    expect(behind.alive).toBe(true);
    expect(far.alive).toBe(true);
  });

  it('warden 방어막은 근접 무효 — barrier_blocked', () => {
    const warden = spawnEnemyAt('warden', 6 + 2, 6, 1);
    world.enemies.push(warden);
    const blocked: unknown[] = [];
    world.events.on('barrier_blocked', (payload) => blocked.push(payload));
    swing();
    expect(warden.health).toBe(90);
    expect(blocked[0]).toMatchObject({ kind: 'melee' });
  });
});

describe('수류탄 (슬롯 2)', () => {
  function throwGrenade(chargeTicks = 1): void {
    world.weapon.active = 'grenade';
    world.weapon.meleeCooldown = 0;
    for (let i = 0; i < chargeTicks; i++) {
      // 실제 마우스다운은 첫 틱에 클릭 엣지 + 홀드가 함께 온다
      world.input = { ...Input.emptySnapshot(), fireHeld: true, firePressed: i === 0 };
      Weapons.tick(world, DT);
    }
    world.input = Input.emptySnapshot(); // 릴리즈 → 투척
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
  }

  it('소모성 — 던지면 개수가 줄고, 0이면 불발', () => {
    throwGrenade();
    expect(world.weapon.grenades).toBe(2);
    expect(world.projectiles.some((p) => p.kind === 'grenade')).toBe(true);

    world.weapon.grenades = 0;
    const empty: unknown[] = [];
    world.events.on('weapon_empty', () => empty.push(1));
    throwGrenade();
    expect(empty).toHaveLength(1);
  });

  it('폭발 — 반경 내 적 피해(거리 감쇠), 신관 만료 시에도 폭발', () => {
    const grenade = balance.weapons.grenade;
    const near = spawnEnemyAt('goblin_runner', 6 + 10, 6, 1);
    near.health = 1000;
    world.enemies.push(near);

    world.player.pitch = 0.3; // 위로 던져 포물선
    throwGrenade();
    const explosions: unknown[] = [];
    world.events.on('explosion', (payload) => explosions.push(payload));
    for (let i = 0; i <= grenade.fuseTicks && world.projectiles.length > 0; i++) {
      Projectiles.tick(world, DT);
    }
    expect(explosions).toHaveLength(1);
    expect(near.health).toBeLessThan(1000); // 반경 내 피해
  });
});

describe('부위 판정 (근거리, 감쇠 없음)', () => {
  it('머리(높이 ≥82%): ×1.5', () => {
    const enemy = runnerAt(12); // dist 6 < startDist 10
    const events: unknown[] = [];
    world.events.on('headshot', (payload) => events.push(payload));
    fireAt(6, 1.55); // 러너 키 1.6의 97%
    expect(enemy.health).toBeCloseTo(1000 - pistol.damage * pistol.hitZones.headMul);
    expect(events).toHaveLength(1);
  });

  it('몸통(45~82%): ×0.8', () => {
    const enemy = runnerAt(12);
    fireAt(6, 1.0); // 62%
    expect(enemy.health).toBeCloseTo(1000 - pistol.damage * pistol.hitZones.bodyMul);
  });

  it('하반신(<45%): ×0.6', () => {
    const enemy = runnerAt(12);
    fireAt(6, 0.4); // 25%
    expect(enemy.health).toBeCloseTo(1000 - pistol.damage * pistol.hitZones.limbMul);
  });
});

describe('거리 감쇠', () => {
  it('startDist 안에서는 감쇠 없음', () => {
    const enemy = runnerAt(6 + 8); // dist 8
    fireAt(8, 1.0);
    expect(enemy.health).toBeCloseTo(1000 - pistol.damage * pistol.hitZones.bodyMul);
  });

  it('endDist(30m) 지점에서는 minMul(60%)', () => {
    const enemy = runnerAt(6 + 30.5); // AABB 표면 ≈ 30
    fireAt(30, 1.0);
    expect(enemy.health).toBeCloseTo(
      1000 - pistol.damage * pistol.hitZones.bodyMul * pistol.falloff.minMul,
      0,
    );
  });

  it('farDist(40m) 이상은 farMul(5%) — 사실상 무효', () => {
    const enemy = runnerAt(6 + 50); // dist 50 > farDist 40
    fireAt(50, 1.0);
    expect(enemy.health).toBeCloseTo(
      1000 - pistol.damage * pistol.hitZones.bodyMul * pistol.falloff.farMul,
      1,
    );
    expect(enemy.alive).toBe(true); // 원거리 원킬 불가
  });

  it('피격·소음 인지 — 맞은 적과 착탄/총성 주변 idle 적이 추격을 시작한다', () => {
    const victim = runnerAt(6 + 35); // 원거리 피해자 (idle)
    victim.ai = 'idle';
    const neighbor = spawnEnemyAt('goblin_runner', 6 + 35 + 8, 6, 2); // 착탄 지점 근처
    neighbor.ai = 'idle';
    world.enemies.push(neighbor);
    const farAway = spawnEnemyAt('goblin_runner', 6 + 35 + 30, 6, 3); // 소음 반경 밖
    farAway.ai = 'idle';
    world.enemies.push(farAway);

    fireAt(35, 1.0);
    expect(victim.ai).toBe('chase'); // 맞으면 무조건 인지
    expect(neighbor.ai).toBe('chase'); // 착탄 소음 반경(12) 안
    expect(farAway.ai).toBe('idle'); // 반경 밖은 그대로
  });

  it('중간 거리는 선형 보간 (20m → 80%)', () => {
    const enemy = runnerAt(6 + 20); // dist 20 = start 10과 end 30의 중간
    fireAt(20, 1.0);
    const midMul = 1 - (1 - pistol.falloff.minMul) * 0.5; // 0.8
    // 명중점은 AABB 표면(중심-반경)이라 실거리가 약간 짧다 — ±0.5 허용
    expect(enemy.health).toBeCloseTo(
      1000 - pistol.damage * pistol.hitZones.bodyMul * midMul,
      0,
    );
  });
});
