// 오염 — 대기(pending)와 확정(applied)의 분리, 제단 정산, 임계 처리.
// docs/systems/economy.md §3. pending 누적은 각 시스템(Sigils 부착 등)이 직접 한다.
// 임계는 넘는 순간 이벤트를 발행하고 되돌리지 않는다.

import { balance } from '../core/Balance';
import type { World } from '../core/World';

/** 제단 진입 시 정산 구독. 시작 시 1회 호출 */
export function init(world: World): void {
  world.events.on('altar_entered', () => settle(world));
}

/** applied += pending. 임계를 넘으면 corruption_threshold 발행 */
export function settle(world: World): void {
  const corruption = world.corruption;
  if (corruption.pending <= 0) return;

  const from = corruption.applied;
  corruption.applied = Math.min(balance.corruption.max, corruption.applied + corruption.pending);
  corruption.pending = 0;
  world.events.emit('corruption_applied', { from, to: corruption.applied });

  for (const threshold of balance.corruption.thresholds) {
    if (from < threshold && corruption.applied >= threshold) {
      world.events.emit('corruption_threshold', { threshold });
      if (threshold === 25) world.canReadGlyphs = true; // 벽 문자 해독 개시
    }
  }
}
