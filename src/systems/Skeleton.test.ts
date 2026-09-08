// 해골 병사 3종(검사·해머병·방패병, docs/systems/skeletons.md) — 데이터 규약, 자세(poise: 끊김·슈퍼아머), 백스텝→찔러 들어오기, 회전 베기(360°),
// 찌르기 난무·지진(고리 광역)·방패 반격·방패 찍기(가드 부수기)·뼈 투척, 대열(flank 산개 확대·rear 대기), 엄호(coverAllies), 관통 배율. 렌더(뼈 흩어짐)는 시험하지 않는다
import { describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { attackReaches, enemyDef, implementedEnemyTypes, inSuperArmor, poiseInterruptible } from '../core/Entities';
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

/** 넓은 빈 방(12×8칸 = 48×32m) — 플레이어 (20,16) 중앙, +x 를 본다(yaw −π/2). 산개·대열이 벽에 걸리지 않는다 */
function arena(): World {
  const row = '#' + '.'.repeat(10) + '#';
  return makeWorld(['#'.repeat(12), '#S' + '.'.repeat(9) + '#', row, row, row, row, row, '#'.repeat(12)], { x: 20, z: 16, yaw: -Math.PI / 2 });
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

/** 해머 한 번 — 입력 뒤 닿는 틱까지 Weapons 만 돌린다(적 AI 는 멈춘 채) */
function hammerSwing(world: World): void {
  world.weapon.meleeCooldown = 0;
  world.input = { ...Input.emptySnapshot(), meleePressed: true };
  Weapons.tick(world, DT);
  world.input = Input.emptySnapshot();
  for (let i = 0; i < 40 && world.weapon.swingImpact > 0; i++) Weapons.tick(world, DT);
}

/** 권총 한 발 — 몸통 높이 */
function pistolShot(world: World, target: EnemyState): void {
  const def = enemyDef(target.type);
  const d = Math.hypot(target.x - world.player.x, target.z - world.player.z);
  world.player.yaw = Math.atan2(-(target.x - world.player.x), -(target.z - world.player.z));
  world.player.pitch = Math.atan2(def.height * 0.6 - balance.player.eyeHeight, d);
  world.weapon.cooldown = 0;
  world.input = { ...Input.emptySnapshot(), rangedPressed: true };
  Weapons.tick(world, DT);
  world.input = Input.emptySnapshot();
}

describe('해골 병사 — 데이터 규약', () => {
  it('셋 다 구현 목록·스포너에 있고, 관통 절반·끊김(interruptible)·대열 역할·체급이 정해져 있다', () => {
    for (const t of TYPES) {
      expect(implementedEnemyTypes()).toContain(t);
      expect(isSpawnable(t)).toBe(true);
      const d = enemyDef(t);
      expect(d.pierceDamageMul).toBe(0.5);
      expect(poiseInterruptible(d)).toBe(true);
      expect(['light', 'medium', 'heavy']).toContain(d.weight);
      expect(d.attack.hitOnContact).toBe(true); // 근접 종족 규약
      expect(d.attack.superArmor ?? false).toBe(t === 'skeleton_hammer'); // 기본 공격은 해머병만 슈퍼아머
    }
    expect(poiseInterruptible(enemyDef('goblin_spear'))).toBe(false); // 기존 적은 옛 규칙(끊기지 않음)
    expect(balance.poise.defaultInterruptible).toBe(false);
    expect(enemyDef('skeleton_sword').formation).toMatchObject({ role: 'flank', offsetDeg: 75 });
    expect(enemyDef('skeleton_hammer').formation).toMatchObject({ role: 'rear', holdRange: 6.0 });
    expect(enemyDef('skeleton_shield').formation).toEqual({ role: 'front' });
    expect(enemyDef('skeleton_hammer').weight).toBe('heavy');
    expect(enemyDef('skeleton_hammer').blockCannotStagger).toBe(true);
  });

  it('검사 — 베기·회전 베기(360°, 교대) 파랑·끊김, 찌르기 난무 3타 전부 슈퍼아머·①②continueOnParry, 찔러 들어오기 슈퍼아머, 뼈 투척 보라·반사·쿨 300', () => {
    const d = enemyDef('skeleton_sword');
    expect(d.attack).toMatchObject({ type: 'slash', arcDeg: 100, parryable: true, telegraph: 'blue' });
    expect(d.attack.superArmor).toBeUndefined();
    expect(d.attackAlt).toMatchObject({ alternate: true, arcDeg: 360, parryable: true, telegraph: 'blue' });
    const chain = [d.comboAttack!, d.comboAttack!.comboNext!, d.comboAttack!.comboNext!.comboNext!];
    expect(d.comboAttack!.comboNext!.comboNext!.comboNext).toBeUndefined(); // 세 타
    for (const step of chain) expect(step).toMatchObject({ type: 'thrust', parryable: true, telegraph: 'blue', superArmor: true });
    expect(chain[0]!.continueOnParry).toBe(true);
    expect(chain[1]!.continueOnParry).toBe(true);
    expect(chain[2]!.continueOnParry).toBeUndefined();
    expect(d.comboAttack!.cooldownTicks).toBe(420);
    expect(d.chargeAttack).toMatchObject({ type: 'thrust', parryable: true, telegraph: 'blue', superArmor: true, minRange: 3.2, maxRange: 6.5 });
    expect(d.rangedAttack).toMatchObject({ type: 'projectile', projectileKind: 'bone', deflectable: true, breakable: true, telegraph: 'purple', minRange: 7, cooldownTicks: 300 });
    expect(d.evade).toMatchObject({ maxDist: 4.0, distance: 2.4, ticks: 12, cooldownTicks: 180, lungeAfter: true });
    expect(balance.playerKnockback['slash']).toBe(1.2);
    expect(d.attackRange + d.evade!.distance).toBeGreaterThan(d.chargeAttack!.minRange!); // 백스텝 뒤 자리가 찔러 들어오기 구간
    expect(balance.skeleton.boneThrow.armlessTicks).toBeGreaterThan(0);
  });

  it('해머병 — 내려치기 파랑·슈퍼아머, 지진 = 강타(3.4) → 여진 고리(3.2~6.5) 둘 다 빨강·슈퍼아머·막아도 0.7, 달려와 내려치기는 끊긴다', () => {
    const d = enemyDef('skeleton_hammer');
    expect(d.attack).toMatchObject({ type: 'smash', parryable: true, telegraph: 'blue', windupTicks: 32, superArmor: true });
    expect(d.comboAttack).toMatchObject({ aoeRadius: 3.4, parryable: false, telegraph: 'red', superArmor: true, blockedDamageRatio: 0.7, blockedKnockbackMul: 1.0, cooldownTicks: 480 });
    expect(d.comboAttack!.comboNext).toMatchObject({ aoeRadius: 6.5, aoeInnerRadius: 3.2, parryable: false, telegraph: 'red', superArmor: true });
    expect(d.comboAttack!.comboNext!.comboNext).toBeUndefined();
    expect(d.closeAttack).toBeUndefined(); // 방패 부수기는 방패병으로 갔다
    expect(d.chargeAttack).toMatchObject({ parryable: true, telegraph: 'blue', chargeRunTicks: 42, minRange: 4.5, maxRange: 9.5 });
    expect(d.chargeAttack!.superArmor).toBeUndefined();
    expect(d.formation!.holdRange!).toBeGreaterThanOrEqual(d.chargeAttack!.minRange!);
    expect(d.formation!.holdRange!).toBeLessThanOrEqual(d.chargeAttack!.maxRange!);
  });

  it('방패병 — 정면 방패 150°, 찌르기 파랑·끊김, 방패 반격 파랑·슈퍼아머·쿨 150, 방패 찍기 빨강·requiresBlocking·guardBreak 40·슈퍼아머, 밀쳐내기 슬롯 없음, 엄호', () => {
    const d = enemyDef('skeleton_shield');
    expect(d.frontalShieldBlocksProjectiles).toBe(true);
    expect(d.shieldArcDeg).toBe(150);
    expect(d.attack).toMatchObject({ type: 'thrust', parryable: true, telegraph: 'blue' });
    expect(d.attack.superArmor).toBeUndefined();
    expect(d.shieldBash).toBeUndefined();
    expect(d.shieldRiposte).toMatchObject({ type: 'thrust', windupTicks: 8, parryable: true, telegraph: 'blue', superArmor: true, cooldownTicks: 150 });
    expect(d.closeAttack).toMatchObject({ type: 'bash', requiresBlocking: true, parryable: false, telegraph: 'red', superArmor: true, blockedDamageRatio: 1.0, guardBreak: { stunTicks: 40 }, cooldownTicks: 240 });
    expect(d.chargeAttack).toMatchObject({ type: 'bash', parryable: false, telegraph: 'red', blockedKnockbackMul: 1.0, playerKnockback: 5.0 });
    expect(d.chargeAttack!.superArmor).toBeUndefined();
    expect(d.coverAllies).toEqual({ radius: 7, speedMul: 1.35, standoff: 1.3 });
  });

  it('상태이상 규약 — 어느 공격에도 statusOnHit/statusOnBlock 이 없다(Status.test 의 공용 규약과 같다)', () => {
    for (const t of TYPES) {
      const d = enemyDef(t);
      const all = [d.attack, d.attackAlt, d.closeAttack, d.chargeAttack, d.shieldRiposte, d.rangedAttack];
      for (let a = d.comboAttack; a; a = a.comboNext) all.push(a);
      for (const a of all) {
        if (!a) continue;
        expect(a.statusOnHit).toBeUndefined();
        expect(a.statusOnBlock).toBeUndefined();
      }
    }
  });
});

describe('자세(poise) — 끊김과 슈퍼아머', () => {
  it('끊길 수 있는 예고(방패병 찌르기)에 해머가 박히면 그 틱에 공격이 끊겨 interruptTicks 튕겨 뻗는다(enemy_interrupted) — 굳힘(attackFreeze)은 걸리지 않는다', () => {
    const world = arena();
    const shield = add(world, 'skeleton_shield', 22.4, 16, 1); // 2.4m — 사거리 안
    ticks(world, 1);
    expect(shield.ai).toBe('windup');
    expect(shield.attackMode).toBe('melee');
    expect(shield.poiseHealthRef).toBe(shield.health);
    shield.shieldBroken = true; // 방패는 이 시험의 대상이 아니다 — 해머가 몸에 닿게
    const interrupted = record(world, 'enemy_interrupted');
    const hp = shield.health;
    hammerSwing(world);
    expect(shield.health).toBeLessThan(hp);
    expect(shield.attackFreezeTicks ?? 0).toBe(0); // 끊길 예고는 굳히지 않는다
    expect(shield.ai).toBe('windup'); // 끊김은 다음 Enemies 틱에
    ticks(world, 1);
    expect(shield.ai).toBe('recover');
    expect(shield.timer).toBe(balance.poise.interruptTicks);
    expect(shield.recoiled).toBe(true);
    expect(shield.poiseHealthRef).toBeUndefined();
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({ enemyType: 'skeleton_shield', ticks: balance.poise.interruptTicks });
  });

  it('슈퍼아머 예고(해머병 내려치기)는 해머를 맞아도 끊기지 않고 굳지도 밀리지도 않는다 — 피해만 들어가고 armored_hit', () => {
    const world = arena();
    const hammer = add(world, 'skeleton_hammer', 22.6, 16, 1);
    hammer.comboCooldown = 9999; // 지진이 아니라 내려치기를 보게
    ticks(world, 1);
    expect(hammer.ai).toBe('windup');
    expect(hammer.attackMode).toBe('melee');
    expect(inSuperArmor(enemyDef('skeleton_hammer'), hammer)).toBe(true);
    expect(hammer.poiseHealthRef).toBeUndefined(); // 기준이 서지 않는다
    const armored = record(world, 'armored_hit');
    const interrupted = record(world, 'enemy_interrupted');
    const hp = hammer.health;
    const timer = hammer.timer;
    hammerSwing(world); // 1타
    hammerSwing(world); // 2타
    hammerSwing(world); // 3타(마무리 — 평소엔 넉백)
    expect(hammer.health).toBeLessThan(hp);
    expect(hammer.attackFreezeTicks ?? 0).toBe(0);
    expect(hammer.kbTicks ?? 0).toBe(0);
    expect(armored.length).toBeGreaterThanOrEqual(3);
    ticks(world, 1);
    expect(hammer.ai).toBe('windup');
    expect(hammer.timer).toBe(timer - 1); // 예고가 그대로 흘러간다
    expect(interrupted).toHaveLength(0);
  });

  it('슈퍼아머는 무적이 아니다 — 피해는 전부 들어가고 체력이 0 이면 그 자리에서 죽는다(melee_kill·enemy_died)', () => {
    const world = arena();
    const hammer = add(world, 'skeleton_hammer', 22.6, 16, 1);
    hammer.comboCooldown = 9999;
    ticks(world, 1);
    expect(inSuperArmor(enemyDef('skeleton_hammer'), hammer)).toBe(true);
    hammer.health = balance.weapons.hammer.damage * 1.5; // 두 타면 죽는 체력
    const kills = record(world, 'melee_kill');
    const died = record(world, 'enemy_died');
    hammerSwing(world);
    expect(hammer.alive).toBe(true);
    expect(hammer.health).toBeCloseTo(balance.weapons.hammer.damage * 0.5, 5);
    hammerSwing(world);
    expect(hammer.alive).toBe(false);
    expect(kills).toHaveLength(1);
    expect(died).toHaveLength(1);
    expect(died[0]).toMatchObject({ enemyType: 'skeleton_hammer', enemyId: hammer.id });
  });

  it('슈퍼아머 예고 이벤트에는 superArmor 표지와 자리(x,z)가 실린다 — main 이 잠기는 소리·발밑 먼지를 낸다', () => {
    const world = arena();
    const hammer = add(world, 'skeleton_hammer', 22.6, 16, 1);
    hammer.comboCooldown = 9999;
    const windups = record(world, 'enemy_windup');
    ticks(world, 1);
    expect(windups[0]).toMatchObject({ enemyType: 'skeleton_hammer', superArmor: true, x: hammer.x, z: hammer.z });
    const w2 = arena();
    const s2 = add(w2, 'skeleton_shield', 22.4, 16, 1);
    const wu2 = record(w2, 'enemy_windup');
    ticks(w2, 1);
    expect(s2.attackMode).toBe('melee');
    expect(wu2[0]).toMatchObject({ superArmor: false });
  });

  it('총알은 끊지 못한다 — 기준 체력이 되맞춰진다(패링 게임을 지우지 않는다)', () => {
    const world = arena();
    const shield = add(world, 'skeleton_shield', 22.4, 16, 1);
    ticks(world, 1);
    expect(shield.ai).toBe('windup');
    shield.shieldBroken = true;
    const hp = shield.health;
    pistolShot(world, shield);
    expect(shield.health).toBeLessThan(hp);
    expect(shield.poiseHealthRef).toBe(shield.health);
    ticks(world, 1);
    expect(shield.ai).toBe('windup');
  });

  it('기존 적(고블린 창병)은 옛 규칙 — 해머 1타에 굳고(attackFreeze) 끊기지 않는다', () => {
    const world = arena();
    const spear = add(world, 'goblin_spear', 23, 16, 1);
    ticks(world, 1);
    expect(spear.ai).toBe('windup');
    spear.shieldBroken = true;
    hammerSwing(world);
    expect(spear.attackFreezeTicks).toBeGreaterThan(0);
    ticks(world, spear.attackFreezeTicks! + 1);
    expect(spear.ai).toBe('windup');
  });

  it('달려와 내려치기(해머병) 질주 중 화살·해머급 피해(체력 감소)가 들어가면 끊겨 고꾸라진다', () => {
    const world = arena();
    const hammer = add(world, 'skeleton_hammer', 26, 16, 1); // 6m — 돌격 구간
    const charges = record(world, 'enemy_charge');
    ticks(world, 1);
    expect(hammer.attackMode).toBe('charge');
    expect(charges).toHaveLength(1);
    expect(hammer.poiseHealthRef).toBe(hammer.health); // 슈퍼아머 없음 — 끊길 수 있다
    for (let i = 0; i < 60 && hammer.ai !== 'charging'; i++) Enemies.tick(world, DT);
    expect(hammer.ai).toBe('charging');
    hammer.health -= 10; // 화살 한 발에 해당(총알이 아닌 피해는 기준을 되맞추지 않는다)
    ticks(world, 1);
    expect(hammer.ai).toBe('recover');
    expect(hammer.timer).toBe(balance.poise.interruptTicks);
  });
});

describe('해골 검사 — 백스텝 → 찔러 들어오기(슈퍼아머)', () => {
  it('추격 중 해머 스윙이 시작되면(weapon.swingSeq) 뒤로 12틱 2.4m 뛰고, 착지 틱에 찔러 들어오기 예고가 난다 — 그 예고는 끊기지 않는다', () => {
    const world = arena();
    const ev = enemyDef('skeleton_sword').evade!;
    const sword = add(world, 'skeleton_sword', 23.5, 16, 1); // 3.5m — 사거리(2.6) 밖, 백스텝 maxDist(4.0) 안
    sword.chargeCooldown = 9999;
    const evades = record(world, 'enemy_evade');
    const charges = record(world, 'enemy_charge');
    ticks(world, 1);
    const before = sword.x;
    world.weapon.swingSeq = 1;
    ticks(world, 1);
    expect(sword.hopTicks).toBe(ev.ticks);
    expect(evades).toHaveLength(1);
    ticks(world, ev.ticks);
    expect(sword.x - before).toBeCloseTo(ev.distance, 1);
    expect(sword.wantsCharge).toBe(true);
    ticks(world, 1);
    expect(sword.ai).toBe('windup');
    expect(sword.attackMode).toBe('charge');
    expect(charges).toHaveLength(1);
    expect(inSuperArmor(enemyDef('skeleton_sword'), sword)).toBe(true);
    expect(sword.poiseHealthRef).toBeUndefined();
  });

  it('쿨다운 중·maxDist 밖·번호 그대로면 뛰지 않는다', () => {
    const world = arena();
    const sword = add(world, 'skeleton_sword', 23.5, 16, 1);
    sword.chargeCooldown = 9999;
    ticks(world, 1);
    world.weapon.swingSeq = 1;
    ticks(world, 1);
    expect(sword.hopTicks).toBeGreaterThan(0);
    ticks(world, 20);
    world.weapon.swingSeq = 2;
    const hopBefore = sword.hopTicks ?? 0;
    ticks(world, 1);
    expect(sword.hopTicks ?? 0).toBe(hopBefore);

    const far = arena();
    const s2 = add(far, 'skeleton_sword', 25.5, 16, 2);
    s2.chargeCooldown = 9999;
    s2.rangedCooldown = 9999;
    ticks(far, 1);
    far.weapon.swingSeq = 1;
    ticks(far, 1);
    expect(s2.hopTicks ?? 0).toBe(0);
  });

  it('Weapons — 해머를 휘두를 때마다 swingSeq 가 1 오른다', () => {
    const world = arena();
    expect(world.weapon.swingSeq).toBeUndefined();
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    expect(world.weapon.swingSeq).toBe(1);
  });
});

describe('해골 검사 — 회전 베기·찌르기 난무·뼈 투척', () => {
  it('회전 베기(attackAlt 360°)는 등 뒤의 플레이어에게도 닿고, 베기(100°)는 닿지 않는다. 사거리 안에서 베기와 교대로 나간다', () => {
    const d = enemyDef('skeleton_sword');
    const sword = { x: 20, z: 16, yaw: 0 }; // -z 를 본다
    expect(attackReaches(d, sword, d.attackAlt!, 20, 16 + 2.0)).toBe(true); // 등 뒤 2m
    expect(attackReaches(d, sword, d.attack, 20, 16 + 2.0)).toBe(false);
    expect(attackReaches(d, sword, d.attackAlt!, 20 + 2.0, 16)).toBe(true); // 옆

    const world = arena();
    const e = add(world, 'skeleton_sword', 22.2, 16, 1);
    e.comboCooldown = 9999; // 난무는 빼고 교대만 본다
    ticks(world, 1);
    const first = e.attackMode;
    expect(['melee', 'alt']).toContain(first);
    // 한 공격을 끝까지 흘려보낸 뒤 다음 선택
    for (let i = 0; i < 200 && e.ai !== 'chase'; i++) Enemies.tick(world, DT);
    world.player.iframeTicks = 0;
    ticks(world, 1);
    expect(e.ai).toBe('windup');
    expect(e.attackMode).not.toBe(first);
  });

  it('찌르기 난무 — 사거리 안 첫 선택. ①을 일반 패링하면 짧은 이음 뒤 ②, 어느 타든 완벽 패링이면 무너진다. 셋 다 슈퍼아머라 해머로 끊을 수 없다', () => {
    const start = (dist: number): { world: World; sword: EnemyState } => {
      const world = arena();
      const sword = add(world, 'skeleton_sword', 20 + dist, 16, 1);
      ticks(world, 1);
      expect(sword.attackMode).toBe('combo');
      for (let i = 0; i < 40 && sword.ai === 'windup'; i++) Enemies.tick(world, DT);
      expect(sword.ai).toBe('active_perfect');
      return { world, sword };
    };
    // 일반 패링 대역: gap = dist − 0.4 − 0.3×(2.6×1.25) ≈ dist − 1.375 ∈ (0.4, 1.3]
    const { world, sword } = start(2.4);
    const parries = record(world, 'parry_attempt');
    const steps = record(world, 'enemy_combo_step');
    expect(inSuperArmor(enemyDef('skeleton_sword'), sword)).toBe(true);
    pressReaction(world);
    expect(parries[0]).toMatchObject({ result: 'normal' });
    expect(sword.ai).toBe('recover');
    expect(sword.timer).toBe(enemyDef('skeleton_sword').comboAttack!.recoverTicks);
    ticks(world, sword.timer);
    expect(sword.ai).toBe('windup');
    expect(sword.comboStep).toBe(1);
    expect(steps).toHaveLength(1);
    // ② 예고 중 해머 — 끊기지 않는다
    const interrupted = record(world, 'enemy_interrupted');
    hammerSwing(world);
    ticks(world, 1);
    expect(interrupted).toHaveLength(0);
    expect(sword.attackMode).toBe('combo');

    const perfect = start(1.7); // gap ≈ 0.33 → 완벽
    const p2 = record(perfect.world, 'parry_attempt');
    pressReaction(perfect.world);
    expect(p2[0]).toMatchObject({ result: 'perfect' });
    expect(perfect.sword.ai).toBe('staggered');
    expect(perfect.sword.attackMode).toBe('melee');
  });

  it('뼈 투척 — 7m 밖·시야에서 rangedAttack, 쿨 300 이 걸리고, 던진 뒤 armlessTicks 동안 왼팔이 없다. 투사체는 bone·반사 가능', () => {
    const world = arena();
    const sword = add(world, 'skeleton_sword', 28, 16, 1); // 8m
    const casts = record(world, 'enemy_cast');
    ticks(world, 1);
    expect(sword.ai).toBe('windup');
    expect(sword.attackMode).toBe('ranged');
    expect(sword.rangedCooldown).toBe(300);
    for (let i = 0; i < 60 && sword.ai === 'windup'; i++) Enemies.tick(world, DT);
    expect(casts).toHaveLength(1);
    expect(sword.armlessTicks).toBe(balance.skeleton.boneThrow.armlessTicks);
    const bone = world.projectiles.find((p) => p.casterId === sword.id);
    expect(bone).toMatchObject({ kind: 'bone', deflectable: true, owner: 'enemy', damage: 30 });
    // 쿨다운 중엔 걸어온다(다시 던지지 않는다)
    for (let i = 0; i < 40 && sword.ai !== 'chase'; i++) Enemies.tick(world, DT);
    const x0 = sword.x;
    ticks(world, 10);
    expect(sword.ai).toBe('chase'); // 다시 던지지 않았다(attackMode 표지는 다음 선택까지 남는다)
    expect(sword.x).toBeLessThan(x0);
  });
});

describe('해골 해머병 — 지진(고리 광역)', () => {
  it('여진(aoeInnerRadius 3.2, aoeRadius 6.5)은 안쪽에 붙은 플레이어에게 닿지 않고 4~6.5m 만 맞는다', () => {
    const d = enemyDef('skeleton_hammer');
    const after = d.comboAttack!.comboNext!;
    const h = { x: 20, z: 16, yaw: 0 };
    expect(attackReaches(d, h, after, 20, 16 + 2.5)).toBe(false); // 안쪽
    expect(attackReaches(d, h, after, 20, 16 + 4.5)).toBe(true); // 고리
    expect(attackReaches(d, h, after, 20 - 6.0, 16)).toBe(true); // 뒤쪽도(원형)
    expect(attackReaches(d, h, after, 20, 16 + 7.0)).toBe(false); // 밖
    expect(attackReaches(d, h, d.comboAttack!, 20, 16 + 2.5)).toBe(true); // 강타는 안쪽
  });

  it('사거리 안에서 지진이 첫 선택 — ① 강타(빨강) 뒤 이음 16틱 뒤 ② 여진, 둘 다 예고 중 해머에 끊기지 않는다', () => {
    const world = arena();
    const hammer = add(world, 'skeleton_hammer', 22.5, 16, 1);
    const windups = record(world, 'enemy_windup');
    const slams = record(world, 'ground_slam');
    const interrupted = record(world, 'enemy_interrupted');
    ticks(world, 1);
    expect(hammer.attackMode).toBe('combo');
    expect(windups[0]).toMatchObject({ telegraph: 'red', superArmor: true });
    hammerSwing(world);
    ticks(world, 1);
    expect(interrupted).toHaveLength(0);
    for (let i = 0; i < 80 && slams.length === 0; i++) Enemies.tick(world, DT);
    expect(slams).toHaveLength(1);
    expect(hammer.ai).toBe('recover');
    expect(hammer.timer).toBe(enemyDef('skeleton_hammer').comboAttack!.recoverTicks);
    ticks(world, hammer.timer);
    expect(hammer.ai).toBe('windup');
    expect(hammer.comboStep).toBe(1);
    for (let i = 0; i < 80 && slams.length < 2; i++) Enemies.tick(world, DT);
    expect(slams).toHaveLength(2);
    expect((slams[1] as { radius: number }).radius).toBe(6.5);
  });
});

describe('해골 방패병 — 방패 반격·방패 찍기', () => {
  it('해머 1타가 방패에 막힌 순간 wantsRiposte → 다음 틱 방패 반격 예고(riposte·슈퍼아머), 쿨 150 안의 다음 막힘은 반격 없이 방패만 깎인다', () => {
    const world = arena();
    const shield = add(world, 'skeleton_shield', 23.4, 16, 1); // 3.4m — 사거리(3.0) 밖(걸어오는 중), 해머 사거리(3.1+0.6) 안
    shield.chargeCooldown = 9999;
    ticks(world, 1);
    expect(shield.ai).toBe('chase');
    const riposte = record(world, 'shield_riposte_start');
    hammerSwing(world);
    expect(shield.wantsRiposte).toBe(true);
    expect(shield.riposteCooldown).toBe(150);
    expect(shield.shieldHits).toBe(1);
    expect(shield.braceTicks ?? 0).toBe(0); // 웅크리지 않는다 — 곧 찌른다
    ticks(world, 1);
    expect(shield.ai).toBe('windup');
    expect(shield.attackMode).toBe('riposte');
    expect(riposte).toHaveLength(1);
    expect(inSuperArmor(enemyDef('skeleton_shield'), shield)).toBe(true);

    const w2 = arena();
    const s2 = add(w2, 'skeleton_shield', 23.4, 16, 2);
    s2.chargeCooldown = 9999;
    s2.riposteCooldown = 100;
    ticks(w2, 1);
    hammerSwing(w2);
    expect(s2.wantsRiposte ?? false).toBe(false);
    expect(s2.shieldHits).toBe(1);
    expect(s2.braceTicks).toBeGreaterThan(0);
  });

  it('방패 찍기 — 플레이어가 막고 있을 때만(requiresBlocking) 고른다(빨강·close). 막으면 피해 그대로·guard_broken 40틱 굳음', () => {
    const open = arena();
    const s1 = add(open, 'skeleton_shield', 22.4, 16, 1);
    ticks(open, 1);
    expect(s1.attackMode).toBe('melee');

    const guarded = arena();
    guarded.player.blocking = true;
    const broken = record(guarded, 'guard_broken');
    const windups = record(guarded, 'enemy_windup');
    const s2 = add(guarded, 'skeleton_shield', 22.4, 16, 1);
    ticks(guarded, 1);
    expect(s2.attackMode).toBe('close');
    expect(s2.closeCooldown).toBe(240);
    expect(windups[0]).toMatchObject({ telegraph: 'red', superArmor: true });
    const hp = guarded.player.health;
    for (let i = 0; i < 80 && broken.length === 0; i++) Enemies.tick(guarded, DT);
    expect(broken).toHaveLength(1);
    expect(guarded.player.stunTicks).toBe(40);
    expect(hp - guarded.player.health).toBe(enemyDef('skeleton_shield').closeAttack!.damage); // blockedDamageRatio 1 — 막아도 그대로
  });
});

describe('해골 대열 — 방패병 전열·검사 측면·해머병 후열', () => {
  it('검사는 10m 안에 방패병이 살아 있으면 산개 편각이 커진다', () => {
    const run = (withFront: boolean): number => {
      const world = arena();
      if (withFront) add(world, 'skeleton_shield', 23, 19, 1);
      const sword = add(world, 'skeleton_sword', 28, 16, 2);
      sword.chargeCooldown = 9999;
      sword.rangedCooldown = 9999;
      ticks(world, 30);
      return Math.abs(sword.z - 16);
    };
    const plain = run(false);
    const formed = run(true);
    expect(plain).toBeGreaterThan(0);
    expect(formed).toBeGreaterThan(plain * 1.4);
  });

  it('해머병은 방패병이 앞에 살아 있으면 holdRange 안에서 다가가지 않고(holding), 방패병이 죽으면 접근한다', () => {
    const world = arena();
    const shield = add(world, 'skeleton_shield', 23, 16, 1);
    const hammer = add(world, 'skeleton_hammer', 25.5, 16, 2);
    hammer.chargeCooldown = 9999;
    ticks(world, 10);
    expect(hammer.holding).toBe(true);
    expect(hammer.x).toBeCloseTo(25.5, 1);
    shield.alive = false;
    ticks(world, 10);
    expect(hammer.holding).toBe(false);
    expect(hammer.x).toBeLessThan(25.5 - 0.3);
  });

  it('후열 대기 중에도 돌격 구간이면 쿨다운이 돌아 달려 들어온다', () => {
    const world = arena();
    add(world, 'skeleton_shield', 23, 16, 1);
    const hammer = add(world, 'skeleton_hammer', 26, 16, 2);
    const charges = record(world, 'enemy_charge');
    ticks(world, 1);
    expect(hammer.attackMode).toBe('charge');
    expect(charges).toHaveLength(1);
  });
});

describe('해골 방패병 — 엄호', () => {
  it('7m 안의 동료가 혼절하면 그 동료와 플레이어 사이로 끼어들고 enemy_cover_start 를 한 번 낸다', () => {
    const world = arena();
    const sword = add(world, 'skeleton_sword', 24, 16, 2, 'staggered');
    sword.timer = 9999;
    const shield = add(world, 'skeleton_shield', 24, 20, 1);
    shield.chargeCooldown = 9999;
    const covers = record(world, 'enemy_cover_start');
    ticks(world, 1);
    expect(shield.covering).toBe(true);
    expect(covers).toHaveLength(1);
    ticks(world, 90);
    expect(covers).toHaveLength(1);
    expect(Math.hypot(shield.x - 22.7, shield.z - 16)).toBeLessThan(1.5);
    expect(Math.hypot(shield.x - 20, shield.z - 16)).toBeLessThanOrEqual(enemyDef('skeleton_shield').attackRange + 0.3);
  });
});

describe('해골 — 관통 무기는 절반', () => {
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
    world.player.pitch = Math.atan2(def.height * 0.6 - balance.player.eyeHeight, 5);
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
