// 적 AI. 모든 근접 적은 공통 공격 상태 머신을 가진다 — docs/systems/combat.md §2.
//
//   idle → chase → windup → active_perfect(6t) → active_normal(12t) → impact → recover → chase
//                                                                  (패링 시 staggered / recover)
//
// windup 진입 시 enemy_windup(오디오 신호), 종료 visualLeadTicks 전에 telegraph_flash(섬광).
// 판정 창(active_*) 길이는 balance.reaction의 전역 값, 나머지 틱 수치는 entities.json.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import type { EnemyState, World } from '../core/World';

export function tick(world: World, dt: number): void {
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    tickEnemy(world, enemy, dt);
  }
}

function tickEnemy(world: World, enemy: EnemyState, dt: number): void {
  const def = enemyDef(enemy.type);
  const p = world.player;

  enemy.prevX = enemy.x;
  enemy.prevZ = enemy.z;

  const distX = p.x - enemy.x;
  const distZ = p.z - enemy.z;
  const dist = Math.hypot(distX, distZ);

  switch (enemy.ai) {
    case 'idle': {
      if (dist <= def.aggroRange && world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)) {
        enemy.ai = 'chase';
        world.events.emit('enemy_alerted', { enemyId: enemy.id, enemyType: enemy.type });
      }
      break;
    }

    case 'chase': {
      // 추격 중에는 항상 플레이어를 바라본다 (정면 방패 판정 기준)
      enemy.yaw = Math.atan2(-distX, -distZ);
      if (dist <= def.attackRange) {
        enemy.ai = 'windup';
        enemy.timer = def.attack.windupTicks;
        world.events.emit('enemy_windup', {
          enemyId: enemy.id,
          enemyType: enemy.type,
          telegraph: def.attack.telegraph ?? 'blue',
        });
        break;
      }
      if (dist > 0) {
        const step = def.speed * dt;
        world.level.slideMove(enemy, def.radius, (distX / dist) * step, (distZ / dist) * step);
      }
      break;
    }

    case 'windup': {
      enemy.timer--;
      if (enemy.timer === balance.telegraph.visualLeadTicks) {
        world.events.emit('telegraph_flash', { enemyId: enemy.id, enemyType: enemy.type });
      }
      if (enemy.timer <= 0) {
        enemy.ai = 'active_perfect';
        enemy.timer = balance.reaction.windowPerfectTicks;
      }
      break;
    }

    case 'active_perfect': {
      enemy.timer--;
      if (enemy.timer <= 0) {
        enemy.ai = 'active_normal';
        enemy.timer = balance.reaction.windowNormalTicks;
      }
      break;
    }

    case 'active_normal': {
      enemy.timer--;
      if (enemy.timer <= 0) enemy.ai = 'impact';
      break;
    }

    case 'impact': {
      if (dist <= def.attackRange * def.attack.impactRangeMul && p.iframeTicks <= 0) {
        p.health -= def.damage;
        world.events.emit('player_damaged', { amount: def.damage, health: p.health });
        if (p.health <= 0) {
          p.health = 0;
          world.dead = true;
          world.events.emit('player_died', { tick: world.tick });
        }
      }
      enemy.ai = 'recover';
      enemy.timer = def.attack.recoverTicks;
      break;
    }

    case 'recover': {
      enemy.timer--;
      if (enemy.timer <= 0) enemy.ai = 'chase';
      break;
    }

    case 'staggered': {
      enemy.timer--;
      if (enemy.timer <= 0) {
        enemy.ai = 'recover';
        enemy.timer = def.attack.recoverTicks;
      }
      break;
    }
  }
}
