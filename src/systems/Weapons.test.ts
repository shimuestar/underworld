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
import * as Enemies from './Enemies';
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

  it('전방 부채꼴 적중 — 권총의 60% 피해 + 뒤로 넉백', () => {
    const hammer = balance.weapons.hammer;
    const enemy = spawnEnemyAt('goblin_runner', 6 + hammer.range - 0.2, 6, 1);
    world.enemies.push(enemy);
    const startX = enemy.x;

    swing();
    expect(enemy.health).toBe(30 - hammer.damage); // 20 — 러너 2방
    expect(enemy.alive).toBe(true);

    // 넉백 — 타격 방향(+X)으로 밀려난다
    world.input = Input.emptySnapshot();
    for (let i = 0; i < hammer.knockbackTicks; i++) Enemies.tick(world, DT);
    expect(enemy.x).toBeCloseTo(startX + hammer.knockback, 1);
  });

  it('헛스윙은 후딜 추가, 명중은 기본 쿨다운', () => {
    const hammer = balance.weapons.hammer;
    swing(); // 아무도 없음 — 헛스윙
    expect(world.weapon.meleeCooldown).toBe(hammer.cooldownTicks + hammer.whiffExtraCooldownTicks);

    const enemy = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    world.enemies.push(enemy);
    swing(); // 명중
    expect(world.weapon.meleeCooldown).toBe(hammer.cooldownTicks);
  });

  it('처치 시 melee_kill(비처형) → 마나 지급 경로', () => {
    const hammer = balance.weapons.hammer;
    const enemy = spawnEnemyAt('goblin_runner', 6 + hammer.range - 0.2, 6, 1);
    enemy.health = hammer.damage; // 한 방 거리
    world.enemies.push(enemy);
    const kills: unknown[] = [];
    world.events.on('melee_kill', (payload) => kills.push(payload));

    swing();
    expect(enemy.alive).toBe(false);
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

describe('방패 파괴 (화염구)', () => {
  /** 플레이어(6,6)를 향해 서 있는 방패병 */
  function shieldman(dist: number): EnemyState {
    const enemy = spawnEnemyAt('goblin_spear', 6 + dist, 6, 1);
    enemy.health = 1000;
    enemy.yaw = Math.atan2(-(6 - enemy.x), -(6 - enemy.z)); // 플레이어를 바라봄
    world.enemies.push(enemy);
    return enemy;
  }

  /** 적을 향해 화염구를 날린다 (owner=player) */
  function fireball(target: EnemyState, damage = 40): void {
    world.projectiles.push({
      id: 700, owner: 'player',
      x: 6, y: 1.2, z: 6, prevX: 6, prevY: 1.2, prevZ: 6,
      vx: 20, vy: 0, vz: 0,
      lifeTicks: 120, damage, burnTicks: 0, burnDamagePerTick: 0,
      radius: 0.3, kind: 'fireball',
    });
    for (let i = 0; i < 40 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    void target;
  }

  it('화염구가 정면 방패를 부순다 — 피해는 damageRatio 배', () => {
    const enemy = shieldman(4);
    const events: unknown[] = [];
    world.events.on('shield_broken', (payload) => events.push(payload));

    fireball(enemy, 40);
    expect(enemy.shieldBroken).toBe(true);
    expect(events[0]).toMatchObject({ enemyType: 'goblin_spear' });
    expect(enemy.health).toBe(1000 - 40 * balance.shieldBreak.damageRatio);
  });

  it('방패가 깨지면 그 뒤 총알은 막히지 않는다', () => {
    const enemy = shieldman(4);
    // 깨지기 전 — 정면 사격은 막힌다
    const blocked: unknown[] = [];
    world.events.on('shot_blocked', (payload) => blocked.push(payload));
    fireAt(4, 1.0);
    expect(blocked).toHaveLength(1);
    expect(enemy.health).toBe(1000);

    fireball(enemy, 40);
    const hpAfterFireball = enemy.health;

    fireAt(4, 1.0); // 깨진 뒤 — 관통
    expect(blocked).toHaveLength(1); // 더 막히지 않는다
    expect(enemy.health).toBeLessThan(hpAfterFireball);
  });

  it('등 뒤에서 맞은 화염구는 방패와 무관 — 온전한 피해', () => {
    const enemy = spawnEnemyAt('goblin_spear', 6 + 4, 6, 1);
    enemy.health = 1000;
    enemy.yaw = Math.atan2(-(20 - enemy.x), -(6 - enemy.z)); // 플레이어 반대편을 봄
    world.enemies.push(enemy);

    fireball(enemy, 40);
    expect(enemy.shieldBroken).toBeUndefined();
    expect(enemy.health).toBe(1000 - 40); // 감쇠 없음
  });
});
