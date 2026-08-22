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
import { rayVsAabb } from '../core/Ray';
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
          // 아군이 사선을 막으면 옆으로 이동해 각을 잡는다.
          // 너무 오래 못 잡으면 그냥 쏜다 — 아군을 맞히는 것도 결과 중 하나
          const blocker = blockingAlly(world, enemy, def, attack);
          const blockedTicks = enemy.strafeBlockedTicks ?? 0;
          if (blocker && blockedTicks < strafeCfg.giveUpTicks) {
            strafeForAngle(world, enemy, def, blocker, distX, distZ, dist, dt);
            break;
          }
          enemy.strafeBlockedTicks = 0;
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

    // active_perfect / active_normal 은 이제 "타격 이동 구간"의 앞·뒤 절반일 뿐이다.
    // 완벽/일반 판정은 상태가 아니라 무기 끝과 가드의 거리(Reaction)가 정한다.
    case 'active_perfect': {
      enemy.timer--;
      advanceStrike(enemy, def, attack);
      if (enemy.timer <= 0) {
        enemy.ai = 'active_normal';
        enemy.timer = balance.reaction.windowNormalTicks;
      }
      break;
    }

    case 'active_normal': {
      enemy.timer--;
      advanceStrike(enemy, def, attack);
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
        if (blocked) world.events.emit('block_hit', { amount: damage, kind: 'melee' });
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

const strafeCfg = balance.enemyAi.strafe;

/** 발사선을 가로막는 아군 — 실제 투사체와 같은 기하로 예측한다 (Projectiles와 동일 규칙) */
function blockingAlly(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  attack: EnemyAttackDef,
): EnemyState | null {
  const p = world.player;
  const originY = def.height * 0.7;
  const targetY = p.y + balance.player.eyeHeight * 0.8;
  const dx = p.x - enemy.x;
  const dy = targetY - originY;
  const dz = p.z - enemy.z;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  const dirX = dx / len;
  const dirY = dy / len;
  const dirZ = dz / len;

  const projRadius = attack.projectileRadius ?? 0.3;
  const muzzle = def.radius + projRadius;
  const ox = enemy.x + dirX * muzzle;
  const oz = enemy.z + dirZ * muzzle;

  // 플레이어까지의 거리 — 이보다 앞에 있는 아군만 사선을 막는다
  const pr = balance.player.radius + projRadius;
  const playerT =
    rayVsAabb(ox, originY, oz, dirX, dirY, dirZ, {
      minX: p.x - pr,
      minY: -projRadius,
      minZ: p.z - pr,
      maxX: p.x + pr,
      maxY: balance.player.height + projRadius,
      maxZ: p.z + pr,
    }) ?? Infinity;

  let nearest: EnemyState | null = null;
  let nearestT = playerT;
  for (const other of world.enemies) {
    if (!other.alive || other.id === enemy.id) continue;
    const od = enemyDef(other.type);
    const t = rayVsAabb(ox, originY, oz, dirX, dirY, dirZ, {
      minX: other.x - od.radius - projRadius,
      minY: -projRadius,
      minZ: other.z - od.radius - projRadius,
      maxX: other.x + od.radius + projRadius,
      maxY: od.height + projRadius,
      maxZ: other.z + od.radius + projRadius,
    });
    if (t !== null && t < nearestT) {
      nearestT = t;
      nearest = other;
    }
  }
  return nearest;
}

/** 사선이 트일 때까지 플레이어를 중심으로 옆걸음. 막힌 아군 반대쪽으로 시작한다 */
function strafeForAngle(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  blocker: EnemyState,
  distX: number,
  distZ: number,
  dist: number,
  dt: number,
): void {
  const perpX = -distZ / dist;
  const perpZ = distX / dist;
  const ticks = (enemy.strafeBlockedTicks ?? 0) + 1;
  enemy.strafeBlockedTicks = ticks;

  if (ticks === 1) {
    // 막은 아군의 반대쪽으로 — 더 빨리 트인다
    const lateral = perpX * (blocker.x - enemy.x) + perpZ * (blocker.z - enemy.z);
    enemy.strafeDir = lateral > 0 ? -1 : 1;
    world.events.emit('enemy_repositioning', {
      enemyId: enemy.id,
      enemyType: enemy.type,
      blockedBy: blocker.id,
    });
  } else if (ticks % strafeCfg.flipAfterTicks === 0) {
    enemy.strafeDir = -(enemy.strafeDir ?? 1); // 한쪽으로 계속 못 트이면 반대로
  }

  const dir = enemy.strafeDir ?? 1;
  const step = def.speed * strafeCfg.speedMul * dt;
  const beforeX = enemy.x;
  const beforeZ = enemy.z;
  world.level.slideMove(enemy, def.radius, perpX * step * dir, perpZ * step * dir);
  // 벽에 막혀 제자리면 즉시 반대쪽으로
  if (Math.hypot(enemy.x - beforeX, enemy.z - beforeZ) < step * 0.3) {
    enemy.strafeDir = -dir;
  }
}

/** 무기가 닿는 최대 거리 (적 중심 기준) — impact 판정 거리와 같아야 한다 */
export function fullReach(def: ReturnType<typeof enemyDef>, attack: EnemyAttackDef): number {
  return def.attackRange * attack.impactRangeMul;
}

/** 타격 진행도에 따라 무기 끝 거리를 갱신. 예비동작에서 당겨진 위치부터 최대 사거리까지 */
function advanceStrike(
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  attack: EnemyAttackDef,
): void {
  const total = balance.reaction.windowPerfectTicks + balance.reaction.windowNormalTicks;
  const elapsed =
    enemy.ai === 'active_perfect'
      ? balance.reaction.windowPerfectTicks - enemy.timer
      : balance.reaction.windowPerfectTicks + (balance.reaction.windowNormalTicks - enemy.timer);
  const progress = Math.max(0, Math.min(1, elapsed / total));
  const reach = fullReach(def, attack);
  const rest = reach * balance.parrySpace.pullbackRatio;
  enemy.strikeProgress = progress;
  enemy.weaponTipDist = rest + (reach - rest) * progress;
}

function startWindup(world: World, enemy: EnemyState, attack: EnemyAttackDef): void {
  enemy.ai = 'windup';
  enemy.timer = attack.windupTicks;
  enemy.strikeProgress = 0;
  enemy.weaponTipDist = fullReach(enemyDef(enemy.type), attack) * balance.parrySpace.pullbackRatio;
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

  // 시전자 몸 밖에서 출발 — 밀착한 아군이 발사 즉시 삼키는 것을 막는다
  const radius = attack.projectileRadius ?? 0.3;
  const muzzle = def.radius + radius;
  const originX = enemy.x + (dx / len) * muzzle;
  const originZ = enemy.z + (dz / len) * muzzle;

  world.projectiles.push({
    id: nextProjectileId++,
    owner: 'enemy',
    x: originX,
    y: originY,
    z: originZ,
    prevX: originX,
    prevY: originY,
    prevZ: originZ,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    vz: (dz / len) * speed,
    lifeTicks: 240,
    damage: def.damage,
    burnTicks: 0,
    burnDamagePerTick: 0,
    radius,
    casterId: enemy.id,
    deflectable: attack.deflectable ?? false,
    kind:
      (attack.projectileKind as 'rock' | undefined) ??
      ((attack.deflectable ?? false) ? 'magic' : 'arrow'),
  });
  world.events.emit('enemy_cast', { enemyId: enemy.id, enemyType: enemy.type });
}
