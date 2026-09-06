// B2-4 검증 — 플레이어 상태 2종(팔 저림 numb_arm·진탕 concussion) + Status.ts (docs/systems/boss_scythe_behemoth.md §6).
// 카운터 감소·상한(maxConcurrent)·해제 규칙(expired/cured/displaced), 저림 게이트(Reaction 완벽 불가·일반 패링 해제·Mana 소실 면제·PlayerMove 방어 이속),
// 진탕(돌격 직격만·막으면 없음·조준 흔들림 채널·체력 물약이 지움·isUseful).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { enemyDef, implementedEnemyTypes } from '../core/Entities';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { addItem, curableStatuses, initInventory, isUseful, itemDef } from '../core/Inventory';
import { ITEM_KINDS, PLAYER_STATUS_KINDS, World, playerStatusTicks, setPlayerStatus, type PlayerStatusKind } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Enemies from './Enemies';
import * as Items from './Items';
import * as Mana from './Mana';
import * as PlayerMove from './PlayerMove';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';
import * as Status from './Status';

const DT = 1 / 60;
const CFG = balance.status;
const TYPE = 'scythe_behemoth';
const def = enemyDef(TYPE);

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

/** (6 + dist, 6) 에 놓고 추격 상태로 — 플레이어(6,6)는 +X 를 본다 = 거수 정면 */
function makeBehemoth(dist: number): ReturnType<typeof spawnEnemyAt> {
  const boss = spawnEnemyAt(TYPE, 6 + dist, 6, 1);
  boss.ai = 'chase';
  world.enemies.push(boss);
  return boss;
}

/** 낫이 열리면 낫끝을 완벽 대역 한복판에 놓고 누른다 — 결과('perfect'/'normal'/'없음') */
function perfectBandParry(boss: ReturnType<typeof spawnEnemyAt>): string {
  tickEnemiesUntil(() => boss.ai === 'active_perfect');
  boss.weaponTipDist =
    Math.hypot(boss.x - world.player.x, boss.z - world.player.z) -
    balance.player.radius -
    balance.parrySpace.perfectBand * 0.5;
  const results: string[] = [];
  const off = (p: unknown): void => {
    results.push((p as { result: string }).result);
  };
  world.events.on('parry_attempt', off);
  pressReaction();
  world.events.off('parry_attempt', off);
  return results[0] ?? '없음';
}

/** 상태 이벤트를 모은다 */
function recordStatus(): { applied: { kind: string; ticks: number }[]; ended: { kind: string; reason: string }[] } {
  const rec = { applied: [] as { kind: string; ticks: number }[], ended: [] as { kind: string; reason: string }[] };
  for (const kind of PLAYER_STATUS_KINDS) {
    world.events.on(`${kind}_applied`, (p) => rec.applied.push(p as { kind: string; ticks: number }));
    world.events.on(`${kind}_ended`, (p) => rec.ended.push(p as { kind: string; reason: string }));
  }
  return rec;
}

describe('Status.ts — 카운터·상한·이벤트 (기획서 §6)', () => {
  it('데이터 — balance.status{maxConcurrent 2, numbArm{240, 완벽 대역 0, 방어 이속 0.25, 마나 소실 면제}, concussion{360, 흔들림 0.02, 기울기 3°, 덕킹 −6dB, 물약이 지움}}, 거수 낫 statusOnBlock·돌격 statusOnHit', () => {
    expect(CFG.maxConcurrent).toBe(2);
    expect(CFG.numbArm).toEqual({ ticks: 240, perfectBandMul: 0, blockSpeedMul: 0.25, noManaLossOnFail: true });
    expect(CFG.concussion).toEqual({ ticks: 360, aimShakeAmp: 0.02, tiltDeg: 3, duckDb: -6, potionCures: true });
    expect(CFG.numbArm.blockSpeedMul).toBeLessThan(balance.block.speedMul); // 저림 중 방어가 더 느리다
    expect(def.attack.statusOnBlock).toBe('numb_arm');
    expect(def.attackAlt!.statusOnBlock).toBe('numb_arm');
    expect(def.attack.statusOnHit).toBeUndefined(); // 낫 직격은 상태 없음 — 피해로 벌받는다
    expect(def.chargeAttack!.statusOnHit).toBe('concussion');
    expect(def.chargeAttack!.statusOnBlock).toBeUndefined(); // 막으면 진탕 없음
    expect(def.closeAttack!.statusOnHit).toBeUndefined();
    expect(def.closeAttack!.statusOnBlock).toBeUndefined();
    // 물약이 지우는 상태는 데이터(items.kinds.*.cures) — 체력 물약 둘만 진탕, 고기·마나 물약은 목록이 없다. 목록의 이름은 전부 아는 상태여야 한다
    expect(itemDef('potion').cures).toEqual(['concussion']);
    expect(itemDef('potion_large').cures).toEqual(['concussion']);
    expect(itemDef('food').cures).toBeUndefined();
    expect(itemDef('mana').cures).toBeUndefined();
    expect(itemDef('mana_large').cures).toBeUndefined();
    for (const kind of ITEM_KINDS) {
      for (const c of itemDef(kind).cures ?? []) expect(PLAYER_STATUS_KINDS).toContain(c);
    }
    // 기존 적은 어느 공격에도 상태가 없다 — 새 필드는 전부 옵셔널(없으면 옛 경로)
    for (const type of implementedEnemyTypes()) {
      if (type === TYPE) continue;
      const d = enemyDef(type);
      for (const a of [d.attack, d.attackAlt, d.closeAttack, d.chargeAttack]) {
        if (!a) continue;
        expect(a.statusOnHit).toBeUndefined();
        expect(a.statusOnBlock).toBeUndefined();
      }
    }
  });

  it('세운 다음 Status 틱에 _applied 한 번, 매 틱 1씩 줄고 0 에 닿으면 _ended{expired} 한 번 — 다른 시스템은 세우기만 한다', () => {
    const rec = recordStatus();
    setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
    expect(world.player.numbArmTicks).toBe(240);
    expect(rec.applied).toHaveLength(0); // 아직 — Status 가 돌아야 알린다

    Status.tick(world, DT);
    expect(rec.applied).toEqual([{ kind: 'numb_arm', ticks: 240 }]);
    expect(world.player.numbArmTicks).toBe(239);
    expect(world.player.statusOrder).toEqual(['numb_arm']);

    for (let i = 0; i < 238; i++) Status.tick(world, DT);
    expect(world.player.numbArmTicks).toBe(1);
    expect(rec.ended).toHaveLength(0);
    Status.tick(world, DT);
    expect(world.player.numbArmTicks).toBe(0);
    expect(rec.ended).toEqual([{ kind: 'numb_arm', reason: 'expired' }]);
    expect(world.player.statusOrder).toEqual([]);
    Status.tick(world, DT);
    expect(rec.applied).toHaveLength(1); // 다시 알리지 않는다
    expect(rec.ended).toHaveLength(1);
  });

  it('밖에서 0 으로 지우면(일반 패링·물약) 다음 틱 _ended{cured} — 해제 문구는 한 곳에서 나온다', () => {
    const rec = recordStatus();
    setPlayerStatus(world.player, 'concussion', CFG.concussion.ticks);
    Status.tick(world, DT);
    expect(rec.applied).toHaveLength(1);
    setPlayerStatus(world.player, 'concussion', 0);
    Status.tick(world, DT);
    expect(rec.ended).toEqual([{ kind: 'concussion', reason: 'cured' }]);
    expect(world.player.statusOrder).toEqual([]);
  });

  it('다시 걸리면 긴 쪽으로 갱신 — 중첩 없음, _applied 도 다시 나지 않는다', () => {
    const rec = recordStatus();
    setPlayerStatus(world.player, 'numb_arm', 100);
    Status.tick(world, DT);
    setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
    expect(world.player.numbArmTicks).toBe(240);
    setPlayerStatus(world.player, 'numb_arm', 50);
    expect(world.player.numbArmTicks).toBe(240); // 짧은 값으로 줄이지 않는다
    Status.tick(world, DT);
    expect(rec.applied).toHaveLength(1);
  });

  it('상한 maxConcurrent(2) — 두 상태는 나란히 걸린다, 각자 제 시간에 끝난다', () => {
    const rec = recordStatus();
    setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
    Status.tick(world, DT);
    setPlayerStatus(world.player, 'concussion', CFG.concussion.ticks);
    Status.tick(world, DT);
    expect(rec.applied.map((a) => a.kind)).toEqual(['numb_arm', 'concussion']);
    expect(rec.ended).toHaveLength(0);
    expect(world.player.statusOrder).toEqual(['numb_arm', 'concussion']);
    for (let i = 0; i < 238; i++) Status.tick(world, DT);
    expect(rec.ended).toEqual([{ kind: 'numb_arm', reason: 'expired' }]);
    expect(playerStatusTicks(world.player, 'concussion')).toBe(360 - 239);
  });

  describe('상한을 넘기면 가장 오래된 것이 해제된다 (상한을 1 로 낮춰 두 종류로 검증 — 세 번째 종류는 B3 에서)', () => {
    const saved = CFG.maxConcurrent;
    afterEach(() => {
      (CFG as { maxConcurrent: number }).maxConcurrent = saved;
    });

    it('저림(먼저) → 진탕(나중): 저림 _ended{displaced}, 진탕은 그대로', () => {
      (CFG as { maxConcurrent: number }).maxConcurrent = 1;
      const rec = recordStatus();
      setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
      Status.tick(world, DT);
      setPlayerStatus(world.player, 'concussion', CFG.concussion.ticks);
      Status.tick(world, DT);
      expect(rec.ended).toEqual([{ kind: 'numb_arm', reason: 'displaced' }]);
      expect(world.player.numbArmTicks).toBe(0);
      expect(world.player.concussionTicks).toBe(359);
      expect(world.player.statusOrder).toEqual(['concussion']);
    });

    it('진탕(먼저) → 저림(나중): 걸린 순서가 기준이다 — 진탕이 밀린다', () => {
      (CFG as { maxConcurrent: number }).maxConcurrent = 1;
      const rec = recordStatus();
      setPlayerStatus(world.player, 'concussion', CFG.concussion.ticks);
      Status.tick(world, DT);
      setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
      Status.tick(world, DT);
      expect(rec.ended).toEqual([{ kind: 'concussion', reason: 'displaced' }]);
      expect(world.player.statusOrder).toEqual(['numb_arm']);
    });
  });

  it('clearAll — 부활·층 이동·시험방 진입: 이벤트 없이 전부 0', () => {
    const rec = recordStatus();
    setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
    setPlayerStatus(world.player, 'concussion', CFG.concussion.ticks);
    Status.tick(world, DT);
    Status.clearAll(world);
    for (const kind of PLAYER_STATUS_KINDS) expect(playerStatusTicks(world.player, kind)).toBe(0);
    expect(world.player.statusOrder).toEqual([]);
    Status.tick(world, DT);
    expect(rec.ended).toHaveLength(0);
    expect(Status.isActive(world, 'numb_arm')).toBe(false);
  });

  it('clearAll 은 진탕이 빌린 aimShake 채널도 놓는다 — 부활·층 이동 뒤 PlayerMove 가 시선을 흔들지 않는다', () => {
    setPlayerStatus(world.player, 'concussion', CFG.concussion.ticks);
    for (let i = 0; i < 30; i++) {
      PlayerMove.tick(world, DT);
      Status.tick(world, DT);
    }
    expect(world.player.aimShakeTicks).toBe(world.player.concussionTicks); // 채널이 실려 있다
    expect(world.player.aimShakeTicks).toBeGreaterThan(300);

    Status.clearAll(world);
    expect(world.player.concussionTicks).toBe(0);
    expect(world.player.aimShakeTicks).toBe(0); // 카운터만 0 이고 채널이 남으면 남은 틱 내내 조준이 흔들린다

    const yaw0 = world.player.yaw;
    const pitch0 = world.player.pitch;
    for (let i = 0; i < 30; i++) {
      world.input = Input.emptySnapshot();
      PlayerMove.tick(world, DT);
      expect(world.player.yaw).toBe(yaw0);
      expect(world.player.pitch).toBe(pitch0);
      Status.tick(world, DT);
      expect(world.player.aimShakeTicks ?? 0).toBe(0); // Status 가 다시 싣지도 않는다
    }
  });

  it('clearAll 은 남의 aimShake(박쥐·포자 진폭)는 건드리지 않는다 — 진폭이 우리 값일 때만 채널을 놓는다', () => {
    const otherAmp = CFG.concussion.aimShakeAmp * 3;
    world.player.aimShakeTicks = 40;
    world.player.aimShakeAmp = otherAmp;
    setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
    Status.tick(world, DT);
    Status.clearAll(world);
    expect(world.player.aimShakeTicks).toBe(40);
    expect(world.player.aimShakeAmp).toBe(otherAmp);
  });

  it('어느 상태도 회피 거리·무적 틱을 건드리지 않는다', () => {
    for (const kind of PLAYER_STATUS_KINDS) setPlayerStatus(world.player, kind as PlayerStatusKind, 300);
    Status.tick(world, DT);
    world.stamina.value = balance.player.stamina.max;
    world.input = { ...Input.emptySnapshot(), dodgePressed: true };
    Reaction.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(world.player.dodgeTicks).toBe(balance.reaction.dodgeDashTicks);
    expect(world.player.iframeTicks).toBe(world.modifiers.dodgeIFrameTicks);
    expect(world.player.dodgeDistMul).toBe(1); // 뒤 대시 = 1배
  });
});

describe('팔 저림 numb_arm — 거수 낫을 방패로 막음', () => {
  it('막으면 240틱 저림 — 칩 피해·방어 경직은 기존대로. 막지 않고 맞으면 저림 없음', () => {
    const boss = makeBehemoth(4.0); // attackRange 4.4 안, 돌격 minRange 4.5 밖
    world.player.blocking = true; // +X 를 본다 = 거수 정면
    const rec = recordStatus();
    const hits: { blocked: boolean }[] = [];
    world.events.on('player_damaged', (p) => hits.push(p as { blocked: boolean }));
    tickEnemiesUntil(() => boss.ai === 'recover', 400);
    expect(hits).toEqual([{ blocked: true, ...hits[0] }]);
    expect(world.player.numbArmTicks).toBe(CFG.numbArm.ticks);
    expect(world.player.stunTicks).toBeGreaterThan(0); // 방어 경직 그대로
    expect(world.player.health).toBeCloseTo(100 - def.attack.damage! * balance.block.chipDamageRatio); // 칩 30%
    Status.tick(world, DT);
    expect(rec.applied).toEqual([{ kind: 'numb_arm', ticks: 240 }]);

    // 막지 않은 직격 — 피해는 다 들어오지만 저림은 없다
    world = makeWorld();
    const boss2 = makeBehemoth(4.0);
    tickEnemiesUntil(() => boss2.ai === 'recover', 400);
    expect(world.player.health).toBe(100 - def.attack.damage!);
    expect(world.player.numbArmTicks ?? 0).toBe(0);
    expect('numbArmTicks' in world.player).toBe(false);
  });

  it('저림 중엔 완벽 대역에 정확히 놓고 눌러도 일반 — 그 일반 패링이 저림을 즉시 푼다(_ended{cured})', () => {
    // 대조 — 저림이 없으면 같은 자리는 완벽이다
    const boss0 = makeBehemoth(4.0);
    expect(perfectBandParry(boss0)).toBe('perfect');

    world = makeWorld();
    const rec = recordStatus();
    setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
    Status.tick(world, DT);
    const boss = makeBehemoth(4.0);
    const clashes: { kind: string }[] = [];
    world.events.on('guard_clash', (p) => clashes.push(p as { kind: string }));
    expect(perfectBandParry(boss)).toBe('normal');
    expect(clashes[0]!.kind).toBe('parry_normal');
    expect(boss.pose).toBeUndefined(); // 머리 내림(완벽 보상)은 없다
    expect(boss.ai).toBe('recover'); // 일반 패링 튕김
    expect(world.player.numbArmTicks).toBe(0); // 즉시 해제 — 0 만 세우고
    Status.tick(world, DT);
    expect(rec.ended).toEqual([{ kind: 'numb_arm', reason: 'cured' }]); // 문구는 Status 가 낸다
  });

  it('저림 중 조기 입력(실패) — 경직은 그대로, 마나 절반 소실은 면제(noManaLoss). 연쇄 리셋은 그대로', () => {
    Mana.init(world);
    // 대조 — 저림이 없으면 절반이 날아간다
    world.mana.value = 60;
    const boss0 = makeBehemoth(4.0);
    tickEnemiesUntil(() => boss0.ai === 'windup');
    pressReaction();
    expect(world.player.stunTicks).toBeGreaterThan(0);
    expect(world.mana.value).toBe(30);

    world = makeWorld();
    Mana.init(world);
    world.mana.value = 60;
    world.mana.chainIndex = 2;
    setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
    Status.tick(world, DT);
    const boss = makeBehemoth(4.0);
    const attempts: { result: string; noManaLoss?: boolean }[] = [];
    world.events.on('parry_attempt', (p) => attempts.push(p as { result: string; noManaLoss?: boolean }));
    const lost: unknown[] = [];
    world.events.on('mana_lost', (p) => lost.push(p));
    tickEnemiesUntil(() => boss.ai === 'windup');
    pressReaction();
    expect(attempts).toEqual([{ result: 'fail', chain: 0, enemyType: TYPE, noManaLoss: true }]);
    expect(world.player.stunTicks).toBe(Math.round(balance.reaction.failStunTicks * world.modifiers.stunMul));
    expect(world.mana.value).toBe(60); // 면제
    expect(lost).toHaveLength(0);
    expect(world.mana.chainIndex).toBe(0); // 연쇄는 끊긴다
  });

  it('저림 중 방어 이속 — block.speedMul(0.35) 대신 numbArm.blockSpeedMul(0.25) (PlayerMove)', () => {
    function blockWalk(numb: boolean): number {
      world = makeWorld();
      if (numb) setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
      world.player.blocking = true;
      const x0 = world.player.x;
      for (let i = 0; i < 30; i++) {
        world.input = { ...Input.emptySnapshot(), moveForward: 1 };
        PlayerMove.tick(world, DT);
      }
      return Math.hypot(world.player.x - x0, world.player.z - 6);
    }
    const normal = blockWalk(false);
    const numb = blockWalk(true);
    expect(normal).toBeGreaterThan(0);
    expect(numb / normal).toBeCloseTo(CFG.numbArm.blockSpeedMul / balance.block.speedMul, 3);
  });
});

describe('진탕 concussion — 거수 돌격 직격', () => {
  it('돌격 직격 → 360틱 진탕(45 피해·7m 밀림은 기존대로), 다음 Status 틱에 _applied', () => {
    const ch = def.chargeAttack!;
    const boss = makeBehemoth(10); // minRange 4.5 ~ maxRange 15 안
    const rec = recordStatus();
    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    tickEnemiesUntil(() => boss.ai === 'recover', 300);
    expect(world.player.health).toBe(100 - ch.damage!);
    expect(world.player.concussionTicks).toBe(CFG.concussion.ticks);
    expect(world.player.kbTicks).toBe(ch.playerKnockbackTicks);
    Status.tick(world, DT);
    expect(rec.applied).toEqual([{ kind: 'concussion', ticks: 360 }]);
  });

  it('막으면 진탕 없음 — 60% 피해·7m 밀림 그대로가 벌이다', () => {
    const ch = def.chargeAttack!;
    const boss = makeBehemoth(10);
    world.player.blocking = true; // +X = 거수 정면
    const hits: { blocked: boolean; amount: number }[] = [];
    world.events.on('player_damaged', (p) => hits.push(p as { blocked: boolean; amount: number }));
    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    tickEnemiesUntil(() => boss.ai === 'recover', 300);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.blocked).toBe(true);
    expect(hits[0]!.amount).toBeCloseTo(ch.damage! * ch.blockedDamageRatio!);
    expect(world.player.concussionTicks ?? 0).toBe(0);
    expect(world.player.kbTicks).toBe(ch.playerKnockbackTicks); // 밀림은 그대로
  });

  it('완벽 회피(무적 접촉)는 피해도 상태도 없다', () => {
    const boss = makeBehemoth(10);
    tickEnemiesUntil(() => boss.ai === 'charging', 300);
    world.player.iframeTicks = 9999;
    tickEnemiesUntil(() => boss.pose === 'skid', 300);
    expect(world.player.health).toBe(100);
    expect(world.player.concussionTicks ?? 0).toBe(0);
  });

  it('진탕 중 조준 흔들림 — 박쥐 aimShake 채널을 남은 진탕 틱으로 채운다(amp 0.02), PlayerMove 가 시선을 실제로 흔든다', () => {
    setPlayerStatus(world.player, 'concussion', CFG.concussion.ticks);
    Status.tick(world, DT);
    expect(world.player.aimShakeTicks).toBe(359);
    expect(world.player.aimShakeAmp).toBe(CFG.concussion.aimShakeAmp);
    const yaw0 = world.player.yaw;
    let moved = 0;
    for (let i = 0; i < 20; i++) {
      world.input = Input.emptySnapshot();
      PlayerMove.tick(world, DT);
      if (Math.abs(world.player.yaw - yaw0) > 1e-4) moved++;
      Status.tick(world, DT);
      expect(world.player.aimShakeTicks).toBe(world.player.concussionTicks); // 채널이 진탕 잔여 틱을 따라간다
    }
    expect(moved).toBeGreaterThan(0);
    // 물약 등으로 일찍 끝나면 빌린 채널도 그 틱에 놓는다 — 남은 틱만큼 계속 흔들리지 않는다
    setPlayerStatus(world.player, 'concussion', 0);
    Status.tick(world, DT);
    expect(world.player.aimShakeTicks).toBe(0);
  });

  it('체력 물약이 지운다 — 만피여도 물약은 유용(isUseful), 마시면 concussion 0 → _ended{cured}. 마나 물약은 지우지 않는다', () => {
    initInventory(world);
    world.mana.value = balance.mana.max;
    expect(isUseful(world, 'potion')).toBe(false); // 만피 — 평소엔 버리는 것
    expect(curableStatuses(world, 'potion')).toEqual([]); // 걸린 게 없으면 지울 것도 없다
    setPlayerStatus(world.player, 'concussion', CFG.concussion.ticks);
    Status.tick(world, DT);
    expect(curableStatuses(world, 'potion')).toEqual(['concussion']);
    expect(curableStatuses(world, 'potion_large')).toEqual(['concussion']);
    expect(isUseful(world, 'potion')).toBe(true); // 지울 상태가 있다
    expect(isUseful(world, 'potion_large')).toBe(true);
    expect(isUseful(world, 'mana')).toBe(false); // 마나 물약은 진탕과 무관
    expect(curableStatuses(world, 'mana')).toEqual([]);
    // 팔 저림은 물약이 지우는 상태가 아니다(일반 패링이 푼다) — 진탕이 없고 저림만 있으면 물약은 만피에 그냥 버리는 것
    world = makeWorld();
    initInventory(world);
    setPlayerStatus(world.player, 'numb_arm', CFG.numbArm.ticks);
    Status.tick(world, DT);
    expect(curableStatuses(world, 'potion')).toEqual([]);
    expect(isUseful(world, 'potion')).toBe(false);

    world = makeWorld();
    initInventory(world);
    world.mana.value = balance.mana.max;
    setPlayerStatus(world.player, 'concussion', CFG.concussion.ticks);
    Status.tick(world, DT);

    const rec = recordStatus();
    addItem(world, 'potion'); // 첫 습득은 빈 퀵슬롯 1 에 자동 등록
    expect(world.quickslots[0]).toBe('potion');
    const used: { cured?: string[] }[] = [];
    world.events.on('item_used', (p) => used.push(p as { cured?: string[] }));
    world.input = { ...Input.emptySnapshot(), useSlot: 1 };
    Items.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(world.itemChannel).not.toBeNull(); // 마시기 시작 — 만피지만 거절되지 않았다
    for (let i = 0; i < balance.items.channelTicks; i++) Items.tick(world, DT);
    expect(used).toEqual([expect.objectContaining({ cured: ['concussion'] })]);
    expect(world.player.concussionTicks).toBe(0);
    Status.tick(world, DT);
    expect(rec.ended).toEqual([{ kind: 'concussion', reason: 'cured' }]);
  });

  it('말린 고기(heal 5)는 진탕을 지우지 않는다 — cures 목록이 없다. isUseful 도 진탕으로 켜지지 않고, 먹어도 concussion 그대로', () => {
    initInventory(world);
    world.foodRegenTicks = 1; // 지속 회복이 돌고 있고 만피 — 고기가 유용할 이유가 하나도 없는 상태
    expect(isUseful(world, 'food')).toBe(false);
    setPlayerStatus(world.player, 'concussion', CFG.concussion.ticks);
    Status.tick(world, DT);
    expect(curableStatuses(world, 'food')).toEqual([]);
    expect(isUseful(world, 'food')).toBe(false); // 진탕이 걸려도 고기는 켜지지 않는다 (물약은 켜진다 — 위 케이스)
    expect(isUseful(world, 'potion')).toBe(true);

    const rec = recordStatus();
    addItem(world, 'food');
    expect(world.quickslots[0]).toBe('food');
    const used: { cured?: string[]; healed: number }[] = [];
    world.events.on('item_used', (p) => used.push(p as { cured?: string[]; healed: number }));
    world.player.health = 50; // 먹을 수 있게 — 판정은 heal 이 아니라 cures 로 갈라야 한다
    world.input = { ...Input.emptySnapshot(), useSlot: 1 };
    Items.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(world.itemChannel).not.toBeNull();
    for (let i = 0; i < balance.items.channelTicks; i++) Items.tick(world, DT);
    expect(used).toHaveLength(1);
    expect(used[0]!.healed).toBeGreaterThan(0); // 회복은 됐지만
    expect(used[0]!.cured).toEqual([]); // 지운 것은 없다
    expect(world.player.concussionTicks).toBeGreaterThan(0);
    expect(world.player.aimShakeTicks).toBeGreaterThan(0); // 흔들림도 그대로
    for (let i = 0; i < 3; i++) Status.tick(world, DT);
    expect(rec.ended).toHaveLength(0);
  });
});
