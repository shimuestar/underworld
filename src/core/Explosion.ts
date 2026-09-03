// 폭발 하나 — 반경 피해·넉백·방패 파괴·통 연쇄·소품(구울 머리·기믹) 파괴·소음까지.
// 폭발통(Barrels)과 기믹 폭발(Props)이 같은 규약을 쓴다 — 시스템이 아니라
// pushPlayer·alertNearbyAt 과 같은 층위의 core 공용 헬퍼다.

import { balance } from './Balance';
import { enemyDef, shieldBlocksProjectile } from './Entities';
import {
  alertNearbyAt,
  applyFrostOnHit,
  breakHeadsInRadius,
  breakPropsInRadius,
  igniteBarrel,
  igniteOilInRadius,
  provokeTrapsInRadius,
  pushEnemy,
  pushPlayer,
  type World,
} from './World';

export interface ExplosionSpec {
  radius: number;
  damage: number;
  damageFalloffMin: number;
  enemyKnockback: number;
  playerKnockback: number;
  playerKnockbackTicks: number;
  noiseRadius: number;
  /** explosion 이벤트(이펙트·소리)의 y — 폭심 높이 */
  fxHeight: number;
}

/** 폭심에서 바깥으로 밀어낸다. 체급이 무거울수록 덜 밀린다 —
 *  해머 마무리 타와 같은 규약 (balance.explosionKnockback) */
function pushFromBlast(enemy: Parameters<typeof pushEnemy>[0], cx: number, cz: number, distance: number): void {
  const kb = balance.explosionKnockback;
  const byWeight = kb.byWeight as unknown as Record<string, number>;
  const weightMul = byWeight[enemyDef(enemy.type).weight] ?? 1;
  pushEnemy(enemy, enemy.x - cx, enemy.z - cz, distance * weightMul, kb.ticks);
}

/** 터진다 — 적·플레이어·다른 통·소품을 가리지 않는다. 통 연쇄는 즉발 점화로 걸어 두고
 *  같은 틱의 뒷 순서(또는 다음 틱)에 터지게 한다 (재귀 금지 — 스택이 깊어진다) */
export function explodeAt(world: World, x: number, z: number, cfg: ExplosionSpec): void {
  world.events.emit('explosion', { x, y: cfg.fxHeight, z, radius: cfg.radius });

  const damageAt = (dist: number): number =>
    cfg.damage * (1 - (1 - cfg.damageFalloffMin) * Math.min(1, dist / cfg.radius));

  breakHeadsInRadius(world, x, z, cfg.radius); // 구울 머리 소품도 터진다
  breakPropsInRadius(world, x, z, cfg.radius); // 기믹도 연쇄로 부서진다 (각자 결과를 굴린다)
  igniteOilInRadius(world, x, z, cfg.radius, balance.traps.types.trap_oil.burnTicks); // 기름 웅덩이에 불
  provokeTrapsInRadius(world, x, z, cfg.radius, 'trap_gas', balance.traps.types.trap_gas.telegraphTicks, 'explosion'); // 포자 식물도 터진다

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dist = Math.hypot(enemy.x - x, enemy.z - z);
    if (dist > cfg.radius) continue;
    if (enemy.ai === 'idle') enemy.ai = 'chase';

    // 정면 방패로 폭풍을 받아내면 방패가 부서진다 — 수류탄·화염구와 같은 규칙
    let damage = damageAt(dist);
    if (shieldBlocksProjectile(enemyDef(enemy.type), enemy, x, z)) {
      enemy.shieldBroken = true;
      damage *= balance.shieldBreak.damageRatio;
      world.events.emit('shield_broken', {
        enemyId: enemy.id,
        enemyType: enemy.type,
        x: enemy.x,
        z: enemy.z,
      });
    }

    const dealt = applyFrostOnHit(world.events, enemy, damage);
    enemy.health -= dealt;
    world.events.emit('damage_pop', { enemyId: enemy.id, amount: dealt });
    if (enemy.health <= 0) {
      enemy.alive = false;
      world.events.emit('weapon_kill', { weapon: 'barrel', enemyType: enemy.type });
      // 폭심 반대 방향을 함께 실어 보낸다 — 밀려날 몸이 안 남으니 파편이 대신 날아간다
      world.events.emit('enemy_died', {
        enemyType: enemy.type,
        x: enemy.x,
        z: enemy.z,
        noLoot: enemy.noLoot,
        blastX: enemy.x - x,
        blastZ: enemy.z - z,
      });
      continue; // 시체를 밀 수는 없다 (사망 즉시 모형이 사라진다)
    }
    // 폭풍에 밀린다 — 피해와 같은 감쇠를 따라 폭심에 가까울수록 멀리 날아간다
    pushFromBlast(enemy, x, z, (cfg.enemyKnockback * damageAt(dist)) / cfg.damage);
  }

  // 플레이어도 예외가 아니다 — 이게 이 기믹의 값이다 (엄폐물 뒤에서 쏘라는 뜻)
  const p = world.player;
  const playerDist = Math.hypot(p.x - x, p.z - z);
  if (playerDist <= cfg.radius && p.iframeTicks <= 0) {
    const damage = damageAt(playerDist);
    p.health -= damage;
    world.events.emit('player_damaged', { amount: damage, health: p.health, source: 'explosion', srcX: x, srcZ: z });
    if (playerDist > 0) {
      pushPlayer(p, (p.x - x) / playerDist, (p.z - z) / playerDist, cfg.playerKnockback, cfg.playerKnockbackTicks);
    }
    if (p.health <= 0) {
      p.health = 0;
      world.dead = true;
      world.events.emit('player_died', { tick: world.tick });
    }
  }

  // 연쇄 — 반경 안의 폭발통도 즉발로 걸린다 (이미 죽은 통은 건너뛴다)
  for (const other of world.barrels) {
    if (!other.alive) continue;
    if (Math.hypot(other.x - x, other.z - z) > cfg.radius) continue;
    igniteBarrel(other);
  }

  // 소음 — 폭발음은 멀리 퍼지되 열린 칸을 따라 흐른다 (닫힌 문 안쪽 방은 별세계).
  // 예전 통 폭발은 벽을 무시하고 깨웠는데, 경로 기반 규약으로 통일했다
  alertNearbyAt(world, x, z, cfg.noiseRadius, balance.enemyAi.noticeDelayTicks);
}
