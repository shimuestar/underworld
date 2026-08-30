// 성장 자원 — 적 처치 경험치. 수치는 entities.json 의 적별 xp.
// (레벨업·능력치 성장은 이후 구역. 지금은 누적만 한다)

import { enemyDef } from '../core/Entities';
import type { World } from '../core/World';

/** 처치 구독. 시작 시 1회 호출 */
export function init(world: World): void {
  world.events.on('enemy_died', (payload) => {
    const { enemyType, noLoot } = payload as { enemyType: string; noLoot?: boolean };
    if (noLoot) return; // 보스 소환수 — 경험치 없음
    const amount = enemyDef(enemyType).xp;
    if (!amount) return;
    world.xp += amount;
    world.events.emit('xp_gained', { amount, total: world.xp, enemyType });
  });
}
