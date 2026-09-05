// 출구·입구 계단 — 층 사이를 오르내린다.
//
// 보스 층의 출구는 붉은 쇠창살로 봉인돼 있다: 이 층의 주인(보스 종 또는 boss 배치
// 플래그)이 전부 죽는 순간 자동으로 올라간다 (열쇠 흐름 폐지, 2026-09-01).
// 보스가 없는 층은 처음부터 열려 있다 — 로드 직후 첫 틱에 열림 신호를 낸다.
// 오르내림은 발판에서 상호작용을 붙들어야 한다 (stairs.holdTicks) — 스치기 사고 방지.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import type { World } from '../core/World';

// 발판 '중심' 기준 판정이라, 계단 입(쇠창살)에 바짝 붙으면 중심에서 ~2m 라
// 1.6 으로는 빠져나갔다 — E 가 안 먹던 이유. 이웃 칸 중심(4m)과는 여전히 멀다
const EXIT_RADIUS = 2.3;

/** 구독 자리 — 봉인 해제는 tick 이 주인 생사를 매 틱 확인한다 (이벤트 불요) */
export function init(_world: World): void {}

export function tick(world: World, _dt: number): void {
  if (world.cleared) return;
  if (world.monsterRoom) return; // 몬스터 시험방 — 출구가 없고 보스를 잡아도 봉인 해제 개념이 없다 (2026-09-04)
  const p = world.player;
  // 오르내림은 붙들어야 한다 — 스치듯 눌러 실수로 층을 넘지 않게 (의식적 결정).
  // 상호작용 키(E·패드 B)든 근접 키(우클릭 — 한 키 체계)든 붙들면 찬다
  const holding = world.input.interactHeld || world.input.meleeHeld;
  const HOLD = balance.stairs.holdTicks;

  // 입구 발판 — 내려온 계단을 되짚어 위층으로 올라간다
  const spawn = world.level.spawn;
  world.onEntrancePad =
    world.canAscend && Math.hypot(p.x - spawn.x, p.z - spawn.z) <= EXIT_RADIUS;
  if (world.onEntrancePad) {
    if (holding) {
      world.stairHoldTicks++;
      if (world.stairHoldTicks >= HOLD) {
        world.stairHoldTicks = 0;
        world.events.emit('floor_ascend', {});
        return;
      }
    } else {
      world.stairHoldTicks = 0;
    }
  }

  // 봉인 — 이 층의 주인(보스 종 또는 boss 배치 플래그)이 살아 있는 동안 쇠창살이
  // 내려와 있다. 주인이 모두 죽는 순간 자동으로 올라간다 (열쇠 흐름 폐지, 2026-09-01).
  // 출구 발판이 없는 레벨(테스트·특수 방)에서도 봉인 상태 자체는 갱신한다
  if (world.exitNeedsKey) {
    const masters = world.enemies.filter((e) => e.floorBoss || enemyDef(e.type).boss);
    if (masters.length > 0 && masters.every((e) => !e.alive)) {
      world.exitNeedsKey = false;
      world.exitOpen = true;
      world.events.emit('exit_unlocked', {});
    }
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
    if (!world.onEntrancePad) world.stairHoldTicks = 0; // 두 발판 다 아니면 게이지 소멸
    return;
  }

  if (world.exitNeedsKey) {
    if (!world.exitLockedNotified) {
      world.exitLockedNotified = true;
      world.events.emit('exit_locked', {});
    }
    if (world.input.interactPressed) world.events.emit('exit_locked', { tried: true });
    return;
  }

  // 밟는 것만으로는 끝나지 않는다 — 붙들고 있어야 내려간다 (게이지는 main 이 그린다)
  if (!holding) {
    world.stairHoldTicks = 0;
    return;
  }
  world.stairHoldTicks++;
  if (world.stairHoldTicks < HOLD) return;
  world.stairHoldTicks = 0;
  world.cleared = true;
  world.events.emit('zone_cleared', { tick: world.tick });
}
