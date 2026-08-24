// 소모품 가방·퀵슬롯의 상태 조작. 규칙만 있고 틱은 없다 —
// 줍는 쪽(Pickups)과 쓰는 쪽(Items)이 둘 다 만져야 해서 시스템이 아니라 core 에 둔다
// (시스템끼리 직접 참조하지 않는다는 규약. core/Entities 의 공용 판정과 같은 자리).
//
// 가방은 balance.items 의 cols×rows 칸이고 같은 종류는 stackMax 까지 한 칸에 쌓인다.
// 퀵슬롯은 "가방 몇 번 칸"이 아니라 "어떤 종류"를 기억한다 — 다 써도 등록이 남아
// 다시 주우면 그대로 쓸 수 있다. 칸을 기억하면 물약 하나 쓸 때마다 Tab 을 열어야 한다.

import { balance } from './Balance';
import { ITEM_KINDS, type InventorySlot, type ItemKind, type World } from './World';

export interface ItemDef {
  name: string;
  color: string;
  /** HUD·가방 아이콘 모양 (render/ItemIcons). 바닥 3D 모형과 같은 실루엣을 쓴다 */
  icon: string;
  heal: number;
  restore: number;
}

export function itemDef(kind: ItemKind): ItemDef {
  return balance.items.kinds[kind];
}

/** 아이템 색 — Three.js·CSS 양쪽에서 쓰게 숫자로도 준다 (각인의 sigilColor 와 같은 규약) */
export function itemColor(kind: ItemKind): number {
  return Number.parseInt(itemDef(kind).color.slice(1), 16);
}

/** 가방·퀵슬롯 칸을 balance 크기로 잡는다. World 는 데이터에 의존하지 않으므로 여기서 채운다 */
export function initInventory(world: World): void {
  const cfg = balance.items;
  world.inventory = new Array<InventorySlot | null>(cfg.cols * cfg.rows).fill(null);
  world.quickslots = new Array<ItemKind | null>(cfg.quickslots).fill(null);
  world.itemCooldown = 0;
}

/** 가방에 한 개 넣는다. 자리가 없으면 false — 부르는 쪽이 바닥에 남겨 둔다 */
export function addItem(world: World, kind: ItemKind): boolean {
  const stackMax = balance.items.stackMax;
  // 쌓을 자리를 먼저 찾는다 — 새 칸부터 쓰면 같은 물약이 칸을 여럿 잡아먹는다
  for (const slot of world.inventory) {
    if (slot && slot.kind === kind && slot.count < stackMax) {
      slot.count++;
      autoBind(world, kind);
      world.events.emit('item_gained', { kind, count: countOf(world, kind) });
      return true;
    }
  }
  const empty = world.inventory.indexOf(null);
  if (empty < 0) return false;
  world.inventory[empty] = { kind, count: 1 };
  autoBind(world, kind);
  world.events.emit('item_gained', { kind, count: countOf(world, kind) });
  return true;
}

/** 한 개라도 더 들어갈 자리가 있는가 — 자석이 물기 전에 묻는다 */
export function hasRoom(world: World, kind: ItemKind): boolean {
  const stackMax = balance.items.stackMax;
  return world.inventory.some(
    (slot) => slot === null || (slot.kind === kind && slot.count < stackMax),
  );
}

export function countOf(world: World, kind: ItemKind): number {
  let total = 0;
  for (const slot of world.inventory) if (slot?.kind === kind) total += slot.count;
  return total;
}

/** 가방에서 한 개 뺀다. 가장 작은 무더기부터 헐어 칸을 먼저 비운다 */
export function takeItem(world: World, kind: ItemKind): boolean {
  let best = -1;
  for (let i = 0; i < world.inventory.length; i++) {
    const slot = world.inventory[i];
    if (!slot || slot.kind !== kind) continue;
    if (best < 0 || slot.count < world.inventory[best]!.count) best = i;
  }
  if (best < 0) return false;
  const slot = world.inventory[best]!;
  slot.count--;
  if (slot.count <= 0) world.inventory[best] = null;
  return true;
}

/** 버린 아이템 id 대역 — 처치 드랍(500000~)·각인(800000~)·상자 골드(900000~)와 겹치지 않게 */
let nextDropId = 700000;
const DROP_SCATTER = 0.8;

/** 한 칸을 통째로 발밑에 버린다. 버린 직후에는 자석이 물지 않는다 —
 *  안 그러면 버리자마자 도로 주워져 가방을 비울 수가 없다 */
export function dropSlot(world: World, index: number): void {
  const slot = world.inventory[index];
  if (!slot) return;
  world.inventory[index] = null;
  const p = world.player;
  for (let i = 0; i < slot.count; i++) {
    const angle = (i / slot.count) * Math.PI * 2;
    world.groundItems.push({
      id: nextDropId++,
      kind: slot.kind,
      x: p.x + Math.cos(angle) * DROP_SCATTER,
      z: p.z + Math.sin(angle) * DROP_SCATTER,
      noMagnetTicks: balance.items.dropNoMagnetTicks,
    });
  }
  world.events.emit('item_dropped', { kind: slot.kind, count: slot.count });
}

/** 퀵슬롯에 종류를 등록한다. 이미 다른 칸에 있으면 자리를 맞바꾼다 —
 *  같은 물약이 두 칸을 차지하면 다섯 칸이 금방 의미를 잃는다 */
export function bindQuickslot(world: World, index: number, kind: ItemKind): void {
  if (index < 0 || index >= world.quickslots.length) return;
  const already = world.quickslots.indexOf(kind);
  const displaced = world.quickslots[index] ?? null;
  world.quickslots[index] = kind;
  if (already >= 0 && already !== index) world.quickslots[already] = displaced;
  world.events.emit('quickslot_bound', { index, kind });
}

export function unbindQuickslot(world: World, index: number): void {
  if (index < 0 || index >= world.quickslots.length) return;
  if (world.quickslots[index] === null) return;
  world.quickslots[index] = null;
  world.events.emit('quickslot_bound', { index, kind: null });
}

/** 등록 안 된 종류를 처음 주우면 빈 칸에 자동으로 꽂는다 —
 *  Tab 을 한 번도 안 열어도 물약을 쓸 수 있어야 한다 */
function autoBind(world: World, kind: ItemKind): void {
  if (world.quickslots.includes(kind)) return;
  const empty = world.quickslots.indexOf(null);
  if (empty < 0) return;
  world.quickslots[empty] = kind;
  world.events.emit('quickslot_bound', { index: empty, kind, auto: true });
}

/** 지금 이 종류를 써서 값어치가 있는가 — 가득 찬 자원에 부으면 그냥 버리는 것이다.
 *  음식은 둘 중 하나만 모자라도 먹을 값어치가 있다 (옛 Pickups.wants 규칙과 같다) */
export function isUseful(world: World, kind: ItemKind): boolean {
  const def = itemDef(kind);
  if (def.heal > 0 && world.player.health < balance.player.healthMax) return true;
  if (def.restore > 0 && world.mana.value < balance.mana.max) return true;
  return false;
}

/** 종류별 소지 수 — HUD·계측용 */
export function itemCounts(world: World): Record<ItemKind, number> {
  const out = {} as Record<ItemKind, number>;
  for (const kind of ITEM_KINDS) out[kind] = countOf(world, kind);
  return out;
}
