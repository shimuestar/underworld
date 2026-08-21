// 마나 경제 — docs/systems/combat.md §4~5.
//
// ⚠ 하드 룰: 총기 처치(weapon_kill)는 마나를 주지 않는다. 이 파일은 weapon_kill을
//    구독하지 않으며, 앞으로도 추가하면 안 된다. 두 자원 경제를 분리하는 유일한 규칙.
//
// 획득: 완벽 패링 / 일반 패링 / 처형 / 근접 처치 (전부 연쇄 배율 적용)
// 연쇄: incrementOn(완벽 패링·반사)에만 상승, 일반 패링은 유지, resetOn(피격·실패·시전)에 리셋
// 휘발: 활성 적 0 + combatExitTicks 경과 → 매 틱 decayPerTick 감소. 재교전 시 즉시 중단
// 실패: 축적 마나 절반 소실

import { balance } from '../core/Balance';
import type { World } from '../core/World';

function multiplier(world: World): number {
  const multipliers = balance.chain.multipliers;
  const index = Math.min(world.mana.chainIndex, multipliers.length - 1);
  return multipliers[index]!;
}

function gain(world: World, amount: number, source: string): void {
  const mana = world.mana;
  const applied = amount * multiplier(world);
  mana.value = Math.min(balance.mana.max, mana.value + applied);
  world.events.emit('mana_gained', { amount: applied, source, chain: mana.chainIndex });
}

function resetChain(world: World, trigger: string): void {
  if (!balance.chain.resetOn.includes(trigger)) return;
  world.mana.chainIndex = 0;
}

/** 이벤트 구독 등록. 시작 시 1회 호출 */
export function init(world: World): void {
  const events = world.events;

  events.on('parry_attempt', (payload) => {
    const result = (payload as { result: string }).result;
    if (result === 'perfect') {
      gain(world, balance.mana.gain.parryPerfect, 'parry_perfect');
      if (balance.chain.incrementOn.includes('parry_perfect')) {
        world.mana.chainIndex = Math.min(
          world.mana.chainIndex + 1,
          balance.chain.multipliers.length - 1,
        );
      }
    } else if (result === 'normal') {
      gain(world, balance.mana.gain.parryNormal, 'parry_normal'); // 배율 유지, 상승 없음
    } else {
      // 실패 — 축적 마나 절반 소실 + 연쇄 리셋
      const lost = world.mana.value * 0.5;
      world.mana.value -= lost;
      world.events.emit('mana_lost', { amount: lost, reason: 'parry_fail' });
      resetChain(world, 'parry_fail');
    }
  });

  events.on('melee_kill', (payload) => {
    const execution = (payload as { execution?: boolean }).execution;
    gain(world, execution ? balance.mana.gain.execute : balance.mana.gain.melee,
      execution ? 'execute' : 'melee');
  });

  events.on('player_damaged', () => {
    resetChain(world, 'damaged');
    // 심장 각인 페널티 — 피격 시 마나 소실 (combat.md §5: Mana.ts에서 처리)
    if (world.modifiers.manaLostOnHit > 0 && world.mana.value > 0) {
      const lost = world.mana.value * world.modifiers.manaLostOnHit;
      world.mana.value -= lost;
      world.events.emit('mana_lost', { amount: lost, reason: 'heart_penalty' });
    }
  });

  // 마법 시전(M5)이 생기면 이 이벤트가 발행된다
  events.on('cast_spell', () => resetChain(world, 'cast_spell'));
}

/** 전투 종료 감지 + 휘발. 매 틱 호출 */
export function tick(world: World, _dt: number): void {
  const mana = world.mana;
  const active = world.enemies.some((e) => e.alive && e.ai !== 'idle');

  if (active) {
    if (!mana.inCombat) world.events.emit('combat_entered');
    mana.inCombat = true;
    mana.outOfCombatTicks = 0; // 재교전 — 휘발 즉시 중단 (초기화는 하지 않음)
    return;
  }

  mana.inCombat = false;
  mana.outOfCombatTicks++;
  if (mana.outOfCombatTicks === balance.mana.combatExitTicks) {
    world.events.emit('combat_exited');
  }
  if (mana.outOfCombatTicks >= balance.mana.combatExitTicks && mana.value > 0) {
    const amount = Math.min(mana.value, balance.mana.decayPerTick);
    mana.value -= amount;
    world.events.emit('mana_decayed', { amount, wasted: true });
  }
}
