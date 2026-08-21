// 적 AI. 모든 근접 적은 공통 공격 상태 머신을 가진다 — docs/systems/combat.md §2.
//
//   idle → chase → windup → active_perfect(6t) → active_normal(12t) → impact → recover → chase
//                                                                  (패링 시 staggered / recover)
//
// 패링 불가 공격(적색·보스 armored)은 판정 창 없이 windup → impact.
// 원거리 캐스터(warden)는 windup 종료 시 투사체를 발사하고 recover로 간다.
// 보스(boss_two_phase)는 melee(청색·패링 가능) ↔ armored(적색·실탄으로 장갑 파괴) 교대.
// windup 진입 시 enemy_windup(오디오), 종료 visualLeadTicks 전에 telegraph_flash(섬광).

import { balance } from '../core/Balance';
import { currentAttack, enemyDef, type EnemyAttackDef } from '../core/Entities';
import { playerBlocks, type EnemyState, type World } from '../core/World';

let nextProjectileId = 100000; // 적 투사체 id 대역 (플레이어 투사체와 구분)

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

  // 넉백 — 밀려나는 동안은 휘청여서 다른 행동을 못 한다 (벽에는 막힘)
  if ((enemy.kbTicks ?? 0) > 0) {
    enemy.kbTicks = (enemy.kbTicks ?? 0) - 1;
    world.level.slideMove(enemy, def.radius, enemy.kbX ?? 0, enemy.kbZ ?? 0);
    return;
  }

  const distX = p.x - enemy.x;
  const distZ = p.z - enemy.z;
  const dist = Math.hypot(distX, distZ);
  const attack = currentAttack(def, enemy);

  switch (enemy.ai) {
    case 'idle': {
      if (dist <= def.aggroRange && world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)) {
        enemy.ai = 'chase';
        world.events.emit('enemy_alerted', { enemyId: enemy.id, enemyType: enemy.type });
      }
      break;
    }

    case 'chase': {
      enemy.yaw = Math.atan2(-distX, -distZ);

      if (def.behavior === 'caster_kite') {
        // 너무 가까우면 물러나고, 시야가 트이면 시전
        if (dist < (def.kiteMinRange ?? 0) && dist > 0) {
          const step = def.speed * dt;
          world.level.slideMove(enemy, def.radius, (-distX / dist) * step, (-distZ / dist) * step);
        } else if (
          dist <= def.attackRange &&
          world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
        ) {
          startWindup(world, enemy, attack);
        } else if (dist > 0) {
          const step = def.speed * dt;
          world.level.slideMove(enemy, def.radius, (distX / dist) * step, (distZ / dist) * step);
        }
        break;
      }

      if (dist <= def.attackRange) {
        enemy.attackMode = 'melee';
        startWindup(world, enemy, currentAttack(def, enemy));
        break;
      }
      // 원거리 보조 공격 (족장 바위 투척) — 근접 거리 밖 + 시야 확보 시
      if (
        def.rangedAttack &&
        dist >= (def.rangedAttack.minRange ?? 0) &&
        world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
      ) {
        enemy.attackMode = 'ranged';
        startWindup(world, enemy, def.rangedAttack);
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
      if (enemy.timer > 0) break;

      if (attack.type === 'projectile') {
        // 시전 완료 — 마법 투사체 발사
        fireProjectile(world, enemy, attack);
        enemy.ai = 'recover';
        enemy.timer = attack.recoverTicks;
      } else if (attack.parryable) {
        enemy.ai = 'active_perfect';
        enemy.timer = balance.reaction.windowPerfectTicks;
      } else {
        // 패링 불가 — 판정 창 없이 즉시 타격
        enemy.ai = 'impact';
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
      if (dist <= def.attackRange * attack.impactRangeMul && p.iframeTicks <= 0) {
        // 방어(정면) — 칩 데미지만 관통. 피해가 있으므로 연쇄는 여전히 리셋된다
        const blocked = playerBlocks(world, enemy.x, enemy.z, balance.block.arcDeg);
        const damage = blocked ? def.damage * balance.block.chipDamageRatio : def.damage;
        p.health -= damage;
        if (enemy.parryStreak !== undefined) enemy.parryStreak = 0; // 연속 패링 끊김
        if (blocked) world.events.emit('block_hit', { amount: damage });
        world.events.emit('player_damaged', { amount: damage, health: p.health, blocked });
        if (p.health <= 0) {
          p.health = 0;
          world.dead = true;
          world.events.emit('player_died', { tick: world.tick });
        }
      }
      enemy.ai = 'recover';
      enemy.timer = attack.recoverTicks;
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
        if (def.boss && enemy.phase === 'melee') {
          // 보스 — 스태거가 끝나면 장갑 페이즈로 (실탄 구간)
          enemy.phase = 'armored';
          enemy.armorHealth = def.armorHealth ?? 0;
          world.events.emit('boss_phase', { enemyId: enemy.id, phase: 'armored' });
        }
        enemy.ai = 'recover';
        enemy.timer = attack.recoverTicks;
      }
      break;
    }
  }
}

function startWindup(world: World, enemy: EnemyState, attack: EnemyAttackDef): void {
  enemy.ai = 'windup';
  enemy.timer = attack.windupTicks;
  world.events.emit('enemy_windup', {
    enemyId: enemy.id,
    enemyType: enemy.type,
    telegraph: attack.telegraph ?? 'blue',
  });
}

function fireProjectile(world: World, enemy: EnemyState, attack: EnemyAttackDef): void {
  const def = enemyDef(enemy.type);
  const p = world.player;
  const originY = def.height * 0.7;
  const targetY = p.y + balance.player.eyeHeight * 0.8;
  const dx = p.x - enemy.x;
  const dy = targetY - originY;
  const dz = p.z - enemy.z;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return;
  const speed = attack.projectileSpeed ?? 12;

  world.projectiles.push({
    id: nextProjectileId++,
    owner: 'enemy',
    x: enemy.x,
    y: originY,
    z: enemy.z,
    prevX: enemy.x,
    prevY: originY,
    prevZ: enemy.z,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    vz: (dz / len) * speed,
    lifeTicks: 240,
    damage: def.damage,
    burnTicks: 0,
    burnDamagePerTick: 0,
    radius: attack.projectileRadius ?? 0.3,
    casterId: enemy.id,
    deflectable: attack.deflectable ?? false,
    kind:
      (attack.projectileKind as 'rock' | undefined) ??
      ((attack.deflectable ?? false) ? 'magic' : 'arrow'),
  });
  world.events.emit('enemy_cast', { enemyId: enemy.id, enemyType: enemy.type });
}
