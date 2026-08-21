// 단일 반응 버튼 (우클릭) — docs/systems/combat.md §1, §3.
// 상황에 따라 자동 분기: 패링 판정 > 처형 > (windup 조기 입력 = 실패) > 회피 스텝.
// Enemies 뒤에 실행된다 — 적의 공격 상태가 확정된 뒤 판정해야 하기 때문.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import type { EnemyState, World } from '../core/World';

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
    const step = reaction.dodgeDistance / reaction.dodgeDashTicks;
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

    if (enemy.ai === 'active_perfect' || enemy.ai === 'active_normal') {
      if (!parryTarget || dist < parryTarget.dist) parryTarget = { enemy, dist };
    } else if (enemy.ai === 'staggered') {
      if (!executeTarget || dist < executeTarget.dist) executeTarget = { enemy, dist };
    } else if (enemy.ai === 'windup') {
      if (!windupTarget || dist < windupTarget.dist) windupTarget = { enemy, dist };
    }
  }

  if (parryTarget) {
    const enemy = parryTarget.enemy;
    if (enemy.ai === 'active_perfect') {
      // 완벽 패링 — 히트스톱 4t, 적 스태거 → 처형 가능
      world.freezeTicks = reaction.hitstopPerfectTicks;
      enemy.ai = 'staggered';
      enemy.timer = reaction.staggerTicks;
      world.events.emit('parry_attempt', { result: 'perfect', chain: 0, enemyType: enemy.type });
    } else {
      // 일반 패링 — 히트스톱 2t, 공격만 무효 (스태거 없음)
      world.freezeTicks = reaction.hitstopNormalTicks;
      enemy.ai = 'recover';
      enemy.timer = enemyDef(enemy.type).attack.recoverTicks;
      world.events.emit('parry_attempt', { result: 'normal', chain: 0, enemyType: enemy.type });
    }
    return;
  }

  if (executeTarget) {
    // 처형 — 스태거 적 즉사. 마나 획득은 M4의 Mana 시스템이 이 이벤트를 구독해 처리
    const enemy = executeTarget.enemy;
    enemy.alive = false;
    world.events.emit('melee_kill', { enemyType: enemy.type, execution: true });
    return;
  }

  if (windupTarget) {
    // 조기 입력 — 실패. 경직 20t (마나 절반 소실은 M4)
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
  p.iframeTicks = reaction.dodgeIFrameTicks;
  world.events.emit('dodge_step', {});
}
