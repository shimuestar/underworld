// 출구 — 보스가 살아 있으면 잠김, 처치 후 발판 위에서 E 를 눌러야 구역 클리어.
// 밟기만 해도 끝나면 교전 중에 발을 잘못 디뎌 구역이 끝나 버린다.

import { enemyDef } from '../core/Entities';
import type { World } from '../core/World';

const EXIT_RADIUS = 1.6; // 셀 중심 기준 진입 판정 (셀 절반보다 약간 작게)

export function tick(world: World, _dt: number): void {
  if (world.cleared) return;
  const exit = world.level.exitPos;
  if (!exit) return;

  // 잠김 여부는 매 틱 갱신한다 — 밟았을 때만 알려주면 "늘 열려 있다"로 보인다.
  // 부활로 적이 다시 스폰되면 보스도 살아나므로 자연히 다시 잠긴다
  const bossAlive = world.enemies.some((e) => e.alive && enemyDef(e.type).boss);
  if (world.exitOpen === bossAlive) {
    world.exitOpen = !bossAlive;
    if (world.exitOpen) world.events.emit('exit_opened', { x: exit.x, z: exit.z });
  }

  const dist = Math.hypot(world.player.x - exit.x, world.player.z - exit.z);
  world.onExitPad = dist <= EXIT_RADIUS; // 발판 위 안내를 렌더가 이 값으로 띄운다
  if (!world.onExitPad) {
    world.exitLockedNotified = false;
    return;
  }

  if (bossAlive) {
    if (!world.exitLockedNotified) {
      world.exitLockedNotified = true;
      world.events.emit('exit_locked', {});
    }
    return;
  }

  // 밟는 것만으로는 끝나지 않는다 — 명시적으로 E 를 눌러야 나간다
  if (!world.input.interactPressed) return;

  world.cleared = true;
  world.events.emit('zone_cleared', { tick: world.tick });
}
