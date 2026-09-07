// 랜턴 — ON/OFF 토글, 틱당 배터리 소모, 예비 전지 교체.
// 광원 렌더링은 render/Stage가 world.lantern 상태를 읽어 처리한다.

import { balance } from '../core/Balance';
import type { World } from '../core/World';

export function tick(world: World, _dt: number): void {
  const lantern = world.lantern;
  const input = world.input;

  // 성소 로비 — 밝은 곳이라 랜턴을 쓰지 않는다 (2026-09-07 사용자). 들어오며 꺼지고, 켜려 하면 거절만 한다.
  // 나가면 들어올 때 켜져 있던 만큼 되돌린다 (배터리가 남아 있을 때). 전지 교체는 로비에서도 된다
  if (world.lobby) {
    if (lantern.on) {
      lantern.on = false;
      lantern.lobbyOff = true;
      world.events.emit('lantern_toggled', { on: false, reason: 'lobby' });
    }
    if (input.lanternToggle) world.events.emit('lantern_denied', { reason: 'lobby' });
    swapBattery(world, false);
    return;
  }
  if (lantern.lobbyOff) {
    lantern.lobbyOff = false;
    if (lantern.battery > 0 && !lantern.on) {
      lantern.on = true;
      world.events.emit('lantern_toggled', { on: true, reason: 'lobby_exit' });
    }
  }

  if (input.lanternToggle) {
    if (lantern.on) {
      lantern.on = false;
      world.events.emit('lantern_toggled', { on: false });
    } else if (lantern.battery > 0) {
      lantern.on = true;
      world.events.emit('lantern_toggled', { on: true });
    }
  }

  swapBattery(world, true);

  if (lantern.on) {
    lantern.battery -= balance.lantern.drainPerTick;
    if (lantern.battery <= 0) {
      lantern.battery = 0;
      lantern.on = false;
      world.events.emit('lantern_died');
    }
  }
}

/** 전지 교체. relight 면 방전으로 꺼진 랜턴을 교체 즉시 다시 켠다 — 어둠 속에서 F를 또 눌러야 할 이유가 없다.
 *  직접 끈 경우(배터리가 남아 있는데 off)는 존중해서 그대로 둔다. 로비에서는 다시 켜지 않는다 (나갈 때 켜진다) */
function swapBattery(world: World, relight: boolean): void {
  const lantern = world.lantern;
  if (!(world.input.batterySwap && lantern.spares > 0 && lantern.battery < balance.lantern.batteryMax)) return;
  const wasDead = lantern.battery <= 0;
  lantern.spares--;
  lantern.battery = balance.lantern.batteryMax;
  if (wasDead && !lantern.on) {
    if (relight) {
      lantern.on = true;
      world.events.emit('lantern_toggled', { on: true });
    } else {
      lantern.lobbyOff = true; // 로비에서 갈아 끼운 전지 — 나갈 때 켜진다
    }
  }
  world.events.emit('battery_swapped', { spares: lantern.spares });
}
