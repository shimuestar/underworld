// 권총 부위 판정 + 거리 감쇠 검증.
// 부위: 명중 높이 / 키 비율 — head(≥0.82) ×1.5, body(≥0.45) ×0.8, limb ×0.6
// 감쇠: startDist까지 100%, endDist에서 minMul(60%)로 선형

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { enemyDef } from '../core/Entities';
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
  world.input = { ...Input.emptySnapshot(), rangedPressed: true };
  Weapons.tick(world, DT);
  world.input = Input.emptySnapshot();
}

/** 해머 판정은 입력 후 impactTicks 뒤에 일어난다 — 그 시점까지 돌려준다 */
function advanceToHammerImpact(world: World): void {
  for (let i = 0; i < 20 && world.weapon.swingImpact > 0; i++) {
    world.input = Input.emptySnapshot();
    Weapons.tick(world, DT);
  }
}

describe('해머 (슬롯 1)', () => {
  function swing(): void {
    world.weapon.meleeCooldown = 0;
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    advanceToHammerImpact(world);
  }

  it('전방 부채꼴 적중 — 권총의 60% 피해. 1타는 밀치지 않고 굳힌다', () => {
    const hammer = balance.weapons.hammer;
    const enemy = spawnEnemyAt('goblin_runner', 6 + hammer.range - 0.2, 6, 1);
    enemy.ai = 'chase';
    world.enemies.push(enemy);
    const startX = enemy.x;

    swing();
    expect(enemy.health).toBe(30 - hammer.damage); // 20 — 러너 2방
    expect(enemy.alive).toBe(true);
    expect(enemy.kbTicks ?? 0).toBe(0); // 밀려나지 않는다
    expect(enemy.attackFreezeTicks).toBe(hammer.combo.chainFlinchTicks);

    // 굳어 있는 동안 제자리 (연속타를 이어갈 수 있게 붙잡아 둔다)
    world.input = Input.emptySnapshot();
    for (let i = 0; i < hammer.combo.chainFlinchTicks; i++) Enemies.tick(world, DT);
    expect(enemy.x).toBeCloseTo(startX, 5);
  });

  it('공격 중에 맞으면 그 동작 그대로 얼어붙는다 (타이머도 멈춘다)', () => {
    const hammer = balance.weapons.hammer;
    // 방패병은 해머를 방패로 받아내므로 방패 없는 적으로 확인한다
    const enemy = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    enemy.health = 1000;
    enemy.ai = 'chase';
    world.enemies.push(enemy);
    Enemies.tick(world, DT); // 예비동작 진입
    expect(enemy.ai).toBe('windup');
    for (let i = 0; i < 5; i++) Enemies.tick(world, DT);
    const frozenTimer = enemy.timer;

    swing(); // 해머 적중
    expect(enemy.attackFreezeTicks).toBe(hammer.combo.chainFlinchTicks);
    for (let i = 0; i < hammer.combo.chainFlinchTicks; i++) Enemies.tick(world, DT);
    expect(enemy.ai).toBe('windup'); // 취소되지 않는다
    expect(enemy.timer).toBe(frozenTimer); // 예비동작이 진행되지도 않는다

    Enemies.tick(world, DT); // 경직이 풀리면 이어서 진행
    expect(enemy.timer).toBe(frozenTimer - 1);
  });

  it('마무리 3타에서만 뒤로 밀린다', () => {
    const hammer = balance.weapons.hammer;
    const enemy = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    enemy.health = 1000;
    world.enemies.push(enemy);

    swing();
    // 경직을 지나야 다음 타가 유효하다 (얼어붙은 동안은 그대로 서 있는다)
    for (let i = 0; i < hammer.combo.chainFlinchTicks; i++) Enemies.tick(world, DT);
    swing();
    expect(enemy.kbTicks ?? 0).toBe(0);
    for (let i = 0; i < hammer.combo.chainFlinchTicks; i++) Enemies.tick(world, DT);
    const startX = enemy.x;
    swing(); // 3타 강타

    world.input = Input.emptySnapshot();
    const kbTicks = Math.round(hammer.knockbackTicks * hammer.combo.knockbackTicksMul);
    expect(enemy.kbTicks).toBe(kbTicks); // 미는 시간도 늘어난다
    for (let i = 0; i < kbTicks; i++) Enemies.tick(world, DT);
    // 러너는 경량 — 배율 1.0
    expect(enemy.x).toBeCloseTo(startX + hammer.knockback * hammer.combo.knockbackMul, 1);
  });

  it('헛스윙은 후딜 추가, 명중은 짧은 연결 쿨다운 (1·2타)', () => {
    const combo = balance.weapons.hammer.combo;
    const chain = combo.chainCooldownTicks;
    swing(); // 아무도 없음 — 헛스윙. 1·2타는 연결을 막지 않게 작은 추가 후딜만
    expect(world.weapon.meleeCooldown).toBe(chain + combo.chainWhiffExtraTicks);
    // 후딜이 연결 창(windowTicks)보다 짧아야 헛친 1타에서 2타가 나간다
    expect(chain + combo.chainWhiffExtraTicks).toBeLessThan(chain + combo.windowTicks);

    const enemy = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    world.enemies.push(enemy);
    swing(); // 명중 — 바로 다음 타로 이어칠 수 있게 짧다 (적중 가속까지 붙는다)
    expect(world.weapon.meleeCooldown).toBe(Math.round(chain * combo.hitCooldownMul));
    expect(world.weapon.meleeCooldown).toBeLessThan(chain);
  });

  it('후딜 중에 누른 근접 입력은 버려지지 않는다 — 풀리는 즉시 이어친다', () => {
    const combo = balance.weapons.hammer.combo;
    const enemy = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    enemy.health = 1000;
    world.enemies.push(enemy);
    const swings: { step: number }[] = [];
    world.events.on('hammer_swing', (payload) => swings.push(payload as { step: number }));

    swing(); // 1타 (impact 까지 진행됨)
    expect(swings.map((s) => s.step)).toEqual([1]);
    expect(world.weapon.meleeCooldown).toBeGreaterThan(0);

    // 후딜이 아직 남았는데 누른다 — 예전에는 그냥 사라졌다
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(swings).toHaveLength(1); // 아직 안 나감
    expect(world.weapon.meleeBufferTicks).toBeGreaterThan(0); // 기억해 뒀다

    // 클릭을 더 하지 않아도 후딜이 풀리는 순간 2타가 나간다
    for (let i = 0; i < combo.bufferTicks; i++) Weapons.tick(world, DT);
    expect(swings.map((s) => s.step)).toEqual([1, 2]);
  });

  it('예비탄까지 없으면 불발 — weapon_empty 만 나가고 탄은 줄지 않는다', () => {
    world.weapon.mag = 0;
    world.weapon.reserve = 0;
    const empty: { weapon: string }[] = [];
    const shots: unknown[] = [];
    world.events.on('weapon_empty', (payload) => empty.push(payload as { weapon: string }));
    world.events.on('shot_fired', (payload) => shots.push(payload));

    world.weapon.cooldown = 0;
    world.input = { ...Input.emptySnapshot(), rangedPressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();

    expect(empty).toEqual([{ weapon: 'pistol' }]);
    expect(shots).toHaveLength(0); // 총알은 나가지 않는다
    expect(world.weapon.reloading).toBe(0); // 장전도 시작되지 않는다
  });

  it('예비탄이 남아 있으면 불발이 아니라 자동 장전', () => {
    world.weapon.mag = 0;
    world.weapon.reserve = 12;
    const empty: unknown[] = [];
    world.events.on('weapon_empty', () => empty.push(1));

    world.weapon.cooldown = 0;
    world.input = { ...Input.emptySnapshot(), rangedPressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();

    expect(empty).toHaveLength(0);
    expect(world.weapon.reloading).toBeGreaterThan(0);
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
    world.weapon.ranged = 'grenade';
    world.weapon.meleeCooldown = 0;
    for (let i = 0; i < chargeTicks; i++) {
      // 실제 마우스다운은 첫 틱에 클릭 엣지 + 홀드가 함께 온다
      world.input = { ...Input.emptySnapshot(), rangedHeld: true, rangedPressed: i === 0 };
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

  /** 적 기준 offsetX 만큼 떨어진 곳에서 수류탄을 터뜨린다 (신관 만료) */
  function grenadeAt(enemy: EnemyState, offsetX: number, id: number): void {
    const gx = enemy.x + offsetX;
    world.projectiles.push({
      id, owner: 'player',
      x: gx, y: 0.2, z: enemy.z, prevX: gx, prevY: 0.2, prevZ: enemy.z,
      vx: 0, vy: 0, vz: 0, lifeTicks: 1, damage: 0,
      burnTicks: 0, burnDamagePerTick: 0, radius: 0.2, kind: 'grenade',
    });
    Projectiles.tick(world, DT);
  }

  /** 폭심에서 dist 떨어진 지점의 수류탄 피해 */
  function grenadeDamageAt(dist: number): number {
    const g = balance.weapons.grenade;
    return g.damage * (1 - (1 - g.damageFalloffMin) * Math.min(1, dist / g.radius));
  }

  it('수류탄 폭풍을 방패로 받아내면 방패가 부서진다 — 피해도 damageRatio 배', () => {
    const enemy = shieldman(4); // 플레이어(−X 쪽)를 정면으로 본다
    const broken: { enemyType: string }[] = [];
    world.events.on('shield_broken', (payload) => broken.push(payload as { enemyType: string }));

    grenadeAt(enemy, -1.5, 800); // 정면(플레이어 쪽) 1.5m 앞에서 폭발

    expect(enemy.shieldBroken).toBe(true);
    expect(broken[0]).toMatchObject({ enemyType: 'goblin_spear' });
    expect(1000 - enemy.health).toBeCloseTo(
      grenadeDamageAt(1.5) * balance.shieldBreak.damageRatio,
      3,
    );
  });

  it('등 뒤에서 터진 수류탄은 방패와 무관 — 온전한 피해', () => {
    const enemy = shieldman(4);
    grenadeAt(enemy, 1.5, 801); // 등 뒤 1.5m

    expect(enemy.shieldBroken).toBeUndefined();
    expect(1000 - enemy.health).toBeCloseTo(grenadeDamageAt(1.5), 3);
  });

  it('이미 부서진 방패는 다시 부서지지 않는다 — 두 번째 수류탄은 온전한 피해', () => {
    const enemy = shieldman(4);
    const broken: unknown[] = [];
    world.events.on('shield_broken', () => broken.push(1));

    grenadeAt(enemy, -1.5, 802);
    const hpAfterFirst = enemy.health;
    grenadeAt(enemy, -1.5, 803);

    expect(broken).toHaveLength(1);
    expect(hpAfterFirst - enemy.health).toBeCloseTo(grenadeDamageAt(1.5), 3);
  });

  it('뒤로 밀려나는 동안은 방패가 내려가 총알이 박힌다 — 끝나면 다시 막는다', () => {
    const enemy = shieldman(4);
    const blocked: unknown[] = [];
    world.events.on('shot_blocked', (payload) => blocked.push(payload));

    // 평소 — 정면 사격은 막힌다
    fireAt(4, 1.0);
    expect(blocked).toHaveLength(1);
    expect(enemy.health).toBe(1000);

    // 해머 3타로 날아가는 중 (kbTicks > 0) — 가드가 풀려 관통한다
    enemy.kbTicks = 10;
    fireAt(4, 1.0);
    expect(blocked).toHaveLength(1); // 더 막히지 않는다
    expect(enemy.health).toBeLessThan(1000);
    expect(enemy.shieldBroken).toBeUndefined(); // 깨진 게 아니라 내려간 것뿐

    // 밀림이 끝나면 즉시 다시 막는다
    enemy.kbTicks = 0;
    const hp = enemy.health;
    fireAt(4, 1.0);
    expect(blocked).toHaveLength(2);
    expect(enemy.health).toBe(hp);
  });

  it('밀려나는 중에도 해머는 여전히 방패에 막힌다 (벽에 붙은 방패병 관통 방지)', () => {
    const enemy = spawnEnemyAt('goblin_spear', 6 + 2.2, 6, 1);
    enemy.health = 110;
    enemy.yaw = Math.atan2(-(6 - enemy.x), -(6 - enemy.z));
    enemy.kbTicks = 10;
    world.enemies.push(enemy);

    world.weapon.meleeCooldown = 0;
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    advanceToHammerImpact(world);
    expect(enemy.health).toBe(110); // HP 피해 없음 — 방패가 받아냈다
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

describe('피탄 경직', () => {
  it('총에 맞으면 잠깐 발이 묶인다 — 공격 진행은 막지 않는다', () => {
    const enemy = spawnEnemyAt('goblin_runner', 6 + 6, 6, 1);
    enemy.health = 1000;
    enemy.ai = 'chase';
    world.enemies.push(enemy);

    fireAt(6, 1.0);
    expect(enemy.flinchTicks).toBe(balance.weapons.pistol.flinchTicks);

    // 경직 동안은 다가오지 못한다
    const x0 = enemy.x;
    for (let i = 0; i < balance.weapons.pistol.flinchTicks; i++) Enemies.tick(world, DT);
    expect(enemy.x).toBeCloseTo(x0, 5);

    // 끝나면 다시 접근한다
    for (let i = 0; i < 10; i++) Enemies.tick(world, DT);
    expect(enemy.x).toBeLessThan(x0);
  });

  it('경직이 공격 상태 머신을 끊지 않는다 (스턴락 불가)', () => {
    const enemy = spawnEnemyAt('goblin_spear', 6 + 3, 6, 1);
    enemy.health = 1000;
    enemy.ai = 'chase';
    world.enemies.push(enemy);
    Enemies.tick(world, DT); // windup 진입
    expect(enemy.ai).toBe('windup');
    const timerBefore = enemy.timer;

    fireAt(3, 1.0);
    Enemies.tick(world, DT);
    expect(enemy.ai).toBe('windup'); // 여전히 공격 중
    expect(enemy.timer).toBe(timerBefore - 1); // 예비동작은 정상 진행
  });
});

describe('방어 중 손 역할 분담', () => {
  it('방어 중에는 총을 쏘지 못한다 (왼손이 방패 손)', () => {
    world.player.blocking = true;
    const mag0 = world.weapon.mag;
    fireAt(6, 1.0);
    expect(world.weapon.mag).toBe(mag0); // 한 발도 안 나갔다

    world.player.blocking = false;
    fireAt(6, 1.0);
    expect(world.weapon.mag).toBe(mag0 - 1);
  });

  it('방어 중에도 해머는 휘두를 수 있다 (오른손은 비어 있다)', () => {
    const enemy = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    enemy.health = 1000;
    world.enemies.push(enemy);
    world.player.blocking = true;
    world.weapon.meleeCooldown = 0;
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    advanceToHammerImpact(world);
    expect(enemy.health).toBe(1000 - balance.weapons.hammer.damage);
  });

  it('방어 중에는 수류탄 차징도 멈춘다', () => {
    world.weapon.ranged = 'grenade';
    world.player.blocking = true;
    world.input = { ...Input.emptySnapshot(), rangedHeld: true, rangedPressed: true };
    Weapons.tick(world, DT);
    Weapons.tick(world, DT);
    expect(world.weapon.grenadeCharge).toBe(0);
    expect(world.weapon.grenades).toBe(3); // 던져지지도 않았다
  });
});

describe('해머 3타 콤보', () => {
  const hammer = balance.weapons.hammer;
  const combo = hammer.combo;

  function swingAt(enemy: EnemyState): { damage: number; heavy: boolean } {
    const hp = enemy.health;
    let heavy = false;
    const off = world.events.on('hammer_swing', (payload) => {
      heavy = (payload as { heavy: boolean }).heavy;
    });
    world.weapon.meleeCooldown = 0;
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    advanceToHammerImpact(world);
    if (typeof off === 'function') off();
    return { damage: hp - enemy.health, heavy };
  }

  it('3타째가 강타 — 피해·넉백·사거리가 커지고 후딜도 길다', () => {
    const enemy = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    enemy.health = 100000;
    world.enemies.push(enemy);

    const a = swingAt(enemy);
    const b = swingAt(enemy);
    const c = swingAt(enemy);
    expect(a.heavy).toBe(false);
    expect(b.heavy).toBe(false);
    expect(c.heavy).toBe(true);
    expect(a.damage).toBe(hammer.damage);
    expect(c.damage).toBeCloseTo(hammer.damage * combo.damageMul, 5);
    // 강타도 적중하면 가속을 받는다 — 마무리를 맞힌 쪽이 다시 붙기 쉽다
    expect(world.weapon.meleeCooldown).toBe(
      Math.round(hammer.cooldownTicks * combo.cooldownMul * combo.hitCooldownMul),
    );
    expect(world.weapon.comboStep).toBe(0); // 마무리 후 초기화
  });

  it('적중하면 다음 타가 빨라진다 — 예비동작·후딜이 함께 줄고 뷰모델도 배속', () => {
    const enemy = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    enemy.health = 100000;
    world.enemies.push(enemy);

    /** 한 번 휘두르고, 이번 스윙의 예비동작 틱과 뷰모델 배속을 돌려준다 */
    function swingMeasured(): { impact: number; speedMul: number } {
      const swings: { speedMul: number }[] = [];
      const off = world.events.on('hammer_swing', (p) => swings.push(p as { speedMul: number }));
      world.weapon.meleeCooldown = 0;
      world.input = { ...Input.emptySnapshot(), meleePressed: true };
      Weapons.tick(world, DT);
      world.input = Input.emptySnapshot();
      const impact = world.weapon.swingImpact;
      advanceToHammerImpact(world);
      if (typeof off === 'function') off();
      return { impact, speedMul: swings[0]!.speedMul };
    }

    // 첫 타 — 가속 없음. 로직 예비동작과 뷰모델 배속이 기본값이다
    const first = swingMeasured();
    expect(first.impact).toBe(hammer.impactTicks);
    expect(first.speedMul).toBe(1);
    expect(world.weapon.meleeRushTicks).toBe(combo.rushWindowTicks);

    // 맞혔으니 다음 타는 짧아진다 — 그림도 같은 배율로 빨라져야 판정 시점과 안 어긋난다
    const second = swingMeasured();
    expect(second.impact).toBe(Math.round(hammer.impactTicks * combo.hitImpactMul));
    expect(second.impact).toBeLessThan(first.impact);
    expect(second.speedMul).toBeCloseTo(1 / combo.hitImpactMul, 5);

    // 헛치면 즉시 원속도로 돌아간다 — 단 이미 나간 스윙은 앞선 적중으로 번 속도를 쓴다
    enemy.x = 6 + 40;
    const third = swingMeasured(); // 3타 = 강타, 아직 가속 중
    expect(third.impact).toBe(Math.round(combo.heavyImpactTicks * combo.hitImpactMul));
    expect(world.weapon.meleeRushTicks).toBe(0); // 헛쳤으니 여기서 끊긴다
    const fourth = swingMeasured();
    expect(fourth.impact).toBe(hammer.impactTicks);
    expect(fourth.speedMul).toBe(1);
  });

  it('적중 가속은 rushWindowTicks 가 지나면 사라진다', () => {
    const enemy = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    enemy.health = 100000;
    world.enemies.push(enemy);
    world.weapon.meleeCooldown = 0;
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    advanceToHammerImpact(world);
    expect(world.weapon.meleeRushTicks).toBe(combo.rushWindowTicks);

    for (let i = 0; i < combo.rushWindowTicks; i++) Weapons.tick(world, DT);
    expect(world.weapon.meleeRushTicks).toBe(0);

    world.weapon.meleeCooldown = 0;
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(world.weapon.swingImpact).toBe(hammer.impactTicks); // 다시 원속도
  });

  it('시간이 지나 창이 끊기면 1타부터 다시 센다', () => {
    const enemy = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    enemy.health = 100000;
    world.enemies.push(enemy);

    swingAt(enemy);
    swingAt(enemy);
    // 연속타 창이 만료될 때까지 대기
    for (let i = 0; i < combo.windowTicks + hammer.cooldownTicks + 2; i++) {
      world.input = Input.emptySnapshot();
      Weapons.tick(world, DT);
    }
    expect(world.weapon.comboStep).toBe(0);
    const next = swingAt(enemy);
    expect(next.heavy).toBe(false); // 3타가 아니라 다시 1타
  });

  it('강타는 사거리 밖의 적에게도 닿는다 (rangeMul)', () => {
    // 판정은 적 반경(0.5)을 더해 재므로 일반 3.6 / 강타 4.07 사이에 둔다
    const far = spawnEnemyAt('goblin_runner', 6 + hammer.range + 0.75, 6, 1);
    far.health = 100000;
    world.enemies.push(far);

    const a = swingAt(far); // 1타 — 닿지 않는다
    expect(a.damage).toBe(0);
    // 콤보를 이어 3타를 만든다
    swingAt(far);
    const heavy = swingAt(far);
    expect(heavy.heavy).toBe(true);
    expect(heavy.damage).toBeGreaterThan(0);
  });
});

describe('체급별 넉백 저항', () => {
  const hammer = balance.weapons.hammer;
  const byWeight = hammer.combo.knockbackByWeight as unknown as Record<string, number>;

  /** 3타 강타를 맞히고 밀려난 거리를 잰다 */
  function finisherPush(type: string): number {
    const world2 = makeWorld();
    const enemy = spawnEnemyAt(type, 6 + 2, 6, 1);
    enemy.health = 1e9;
    world2.enemies.push(enemy);
    const swing3 = (): void => {
      world2.weapon.meleeCooldown = 0;
      world2.input = { ...Input.emptySnapshot(), meleePressed: true };
      Weapons.tick(world2, DT);
      world2.input = Input.emptySnapshot();
      advanceToHammerImpact(world2);
      for (let i = 0; i < hammer.combo.chainFlinchTicks; i++) Enemies.tick(world2, DT);
    };
    swing3();
    swing3();
    const startX = enemy.x;
    world2.weapon.meleeCooldown = 0;
    world2.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world2, DT);
    world2.input = Input.emptySnapshot();
    advanceToHammerImpact(world2);
    for (let i = 0; i < Math.round(hammer.knockbackTicks * hammer.combo.knockbackTicksMul); i++) {
      Enemies.tick(world2, DT);
    }
    return enemy.x - startX;
  }

  it('경량 1.0 / 중량 0.5 / 중장 0.25 — 무거울수록 덜 밀린다', () => {
    const full = hammer.knockback * hammer.combo.knockbackMul;
    expect(finisherPush('goblin_runner')).toBeCloseTo(full * byWeight['light']!, 1);
    expect(finisherPush('goblin_spear')).toBeCloseTo(full * byWeight['medium']!, 1);
    expect(finisherPush('goblin_chieftain')).toBeCloseTo(full * byWeight['heavy']!, 1);
  });

  it('모든 적에 체급이 지정돼 있다', () => {
    for (const type of ['goblin_runner', 'goblin_spear', 'goblin_archer', 'warden', 'goblin_chieftain']) {
      expect(['light', 'medium', 'heavy']).toContain(enemyDef(type).weight);
    }
  });
});

describe('방패병 vs 해머', () => {
  const sb = balance.shieldBreak;
  const hammer = balance.weapons.hammer;

  function shieldman(): EnemyState {
    const enemy = spawnEnemyAt('goblin_spear', 6 + 2.2, 6, 1);
    enemy.health = 110;
    enemy.ai = 'chase';
    enemy.yaw = Math.atan2(-(6 - enemy.x), -(6 - enemy.z)); // 플레이어를 정면으로
    world.enemies.push(enemy);
    return enemy;
  }
  function swingOnce(): void {
    world.weapon.meleeCooldown = 0;
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    advanceToHammerImpact(world);
  }

  it('정면 해머는 HP를 깎지 못하고 방패에 막힌다', () => {
    const enemy = shieldman();
    const braced: unknown[] = [];
    world.events.on('shield_braced', (payload) => braced.push(payload));

    swingOnce();
    expect(enemy.health).toBe(110); // 피해 없음
    expect(braced).toHaveLength(1);
    expect(enemy.braceTicks).toBe(sb.braceTicks);
    expect(enemy.kbTicks ?? 0).toBe(0); // 1·2타는 밀리지 않는다
  });

  it('마무리 3타를 방패로 받으면 크게 밀려난다 — 버티기도 풀린다', () => {
    const enemy = shieldman();
    swingOnce();
    swingOnce();
    const startX = enemy.x;
    swingOnce(); // 3타

    expect(enemy.braceTicks).toBe(0); // 가드를 잃고 떠밀린다
    expect(enemy.kbTicks).toBe(sb.finisherKnockbackTicks);
    for (let i = 0; i < sb.finisherKnockbackTicks; i++) Enemies.tick(world, DT);
    expect(enemy.x - startX).toBeCloseTo(sb.finisherKnockback, 1);
    // 밀려난 거리가 해머 사거리 밖이라 연타를 이어갈 수 없다
    expect(enemy.x - world.player.x).toBeGreaterThan(hammer.range * hammer.combo.rangeMul);
  });

  it('버티는 동안 방패병은 아무 행동도 하지 않는다', () => {
    const enemy = shieldman();
    swingOnce();
    const pos = { x: enemy.x, z: enemy.z };
    const ai = enemy.ai;
    for (let i = 0; i < sb.braceTicks - 1; i++) Enemies.tick(world, DT);
    expect(enemy.ai).toBe(ai); // 공격으로 넘어가지 않는다
    expect(enemy.x).toBeCloseTo(pos.x, 5);
    expect(world.player.health).toBe(balance.player.healthMax); // 반격도 없다
  });

  it('마무리 3타 2번이면 방패가 부서지고, 첫 번째엔 금만 간다', () => {
    const enemy = shieldman();
    const cracked: unknown[] = [];
    const broken: unknown[] = [];
    world.events.on('shield_cracked', (payload) => cracked.push(payload));
    world.events.on('shield_broken', (payload) => broken.push(payload));

    for (let n = 0; n < sb.finisherHitsToBreak; n++) {
      swingOnce();
      swingOnce();
      swingOnce(); // 3타 = 마무리
      for (let i = 0; i < hammer.combo.windowTicks + 20; i++) Weapons.tick(world, DT);
    }
    expect(enemy.shieldHits).toBe(sb.finisherHitsToBreak);
    expect(cracked).toHaveLength(sb.finisherHitsToBreak - 1);
    expect(broken).toHaveLength(1);
    expect(enemy.shieldBroken).toBe(true);
    expect(enemy.health).toBe(110); // 방패가 버티는 동안은 HP 무손실
  });

  it('연타를 멈추지 않으면 방패로 밀쳐낸다 (bashAfterBlocks)', () => {
    const enemy = shieldman();
    const bashes: unknown[] = [];
    world.events.on('shield_bash_start', (payload) => bashes.push(payload));

    for (let i = 0; i < sb.bashAfterBlocks - 1; i++) {
      swingOnce();
      expect(bashes).toHaveLength(0); // 임계 전에는 웅크리기만
    }
    swingOnce(); // 임계 도달
    Enemies.tick(world, DT); // Enemies 가 실행한다 (Weapons 는 의도만 남긴다)
    expect(bashes).toHaveLength(1);
    expect(enemy.attackMode).toBe('bash');
    expect(enemy.ai).toBe('windup');
    expect(enemy.braceTicks).toBe(0); // 웅크리기가 풀린다
  });

  it('연타를 멈추면 막아낸 기록이 사라진다', () => {
    const enemy = shieldman();
    swingOnce();
    swingOnce();
    expect(enemy.blockedStreak).toBe(2);
    for (let i = 0; i < sb.blockedStreakDecayTicks + 1; i++) Enemies.tick(world, DT);
    expect(enemy.blockedStreak).toBe(0);
  });

  it('방패에 막히면 다음 스윙이 늦어진다 (해머가 튕긴다)', () => {
    const enemy = shieldman();
    swingOnce();
    const blockedCd = world.weapon.meleeCooldown;

    // 방패 없는 적에게 같은 1타를 쳤을 때와 비교
    const world2 = makeWorld();
    const naked = spawnEnemyAt('goblin_runner', 6 + 2.2, 6, 2);
    naked.health = 1000;
    world2.enemies.push(naked);
    world2.weapon.meleeCooldown = 0;
    world2.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world2, DT);
    world2.input = Input.emptySnapshot();
    advanceToHammerImpact(world2);

    // 방패에 튕기면 적중 가속이 붙지 않는다 — 후딜 감면 없이 반동만 더해진다
    expect(blockedCd).toBe(balance.weapons.hammer.combo.chainCooldownTicks + sb.blockedRecoilTicks);
    expect(world.weapon.meleeRushTicks).toBe(0);
    expect(blockedCd).toBeGreaterThan(world2.weapon.meleeCooldown);
    expect(enemy.health).toBe(110);
  });

  it('마무리로 밀어낸 뒤에는 반드시 돌격으로 반격한다', () => {
    const enemy = shieldman();
    swingOnce();
    swingOnce();
    swingOnce(); // 마무리 → 밀려남
    expect(enemy.wantsCharge).toBe(true);

    const charges: unknown[] = [];
    world.events.on('enemy_charge', (payload) => charges.push(payload));
    for (let i = 0; i < sb.finisherKnockbackTicks + 2; i++) Enemies.tick(world, DT);
    expect(charges).toHaveLength(1); // 밀림이 끝나자마자 달려든다
    expect(enemy.attackMode).toBe('charge');
  });

  it('방패가 부서진 뒤에는 해머 피해가 들어간다', () => {
    const enemy = shieldman();
    enemy.shieldBroken = true;
    swingOnce();
    expect(enemy.health).toBe(110 - hammer.damage);
  });

  it('등 뒤에서 치면 방패와 무관하게 피해가 들어간다', () => {
    const enemy = shieldman();
    enemy.yaw = Math.atan2(-(20 - enemy.x), -(6 - enemy.z)); // 반대편을 봄
    swingOnce();
    expect(enemy.health).toBe(110 - hammer.damage);
  });
});
