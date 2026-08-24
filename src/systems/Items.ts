// 소모품 사용 — 퀵슬롯 1~5 키를 받아 마시고 쿨다운을 돌린다.
// 가방·퀵슬롯의 상태 조작 자체는 core/Inventory 에 있다 (줍는 쪽도 같은 규칙을 써야 해서).

import { balance } from '../core/Balance';
import { countOf, isUseful, itemDef, takeItem } from '../core/Inventory';
import type { World } from '../core/World';

export function tick(world: World, _dt: number): void {
  if (world.itemCooldown > 0) world.itemCooldown--;

  const key = world.input.useSlot;
  if (key >= 1 && key <= world.quickslots.length) use(world, key - 1);
}

/** 퀵슬롯 하나를 쓴다. 실패 이유는 item_denied 로 알린다 —
 *  "왜 안 마셔지지"를 화면에서 바로 읽을 수 있어야 한다 */
export function use(world: World, index: number): boolean {
  const kind = world.quickslots[index] ?? null;
  if (!kind) {
    world.events.emit('item_denied', { index, reason: 'empty' });
    return false;
  }
  if (world.itemCooldown > 0) {
    world.events.emit('item_denied', { index, kind, reason: 'cooldown' });
    return false;
  }
  if (countOf(world, kind) <= 0) {
    world.events.emit('item_denied', { index, kind, reason: 'none' });
    return false;
  }
  if (!isUseful(world, kind)) {
    world.events.emit('item_denied', { index, kind, reason: 'full' });
    return false;
  }

  takeItem(world, kind);
  world.itemCooldown = balance.items.useCooldownTicks;

  const def = itemDef(kind);
  const p = world.player;
  const hpBefore = p.health;
  const manaBefore = world.mana.value;
  if (def.heal > 0) p.health = Math.min(balance.player.healthMax, p.health + def.heal);
  if (def.restore > 0) {
    world.mana.value = Math.min(balance.mana.max, world.mana.value + def.restore);
  }
  world.events.emit('item_used', {
    kind,
    index,
    healed: p.health - hpBefore,
    restored: world.mana.value - manaBefore,
    left: countOf(world, kind),
  });
  return true;
}
