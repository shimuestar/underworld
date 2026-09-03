// 잠긴 문 — 문 앞에서 E 를 눌러 플레이어가 직접 연다(D).
// 관문(G)만은 예외로 레버로만 열린다 — Lever 가 unlockByLever 로 잠금을 풀어 주면
// 그 뒤 미닫이·개방은 여기서 똑같이 처리한다 (문 파이프라인은 하나다).
//
// 세 단계로 나뉜다.
//   1. 채널  progress 0 → openTicks. E 로 시작하고, 반경 안에서 문을 보고 있는 동안만 오른다.
//            벗어나면 0 으로 되돌아간다 — 손을 뗐으니 잠금이 다시 걸린 셈이다.
//   2. 미닫이 slide 0 → 1. 여기서부터는 손을 떼도 알아서 밀린다.
//   3. 개방   slide 가 1 이 되는 틱에 격자 셀을 뚫는다.
//
// 통행이 열리는 시점을 미닫이가 다 밀린 뒤로 잡은 이유: 셀을 먼저 뚫으면
// 아직 반쯤 닫힌 문을 몸으로 통과할 수 있다. 보이는 것과 지나갈 수 있는 것을 맞춘다.
//
// 닫기(2026-09-03): 열린 문 앞에서 E 를 누르면 closeTicks 동안 되밀려 닫히고, 다 닫힌 틱에 셀이
// 다시 벽이 된다 — 적 추격·소음이 막힌다(쫓기다 문을 닫아 끊는 수). 문 칸에 몸이 있으면 시작을
// 거부하고, 닫히는 중에 들어오면 그 자리에서 멈춰 기다린다(벽 속에 몸이 갇히지 않게).
// 한 번 자물쇠가 풀린 문은 채널 없이 E 한 번에 다시 밀려 열린다 — 자물쇠는 이미 부서졌다.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { addDoorFrameBlockers, removeDoorFrameBlockers } from '../level/GridLoader';
import type { DoorState, World } from '../core/World';

/** 문 칸에 몸이 있는가 — 플레이어·살아 있는 적의 원이 셀 사각형과 겹치면 참 */
function bodyInDoorway(world: World, door: DoorState): boolean {
  const cs = world.level.cellSize;
  const minX = door.col * cs;
  const maxX = minX + cs;
  const minZ = door.row * cs;
  const maxZ = minZ + cs;
  const overlaps = (x: number, z: number, r: number): boolean =>
    x + r > minX && x - r < maxX && z + r > minZ && z - r < maxZ;
  const p = world.player;
  if (!world.dead && overlaps(p.x, p.z, balance.player.radius)) return true;
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    if (overlaps(enemy.x, enemy.z, enemyDef(enemy.type).radius)) return true;
  }
  return false;
}

/** 닫히는 중 — 몸에 걸리면 멈춰 기다리고, 다 닫힌 틱에 셀·문틀을 되돌린다 */
function tickClosing(world: World, door: DoorState, closeTicks: number): void {
  door.prevSlide = door.slide;
  if (bodyInDoorway(world, door)) return;
  door.slide = Math.max(0, door.slide - 1 / Math.max(1, closeTicks));
  if (door.slide > 0) return;
  door.closing = false;
  door.opened = false;
  door.progress = 0;
  door.swingDir = undefined; // 다음에 열 때 여는 사람 반대쪽으로 다시 정한다
  world.level.closeCell(door.col, door.row, door.byLever ? 'G' : 'D');
  if (door.frameBlockers) {
    removeDoorFrameBlockers(world.level, door.frameBlockers);
    door.frameBlockers = undefined;
  }
  world.events.emit('door_closed', { row: door.row, col: door.col, x: door.x, z: door.z });
}

export function tick(world: World, _dt: number): void {
  const cfg = balance.door;
  const p = world.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const arcCos = Math.cos((cfg.facingArcDeg * Math.PI) / 360);

  // 손댈 수 있는 문 — 반경 안 + 바라보는 중인 것 중 가장 가까운 하나. 잠긴 문(채널 전)과
  // 열린 문(닫기) 둘 다 대상이다. 밀리는 중·닫히는 중은 손댈 수 없다
  let target: DoorState | null = null;
  let best = Infinity;
  for (const door of world.doors) {
    if (door.closing) continue;
    if (!door.opened && door.progress >= cfg.openTicks) continue;
    const toX = door.x - p.x;
    const toZ = door.z - p.z;
    const dist = Math.hypot(toX, toZ);
    if (dist > cfg.radius || dist >= best) continue;
    if (dist > 0.001 && (toX * fx + toZ * fz) / dist < arcCos) continue;
    target = door;
    best = dist;
  }
  world.doorInView = target;

  for (const door of world.doors) {
    if (door.closing) {
      tickClosing(world, door, cfg.closeTicks);
      continue;
    }
    if (door.opened) {
      // 닫기 — 열린 문 앞에서 E. 문 칸에 몸이 있으면 거부한다 (닫히면 벽이 되므로)
      if (door === target && world.input.interactPressed) {
        if (bodyInDoorway(world, door)) {
          world.events.emit('door_blocked', { row: door.row, col: door.col });
        } else {
          door.closing = true;
          door.prevSlide = door.slide;
          world.events.emit('door_closing', { row: door.row, col: door.col, x: door.x, z: door.z });
        }
      }
      continue;
    }

    // 2·3단계 — 잠금이 풀린 문은 손과 무관하게 계속 밀린다
    if (door.progress >= cfg.openTicks) {
      // 문은 여는 사람에게서 먼 쪽으로 젖혀진다 — 당기지 않고 민다.
      // dirX 문(좌우가 벽)은 앞뒤가 Z 축이고, dirZ 문은 앞뒤가 X 축이다
      if (door.swingDir === undefined) {
        const side = door.dirX !== 0 ? p.z - door.z : p.x - door.x;
        door.swingDir = side >= 0 ? 1 : -1;
      }
      door.prevSlide = door.slide;
      door.slide = Math.min(1, door.slide + 1 / Math.max(1, cfg.slideTicks));
      if (door.slide >= 1) {
        door.opened = true;
        door.unlockedOnce = true; // 자물쇠는 이제 부서졌다 — 닫아도 채널 없이 다시 열린다
        world.level.openCell(door.col, door.row);
        // 셀은 열렸지만 석조 문틀은 그대로 서 있다 — 몸이 그걸 뚫고 지나가면 안 된다
        door.frameBlockers = addDoorFrameBlockers(world.level, door.col, door.row);
        world.events.emit('door_opened', { row: door.row, col: door.col });
      }
      continue;
    }

    // 1단계 — 대상에서 벗어나면 처음으로 되돌린다
    if (door !== target) {
      if (door.progress > 0) {
        door.progress = 0;
        world.events.emit('door_channel_broken', { row: door.row, col: door.col });
      }
      continue;
    }

    // 이미 손을 대고 있으면 계속, 아니면 E 를 눌러야 시작한다
    // 관문은 손으로 안 열린다 — 레버가 progress 를 채워 줄 때까지 그대로다 (한 번 풀린 뒤는 예외)
    if (door.byLever && !door.unlockedOnce) {
      if (world.input.interactPressed) {
        world.events.emit('door_needs_lever', { row: door.row, col: door.col });
      }
      continue;
    }
    if (door.progress === 0 && !world.input.interactPressed) continue;
    if (door.unlockedOnce) {
      // 닫아 둔 문 — 자물쇠가 없으니 채널 없이 곧장 밀린다
      door.progress = cfg.openTicks;
      world.events.emit('door_reopened', { row: door.row, col: door.col, x: door.x, z: door.z });
      continue;
    }
    door.progress++;
    if (door.progress === 1) {
      world.events.emit('door_channel_started', { row: door.row, col: door.col });
    }
    if (door.progress >= cfg.openTicks) {
      world.events.emit('door_unlocked', { row: door.row, col: door.col, x: door.x, z: door.z });
    }
  }
}

/** 지금 손대고 있는 문의 진행률 0~1 — 손 연출과 HUD 게이지가 읽는다.
 *  미닫이가 밀리는 동안은 손을 떼므로 0 이다 */
export function channelFrac(world: World): number {
  const door = world.doorInView;
  // 열린 문(닫기 대상)은 채널이 없다 — progress 는 열릴 때의 값(openTicks)이 남아 있을 뿐이다
  if (!door || door.opened || door.byLever || door.progress <= 0) return 0;
  return Math.min(1, door.progress / balance.door.openTicks);
}
