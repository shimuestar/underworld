// 장비 — 가방의 장비를 몸의 칸(투구·갑옷·부츠·반지 2·목걸이·짐칸)에 걸치고 벗는다 (2026-09-04 사용자 기획).
// 효과는 core/Modifiers 가 각인과 함께 합산한다. 오염은 없다. 짐칸(벨트/가방)은 가방 칸 수를 바꾸므로
// 걸치기/벗기 때 가방을 다시 재고(resizeInventory) — 줄어드는데 든 것이 안 들어가면 벗지 못한다(안내, 결정 6-A).

import { equipDef, type EquipSlot, slotsFor } from '../core/EquipData';
import { addEquip, bagSizeFor, hasRoom, resizeInventory } from '../core/Inventory';
import { recomputeModifiers } from '../core/Modifiers';
import type { World } from '../core/World';

export type EquipResult = 'equipped' | 'swapped' | 'bag_full' | 'none';

/** 정의 부위에 맞는 목표 칸 — 반지는 빈 칸 먼저, 둘 다 차 있으면 1번을 바꾼다 */
export function targetSlot(world: World, equipId: string): EquipSlot {
  const slots = slotsFor(equipDef(equipId).slot);
  return slots.find((s) => world.equipment[s] === null) ?? slots[0]!;
}

/** 가방 칸의 장비를 걸친다. 그 칸에 있던 장비는 같은 가방 칸으로 돌아온다(맞바꾸기).
 *  짐칸이 줄어 든 것이 안 들어가면 되돌리고 bag_full */
export function equipFromBag(world: World, slotIndex: number): EquipResult {
  const slot = world.inventory[slotIndex];
  if (!slot || slot.kind !== 'equip' || !slot.equipId) return 'none';
  const id = slot.equipId;
  const target = targetSlot(world, id);
  const prev = world.equipment[target];
  world.inventory[slotIndex] = prev ? { kind: 'equip', count: 1, equipId: prev } : null;
  world.equipment[target] = id;
  recomputeModifiers(world);
  if (!resizeInventory(world, bagSizeFor(world))) {
    // 되돌린다 — 작은 짐칸으로 바꾸려는데 든 것이 안 들어간다
    world.equipment[target] = prev;
    world.inventory[slotIndex] = { kind: 'equip', count: 1, equipId: id };
    recomputeModifiers(world);
    world.events.emit('equip_denied', { id, reason: 'bag_full' });
    return 'bag_full';
  }
  world.events.emit('equip_changed', { slot: target, id, prev });
  return prev ? 'swapped' : 'equipped';
}

/** 칸의 장비를 벗어 가방으로. 가방에 자리가 없거나(짐칸이면 줄어든 가방에 든 것 + 이 장비가 안 들어가면) bag_full */
export function unequip(world: World, slot: EquipSlot): 'ok' | 'bag_full' | 'none' {
  const id = world.equipment[slot];
  if (!id) return 'none';
  world.equipment[slot] = null;
  recomputeModifiers(world);
  const size = bagSizeFor(world);
  // 줄어드는 가방에 든 것 + 벗는 장비 한 칸이 들어가야 한다
  if (!resizeInventory(world, size, 1) || !hasRoom(world, 'equip')) {
    world.equipment[slot] = id;
    recomputeModifiers(world);
    resizeInventory(world, bagSizeFor(world));
    world.events.emit('equip_denied', { id, reason: 'bag_full' });
    return 'bag_full';
  }
  addEquip(world, id);
  world.events.emit('equip_changed', { slot, id: null, prev: id });
  return 'ok';
}

/** 시작 시 1회 — 장비 상태에 맞춰 파생 수치·가방 칸을 맞춘다 */
export function init(world: World): void {
  recomputeModifiers(world);
  resizeInventory(world, bagSizeFor(world));
}
