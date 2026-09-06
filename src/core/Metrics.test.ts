// 계측 수집 검증 — docs/metrics.md의 파생 지표 공식.

import { describe, expect, it } from 'vitest';
import { Events } from './Events';
import { Metrics } from './Metrics';
import type { World } from './World';

function makeWorldStub(): World {
  return {
    tick: 3600,
    cleared: false,
    corruption: { applied: 13, pending: 8 },
  } as unknown as World;
}

describe('Metrics', () => {
  it('패링·마나·제단 지표를 이벤트에서 파생한다', () => {
    const events = new Events();
    const metrics = new Metrics(events);

    // 교전 1: 완벽 2, 일반 1, 실패 1 — 연쇄 3 도달
    events.emit('combat_entered');
    events.emit('parry_attempt', { result: 'perfect', chain: 0, enemyType: 'x' });
    events.emit('chain_changed', { chain: 1 });
    events.emit('parry_attempt', { result: 'perfect', chain: 1, enemyType: 'x' });
    events.emit('chain_changed', { chain: 2 });
    events.emit('deflect', { casterId: 1 });
    events.emit('chain_changed', { chain: 3 });
    events.emit('parry_attempt', { result: 'normal', chain: 3, enemyType: 'x' });
    events.emit('parry_attempt', { result: 'fail', chain: 3, enemyType: 'x' });
    events.emit('mana_gained', { amount: 40, source: 'parry_perfect', chain: 0 });
    events.emit('combat_exited');

    // 교전 2: 시도 없음, 연쇄 없음
    events.emit('combat_entered');
    events.emit('combat_exited');

    events.emit('mana_decayed', { amount: 10, wasted: true });
    events.emit('altar_entered', { ammoLeftRatio: 0.3, pendingCorruption: 0, multiplier: 1 });
    events.emit('altar_entered', { ammoLeftRatio: 0.1, pendingCorruption: 0, multiplier: 1 });
    events.emit('altar_bypassed', { ammoLeftRatio: 0.5 });
    events.emit('shot_fired', { hitEnemy: true });
    events.emit('shot_fired', { hitEnemy: false });
    events.emit('weapon_kill', { weapon: 'pistol', enemyType: 'x' });
    events.emit('melee_kill', { enemyType: 'x', execution: true });
    events.emit('player_damaged', { amount: 22, health: 78 });
    events.emit('weak_point_hit', { enemyId: 1, enemyType: 'scythe_behemoth', id: 'eye', damage: 33, x: 0, y: 2.35, z: 0 });
    events.emit('weak_point_hit', { enemyId: 1, enemyType: 'scythe_behemoth', id: 'joint_r', damage: 22, x: 0, y: 2.5, z: 0 });
    events.emit('weak_point_broken', { enemyId: 1, enemyType: 'scythe_behemoth', id: 'joint_r' });
    events.emit('exposure_closed', { enemyId: 1, enemyType: 'scythe_behemoth', id: 'joint_r', hits: 2 });
    events.emit('exposure_closed', { enemyId: 1, enemyType: 'scythe_behemoth', id: 'eye', hits: 0 });
    events.emit('boss_staggered', { enemyId: 1, enemyType: 'scythe_behemoth', cause: 'eye' });
    events.emit('boss_staggered', { enemyId: 2, enemyType: 'goblin_chieftain', cause: 'parry' }); // 족장 스태거는 혼절이 아니다
    events.emit('charge_dodged', { enemyId: 1, enemyType: 'scythe_behemoth', x: 0, z: 0 });
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'limp', on: true });
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'limp', on: false }); // 해제는 세지 않는다
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'rupture', id: 'joint_r', blade: 'r', on: true }); // 파열은 weak_point_broken 이 센다
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'blind', on: true, ticks: 80 }); // 눈멂 유도(B2-5)
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'blind', on: false });
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'topple', on: true, ticks: 90, cell: 'P' }); // 전도
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'head_down', on: true, ticks: 90, cause: 'topple' }); // 전도의 머리 내림은 따로 세지 않는다
    events.emit('pillar_hit', { enemyId: 1, enemyType: 'scythe_behemoth', row: 3, col: 5, x: 22, z: 14 });
    // 페이즈(B2-6) — 3 → 2 전환(P1 90초), 2 → 1 (P2 120초), 사망(phase 0 — 전환으로 세지 않고 P3 90초만 쌓는다)
    events.emit('boss_phase', { enemyId: 1, enemyType: 'scythe_behemoth', phase: 2, from: 3, skipped: false, fromTicks: 5400, tick: 5400 });
    events.emit('boss_phase', { enemyId: 1, enemyType: 'scythe_behemoth', phase: 1, from: 2, skipped: false, fromTicks: 7200, tick: 12600 });
    events.emit('boss_phase', { enemyId: 1, enemyType: 'scythe_behemoth', phase: 0, from: 1, skipped: false, fromTicks: 5400, tick: 18000, death: true });

    const s = metrics.snapshot(makeWorldStub());
    expect(s.weakPoints).toEqual({ hits: 2, damage: 55, broken: 1, exposuresClosed: 2, exposureHits: 2, dazes: 1, chargeDodges: 1, limps: 1, blinds: 1, topples: 1, pillarHits: 1 });
    expect(s.boss).toEqual({ phaseShifts: 2, phaseSkips: 0, phaseSeconds: { '3': 90, '2': 120, '1': 90 } });
    expect(s.combat.parryAttempts).toBe(4);
    expect(s.derived.perfectParryRatio).toBeCloseTo(0.5);
    expect(s.derived.parrySuccessRatio).toBeCloseTo(0.75);
    expect(s.derived.parryAttemptsPerEncounter).toBeCloseTo(2);
    expect(s.derived.chainTier3ReachRatio).toBeCloseTo(0.5); // 교전 2개 중 1개
    expect(s.derived.manaWasteRatio).toBeCloseTo(10 / 40);
    expect(s.derived.ammoLeftRatioAtAltar).toBeCloseTo(0.2);
    expect(s.derived.altarBypassRatio).toBeCloseTo(1 / 3);
    expect(s.derived.shotAccuracy).toBeCloseTo(0.5);
    expect(s.kills.total).toBe(2);
    expect(s.combat.deflects).toBe(1);
    expect(s.session.seconds).toBe(60);
  });

  it('2단 건너뜀(skipped)은 전환 1·건너뜀 1 로 센다 — 머문 시간은 from 페이즈에', () => {
    const events = new Events();
    const metrics = new Metrics(events);
    events.emit('boss_phase', { enemyId: 1, enemyType: 'scythe_behemoth', phase: 1, from: 3, skipped: true, fromTicks: 600, tick: 600 });
    const s = metrics.snapshot(makeWorldStub());
    expect(s.boss).toEqual({ phaseShifts: 1, phaseSkips: 1, phaseSeconds: { '3': 10 } });
  });

  it('데이터가 없으면 파생 지표는 null (0으로 왜곡하지 않는다)', () => {
    const metrics = new Metrics(new Events());
    const s = metrics.snapshot(makeWorldStub());
    expect(s.boss).toEqual({ phaseShifts: 0, phaseSkips: 0, phaseSeconds: {} });
    expect(s.derived.perfectParryRatio).toBeNull();
    expect(s.derived.manaWasteRatio).toBeNull();
    expect(s.derived.ammoLeftRatioAtAltar).toBeNull();
  });
});
