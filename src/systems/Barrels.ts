// 폭발통 — 도화선을 돌리고 터뜨린다.
//
// 점화는 때리는 쪽이 한다: 총·해머는 World.hitBarrel(누적 → 도화선 단축),
// 화염구·수류탄·다른 통의 폭발은 World.igniteBarrel(즉발).
// 여기서는 도화선만 세고, 0이 되는 틱에 반경 안의 적·플레이어·다른 통을 함께 친다.
//
// 시스템 순서상 Projectiles 뒤에 둔다 — 같은 틱에 던진 수류탄·쏜 화염구가
// 그 틱에 통을 터뜨릴 수 있어야 "즉발"이 한 프레임도 안 밀린다.

import { balance } from '../core/Balance';
import { enemyDef, shieldBlocksProjectile } from '../core/Entities';
import {
  alertEnemy,
  igniteBarrel,
  pushEnemy,
  pushPlayer,
  type BarrelState,
  type EnemyState,
  type World,
} from '../core/World';

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

/** 폭심에서 바깥으로 밀어낸다. 체급이 무거울수록 덜 밀린다 —
 *  해머 마무리 타와 같은 규약 (balance.explosionKnockback) */
function pushFromBlast(enemy: EnemyState, cx: number, cz: number, distance: number): void {
  const kb = balance.explosionKnockback;
  const byWeight = kb.byWeight as unknown as Record<string, number>;
  const weightMul = byWeight[enemyDef(enemy.type).weight] ?? 1;
  pushEnemy(enemy, enemy.x - cx, enemy.z - cz, distance * weightMul, kb.ticks);
}

/** 터진다 — 적·플레이어·다른 통을 가리지 않는다. 연쇄는 즉발로 걸어 두고
 *  같은 틱의 뒷 순서(또는 다음 틱)에 터지게 한다. 여기서 재귀로 들어가면
 *  통이 촘촘한 방에서 호출 스택이 그대로 깊어진다 */
function explode(world: World, barrel: BarrelState): void {
  const cfg = balance.barrel;
  barrel.alive = false;
  barrel.fuseTicks = -1;
  if (barrel.blocker) {
    world.level.removeBlocker(barrel.blocker);
    barrel.blocker = undefined;
  }

  world.events.emit('barrel_exploded', { id: barrel.id, x: barrel.x, z: barrel.z });
  world.events.emit('explosion', {
    x: barrel.x,
    y: cfg.height * 0.5,
    z: barrel.z,
    radius: cfg.radius,
  });

  const damageAt = (dist: number): number =>
    cfg.damage * (1 - (1 - cfg.damageFalloffMin) * Math.min(1, dist / cfg.radius));

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dist = Math.hypot(enemy.x - barrel.x, enemy.z - barrel.z);
    if (dist > cfg.radius) continue;
    if (enemy.ai === 'idle') enemy.ai = 'chase';

    // 정면 방패로 폭풍을 받아내면 방패가 부서진다 — 수류탄·화염구와 같은 규칙
    let damage = damageAt(dist);
    if (shieldBlocksProjectile(enemyDef(enemy.type), enemy, barrel.x, barrel.z)) {
      enemy.shieldBroken = true;
      damage *= balance.shieldBreak.damageRatio;
      world.events.emit('shield_broken', {
        enemyId: enemy.id,
        enemyType: enemy.type,
        x: enemy.x,
        z: enemy.z,
      });
    }

    enemy.health -= damage;
    if (enemy.health <= 0) {
      enemy.alive = false;
      world.events.emit('weapon_kill', { weapon: 'barrel', enemyType: enemy.type });
      world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
      continue; // 시체는 밀지 않는다
    }
    // 폭풍에 밀린다 — 피해와 같은 감쇠를 따라 폭심에 가까울수록 멀리 날아간다
    pushFromBlast(enemy, barrel.x, barrel.z, cfg.enemyKnockback * damageAt(dist) / cfg.damage);
  }

  // 플레이어도 예외가 아니다 — 이게 이 기믹의 값이다 (엄폐물 뒤에서 쏘라는 뜻)
  const p = world.player;
  const playerDist = Math.hypot(p.x - barrel.x, p.z - barrel.z);
  if (playerDist <= cfg.radius && p.iframeTicks <= 0) {
    const damage = damageAt(playerDist);
    p.health -= damage;
    world.events.emit('player_damaged', { amount: damage, health: p.health });
    if (playerDist > 0) {
      pushPlayer(
        p,
        (p.x - barrel.x) / playerDist,
        (p.z - barrel.z) / playerDist,
        cfg.playerKnockback,
        cfg.playerKnockbackTicks,
      );
    }
    if (p.health <= 0) {
      p.health = 0;
      world.dead = true;
      world.events.emit('player_died', { tick: world.tick });
    }
  }

  // 연쇄 — 반경 안의 다른 통도 즉발로 걸린다
  for (const other of world.barrels) {
    if (other === barrel || !other.alive) continue;
    if (Math.hypot(other.x - barrel.x, other.z - barrel.z) > cfg.radius) continue;
    igniteBarrel(other);
  }

  // 소음 — 폭발음은 멀리 퍼진다
  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.ai !== 'idle') continue;
    if (Math.hypot(enemy.x - barrel.x, enemy.z - barrel.z) > cfg.noiseRadius) continue;
    alertEnemy(enemy, balance.enemyAi.noticeDelayTicks);
    world.events.emit('enemy_alerted', { enemyId: enemy.id, enemyType: enemy.type, noise: true });
  }
}
