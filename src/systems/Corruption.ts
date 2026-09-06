// 오염 — 대기(pending)와 확정(applied)의 분리, 제단 정산, 임계 처리.
// docs/systems/economy.md §3. pending 누적은 각 시스템(Sigils 부착·Status 오염 진액 등)이 직접 한다.
// 임계는 넘는 순간 이벤트를 발행하고 되돌리지 않는다.
// 정화(B3-2, 기획서 §11): corruption_cleansed{amount, source} 를 구독해 pending 만 깎는다 — applied 는 불변(임계 불가역).
// pending 은 음수가 될 수 있다: 정산(settle)은 0 이하를 건너뛰고, 다음 각인 부착이 그 여유를 쓴다("각인 하나를 공짜로 새길 여유", §11.1)

import { balance } from '../core/Balance';
import type { World } from '../core/World';

/** 제단 진입 시 정산 구독 + 정화 구독. 시작 시 1회 호출 */
export function init(world: World): void {
  world.events.on('altar_entered', () => settle(world));
  world.events.on('corruption_cleansed', (payload) => cleanse(world, (payload as { amount: number }).amount));
}

/** 오염 대기에서 amount 를 깎는다(분출공 명중·처형 마무리 등) — applied 는 건드리지 않는다. 0 이하 amount 는 무시 */
export function cleanse(world: World, amount: number): void {
  if (!(amount > 0)) return;
  world.corruption.pending -= amount;
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
