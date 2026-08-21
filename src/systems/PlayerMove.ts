// 플레이어 시선 회전 + WASD 이동 + 스윕 AABB 충돌.
// 축 분리(X 이동 → 해결 → Z 이동 → 해결)로 벽 슬라이딩을 얻는다. docs/architecture.md §3.

import { balance } from '../core/Balance';
import type { World } from '../core/World';

/** 벽 면에서 살짝 띄우는 수치 오차 방지용 여유 (튜닝값 아님) */
const SKIN = 1e-3;

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
  moveAxis(world, wx * speed * dt, 0);
  moveAxis(world, 0, wz * speed * dt);
}

function moveAxis(world: World, dx: number, dz: number): void {
  const p = world.player;
  const level = world.level;
  const cs = level.cellSize;
  const r = balance.player.radius;

  let nx = p.x + dx;
  let nz = p.z + dz;

  const minCol = Math.floor((nx - r) / cs);
  const maxCol = Math.floor((nx + r) / cs);
  const minRow = Math.floor((nz - r) / cs);
  const maxRow = Math.floor((nz + r) / cs);

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!level.solidAt(col, row)) continue;
      if (dx > 0) nx = Math.min(nx, col * cs - r - SKIN);
      else if (dx < 0) nx = Math.max(nx, (col + 1) * cs + r + SKIN);
      if (dz > 0) nz = Math.min(nz, row * cs - r - SKIN);
      else if (dz < 0) nz = Math.max(nz, (row + 1) * cs + r + SKIN);
    }
  }

  p.x = nx;
  p.z = nz;
}
