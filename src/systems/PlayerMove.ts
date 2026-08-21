// 플레이어 시선 회전 + WASD 이동. 충돌은 Level.slideMove(축 분리 스윕 AABB).

import { balance } from '../core/Balance';
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

  // 경직/회피 대시 중에는 일반 이동 불가 (시선은 위에서 이미 처리 — 계속 돌아본다)
  if (p.stunTicks > 0 || p.dodgeTicks > 0) return;

  // 이동 방향 (yaw 기준, XZ 평면)
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  let wx = fx * input.moveForward + rx * input.moveX;
  let wz = fz * input.moveForward + rz * input.moveX;
  const len = Math.hypot(wx, wz);
  if (len === 0) return;
  wx /= len;
  wz /= len;

  const speed = input.sprint ? balance.player.sprintSpeed : balance.player.moveSpeed;
  world.level.slideMove(p, balance.player.radius, wx * speed * dt, wz * speed * dt);
}
