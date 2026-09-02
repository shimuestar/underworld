// 성장 자원 — 적 처치 경험치. 수치는 entities.json 의 적별 xp.
// (레벨업·능력치 성장은 이후 구역. 지금은 누적만 한다)

import { enemyDef } from '../core/Entities';
import type { World } from '../core/World';

/** 처치 구독. 시작 시 1회 호출 */
export function init(world: World): void {
  world.events.on('enemy_died', (payload) => {
    const { enemyType, noLoot, x, z } = payload as {
      enemyType: string; noLoot?: boolean; x: number; z: number;
    };
    if (noLoot) return; // 보스 소환수 — 경험치 없음
    const amount = enemyDef(enemyType).xp;
    if (!amount) return;
    world.xp += amount;
    // 죽은 자리를 함께 싣는다 — XP 표기가 그 적 머리 위에 뜬다 (피해 숫자와 같은 자리)
    world.events.emit('xp_gained', { amount, total: world.xp, enemyType, x, z });
  });
}
