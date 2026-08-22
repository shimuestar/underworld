// 랜턴 — ON/OFF 토글, 틱당 배터리 소모, 예비 전지 교체.
// 광원 렌더링은 render/Stage가 world.lantern 상태를 읽어 처리한다.

import { balance } from '../core/Balance';
import type { World } from '../core/World';

export function tick(world: World, _dt: number): void {
  const lantern = world.lantern;
  const input = world.input;

  if (input.lanternToggle) {
    if (lantern.on) {
      lantern.on = false;
      world.events.emit('lantern_toggled', { on: false });
    } else if (lantern.battery > 0) {
      lantern.on = true;
      world.events.emit('lantern_toggled', { on: true });
    }
  }

  if (input.batterySwap && lantern.spares > 0 && lantern.battery < balance.lantern.batteryMax) {
    // 방전으로 꺼진 랜턴은 교체 즉시 다시 켠다 — 어둠 속에서 F를 또 눌러야 할 이유가 없다.
    // 직접 끈 경우(배터리가 남아 있는데 off)는 존중해서 그대로 둔다
    const wasDead = lantern.battery <= 0;
    lantern.spares--;
    lantern.battery = balance.lantern.batteryMax;
    if (wasDead && !lantern.on) {
      lantern.on = true;
      world.events.emit('lantern_toggled', { on: true });
    }
    world.events.emit('battery_swapped', { spares: lantern.spares });
  }

  if (lantern.on) {
    lantern.battery -= balance.lantern.drainPerTick;
    if (lantern.battery <= 0) {
      lantern.battery = 0;
      lantern.on = false;
      world.events.emit('lantern_died');
    }
  }
}
