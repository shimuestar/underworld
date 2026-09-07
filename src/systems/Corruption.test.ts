// 오염 — 정화(corruption_cleansed) 구독(B3-2, 기획서 §11): pending 만 깎고 applied 는 불변, 음수 pending 은 정산에서 건너뛰고 다음 부착의 여유가 된다.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Corruption from './Corruption';
import * as Sigils from './Sigils';

function makeWorld(): World {
  const level = new Level({
    id: 'arena', name: 'arena', cellSize: 4, ceiling: 4,
    grid: ['######', '#S..X#', '######'],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6, yaw: 0, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0, iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: { inventory: [], equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null } },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 20, pending: 3 },
    enemies: [],
    level,
  });
}

let world: World;
beforeEach(() => {
  world = makeWorld();
  Corruption.init(world);
});

describe('Corruption — 정화(corruption_cleansed) 구독 (B3-2)', () => {
  it('데이터 — ventHitCleanse 1·ventCleanseCap 6·corrosiveCleanseMul 2', () => {
    expect(balance.corruption).toMatchObject({ ventHitCleanse: 1, ventCleanseCap: 6, corrosiveCleanseMul: 2 });
  });

  it('corruption_cleansed{amount} 만큼 pending 이 준다 — applied 는 그대로. 0 이하 양은 무시', () => {
    world.events.emit('corruption_cleansed', { amount: 1, source: 'vent' });
    expect(world.corruption.pending).toBe(2);
    expect(world.corruption.applied).toBe(20);
    world.events.emit('corruption_cleansed', { amount: 2, source: 'vent' });
    expect(world.corruption.pending).toBe(0);
    world.events.emit('corruption_cleansed', { amount: 0, source: 'vent' });
    world.events.emit('corruption_cleansed', { amount: -3, source: 'vent' });
    expect(world.corruption.pending).toBe(0);
    Corruption.cleanse(world, 4);
    expect(world.corruption.pending).toBe(-4); // 음수 = 여유
    expect(world.corruption.applied).toBe(20);
  });

  it('음수 pending 은 제단 정산에서 건너뛰고(applied 불변, corruption_applied 없음) 다음 부착(pending 가산)이 그 여유를 쓴다', () => {
    const appliedEv: unknown[] = [];
    world.events.on('corruption_applied', (p) => appliedEv.push(p));
    Corruption.cleanse(world, 5); // 3 → −2
    world.events.emit('altar_entered', {});
    expect(world.corruption.applied).toBe(20);
    expect(world.corruption.pending).toBe(-2);
    expect(appliedEv).toHaveLength(0);
    world.corruption.pending += 8; // 각인 부착(눈 8)
    world.events.emit('altar_entered', {});
    expect(world.corruption.applied).toBe(26); // 8 중 2 가 상쇄됐다
    expect(world.corruption.pending).toBe(0);
    expect(appliedEv).toEqual([{ from: 20, to: 26 }]);
  });

  it('정화는 임계를 되돌리지 않는다 — applied 가 이미 25 를 넘었으면 pending 을 아무리 깎아도 그대로', () => {
    world.corruption.applied = 30;
    world.canReadGlyphs = true;
    Corruption.cleanse(world, 50);
    world.events.emit('altar_entered', {});
    expect(world.corruption.applied).toBe(30);
    expect(world.canReadGlyphs).toBe(true);
  });
});

describe('Corruption — 보스 사망·처형 정화 (B3-6, 기획서 §11)', () => {
  function cleansedLog(): { amount: number; source: string }[] {
    const out: { amount: number; source: string }[] = [];
    world.events.on('corruption_cleansed', (p) => out.push(p as { amount: number; source: string }));
    return out;
  }

  it('데이터 — bossCleansePending 10 · bossExecuteCleanse 15 (처형 마무리가 더 크다)', () => {
    expect(balance.corruption).toMatchObject({ bossCleansePending: 10, bossExecuteCleanse: 15 });
    expect(balance.corruption.bossExecuteCleanse).toBeGreaterThan(balance.corruption.bossCleansePending);
  });

  it('보스가 죽으면(enemy_died, def.boss) 오염 대기 −10 — corruption_cleansed{amount 10, source boss_death}. applied 는 그대로, pending 은 음수가 된다(여유)', () => {
    const log = cleansedLog();
    world.events.emit('enemy_died', { enemyId: 7, enemyType: 'scythe_behemoth', x: 0, z: 0 });
    expect(world.corruption.pending).toBe(3 - 10);
    expect(world.corruption.applied).toBe(20);
    expect(log).toEqual([expect.objectContaining({ amount: 10, source: 'boss_death', enemyId: 7, enemyType: 'scythe_behemoth' })]);
  });

  it('처형으로 마무리하면(enemy_died{execution}) 대신 −15 — 둘 중 하나만(−25 가 아니다). 정산은 음수를 건너뛴다', () => {
    const log = cleansedLog();
    const appliedEv: unknown[] = [];
    world.events.on('corruption_applied', (p) => appliedEv.push(p));
    world.events.emit('enemy_died', { enemyId: 7, enemyType: 'scythe_behemoth', x: 0, z: 0, execution: true, boss: true });
    expect(world.corruption.pending).toBe(3 - 15);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ amount: 15, source: 'boss_execute' });
    world.events.emit('altar_entered', {});
    expect(world.corruption.applied).toBe(20);
    expect(appliedEv).toHaveLength(0);
    // 다음 각인 부착(눈 8 + 심장 15 = 23)이 여유 12 를 쓴다
    world.corruption.pending += 23;
    world.events.emit('altar_entered', {});
    expect(world.corruption.applied).toBe(31);
  });

  it('정화는 deathCleanse 를 든 보스(거수)만 — 보스가 아닌 적·소환수(noLoot)·족장(boss 지만 deathCleanse 없음)은 정화가 없다 (B3-6 잔여 메모)', () => {
    const log = cleansedLog();
    world.events.emit('enemy_died', { enemyType: 'goblin_runner', x: 0, z: 0, execution: true });
    world.events.emit('enemy_died', { enemyType: 'scythe_behemoth', x: 0, z: 0, noLoot: true });
    world.events.emit('enemy_died', { enemyType: 'goblin_chieftain', x: 0, z: 0, execution: true, boss: true });
    expect(world.corruption.pending).toBe(3); // 족장 처형도 오염 여유를 주지 않는다 — 슬라이스 경제 유지
    expect(log).toHaveLength(0);
    world.events.emit('enemy_died', { enemyType: 'scythe_behemoth', x: 0, z: 0 });
    expect(world.corruption.pending).toBe(3 - 10);
    expect(log).toEqual([expect.objectContaining({ amount: 10, source: 'boss_death' })]);
  });

  it('bossCleanse — 처형 여부로 양을 고르고 그 양을 돌려준다', () => {
    expect(Corruption.bossCleanse(world, false)).toBe(10);
    expect(Corruption.bossCleanse(world, true)).toBe(15);
    expect(world.corruption.pending).toBe(3 - 25);
  });
});
