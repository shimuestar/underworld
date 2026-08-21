// 단일 반응 버튼 (우클릭) — docs/systems/combat.md §1, §3.
// 상황에 따라 자동 분기: 패링 판정 > 반사(투사체) > 처형 > (windup 조기 입력 = 실패) > 회피.
// Enemies 뒤에 실행된다 — 적의 공격 상태가 확정된 뒤 판정해야 하기 때문.
//
// 보스: 완벽/일반 패링 모두 공격을 끊지만, parriesToStagger 연속 성공해야 스태거.
//       스태거 중 처형은 즉사가 아니라 executeDamage 타격.

import { balance } from '../core/Balance';
import { currentAttack, enemyDef } from '../core/Entities';
import type { EnemyState, ProjectileState, World } from '../core/World';

export function tick(world: World, _dt: number): void {
  const p = world.player;
  const reaction = balance.reaction;

  // 진행 중인 상태 카운트다운
  if (p.iframeTicks > 0) p.iframeTicks--;
  if (p.reactionBufferTicks > 0) p.reactionBufferTicks--;

  if (p.stunTicks > 0) {
    p.stunTicks--;
    return; // 경직 중에는 반응 불가 (입력은 버려진다)
  }

  if (p.dodgeTicks > 0) {
    p.dodgeTicks--;
    const step =
      (reaction.dodgeDistance * world.modifiers.dodgeDistanceMul) / reaction.dodgeDashTicks;
    world.level.slideMove(p, balance.player.radius, p.dodgeDirX * step, p.dodgeDirZ * step);
    return; // 대시 중 추가 반응 불가
  }

  const pressed = world.input.reactionPressed || p.reactionBufferTicks > 0;
  if (!pressed) return;
  p.reactionBufferTicks = 0;

  // 반경 내 적을 우선순위로 분류 (같은 우선순위면 가장 가까운 적)
  let parryTarget: { enemy: EnemyState; dist: number } | null = null;
  let executeTarget: { enemy: EnemyState; dist: number } | null = null;
  let windupTarget: { enemy: EnemyState; dist: number } | null = null;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dist = Math.hypot(p.x - enemy.x, p.z - enemy.z);
    if (dist > reaction.radius) continue;
    const attack = currentAttack(enemyDef(enemy.type), enemy);

    if (enemy.ai === 'active_perfect' || enemy.ai === 'active_normal') {
      if (!parryTarget || dist < parryTarget.dist) parryTarget = { enemy, dist };
    } else if (enemy.ai === 'staggered') {
      if (!executeTarget || dist < executeTarget.dist) executeTarget = { enemy, dist };
    } else if (enemy.ai === 'windup' && attack.type !== 'projectile') {
      // 원거리 시전(warden)의 windup은 근접 판정 대상이 아니다 (반사로 대응)
      if (!windupTarget || dist < windupTarget.dist) windupTarget = { enemy, dist };
    }
  }

  // 반사 대상 — 반경 내 접근 중인 적 투사체. 화살(deflectable=false)은 반사 불가 → 회피로
  let deflectTarget: { proj: ProjectileState; dist: number } | null = null;
  for (const proj of world.projectiles) {
    if (proj.owner !== 'enemy' || !proj.deflectable) continue;
    const dist = Math.hypot(p.x - proj.x, p.z - proj.z);
    if (dist > reaction.radius) continue;
    if (!deflectTarget || dist < deflectTarget.dist) deflectTarget = { proj, dist };
  }

  if (parryTarget) {
    const enemy = parryTarget.enemy;
    const def = enemyDef(enemy.type);
    const attack = currentAttack(def, enemy);
    const perfect = enemy.ai === 'active_perfect';
    world.freezeTicks = perfect ? reaction.hitstopPerfectTicks : reaction.hitstopNormalTicks;

    if (def.boss && def.parriesToStagger) {
      // 보스 — 연속 패링 누적, 도달 시에만 스태거
      enemy.parryStreak = (enemy.parryStreak ?? 0) + 1;
      if (enemy.parryStreak >= def.parriesToStagger) {
        enemy.parryStreak = 0;
        enemy.ai = 'staggered';
        enemy.timer = reaction.staggerTicks;
        world.events.emit('boss_staggered', { enemyId: enemy.id });
      } else {
        enemy.ai = 'recover';
        enemy.timer = attack.recoverTicks;
      }
    } else if (perfect) {
      // 완벽 패링 — 적 스태거 → 처형 가능
      enemy.ai = 'staggered';
      enemy.timer = reaction.staggerTicks;
    } else {
      // 일반 패링 — 공격만 무효 (스태거 없음)
      enemy.ai = 'recover';
      enemy.timer = attack.recoverTicks;
    }
    world.events.emit('parry_attempt', {
      result: perfect ? 'perfect' : 'normal',
      chain: 0,
      enemyType: enemy.type,
    });
    return;
  }

  if (deflectTarget) {
    // 반사 — 투사체 반전, 위력 ×1.5, 방어막 무시. 마나·연쇄는 Mana가 구독
    const proj = deflectTarget.proj;
    const caster = world.enemies.find((e) => e.id === proj.casterId && e.alive);
    if (caster) {
      const dx = caster.x - proj.x;
      const dy = enemyDef(caster.type).height * 0.6 - proj.y;
      const dz = caster.z - proj.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const speed = Math.hypot(proj.vx, proj.vy, proj.vz);
      proj.vx = (dx / len) * speed;
      proj.vy = (dy / len) * speed;
      proj.vz = (dz / len) * speed;
    } else {
      proj.vx = -proj.vx;
      proj.vy = -proj.vy;
      proj.vz = -proj.vz;
    }
    proj.owner = 'player';
    proj.deflected = true;
    proj.damage *= 1.5;
    world.freezeTicks = reaction.hitstopNormalTicks;
    world.events.emit('deflect', { casterId: proj.casterId });
    return;
  }

  if (executeTarget) {
    const enemy = executeTarget.enemy;
    const def = enemyDef(enemy.type);
    if (def.boss && def.executeDamage) {
      // 보스 처형 — 즉사가 아니라 큰 타격. 스태거를 끝내 armored 전환을 유도
      enemy.health -= def.executeDamage;
      world.freezeTicks = reaction.hitstopPerfectTicks;
      world.events.emit('boss_execute', { enemyId: enemy.id, damage: def.executeDamage });
      if (enemy.health <= 0) {
        enemy.alive = false;
        world.events.emit('melee_kill', {
          enemyType: enemy.type,
          execution: true,
          x: enemy.x,
          z: enemy.z,
        });
        world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
      } else {
        enemy.timer = 1; // 다음 틱에 스태거 종료 → armored 페이즈로
      }
      return;
    }
    // 일반 적 — 처형 즉사. 마나는 Mana가, 각인 드랍은 Sigils가 이 이벤트를 구독해 처리
    enemy.alive = false;
    world.events.emit('melee_kill', {
      enemyType: enemy.type,
      execution: true,
      x: enemy.x,
      z: enemy.z,
    });
    world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
    return;
  }

  if (windupTarget) {
    // 조기 입력 — 실패. 경직 20t (마나 절반 소실은 Mana)
    p.stunTicks = reaction.failStunTicks;
    world.events.emit('parry_attempt', {
      result: 'fail',
      chain: 0,
      enemyType: windupTarget.enemy.type,
    });
    return;
  }

  // 아무것도 없음 — 회피 스텝 (이동 입력 방향, 없으면 뒤로)
  const input = world.input;
  let dirX: number;
  let dirZ: number;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  if (input.moveX !== 0 || input.moveForward !== 0) {
    dirX = fx * input.moveForward + rx * input.moveX;
    dirZ = fz * input.moveForward + rz * input.moveX;
  } else {
    dirX = -fx;
    dirZ = -fz;
  }
  const len = Math.hypot(dirX, dirZ);
  p.dodgeDirX = dirX / len;
  p.dodgeDirZ = dirZ / len;
  p.dodgeTicks = reaction.dodgeDashTicks;
  p.iframeTicks = world.modifiers.dodgeIFrameTicks; // sig_dash 부착 시 연장
  world.events.emit('dodge_step', {});
}
