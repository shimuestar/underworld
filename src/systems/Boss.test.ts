// M7 검증 — warden(방어막·시전·반사), 보스 2페이즈 교대, 출구 잠금/클리어.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { attackReaches, enemyDef } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Enemies from './Enemies';
import * as Exit from './Exit';
import * as Projectiles from './Projectiles';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';
import * as Weapons from './Weapons';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['##########', '#S.......#', '#........#', '#.......X#', '##########'],
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

function tickEnemiesUntil(predicate: () => boolean, maxTicks = 600): void {
  for (let i = 0; i < maxTicks; i++) {
    Enemies.tick(world, DT);
    if (predicate()) return;
  }
  throw new Error('조건 미도달');
}

function pressReaction(): void {
  world.input = { ...Input.emptySnapshot(), reactionPressed: true };
  Reaction.tick(world, DT);
  world.input = Input.emptySnapshot();
}

describe('warden (수호주술사)', () => {
  it('시전 사이클: windup 46t → 적 투사체 발사 → recover', () => {
    const warden = spawnEnemyAt('warden', 18, 6, 1);
    warden.ai = 'chase';
    world.enemies.push(warden);

    tickEnemiesUntil(() => warden.ai === 'windup');
    tickEnemiesUntil(() => warden.ai === 'recover');
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0]!.owner).toBe('enemy');
    expect(world.projectiles[0]!.damage).toBe(enemyDef('warden').damage);
  });

  it('적 투사체가 플레이어에 명중하면 피해', () => {
    const warden = spawnEnemyAt('warden', 18, 6, 1);
    warden.ai = 'chase';
    world.enemies.push(warden);
    tickEnemiesUntil(() => world.projectiles.length === 1);

    for (let i = 0; i < 120 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(world.player.health).toBe(100 - enemyDef('warden').damage);
  });

  it('반사: 투사체 반전(위력 ×1.5, 방어막 무시) → warden 피격', () => {
    const warden = spawnEnemyAt('warden', 18, 6, 1);
    warden.ai = 'chase';
    world.enemies.push(warden);
    tickEnemiesUntil(() => world.projectiles.length === 1);

    // 투사체가 반응 반경 안에 올 때까지 비행
    for (let i = 0; i < 200; i++) {
      Projectiles.tick(world, DT);
      const proj = world.projectiles[0];
      if (!proj) throw new Error('반사 전에 착탄');
      if (Math.hypot(world.player.x - proj.x, world.player.z - proj.z) <= balance.reaction.radius)
        break;
    }
    const baseDamage = world.projectiles[0]!.damage;
    pressReaction();
    const proj = world.projectiles[0]!;
    expect(proj.owner).toBe('player');
    expect(proj.deflected).toBe(true);
    expect(proj.damage).toBeCloseTo(baseDamage * 1.5);

    // 되돌아가 warden 피격 (방어막 무시)
    for (let i = 0; i < 200 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(warden.health).toBeCloseTo(enemyDef('warden').health - baseDamage * 1.5);
  });

  it('마법(화염구)은 방어막에 무효 — barrier_blocked 피드백', () => {
    const warden = spawnEnemyAt('warden', 12, 6, 1);
    world.enemies.push(warden);
    const blocked: unknown[] = [];
    world.events.on('barrier_blocked', (payload) => blocked.push(payload));

    world.projectiles.push({
      id: 1, owner: 'player', x: 8, y: 1.2, z: 6, prevX: 8, prevY: 1.2, prevZ: 6,
      vx: 26, vy: 0, vz: 0, lifeTicks: 120, damage: 45,
      burnTicks: 180, burnDamagePerTick: 0.15, radius: 0.35,
    });
    for (let i = 0; i < 60 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(warden.health).toBe(enemyDef('warden').health);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ kind: 'magic' });
  });

  it('9mm는 방어막을 관통해 피해를 준다 (근거리 몸통 = damage × bodyMul)', () => {
    const warden = spawnEnemyAt('warden', 12, 6, 1);
    world.enemies.push(warden);
    world.input = { ...Input.emptySnapshot(), rangedPressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    // 수평 사격 → 눈높이 1.6 / warden 키 2.0 = 0.8 → 몸통 판정
    expect(warden.health).toBeCloseTo(
      enemyDef('warden').health -
        balance.weapons.pistol.damage * balance.weapons.pistol.hitZones.bodyMul,
    );
  });
});

describe('goblin_chieftain (1구역 보스)', () => {
  function makeBoss(): ReturnType<typeof spawnEnemyAt> {
    const boss = spawnEnemyAt('goblin_chieftain', 8.4, 6, 1); // attackRange 안
    boss.ai = 'chase';
    world.enemies.push(boss);
    return boss;
  }

  /** 족장은 완벽 대역에서만 성립한다 — 창이 열린 뒤 매 틱 눌러 닿는 순간을 잡는다 */
  function parryBoss(boss: ReturnType<typeof spawnEnemyAt>): string {
    tickEnemiesUntil(() => boss.ai === 'active_perfect');
    const results: string[] = [];
    const off = (p: unknown): void => {
      results.push((p as { result: string }).result);
    };
    world.events.on('parry_attempt', off);
    for (let i = 0; i < 40 && results.length === 0; i++) {
      pressReaction();
      if (results.length) break;
      Enemies.tick(world, DT);
    }
    return results[0] ?? '없음';
  }

  it('melee 페이즈: 3연속 패링해야 스태거, 그 전엔 recover', () => {
    const boss = makeBoss();
    const def = enemyDef('goblin_chieftain');

    for (let n = 1; n <= def.parriesToStagger!; n++) {
      expect(parryBoss(boss)).toBe('perfect'); // 보스는 완벽만 성립한다
      if (n < def.parriesToStagger!) {
        expect(boss.ai).toBe('recover');
        expect(boss.parryStreak).toBe(n);
      }
    }
    expect(boss.ai).toBe('staggered');
    expect(boss.parryStreak).toBe(0);
  });

  it('일반 대역에서 누르면 성립하지 않는다 — 완벽 패링만 받는다', () => {
    const def = enemyDef('goblin_chieftain');
    expect(def.perfectParryOnly).toBe(true);
    const boss = makeBoss();
    tickEnemiesUntil(() => boss.ai === 'active_perfect');

    const results: unknown[] = [];
    world.events.on('parry_attempt', (p) => results.push(p));
    // 무기 끝을 일반 대역 한가운데로 강제로 놓고 눌러 본다
    const mid = (balance.parrySpace.perfectBand + balance.parrySpace.guardDepth) / 2;
    boss.weaponTipDist =
      Math.hypot(boss.x - world.player.x, boss.z - world.player.z) - balance.player.radius - mid;
    pressReaction();
    expect(results).toHaveLength(0);
    expect(boss.ai).not.toBe('staggered');
  });

  it('장갑 페이즈 강타도 패링할 수 있다 (완벽만)', () => {
    const def = enemyDef('goblin_chieftain');
    expect(def.armoredAttack!.parryable).toBe(true);
    expect(def.armoredAttack!.telegraph).toBe('blue'); // 색 규약 — 청=패링 가능
    const boss = makeBoss();
    boss.phase = 'armored';
    boss.armorHealth = def.armorHealth!;
    expect(parryBoss(boss)).toBe('perfect');
  });

  it('방패로 막아도 보스는 끊기지 않는다 — 플레이어만 굳는다', () => {
    const def = enemyDef('goblin_chieftain');
    expect(def.blockCannotStagger).toBe(true);
    const boss = makeBoss();
    world.player.blocking = true;
    const clashes: unknown[] = [];
    const blocks: unknown[] = [];
    world.events.on('guard_clash', (p) => clashes.push(p));
    world.events.on('block_hit', (p) => blocks.push(p));

    tickEnemiesUntil(() => boss.ai === 'recover', 400);
    expect(blocks).toHaveLength(1); // 막긴 했다 (방패 섬광·소리)
    expect(clashes).toHaveLength(0); // 격돌 연출은 없다
    expect(boss.recoiled).not.toBe(true); // 튕기지 않았다
    expect(boss.timer).toBe(def.attack.recoverTicks); // 후딜이 늘지 않았다
    expect(world.player.stunTicks).toBeGreaterThan(0); // 플레이어만 굳는다
    expect(world.player.health).toBeLessThan(balance.player.healthMax); // 칩 피해도 받는다
  });

  it('스태거 중 처형 → executeDamage 타격 → 스태거 종료 후 armored 페이즈', () => {
    const boss = makeBoss();
    const def = enemyDef('goblin_chieftain');
    boss.ai = 'staggered';
    boss.timer = 90;

    pressReaction(); // 처형 타격
    expect(boss.health).toBe(def.health - def.executeDamage!);
    expect(boss.alive).toBe(true);

    // 처형 연출 동안은 적 전체가 멈춘다 — 그 시간을 지나야 스태거가 끝난다
    for (let i = 0; i < balance.reaction.executeFocusTicks + 1; i++) Enemies.tick(world, DT);
    expect(boss.phase).toBe('armored');
    expect(boss.armorHealth).toBe(def.armorHealth);
  });

  it('armored 페이즈: 총알이 장갑을 깎고, 파괴되면 melee 복귀. 마법은 튕긴다', () => {
    const boss = makeBoss();
    const def = enemyDef('goblin_chieftain');
    boss.phase = 'armored';
    boss.armorHealth = def.armorHealth!;

    // 마법 무효
    const blocked: unknown[] = [];
    world.events.on('barrier_blocked', (payload) => blocked.push(payload));
    world.projectiles.push({
      id: 1, owner: 'player', x: 7, y: 1.2, z: 6, prevX: 7, prevY: 1.2, prevZ: 6,
      vx: 26, vy: 0, vz: 0, lifeTicks: 60, damage: 45,
      burnTicks: 0, burnDamagePerTick: 0, radius: 0.35,
    });
    for (let i = 0; i < 30 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(blocked[0]).toMatchObject({ kind: 'armor' });
    expect(boss.health).toBe(def.health);

    // 실탄으로 장갑 파괴 — 필요한 발수는 밸런스에서 계산한다 (총 위력을 조정해도 안 깨지게)
    const pistol = balance.weapons.pistol;
    const perShot = pistol.damage * pistol.hitZones.bodyMul; // 몸통 판정
    const shots = Math.ceil(def.armorHealth! / perShot);
    const phases: unknown[] = [];
    world.events.on('boss_phase', (payload) => phases.push(payload));
    for (let shot = 0; shot < shots; shot++) {
      world.weapon.cooldown = 0;
      world.input = { ...Input.emptySnapshot(), rangedPressed: true };
      Weapons.tick(world, DT);
      world.input = Input.emptySnapshot();
    }
    expect(boss.phase).toBe('melee');
    expect(boss.health).toBe(def.health); // 장갑이 전부 흡수
    expect(phases).toContainEqual({ enemyId: 1, phase: 'melee' });
  });

  it('armored 공격은 판정 창 없이 windup → impact (패링 불가)', () => {
    const boss = makeBoss();
    boss.phase = 'armored';
    tickEnemiesUntil(() => boss.ai === 'windup');
    tickEnemiesUntil(() => boss.ai === 'recover'); // active_* 없이 impact를 거침
    expect(world.player.health).toBe(100 - enemyDef('goblin_chieftain').damage);
  });
});

describe('goblin_chieftain 원거리 공격', () => {
  it('원거리(minRange 이상)에서는 바위 투척 — 반사 불가 투사체', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1); // dist 12 ≥ minRange 7
    boss.ai = 'chase';
    boss.volleyCooldown = 9999; // 화살 세례가 먼저 나가지 않게
    boss.chargeCooldown = 9999; // 돌격도
    world.enemies.push(boss);

    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('ranged');
    tickEnemiesUntil(() => boss.ai === 'recover');
    expect(world.projectiles).toHaveLength(1);
    const rock = world.projectiles[0]!;
    expect(rock.kind).toBe('rock');
    expect(rock.deflectable).toBe(false);
    expect(rock.damage).toBe(enemyDef('goblin_chieftain').damage);
  });

  it('화살 세례 — 예고 뒤 0.5초 간격으로 10발, 그동안 제자리', () => {
    const volley = enemyDef('goblin_chieftain').volleyAttack!;
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1);
    boss.ai = 'chase';
    boss.chargeCooldown = 9999; // 돌격이 먼저 나가지 않게 (이제 15m 까지 닿는다)
    world.enemies.push(boss);
    const starts: { shots: number }[] = [];
    const shots: { left: number }[] = [];
    world.events.on('enemy_volley_start', (p) => starts.push(p as { shots: number }));
    world.events.on('enemy_volley_shot', (p) => shots.push(p as { left: number }));

    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('volley');
    expect(starts[0]).toMatchObject({ shots: volley.shots });
    expect(world.projectiles).toHaveLength(0); // 예고 중에는 아직 안 쏜다

    tickEnemiesUntil(() => boss.ai === 'volley');
    const heldX = boss.x;
    const heldZ = boss.z;

    // 발사 간격 — 첫 발은 예고가 끝나는 즉시, 이후 shotIntervalTicks 마다
    Enemies.tick(world, DT);
    expect(world.projectiles).toHaveLength(1);
    let gap = 0;
    while (world.projectiles.length === 1 && gap < 200) {
      Enemies.tick(world, DT);
      gap++;
    }
    expect(world.projectiles).toHaveLength(2);
    expect(gap).toBe(30); // 정확히 0.5초 (대기 29틱 + 발사 1틱)

    // 한 발은 약하다 — 연사이므로 def.damage(30)가 아니라 attack.damage(12)
    expect(world.projectiles[0]!.damage).toBe(volley.damage);
    expect(volley.damage!).toBeLessThan(enemyDef('goblin_chieftain').damage);
    expect(world.projectiles[0]!.kind).toBe('arrow');
    expect(world.projectiles[0]!.deflectable).toBe(false); // 회피 전용

    tickEnemiesUntil(() => boss.ai === 'recover', 1200);
    expect(shots).toHaveLength(volley.shots!);
    expect(shots[shots.length - 1]!.left).toBe(0);
    expect(boss.x).toBeCloseTo(heldX, 5); // 쏘는 동안 제자리
    expect(boss.z).toBeCloseTo(heldZ, 5);
    expect(boss.volleyCooldown).toBe(volley.cooldownTicks);
    expect(boss.attackMode).toBe('melee'); // 끝나면 평소 모드로
  });

  it('화살은 손에서 나가도 몸 중심을 향한다 — 조준선은 발사 지점에서 다시 잰다', () => {
    const def = enemyDef('goblin_chieftain');
    const volley = def.volleyAttack!;
    expect(volley.muzzleSideMul!).toBeGreaterThan(0); // 해머 든 손 옆에서 나간다
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1);
    boss.ai = 'chase';
    boss.chargeCooldown = 9999;
    world.enemies.push(boss);

    tickEnemiesUntil(() => world.projectiles.length === 1, 1200);
    const arrow = world.projectiles[0]!;
    const p = world.player;

    // 발사 지점은 몸 중심에서 옆으로 벗어나 있다 (손 위치)
    expect(Math.hypot(arrow.x - boss.x, arrow.z - boss.z)).toBeGreaterThan(def.radius);
    expect(Math.abs(arrow.z - boss.z)).toBeGreaterThan(def.radius * volley.muzzleSideMul! * 0.9);

    // 그런데도 진행선은 플레이어를 관통해야 한다. 몸 중심 기준으로 조준하면
    // 손만큼(0.68m) 평행 이동한 선이 되어 반경(0.4+0.15)을 넘어 영영 빗나간다
    const len = Math.hypot(arrow.vx, arrow.vy, arrow.vz);
    const u = [arrow.vx / len, arrow.vy / len, arrow.vz / len];
    const rel = [
      p.x - arrow.x,
      p.y + balance.player.eyeHeight * 0.8 - arrow.y,
      p.z - arrow.z,
    ];
    const t = rel[0]! * u[0]! + rel[1]! * u[1]! + rel[2]! * u[2]!;
    const perp = Math.hypot(rel[0]! - u[0]! * t, rel[1]! - u[1]! * t, rel[2]! - u[2]! * t);
    expect(perp).toBeLessThan(1e-9);
  });

  it('그래서 정면을 보고 있으면 방패로 받아낼 수 있다', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1);
    boss.ai = 'chase';
    boss.chargeCooldown = 9999;
    world.enemies.push(boss);
    tickEnemiesUntil(() => world.projectiles.length === 1, 1200);

    world.player.blocking = true; // +X 를 본다 = 보스 정면
    const blocked: unknown[] = [];
    world.events.on('block_hit', (payload) => blocked.push(payload));
    const before = world.player.health;

    for (let i = 0; i < 120 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(world.projectiles).toHaveLength(0); // 옆으로 지나쳐 날아가지 않았다
    expect(blocked).toHaveLength(1);
    expect(world.player.health).toBe(before); // 화살 칩 피해는 0
  });

  it('돌격은 예고 뒤 따로 달려 거리를 좁힌다 — 타격 창만으로는 못 닿는다', () => {
    const ch = enemyDef('goblin_chieftain').chargeAttack!;
    const def = enemyDef('goblin_chieftain');
    const start = 12; // 타격 창(0.3초 × chargeSpeed ≒ 3.9m)만으로는 절대 못 닿는 거리
    expect(start - balance.reaction.windowPerfectTicks / 60 * ch.chargeSpeed!).toBeGreaterThan(
      def.attackRange,
    );
    const boss = spawnEnemyAt('goblin_chieftain', 6 + start, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);

    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    expect(boss.attackMode).toBe('charge');
    const atRunStart = boss.x - world.player.x;

    tickEnemiesUntil(() => boss.ai !== 'charging', 300);
    const atStrike = boss.x - world.player.x;
    expect(atStrike).toBeLessThan(atRunStart - 5); // 달려서 크게 좁혔다
    expect(atStrike).toBeLessThanOrEqual(def.attackRange + 0.2); // 사거리 안까지 붙었다
    expect(boss.ai).toBe('active_perfect'); // 붙은 뒤에야 패링 창이 열린다
    // 달리기가 멈추는 자리가 판정 반경 안이어야 한다 — 아니면 붙고도 헛친다
    expect(ch.aoeRadius!).toBeGreaterThan(def.attackRange);
  });

  it('돌격은 예고가 끝난 순간의 좌표로만 달린다 — 옆으로 비키면 헛친다', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 6 + 11, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);

    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    const lockX = boss.chargeTargetX!;
    const lockZ = boss.chargeTargetZ!;
    expect(lockX).toBeCloseTo(world.player.x, 5); // 발동 순간의 플레이어 자리
    expect(lockZ).toBeCloseTo(world.player.z, 5);

    // 플레이어가 옆으로 크게 비킨다
    world.player.z += 7;
    const hits: unknown[] = [];
    world.events.on('player_damaged', (p) => hits.push(p));

    tickEnemiesUntil(() => boss.ai === 'recover', 400);
    // 목표는 그대로 — 따라오지 않았다
    expect(boss.chargeTargetX).toBe(lockX);
    expect(boss.chargeTargetZ).toBe(lockZ);
    expect(Math.hypot(boss.x - lockX, boss.z - lockZ)).toBeLessThan(1.5); // 찍어둔 자리로 갔다
    expect(hits).toHaveLength(0); // 비킨 플레이어는 안 맞는다
    expect(boss.whiffed).toBe(true);
    expect(boss.timer).toBeGreaterThanOrEqual(
      enemyDef('goblin_chieftain').chargeAttack!.whiffRecoverTicks!,
    );
  });

  it('가만히 서 있으면 돌격이 그대로 꽂힌다', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 6 + 11, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);
    const hits: { amount: number }[] = [];
    world.events.on('player_damaged', (p) => hits.push(p as { amount: number }));

    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    tickEnemiesUntil(() => boss.ai === 'recover', 400);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBe(enemyDef('goblin_chieftain').damage);
  });

  it('돌격은 방패로 막아도 크게 튕겨 나가고 피해도 들어온다', () => {
    const ch = enemyDef('goblin_chieftain').chargeAttack!;
    const def = enemyDef('goblin_chieftain');
    expect(ch.blockedKnockbackMul).toBe(1); // 방어해도 밀림이 안 줄어든다

    const boss = spawnEnemyAt('goblin_chieftain', 6 + 2.5, 6, 1);
    boss.yaw = Math.atan2(-(6 - boss.x), -(6 - boss.z)); // 플레이어를 본다
    boss.attackMode = 'charge';
    boss.ai = 'impact';
    world.enemies.push(boss);
    world.player.yaw = -Math.PI / 2; // 보스(+X)를 정면으로 본다
    world.player.blocking = true;
    const hp0 = world.player.health;

    Enemies.tick(world, DT);

    // 피해 — 완전 차단이 아니라 blockedDamageRatio 만큼 들어온다
    const taken = hp0 - world.player.health;
    expect(taken).toBeCloseTo(def.damage * ch.blockedDamageRatio!, 4);
    expect(taken).toBeGreaterThan(def.damage * balance.block.chipDamageRatio); // 평소보다 아프다

    // 밀림 — 방패를 들었는데도 전량
    const flung = Math.hypot(world.player.kbX!, world.player.kbZ!) * world.player.kbTicks!;
    expect(flung).toBeCloseTo(ch.playerKnockback!, 3);
    expect(world.player.kbTicks).toBe(ch.playerKnockbackTicks);
    // 일반 스매시를 막았을 때보다 훨씬 멀리 난다
    const normalBlocked = balance.playerKnockback.smash * balance.playerKnockback.blockedMul;
    expect(flung).toBeGreaterThan(normalBlocked * 5);
  });

  it('중거리에 들어오면 돌격 — 연사보다 먼저 고른다', () => {
    const ch = enemyDef('goblin_chieftain').chargeAttack!;
    const mid = ((ch.minRange ?? 0) + ch.maxRange!) / 2;
    const boss = spawnEnemyAt('goblin_chieftain', 6 + mid, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);
    const charges: unknown[] = [];
    world.events.on('enemy_charge', (p) => charges.push(p));

    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('charge'); // 화살 세례가 아니라 돌격
    expect(charges).toHaveLength(1);
    expect(boss.chargeCooldown).toBe(ch.cooldownTicks);
  });

  it('돌격 사거리 밖(멀리)에서는 화살 세례로 돌아간다', () => {
    const ch = enemyDef('goblin_chieftain').chargeAttack!;
    const boss = spawnEnemyAt('goblin_chieftain', 6 + ch.maxRange! + 3, 6, 1);
    boss.ai = 'chase';
    world.enemies.push(boss);
    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('volley');
  });

  it('붙으면 던지기를 접고 해머로 — 연사 중이어도 끊긴다', () => {
    const volley = enemyDef('goblin_chieftain').volleyAttack!;
    const boss = spawnEnemyAt('goblin_chieftain', 6 + 14, 6, 1);
    boss.ai = 'chase';
    boss.chargeCooldown = 9999; // 돌격 말고 연사를 쓰게
    world.enemies.push(boss);
    const held: unknown[] = [];
    world.events.on('enemy_hold_fire', (p) => held.push(p));

    tickEnemiesUntil(() => boss.ai === 'volley');
    Enemies.tick(world, DT); // 첫 발
    expect(world.projectiles.length).toBeGreaterThan(0);

    // 플레이어가 코앞까지 붙는다
    boss.x = world.player.x + volley.abortRange! - 0.5;
    Enemies.tick(world, DT);
    expect(boss.ai).toBe('chase');
    expect(boss.attackMode).toBe('melee');
    expect(held).toHaveLength(1);
    expect(boss.volleyCooldown).toBe(volley.cooldownTicks); // 끊겨도 쿨다운은 문다
  });

  it('지면 강타는 맞든 빗나가든 ground_slam 을 발행한다 (소리·흔들림용)', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 8.4, 6, 1); // 근접 거리 → 해머
    boss.ai = 'chase';
    world.enemies.push(boss);
    const slams: { radius: number; dist: number }[] = [];
    world.events.on('ground_slam', (p) => slams.push(p as { radius: number; dist: number }));

    tickEnemiesUntil(() => boss.ai === 'recover', 400);
    expect(slams).toHaveLength(1);
    expect(slams[0]!.radius).toBe(enemyDef('goblin_chieftain').attack.aoeRadius);
    expect(slams[0]!.dist).toBeGreaterThan(0);
  });

  it('화살 세례는 쿨다운 중이면 나가지 않는다', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 18, 6, 1);
    boss.ai = 'chase';
    boss.volleyCooldown = 5;
    boss.chargeCooldown = 9999;
    world.enemies.push(boss);
    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('ranged'); // 바위 투척으로 대체
  });

  it('해머 지면 강타는 원형 범위 — 옆으로 비켜도 맞고, 반경 밖이면 안 맞는다', () => {
    const def = enemyDef('goblin_chieftain');
    const aoe = def.attack.aoeRadius!;
    expect(aoe).toBeGreaterThan(0);
    const boss = { x: 10, z: 10, yaw: 0 }; // −Z 를 본다

    // 정면 (기존과 동일)
    expect(attackReaches(def, boss, def.attack, 10, 10 - aoe + 0.2)).toBe(true);
    // 완전히 옆 — 호(110°) 밖이지만 원 안이라 맞는다
    expect(attackReaches(def, boss, def.attack, 10 + aoe - 0.2, 10)).toBe(true);
    // 등 뒤도 원 안이면 맞는다
    expect(attackReaches(def, boss, def.attack, 10, 10 + aoe - 0.2)).toBe(true);
    // 반경 밖은 어느 방향이든 안 맞는다
    expect(attackReaches(def, boss, def.attack, 10, 10 - aoe - 0.3)).toBe(false);
    expect(attackReaches(def, boss, def.attack, 10 + aoe + 0.3, 10)).toBe(false);
  });

  it('원형 범위여도 패링 판정은 같은 함수를 쓴다 — 못 막는데 맞는 구멍이 없다', () => {
    const def = enemyDef('goblin_chieftain');
    const aoe = def.attack.aoeRadius!;
    const boss = spawnEnemyAt('goblin_chieftain', 10, 10, 1);
    boss.yaw = 0;
    // 호 밖(정옆)에 서 있어도 Reaction 이 대상으로 잡을 수 있어야 한다
    const sideX = 10 + aoe - 0.4;
    expect(attackReaches(def, boss, def.attack, sideX, 10)).toBe(true);
  });

  it('근접 거리에서는 기존 스매시 (melee 모드)', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 8.4, 6, 1); // dist 2.4 < minRange
    boss.ai = 'chase';
    world.enemies.push(boss);
    tickEnemiesUntil(() => boss.ai === 'windup');
    expect(boss.attackMode).toBe('melee');
    expect(world.projectiles).toHaveLength(0);
  });
});

describe('출구 (7.4)', () => {
  it('보스 생존 시 잠김, 처치 후 발판 위에서 E 를 눌러야 zone_cleared', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 8, 6, 1);
    world.enemies.push(boss);
    const events: string[] = [];
    world.events.on('exit_locked', () => events.push('locked'));
    world.events.on('zone_cleared', () => events.push('cleared'));

    world.player.x = world.level.exitPos!.x;
    world.player.z = world.level.exitPos!.z;
    Exit.tick(world, DT);
    expect(events).toEqual(['locked']);
    expect(world.cleared).toBe(false);

    // 보스를 잡아도 밟는 것만으로는 끝나지 않는다
    boss.alive = false;
    Exit.tick(world, DT);
    expect(world.cleared).toBe(false);
    expect(events).toEqual(['locked']);

    // E 를 눌러야 나간다
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Exit.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(events).toEqual(['locked', 'cleared']);
    expect(world.cleared).toBe(true);
  });

  it('발판 밖에서 E 를 눌러도 클리어되지 않는다', () => {
    world.player.x = 6; // 출구에서 멀리
    world.player.z = 6;
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Exit.tick(world, DT);
    expect(world.cleared).toBe(false);
    expect(world.onExitPad).toBe(false);
  });

  it('exitOpen 은 출구에서 멀리 있어도 갱신된다 — 보스가 죽는 순간 exit_opened 1회', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 8, 6, 1);
    world.enemies.push(boss);
    const opened: unknown[] = [];
    world.events.on('exit_opened', (payload) => opened.push(payload));

    world.player.x = 6; // 출구에서 멀리
    world.player.z = 6;
    Exit.tick(world, DT);
    expect(world.exitOpen).toBe(false); // 봉인 — 밟지 않아도 상태가 잡힌다
    expect(opened).toHaveLength(0);

    boss.alive = false;
    Exit.tick(world, DT);
    expect(world.exitOpen).toBe(true);
    expect(opened).toHaveLength(1);

    Exit.tick(world, DT); // 계속 돌아도 한 번만
    expect(opened).toHaveLength(1);
  });

  it('보스가 되살아나면 다시 봉인된다 (부활로 적이 재스폰될 때)', () => {
    const boss = spawnEnemyAt('goblin_chieftain', 8, 6, 1);
    boss.alive = false;
    world.enemies.push(boss);
    Exit.tick(world, DT);
    expect(world.exitOpen).toBe(true);

    boss.alive = true;
    Exit.tick(world, DT);
    expect(world.exitOpen).toBe(false);
  });
});

describe('캐스터 재배치 — 아군이 사선을 막을 때', () => {
  const strafe = balance.enemyAi.strafe;

  /** 궁수(사거리 18, 카이팅 최소 8)와 그 사선 중앙에 고정된 아군 */
  function setup(): { archer: ReturnType<typeof spawnEnemyAt>; ally: ReturnType<typeof spawnEnemyAt> } {
    world.player.x = 6;
    world.player.z = 10;
    const archer = spawnEnemyAt('goblin_archer', 16, 10, 11);
    archer.ai = 'chase';
    const ally = spawnEnemyAt('goblin_spear', 11, 10, 12);
    ally.ai = 'windup'; // 제자리 고정 (추격으로 사선이 저절로 트이는 것 방지)
    ally.timer = 99999;
    world.enemies.push(archer, ally);
    return { archer, ally };
  }

  it('막히면 쏘지 않고 옆으로 이동한다 — enemy_repositioning 1회', () => {
    const { archer } = setup();
    const repos: unknown[] = [];
    world.events.on('enemy_repositioning', (payload) => repos.push(payload));
    const z0 = archer.z;

    for (let i = 0; i < 20; i++) Enemies.tick(world, DT);
    expect(archer.ai).toBe('chase'); // 아직 발사 안 함
    expect(Math.abs(archer.z - z0)).toBeGreaterThan(0.5); // 옆으로 움직였다
    expect(repos).toHaveLength(1); // 재배치 시작 시 1회만
  });

  it('각이 트이면 발사한다', () => {
    const { archer } = setup();
    for (let i = 0; i < 200 && archer.ai === 'chase'; i++) Enemies.tick(world, DT);
    expect(archer.ai).toBe('windup');
    expect(archer.strafeBlockedTicks).toBe(0);
  });

  it('끝내 각이 안 나오면 giveUpTicks 후 아군을 무릅쓰고 쏜다', () => {
    const { archer, ally } = setup();
    let ticks = 0;
    for (let i = 0; i < strafe.giveUpTicks + 30; i++) {
      ally.x = (archer.x + world.player.x) / 2; // 계속 사선에 붙는다
      ally.z = (archer.z + world.player.z) / 2;
      Enemies.tick(world, DT);
      ticks++;
      if (archer.ai !== 'chase') break;
    }
    expect(archer.ai).toBe('windup');
    expect(ticks).toBeGreaterThanOrEqual(strafe.giveUpTicks);
  });

  it('겨누는 사이 아군이 끼어들면 쏘지 않고 내린다 (enemy_hold_fire)', () => {
    const { archer, ally } = setup();
    ally.x = -500; // 처음엔 사선이 비어 있다
    ally.z = -500;
    Enemies.tick(world, DT);
    expect(archer.ai).toBe('windup');

    // 겨누는 도중 아군이 사선으로 들어온다
    ally.x = (archer.x + world.player.x) / 2;
    ally.z = world.player.z;
    const holds: unknown[] = [];
    world.events.on('enemy_hold_fire', (payload) => holds.push(payload));

    for (let i = 0; i < 40 && archer.ai === 'windup'; i++) Enemies.tick(world, DT);
    expect(holds).toHaveLength(1);
    expect(world.projectiles).toHaveLength(0); // 발사하지 않았다
    expect(archer.ai).toBe('chase'); // 각부터 다시 잡는다
  });

  it('사선이 비어 있으면 재배치 없이 즉시 발사', () => {
    world.player.x = 6;
    world.player.z = 10;
    const archer = spawnEnemyAt('goblin_archer', 16, 10, 11);
    archer.ai = 'chase';
    world.enemies.push(archer);
    Enemies.tick(world, DT);
    expect(archer.ai).toBe('windup');
  });
});
