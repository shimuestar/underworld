// 상인(성소 로비) — 매입. 소모품을 한 개씩(또는 칸 통째로) 사 준다.
// 장비·각인 매각은 각 시스템(Equipment.sellFromBag / Sigils.sellFromBag)이 이미 맡고 있어 여기서는 소모품만 —
// 무엇을 어느 시스템에 넘길지는 창(MerchantUI)이 종류를 보고 가른다 (시스템끼리 직접 참조하지 않는다).
// 파는 쪽(사기 탭)은 제단 상점(Altar.shopState / purchase)을 그대로 쓴다 — 품목·값·재고 공유.

import { balance } from '../core/Balance';
import type { ShopItem } from './Altar';
import type { InventorySlot, ItemKind, World } from '../core/World';

/** 소모품 종류 → 제단 상점 품목 — 기준가를 그쪽에서 읽는다 */
const SHOP_ITEM_OF: Partial<Record<ItemKind, ShopItem>> = {
  potion: 'heal',
  mana: 'mana',
  potion_large: 'healLarge',
  mana_large: 'manaLarge',
};

/** 소모품 한 개의 매입가 — 팔 수 없는 종류(각인·장비·기준가 없는 것)는 null.
 *  각인·장비 값은 창이 각 시스템 규칙(sigil.sellGold / equipment.sellRatio)으로 따로 읽는다 */
export function unitSellPrice(kind: ItemKind): number | null {
  if (kind === 'sigil' || kind === 'equip') return null;
  const shopItem = SHOP_ITEM_OF[kind];
  const shop = balance.altar.shop as unknown as Record<string, { price?: number }>;
  const base = shopItem ? shop[shopItem]?.price : (balance.lobby.merchant.basePrice as Record<string, number>)[kind];
  if (base === undefined) return null;
  return Math.floor(base * balance.lobby.merchant.sellRatio);
}

/** 이 칸을 팔면 받을 골드 (소모품은 count 개 전부 기준). 못 파는 칸은 null */
export function slotSellPrice(slot: InventorySlot | null, count = slot?.count ?? 0): number | null {
  if (!slot) return null;
  const unit = unitSellPrice(slot.kind);
  return unit === null ? null : unit * count;
}

/** 소모품 매각 — all 이면 칸 통째로, 아니면 한 개. 받은 골드를 돌려준다 (0 = 못 팔았다: item_sell_denied) */
export function sellConsumable(world: World, slotIndex: number, all = false): number {
  const slot = world.inventory[slotIndex];
  if (!slot || slot.kind === 'sigil' || slot.kind === 'equip') return 0;
  const unit = unitSellPrice(slot.kind);
  if (unit === null) {
    world.events.emit('item_sell_denied', { kind: slot.kind, reason: 'no_price' });
    return 0;
  }
  const count = all ? slot.count : 1;
  const gold = unit * count;
  slot.count -= count;
  if (slot.count <= 0) world.inventory[slotIndex] = null;
  world.gold += gold;
  world.events.emit('item_sold', { kind: slot.kind, count, gold, total: world.gold });
  return gold;
}
