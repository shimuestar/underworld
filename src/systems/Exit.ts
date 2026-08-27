// 출구·입구 계단 — 층 사이를 오르내린다.
//
// 보스 층의 출구는 쇠사슬·자물쇠로 잠겨 있다: 보스가 죽으면 열쇠를 떨구고,
// 주워서 발판에서 E 를 누르면 자물쇠가 열린다 (열쇠는 1회 소모).
// 보스가 없는 층은 처음부터 열려 있다 — 로드 직후 첫 틱에 열림 신호를 낸다.
// 입구 발판에서 E 를 누르면 위층으로 되돌아간다 (첫 층 제외 — canAscend 는 main 이 준다).
// 내려가기·올라가기 모두 명시적 E 다 — 밟기만 해서 층이 갈리면 교전 중 사고가 난다.

import { enemyDef } from '../core/Entities';
import type { World } from '../core/World';

const EXIT_RADIUS = 1.6; // 발판 중심 기준 진입 판정 (셀 절반보다 약간 작게)
let nextKeyId = 900000; // 바닥 아이템 id 대역 — 픽업(500000)·각인과 겹치지 않게

/** 구독. 시작 시 1회 — 보스가 죽으면 그 자리에 열쇠를 떨군다 */
export function init(world: World): void {
  world.events.on('enemy_died', (payload) => {
    const { enemyType, x, z } = payload as { enemyType: string; x: number; z: number };
    if (!enemyDef(enemyType).boss || !world.exitNeedsKey) return;
    world.groundItems.push({ id: nextKeyId++, kind: 'key', x, z });
    world.events.emit('exit_key_dropped', { x, z });
  });
}

export function tick(world: World, _dt: number): void {
  if (world.cleared) return;
  const p = world.player;

  // 입구 발판 — 내려온 계단을 되짚어 위층으로 올라간다
  const spawn = world.level.spawn;
  world.onEntrancePad =
    world.canAscend && Math.hypot(p.x - spawn.x, p.z - spawn.z) <= EXIT_RADIUS;
  if (world.onEntrancePad && world.input.interactPressed) {
    world.events.emit('floor_ascend', {});
    return;
  }

  const exit = world.level.exitPos;
  if (!exit) return;

  // 보스 없는 층(또는 이미 딴 층)은 로드 직후 첫 틱에 열린다
  if (!world.exitNeedsKey && !world.exitOpen) {
    world.exitOpen = true;
    world.events.emit('exit_opened', { x: exit.x, z: exit.z });
  }

  const dist = Math.hypot(p.x - exit.x, p.z - exit.z);
  world.onExitPad = dist <= EXIT_RADIUS;
  if (!world.onExitPad) {
    world.exitLockedNotified = false;
    return;
  }

  if (world.exitNeedsKey) {
    if (!world.exitLockedNotified) {
      world.exitLockedNotified = true;
      world.events.emit('exit_locked', { hasKey: world.hasExitKey });
    }
    // 열쇠가 있으면 E 로 자물쇠를 딴다 — 내려가는 것은 그다음 E 다
    if (world.input.interactPressed) {
      if (world.hasExitKey) {
        world.hasExitKey = false;
        world.exitNeedsKey = false;
        world.exitOpen = true;
        world.events.emit('exit_unlocked', { x: exit.x, z: exit.z });
      } else {
        world.events.emit('exit_locked', { hasKey: false, tried: true });
      }
    }
    return;
  }

  // 밟는 것만으로는 끝나지 않는다 — 명시적으로 E 를 눌러야 내려간다
  if (!world.input.interactPressed) return;
  world.cleared = true;
  world.events.emit('zone_cleared', { tick: world.tick });
}
