// 폭발통 — 도화선을 돌리고 터뜨린다.
//
// 점화는 때리는 쪽이 한다: 총·해머는 World.hitBarrel(누적 → 도화선 단축),
// 화염구·수류탄·다른 통의 폭발은 World.igniteBarrel(즉발).
// 여기서는 도화선만 세고, 0이 되는 틱에 반경 안의 적·플레이어·다른 통을 함께 친다.
//
// 시스템 순서상 Projectiles 뒤에 둔다 — 같은 틱에 던진 수류탄·쏜 화염구가
// 그 틱에 통을 터뜨릴 수 있어야 "즉발"이 한 프레임도 안 밀린다.

import { balance } from '../core/Balance';
import { explodeAt } from '../core/Explosion';
import type { BarrelState, World } from '../core/World';

export function tick(world: World, _dt: number): void {
  for (const barrel of world.barrels) {
    if (!barrel.alive || barrel.fuseTicks < 0) continue;
    // 먼저 줄이고 0이 된 그 틱에 터뜨린다 — 120이면 정확히 120틱(2초).
    // 나중에 줄이면 한 틱이 더 붙어 2.02초가 된다
    if (barrel.fuseTicks > 0) {
      barrel.fuseTicks--;
      if (barrel.fuseTicks > 0) continue;
    }
    explode(world, barrel);
  }
}

/** 터진다 — 통 고유 처리(상태·차단·barrel_exploded)만 하고 광역은 공용 폭발
 *  (core/Explosion.explodeAt)에 맡긴다. 기믹 폭발과 같은 규약을 쓰기 위한 추출 */
function explode(world: World, barrel: BarrelState): void {
  const cfg = balance.barrel;
  barrel.alive = false;
  barrel.fuseTicks = -1;
  if (barrel.blocker) {
    world.level.removeBlocker(barrel.blocker);
    barrel.blocker = undefined;
  }
  world.events.emit('barrel_exploded', { id: barrel.id, x: barrel.x, z: barrel.z });
  explodeAt(world, barrel.x, barrel.z, {
    radius: cfg.radius,
    damage: cfg.damage,
    damageFalloffMin: cfg.damageFalloffMin,
    enemyKnockback: cfg.enemyKnockback,
    playerKnockback: cfg.playerKnockback,
    playerKnockbackTicks: cfg.playerKnockbackTicks,
    noiseRadius: cfg.noiseRadius,
    fxHeight: cfg.height * 0.5,
  });
}
