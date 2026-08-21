// 적 AI. 고블린 러너: 직선 추격(charge) → 근접 시 windup → impact 접촉 피해 → recover.
// windup/recover 등 모든 틱 수치는 entities.json에서 로드.

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
      if (dist <= def.attackRange) {
        enemy.ai = 'windup';
        enemy.timer = def.attack.windupTicks;
        world.events.emit('enemy_windup', { enemyId: enemy.id, enemyType: enemy.type });
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
      if (enemy.timer > 0) break;
      // impact — 아직 범위 안이면 접촉 피해
      if (dist <= def.attackRange * def.attack.impactRangeMul) {
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
  }
}
