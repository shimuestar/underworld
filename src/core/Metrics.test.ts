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
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'backflow', on: true, ticks: 60, selfDamage: 45 }); // 역류(B3-1)
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'backflow', on: false });
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'rear', on: true }); // 앞발 들기 자세는 세지 않는다
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'head_down', on: true, ticks: 60, cause: 'backflow' });
    // 페이즈(B2-6) — 3 → 2 전환(P1 90초), 2 → 1 (P2 120초), 사망(phase 0 — 전환으로 세지 않고 P3 90초만 쌓는다)
    events.emit('boss_phase', { enemyId: 1, enemyType: 'scythe_behemoth', phase: 2, from: 3, skipped: false, fromTicks: 5400, tick: 5400 });
    events.emit('boss_phase', { enemyId: 1, enemyType: 'scythe_behemoth', phase: 1, from: 2, skipped: false, fromTicks: 7200, tick: 12600 });
    events.emit('boss_phase', { enemyId: 1, enemyType: 'scythe_behemoth', phase: 0, from: 1, skipped: false, fromTicks: 5400, tick: 18000, death: true });
    events.emit('plate_broken', { enemyId: 1, enemyType: 'scythe_behemoth', gold: 7, platesLeft: 2, count: 3, ventScale: 1.15, x: 0, z: 0 }); // 갑각판(B3-3)
    events.emit('plate_broken', { enemyId: 1, enemyType: 'scythe_behemoth', gold: 10, platesLeft: 1, count: 3, ventScale: 1.3225, x: 0, z: 0 });
    events.emit('plate_shed', { enemyId: 1, enemyType: 'scythe_behemoth', count: 1, x: 0, z: 0 }); // 탈락은 세지 않는다
    // 진액 웅덩이·오염 진액·분출공 정화·질식(B3-2)
    events.emit('pool_spawned', { id: 1, x: 0, z: 0, r: 1.6, kind: 'blade' });
    events.emit('pool_spawned', { id: 2, x: 0, z: 0, r: 1.2, kind: 'orb' });
    events.emit('pool_evaporated', { id: 1, x: 0, z: 0, r: 1.6, kind: 'blade', reason: 'fire' });
    events.emit('pool_evaporated', { id: 2, x: 0, z: 0, r: 1.2, kind: 'orb', reason: 'expired' }); // 자연 소멸은 증발로 세지 않는다
    events.emit('corrosive_applied', { kind: 'corrosive', ticks: 30 });
    events.emit('corrosive_tick', { amount: 2, health: 76 }); // 도트 — 받은 피해에 합산, 함정 사망은 아니다
    events.emit('corrosive_pending', { amount: 1, total: 1, cap: 8, enemyId: 1 });
    events.emit('corruption_cleansed', { amount: 2, source: 'vent', enemyId: 1, total: 2 });
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'backflow', on: true, cause: 'vent', ticks: 60, selfDamage: 0 }); // 분출공 역류도 역류
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'choke', on: true, ticks: 1800 });
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'choke', on: false });
    // P3 기술(B3-4) — 포효 둘(하나는 위압 적중), 삼연낫 하나 → 탈진, 광란 돌격 선회 하나
    events.emit('enemy_roar', { enemyId: 1, enemyType: 'scythe_behemoth', despair: false, radius: 12, dist: 8 });
    events.emit('boss_roar_hit', { enemyId: 1, enemyType: 'scythe_behemoth', status: 'cowed', pull: 0, push: 1.5, dist: 8, despair: false });
    events.emit('enemy_roar', { enemyId: 1, enemyType: 'scythe_behemoth', despair: true, radius: 12, dist: 14 });
    events.emit('enemy_combo_start', { enemyId: 1, enemyType: 'scythe_behemoth', steps: 3 });
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'exhaust', on: true, ticks: 150 });
    events.emit('boss_status', { enemyId: 1, enemyType: 'scythe_behemoth', kind: 'exhaust', on: false });
    events.emit('enemy_chain_turn', { enemyId: 1, enemyType: 'scythe_behemoth', ticks: 24 });
    // 보스 아레나(B3-5) — 봉쇄 둘(입장·재입장), 기둥 붕괴 하나(pillar_damaged 는 세지 않는다), 자발 돌격 하나, 접근 가속 켜짐/꺼짐(켜짐만 센다), 잔해 하나
    events.emit('arena_sealed', { enemyId: 1, enemyType: 'scythe_behemoth', row: 11, col: 22, x: 90, z: 46 });
    events.emit('arena_unsealed', { reason: 'left', row: 11, col: 22 });
    events.emit('arena_sealed', { enemyId: 1, enemyType: 'scythe_behemoth', row: 11, col: 22, x: 90, z: 46 });
    events.emit('pillar_damaged', { row: 4, col: 19, hp: 1, max: 3, x: 78, z: 18 });
    events.emit('pillar_collapsed', { row: 4, col: 19, x: 78, z: 18, playerHit: true, enemyHits: 1 });
    events.emit('anticamp_charge', { enemyId: 1, enemyType: 'scythe_behemoth', row: 4, col: 25, x: 102, z: 18, dist: 12 });
    events.emit('anticamp_far', { enemyId: 1, enemyType: 'scythe_behemoth', on: true, dist: 14 });
    events.emit('anticamp_far', { enemyId: 1, enemyType: 'scythe_behemoth', on: false, dist: 7 });
    events.emit('arena_rubble_broken', { row: 4, col: 19, x: 78, z: 18 });

    const s = metrics.snapshot(makeWorldStub());
    expect(s.arena).toEqual({ seals: 2, pillarCollapses: 1, anticampCharges: 1, anticampFar: 1, rubbleBroken: 1 });
    expect(s.weakPoints).toEqual({ hits: 2, damage: 55, broken: 1, exposuresClosed: 2, exposureHits: 2, dazes: 1, chargeDodges: 1, limps: 1, blinds: 1, topples: 1, pillarHits: 1, backflows: 2 });
    expect(s.boss).toEqual({ phaseShifts: 2, phaseSkips: 0, phaseSeconds: { '3': 90, '2': 120, '1': 90 }, platesBroken: 2, plateGold: 17, roars: 2, roarHits: 1, combos: 1, exhausts: 1, chainTurns: 1 });
    expect(s.hazards).toEqual({ pools: 2, evaporated: 1, corrosiveApplied: 1, corrosiveDamage: 2, pendingIn: 1, ventCleanse: 2, chokes: 1 });
    expect(s.combat.damageTakenTotal).toBe(22 + 2); // 오염 진액 도트도 받은 피해다
    expect(s.traps.deaths).toBe(0);
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
    expect(s.boss).toEqual({ phaseShifts: 1, phaseSkips: 1, phaseSeconds: { '3': 10 }, platesBroken: 0, plateGold: 0, roars: 0, roarHits: 0, combos: 0, exhausts: 0, chainTurns: 0 });
  });

  it('데이터가 없으면 파생 지표는 null (0으로 왜곡하지 않는다)', () => {
    const metrics = new Metrics(new Events());
    const s = metrics.snapshot(makeWorldStub());
    expect(s.boss).toEqual({ phaseShifts: 0, phaseSkips: 0, phaseSeconds: {}, platesBroken: 0, plateGold: 0, roars: 0, roarHits: 0, combos: 0, exhausts: 0, chainTurns: 0 });
    expect(s.hazards).toEqual({ pools: 0, evaporated: 0, corrosiveApplied: 0, corrosiveDamage: 0, pendingIn: 0, ventCleanse: 0, chokes: 0 });
    expect(s.derived.perfectParryRatio).toBeNull();
    expect(s.derived.manaWasteRatio).toBeNull();
    expect(s.derived.ammoLeftRatioAtAltar).toBeNull();
  });
});
