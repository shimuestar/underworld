// 해골 병사 3종(검사·해머병·방패병, docs/systems/skeletons.md) — 데이터 규약, 백스텝→찔러 들어오기, 방패 부수기(requiresBlocking),
// 대열(flank 산개 확대·rear 대기), 엄호(coverAllies), 이연격 패링 규약, 관통 배율(pierceDamageMul). 렌더(뼈 흩어짐)는 시험하지 않는다
import { describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { enemyDef, implementedEnemyTypes } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import { isSpawnable, spawnEnemyAt } from '../level/Spawner';
import * as Enemies from './Enemies';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';
import * as Stamina from './Stamina';
import * as Weapons from './Weapons';

const DT = 1 / 60;
const TYPES = ['skeleton_sword', 'skeleton_hammer', 'skeleton_shield'] as const;

function makeWorld(grid: string[], player: { x: number; z: number; yaw?: number }): World {
  const level = new Level({
    id: 'arena', name: 'arena', cellSize: 4, ceiling: 4, grid,
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: player.x, y: 0, z: player.z, prevX: player.x, prevY: 0, prevZ: player.z, yaw: player.yaw ?? 0, pitch: 0,
      health: balance.player.healthMax, stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: {
      melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3,
      meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false,
    },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  Stamina.init(world);
  return world;
}

/** 넓은 빈 방(12×8칸 = 48×32m) — 플레이어 (20,16) 중앙. 산개·대열이 벽에 걸리지 않는다 */
function arena(): World {
  const row = '#' + '.'.repeat(10) + '#';
  return makeWorld(['#'.repeat(12), '#S' + '.'.repeat(9) + '#', row, row, row, row, row, '#'.repeat(12)], { x: 20, z: 16 });
}

function add(world: World, type: string, x: number, z: number, id: number, ai: EnemyState['ai'] = 'chase'): EnemyState {
  const e = spawnEnemyAt(type, x, z, id);
  e.ai = ai;
  world.enemies.push(e);
  return e;
}

function ticks(world: World, n: number): void {
  for (let i = 0; i < n; i++) Enemies.tick(world, DT);
}

function record(world: World, name: string): unknown[] {
  const got: unknown[] = [];
  world.events.on(name, (p) => got.push(p));
  return got;
}

function pressReaction(world: World): void {
  world.input = { ...Input.emptySnapshot(), reactionPressed: true };
  Reaction.tick(world, DT);
  world.input = Input.emptySnapshot();
}

describe('해골 병사 — 데이터 규약', () => {
  it('셋 다 구현 목록·스포너에 있고, 관통 절반·언데드 대열 역할·체급이 정해져 있다', () => {
    for (const t of TYPES) {
      expect(implementedEnemyTypes()).toContain(t);
      expect(isSpawnable(t)).toBe(true);
      const d = enemyDef(t);
      expect(d.pierceDamageMul).toBe(0.5);
      expect(['light', 'medium', 'heavy']).toContain(d.weight);
      expect(d.attack.hitOnContact).toBe(true); // 근접 종족 규약
    }
    expect(enemyDef('skeleton_sword').formation).toMatchObject({ role: 'flank', offsetDeg: 75 });
    expect(enemyDef('skeleton_hammer').formation).toMatchObject({ role: 'rear', holdRange: 6.0 });
    expect(enemyDef('skeleton_shield').formation).toEqual({ role: 'front' });
    expect(enemyDef('skeleton_hammer').weight).toBe('heavy');
    expect(enemyDef('skeleton_hammer').blockCannotStagger).toBe(true);
  });

  it('검사 — 베기·이연격·찔러 들어오기 전부 파랑(패링 가능), 이연격 ①은 continueOnParry, 백스텝은 해머 사거리 밖으로', () => {
    const d = enemyDef('skeleton_sword');
    expect(d.attack).toMatchObject({ type: 'slash', parryable: true, telegraph: 'blue' });
    expect(d.comboAttack).toMatchObject({ parryable: true, telegraph: 'blue', continueOnParry: true, cooldownTicks: 360 });
    expect(d.comboAttack!.comboNext).toMatchObject({ parryable: true, telegraph: 'blue' });
    expect(d.comboAttack!.comboNext!.comboNext).toBeUndefined(); // 두 타
    expect(d.comboAttack!.comboNext!.windupTicks).toBeLessThan(d.comboAttack!.windupTicks); // ②가 더 빠르다
    expect(d.chargeAttack).toMatchObject({ type: 'thrust', parryable: true, telegraph: 'blue', minRange: 3.2, maxRange: 6.5 });
    expect(d.evade).toMatchObject({ maxDist: 4.0, distance: 2.4, ticks: 12, cooldownTicks: 180, lungeAfter: true });
    expect(balance.playerKnockback['slash']).toBe(1.2); // 베기 밀림 종류
    // 백스텝 뒤 자리(2.6 + 2.4)가 찔러 들어오기 minRange 밖이어야 반격이 나간다
    expect(d.attackRange + d.evade!.distance).toBeGreaterThan(d.chargeAttack!.minRange!);
  });

  it('해머병 — 내려치기 파랑, 지면 강타는 빨강·광역·requiresBlocking·막아도 0.7, 돌격 파랑', () => {
    const d = enemyDef('skeleton_hammer');
    expect(d.attack).toMatchObject({ type: 'smash', parryable: true, telegraph: 'blue', windupTicks: 32 });
    expect(d.closeAttack).toMatchObject({ aoeRadius: 3.4, requiresBlocking: true, parryable: false, telegraph: 'red', blockedDamageRatio: 0.7, blockedKnockbackMul: 1.0, cooldownTicks: 300 });
    expect(d.chargeAttack).toMatchObject({ parryable: true, telegraph: 'blue', chargeRunTicks: 42, minRange: 4.5, maxRange: 9.5 });
    // 후열 대기 거리(6m)는 돌격 발동 구간(4.5~9.5) 안이어야 기다리다 들어올 수 있다
    expect(d.formation!.holdRange!).toBeGreaterThanOrEqual(d.chargeAttack!.minRange!);
    expect(d.formation!.holdRange!).toBeLessThanOrEqual(d.chargeAttack!.maxRange!);
  });

  it('방패병 — 정면 방패 150°, 찌르기·밀쳐내기 파랑, 방패 돌격 빨강(막아도 그대로 밀림), 엄호 정의', () => {
    const d = enemyDef('skeleton_shield');
    expect(d.frontalShieldBlocksProjectiles).toBe(true);
    expect(d.shieldArcDeg).toBe(150);
    expect(d.attack).toMatchObject({ type: 'thrust', parryable: true, telegraph: 'blue' });
    expect(d.shieldBash).toMatchObject({ type: 'bash', parryable: true, telegraph: 'blue', damage: 40 });
    expect(d.chargeAttack).toMatchObject({ type: 'bash', parryable: false, telegraph: 'red', blockedKnockbackMul: 1.0, playerKnockback: 5.0 });
    expect(d.coverAllies).toEqual({ radius: 7, speedMul: 1.35, standoff: 1.3 });
  });

  it('상태이상 규약 — 어느 공격에도 statusOnHit/statusOnBlock 이 없다(Status.test 의 공용 규약과 같다)', () => {
    for (const t of TYPES) {
      const d = enemyDef(t);
      for (const a of [d.attack, d.closeAttack, d.chargeAttack, d.shieldBash, d.comboAttack, d.comboAttack?.comboNext]) {
        if (!a) continue;
        expect(a.statusOnHit).toBeUndefined();
        expect(a.statusOnBlock).toBeUndefined();
      }
    }
  });
});

describe('해골 검사 — 백스텝 → 찔러 들어오기', () => {
  it('추격 중 해머 스윙이 시작되면(weapon.swingSeq) 뒤로 12틱 2.4m 뛰고, 착지 틱에 찔러 들어오기 예고가 난다', () => {
    const world = arena();
    const ev = enemyDef('skeleton_sword').evade!;
    const sword = add(world, 'skeleton_sword', 23.5, 16, 1); // 3.5m — 사거리(2.6) 밖, 백스텝 maxDist(4.0) 안
    sword.chargeCooldown = 9999; // 거리 발동 돌격은 막는다 — 백스텝 뒤 반격(wantsCharge 우회)만 본다
    const evades = record(world, 'enemy_evade');
    const charges = record(world, 'enemy_charge');
    ticks(world, 1); // 스윙 번호 동기화(seenSwingSeq) + 한 걸음
    expect(sword.hopTicks ?? 0).toBe(0);
    const before = sword.x;
    world.weapon.swingSeq = 1; // 플레이어가 휘두르기 시작했다
    ticks(world, 1); // 이 틱에 뛰기를 결정한다(chase 안) — 이동은 다음 틱부터(넉백처럼 앞단 가드)
    expect(sword.hopTicks).toBe(ev.ticks);
    expect(evades).toHaveLength(1);
    expect(sword.evadeCooldown).toBe(ev.cooldownTicks);
    ticks(world, ev.ticks);
    expect(sword.hopTicks).toBe(0);
    expect(sword.x - before).toBeCloseTo(ev.distance, 1); // 플레이어(−x 쪽) 반대로 2.4m
    expect(sword.wantsCharge).toBe(true);
    ticks(world, 1);
    expect(sword.ai).toBe('windup');
    expect(sword.attackMode).toBe('charge');
    expect(charges).toHaveLength(1);
    expect((charges[0] as { dist: number }).dist).toBeGreaterThanOrEqual(enemyDef('skeleton_sword').chargeAttack!.minRange!);
  });

  it('쿨다운 중의 스윙엔 반응하지 않고, maxDist 밖의 스윙에도 반응하지 않는다. 스윙 번호가 그대로면 아무 일 없다', () => {
    const world = arena();
    const sword = add(world, 'skeleton_sword', 23.5, 16, 1);
    sword.chargeCooldown = 9999;
    ticks(world, 1);
    world.weapon.swingSeq = 1;
    ticks(world, 1);
    expect(sword.hopTicks).toBeGreaterThan(0);
    ticks(world, 20); // 백스텝 끝, 쿨다운 진행 중 — 반격은 나간다(windup)
    world.weapon.swingSeq = 2;
    const hopBefore = sword.hopTicks ?? 0;
    ticks(world, 1);
    expect(sword.hopTicks ?? 0).toBe(hopBefore); // 두 번째 스윙엔 뛰지 않는다

    const far = arena();
    const s2 = add(far, 'skeleton_sword', 25.5, 16, 2); // 5.5m — maxDist 밖
    s2.chargeCooldown = 9999;
    ticks(far, 1);
    far.weapon.swingSeq = 1;
    ticks(far, 1);
    expect(s2.hopTicks ?? 0).toBe(0);

    const still = arena();
    const s3 = add(still, 'skeleton_sword', 23.5, 16, 3);
    s3.chargeCooldown = 9999;
    still.weapon.swingSeq = 4; // 첫 틱에 본 번호 그대로
    ticks(still, 3);
    expect(s3.hopTicks ?? 0).toBe(0);
  });

  it('Weapons — 해머를 휘두를 때마다 swingSeq 가 1 오른다(적 AI 가 읽는 스윙 시작 표지)', () => {
    const world = arena();
    expect(world.weapon.swingSeq).toBeUndefined();
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    expect(world.weapon.swingSeq).toBe(1);
    world.input = Input.emptySnapshot();
    for (let i = 0; i < 60; i++) Weapons.tick(world, DT);
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    expect(world.weapon.swingSeq).toBe(2);
  });
});

describe('해골 해머병 — 지면 강타는 방패를 든 플레이어에게만', () => {
  it('막지 않으면 내려치기(파랑), 막고 있으면 지면 강타(빨강·close)를 고르고 쿨다운이 걸린다', () => {
    const open = arena();
    const h1 = add(open, 'skeleton_hammer', 22.5, 16, 1); // 2.5m — 사거리(3.2)·강타 maxRange(3.2) 안
    ticks(open, 1);
    expect(h1.ai).toBe('windup');
    expect(h1.attackMode).toBe('melee');

    const guarded = arena();
    guarded.player.blocking = true;
    const windups = record(guarded, 'enemy_windup');
    const h2 = add(guarded, 'skeleton_hammer', 22.5, 16, 1);
    ticks(guarded, 1);
    expect(h2.ai).toBe('windup');
    expect(h2.attackMode).toBe('close');
    expect(h2.closeCooldown).toBe(enemyDef('skeleton_hammer').closeAttack!.cooldownTicks);
    expect(windups[0]).toMatchObject({ enemyType: 'skeleton_hammer', telegraph: 'red' });
  });

  it('강타 쿨다운 중엔 막고 있어도 내려치기로', () => {
    const world = arena();
    world.player.blocking = true;
    const h = add(world, 'skeleton_hammer', 22.5, 16, 1);
    h.closeCooldown = 100;
    ticks(world, 1);
    expect(h.attackMode).toBe('melee');
  });
});

describe('해골 대열 — 방패병 전열·검사 측면·해머병 후열', () => {
  it('검사는 10m 안에 방패병이 살아 있으면 산개 편각이 커진다(같은 자리·같은 id, 옆으로 더 벌어진다)', () => {
    const run = (withFront: boolean): number => {
      const world = arena();
      if (withFront) add(world, 'skeleton_shield', 23, 19, 1); // 검사에서 5.8m — 대열 반경 안
      const sword = add(world, 'skeleton_sword', 28, 16, 2); // 플레이어에서 8m
      sword.chargeCooldown = 9999;
      ticks(world, 30);
      return Math.abs(sword.z - 16);
    };
    const plain = run(false);
    const formed = run(true);
    expect(plain).toBeGreaterThan(0); // 기본 산개도 편각이 있다
    expect(formed).toBeGreaterThan(plain * 1.4);
  });

  it('해머병은 방패병이 앞에(플레이어에 더 가까이) 살아 있으면 holdRange(6m) 안에서 다가가지 않고(holding), 방패병이 죽으면 바로 접근한다', () => {
    const world = arena();
    const shield = add(world, 'skeleton_shield', 23, 16, 1); // 3m — 전열
    const hammer = add(world, 'skeleton_hammer', 25.5, 16, 2); // 5.5m — holdRange 안
    hammer.chargeCooldown = 9999;
    ticks(world, 10);
    expect(hammer.holding).toBe(true);
    expect(hammer.x).toBeCloseTo(25.5, 1);
    shield.alive = false;
    ticks(world, 10);
    expect(hammer.holding).toBe(false);
    expect(hammer.x).toBeLessThan(25.5 - 0.3);
  });

  it('방패병이 해머병보다 뒤에 있으면 해머병이 전열 — 기다리지 않는다. holdRange 밖에서는 holdRange 까지 걸어온다', () => {
    const behind = arena();
    add(behind, 'skeleton_shield', 29, 16, 1); // 9m — 해머병보다 뒤
    const h1 = add(behind, 'skeleton_hammer', 25.5, 16, 2);
    h1.chargeCooldown = 9999;
    ticks(behind, 10);
    expect(h1.holding).toBe(false);
    expect(h1.x).toBeLessThan(25.5 - 0.3);

    const far = arena();
    add(far, 'skeleton_shield', 23, 16, 1);
    const h2 = add(far, 'skeleton_hammer', 28, 16, 2); // 8m — holdRange 밖
    h2.chargeCooldown = 9999;
    ticks(far, 60);
    const d = Math.hypot(h2.x - 20, h2.z - 16);
    expect(d).toBeLessThan(8 - 0.5); // 걸어왔다
    expect(d).toBeGreaterThan(enemyDef('skeleton_hammer').formation!.holdRange! - 0.2); // holdRange 에서 멈춘다
    expect(h2.holding).toBe(true);
  });

  it('후열 대기 중에도 돌격 구간(4.5~9.5)이면 쿨다운이 돌아 달려 들어온다', () => {
    const world = arena();
    add(world, 'skeleton_shield', 23, 16, 1);
    const hammer = add(world, 'skeleton_hammer', 26, 16, 2); // 6m
    const charges = record(world, 'enemy_charge');
    ticks(world, 1);
    expect(hammer.attackMode).toBe('charge');
    expect(charges).toHaveLength(1);
  });
});

describe('해골 방패병 — 엄호', () => {
  it('7m 안의 동료가 혼절하면 그 동료와 플레이어 사이(standoff 1.3m)로 끼어들고 enemy_cover_start 를 한 번 낸다', () => {
    const world = arena();
    const sword = add(world, 'skeleton_sword', 24, 16, 2, 'staggered');
    sword.timer = 9999; // 혼절 유지
    const shield = add(world, 'skeleton_shield', 24, 20, 1); // 플레이어 5.66m(사거리 밖), 검사 4m
    shield.chargeCooldown = 9999;
    const covers = record(world, 'enemy_cover_start');
    ticks(world, 1);
    expect(shield.covering).toBe(true);
    expect(covers).toHaveLength(1);
    expect(covers[0]).toMatchObject({ enemyType: 'skeleton_shield', allyType: 'skeleton_sword' });
    ticks(world, 90);
    expect(covers).toHaveLength(1); // 한 번만
    // 목표 (22.7, 16) — 사거리(3.0)에 닿으면 공격 분기가 먼저 먹어 그 언저리에서 선다(혼절한 검사와의 분리력이 조금 밀어낸다)
    expect(Math.hypot(shield.x - 22.7, shield.z - 16)).toBeLessThan(1.5);
    expect(Math.hypot(shield.x - 20, shield.z - 16)).toBeLessThanOrEqual(enemyDef('skeleton_shield').attackRange + 0.3); // 플레이어 사거리까지 들어왔다
    expect(shield.z).toBeLessThan(18); // 플레이어–검사 선 쪽으로 내려왔다(사거리에 닿아 멈춘 자리)
  });

  it('혼절한 동료가 없으면(또는 깨어나면) 엄호를 접는다', () => {
    const world = arena();
    const sword = add(world, 'skeleton_sword', 24, 16, 2, 'staggered');
    sword.timer = 9999;
    const shield = add(world, 'skeleton_shield', 24, 20, 1);
    shield.chargeCooldown = 9999;
    ticks(world, 1);
    expect(shield.covering).toBe(true);
    sword.ai = 'chase';
    ticks(world, 1);
    expect(shield.covering).toBe(false);
  });
});

describe('해골 검사 — 이연격 패링 규약', () => {
  function startCombo(dist: number): { world: World; sword: EnemyState } {
    const world = arena();
    const sword = add(world, 'skeleton_sword', 20 + dist, 16, 1);
    ticks(world, 1);
    expect(sword.attackMode).toBe('combo');
    expect(sword.ai).toBe('windup');
    for (let i = 0; i < 40 && sword.ai === 'windup'; i++) Enemies.tick(world, DT);
    expect(sword.ai).toBe('active_perfect');
    return { world, sword };
  }

  it('①을 일반 패링하면 튕기되 짧은 이음(recoverTicks 8)만 두고 ②(역베기)가 온다 — 두 번 막아야 한다', () => {
    const { world, sword } = startCombo(2.3); // gap ≈ 2.3 − 0.4 − 0.936 = 0.96 → 일반 대역
    const steps = record(world, 'enemy_combo_step');
    const parries = record(world, 'parry_attempt');
    pressReaction(world);
    expect(parries[0]).toMatchObject({ result: 'normal', enemyType: 'skeleton_sword' });
    expect(sword.ai).toBe('recover');
    expect(sword.timer).toBe(enemyDef('skeleton_sword').comboAttack!.recoverTicks); // + parryRecoilTicks 가 아니다
    expect(sword.attackMode).toBe('combo');
    ticks(world, sword.timer);
    expect(sword.ai).toBe('windup');
    expect(sword.comboStep).toBe(1);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ enemyType: 'skeleton_sword', step: 1, steps: 2 });
  });

  it('①을 완벽 패링하면 무너진다(staggered 90) — 콤보는 끝나고 처형 창. 일어나도 ②는 오지 않는다', () => {
    const { world, sword } = startCombo(1.7); // gap ≈ 0.36 → 완벽 대역
    const steps = record(world, 'enemy_combo_step');
    const parries = record(world, 'parry_attempt');
    pressReaction(world);
    expect(parries[0]).toMatchObject({ result: 'perfect' });
    expect(sword.ai).toBe('staggered');
    expect(sword.timer).toBe(balance.reaction.staggerTicks);
    expect(sword.attackMode).toBe('melee');
    ticks(world, balance.reaction.staggerTicks + 1);
    expect(sword.ai).toBe('recover');
    ticks(world, sword.timer + 1);
    expect(steps).toHaveLength(0);
    expect(sword.attackMode).not.toBe('combo'); // 쿨다운(360) 중이라 단발 베기
  });
});

describe('해골 — 관통 무기는 절반', () => {
  /** 사격장 복도 — 플레이어 (6,6) 이 +X 를 본다 */
  function range(): World {
    return makeWorld(['#'.repeat(40), '#S' + '.'.repeat(37) + '#', '#'.repeat(40)], { x: 6, z: 6, yaw: -Math.PI / 2 });
  }
  function shotDamage(type: string): number {
    const world = range();
    const enemy = spawnEnemyAt(type, 6 + 5, 6, 1);
    enemy.health = 1000;
    enemy.ai = 'chase';
    world.enemies.push(enemy);
    const def = enemyDef(type);
    world.player.pitch = Math.atan2(def.height * 0.6 - balance.player.eyeHeight, 5); // 몸통
    world.input = { ...Input.emptySnapshot(), rangedPressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    return 1000 - enemy.health;
  }

  it('권총 몸통 한 발 — 해골은 고블린의 절반(pierceDamageMul 0.5)', () => {
    const goblin = shotDamage('goblin_runner');
    const skeleton = shotDamage('skeleton_sword');
    expect(goblin).toBeGreaterThan(0);
    expect(skeleton).toBeCloseTo(goblin * 0.5, 5);
  });
});
