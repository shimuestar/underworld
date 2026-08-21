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

    const s = metrics.snapshot(makeWorldStub());
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

  it('데이터가 없으면 파생 지표는 null (0으로 왜곡하지 않는다)', () => {
    const metrics = new Metrics(new Events());
    const s = metrics.snapshot(makeWorldStub());
    expect(s.derived.perfectParryRatio).toBeNull();
    expect(s.derived.manaWasteRatio).toBeNull();
    expect(s.derived.ammoLeftRatioAtAltar).toBeNull();
  });
});
