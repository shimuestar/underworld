// 플레이어 시선 회전 + WASD 이동. 충돌은 Level.slideMove(축 분리 스윕 AABB).

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import type { World } from '../core/World';

export function tick(world: World, dt: number): void {
  const p = world.player;
  const input = world.input;

  // 시선 — 마우스 델타를 이번 틱에 소비
  p.yaw -= input.lookDX * balance.input.mouseSensitivity;
  const pitchMax = (balance.input.pitchMaxDeg * Math.PI) / 180;
  p.pitch = Math.max(-pitchMax, Math.min(pitchMax, p.pitch - input.lookDY * balance.input.mouseSensitivity));

  p.prevX = p.x;
  p.prevY = p.y;
  p.prevZ = p.z;

  // 피격 밀림 — 입력·경직과 무관하게 먼저 적용된다. 벽에 막히면 거기서 멈춘다
  if ((p.kbTicks ?? 0) > 0) {
    p.kbTicks = (p.kbTicks ?? 0) - 1;
    world.level.slideMove(p, balance.player.radius, p.kbX ?? 0, p.kbZ ?? 0);
  }

  // 경직/회피 대시 중에는 일반 이동 불가 (시선은 위에서 이미 처리 — 계속 돌아본다)
  if (p.stunTicks > 0 || p.dodgeTicks > 0) {
    resolveEnemyOverlap(world); // 밀리거나 대시로 파묻혀도 겹친 채로 두지 않는다
    return;
  }

  // 이동 방향 (yaw 기준, XZ 평면)
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  let wx = fx * input.moveForward + rx * input.moveX;
  let wz = fz * input.moveForward + rz * input.moveX;
  const len = Math.hypot(wx, wz);
  if (len === 0) {
    resolveEnemyOverlap(world); // 가만히 서 있어도 적이 파고들면 밀려난다
    return;
  }
  wx /= len;
  wz /= len;

  let speed = input.sprint ? balance.player.sprintSpeed : balance.player.moveSpeed;
  if (p.blocking) speed *= balance.block.speedMul; // 방어 중 감속 페널티
  world.level.slideMove(p, balance.player.radius, wx * speed * dt, wz * speed * dt);
  resolveEnemyOverlap(world);
}

/** 적 몸통은 통과할 수 없다 — 겹치면 겹친 만큼 밀려난다.
 *  벽으로 밀리지 않도록 밀어내기도 slideMove를 거친다 */
function resolveEnemyOverlap(world: World): void {
  const p = world.player;
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const minDist = balance.player.radius + enemyDef(enemy.type).radius;
    let dx = p.x - enemy.x;
    let dz = p.z - enemy.z;
    let dist = Math.hypot(dx, dz);
    if (dist >= minDist) continue;
    if (dist === 0) {
      dx = 1; // 완전히 겹친 경우 — 임의 방향으로 뺀다
      dz = 0;
      dist = 1;
    }
    const push = minDist - dist;
    world.level.slideMove(p, balance.player.radius, (dx / dist) * push, (dz / dist) * push);
  }
}
