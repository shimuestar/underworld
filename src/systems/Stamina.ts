// 스태미너 — 회복과 탈진 해제만 담당한다.
// 소모는 실제로 그 행동을 하는 쪽이 직접 깎는다: 질주는 PlayerMove, 회피는 Reaction.
// (시스템끼리 부르지 않는다 — World 상태만 공유한다)

import { balance } from '../core/Balance';
import { itemDef } from '../core/Inventory';
import type { World } from '../core/World';

/** 시작 시 1회 — 가득 찬 상태로 출발한다 (World는 balance에 의존하지 않으므로 여기서) */
export function init(world: World): void {
  world.stamina.value = balance.player.stamina.max;
}

export function tick(world: World, _dt: number): void {
  const st = world.stamina;
  const cfg = balance.player.stamina;

  // 쓴 직후에는 잠깐 멈췄다가 회복한다 — 안 그러면 질주 중에도 야금야금 찬다.
  // 탈진 구간(0~exhaustRecoverTo)은 훨씬 느리게 — 숨을 고르는 시간이다
  if (st.regenDelay > 0) {
    st.regenDelay--;
  } else if (st.value < cfg.max) {
    let rate = st.exhausted ? cfg.exhaustedRegenPerTick : cfg.regenPerTick;
    // 음식 지속 효과 — 씹은 기운으로 숨이 빨리 돌아온다
    if (world.foodRegenTicks > 0) rate *= itemDef('food').regen?.staminaRegenMul ?? 1;
    st.value = Math.min(cfg.max, st.value + rate);
  }

  // 탈진 해제 — 0에서 바로 풀면 쉬프트를 톡톡 눌러 무한 질주가 된다
  if (st.exhausted && st.value >= cfg.exhaustRecoverTo) {
    st.exhausted = false;
    world.events.emit('stamina_recovered', { value: st.value });
  }
}
