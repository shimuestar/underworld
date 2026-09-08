// 창고(성물함) — 성소 로비의 영구 보관 + 몸에 지니는 안전 칸 + 단계 확장. docs/systems/stash.md.
// tick 은 성물함 오브젝트 접근(NPC 와 같은 반경·시야각)만 본다 — 창은 main 이 stash_opened 로 연다.
// 옮기기·확장은 순수 함수(Vitest). 칸 규약은 가방과 같다(InventorySlot). 창고 스택 상한(lobby.stash.stackMax)은 가방(items.stackMax)보다 크다.

import { balance } from '../core/Balance';
import { countOf, isSecureKind, putOne } from '../core/Inventory';
import type { InventorySlot, ItemKind, World } from '../core/World';

export type StashPane = 'bag' | 'stash' | 'secure';

interface Tier {
  slots: number;
  gold: number;
  key: string | null;
}

function tiers(): Tier[] {
  return balance.lobby.stash.tiers as Tier[];
}

/** 지금 단계의 창고 칸 수 */
export function capacity(world: World): number {
  let n = balance.lobby.stash.baseSlots;
  for (let i = 0; i < world.stashTier && i < tiers().length; i++) n += tiers()[i]!.slots;
  return n;
}

/** 칸 배열을 크기에 맞춘다 — 든 것은 앞에서부터 그대로 (줄어들 일은 없다). 시작·불러오기 뒤에 부른다 */
function fit(slots: (InventorySlot | null)[], size: number): (InventorySlot | null)[] {
  const out = new Array<InventorySlot | null>(size).fill(null);
  let j = 0;
  for (const s of slots) if (s && j < size) out[j++] = s;
  return out;
}

export function initStash(world: World): void {
  world.stash = fit(world.stash, capacity(world));
  const secureSize = Math.max(balance.lobby.stash.secure.baseSlots, world.secure.length);
  world.secure = fit(world.secure, Math.min(secureSize, balance.lobby.stash.secure.maxSlots));
}

// ---- 접근 ----

export function tick(world: World, _dt: number): void {
  const pos = world.level.stashPos;
  if (!pos) {
    world.stashInView = false;
    return;
  }
  const cfg = balance.lobby.stash;
  const p = world.player;
  const toX = pos.x - p.x;
  const toZ = pos.z - p.z;
  const dist = Math.hypot(toX, toZ);
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const facing = dist <= 0.001 || (toX * fx + toZ * fz) / dist >= Math.cos((cfg.facingArcDeg * Math.PI) / 360);
  world.stashInView = dist <= cfg.radius && facing;
  // 닫은 키가 도로 열지 않게 — NPC 와 같은 가드(npcReopenGuard, Npc.tick 이 줄인다)
  if (world.stashInView && world.input.interactPressed && !world.uiOpen && !world.dead && world.npcReopenGuard === 0) {
    world.events.emit('stash_opened', { x: pos.x, z: pos.z });
  }
}

// ---- 옮기기 ----

function slotsOf(world: World, pane: StashPane): (InventorySlot | null)[] {
  return pane === 'bag' ? world.inventory : pane === 'stash' ? world.stash : world.secure;
}

function stackMaxOf(pane: StashPane): number {
  return pane === 'stash' ? balance.lobby.stash.stackMax : balance.items.stackMax;
}

/** from[index] 에서 to 로 옮긴다 — all 이면 칸 통째로(들어가는 만큼), 아니면 한 개. 옮긴 개수를 돌려준다.
 *  0 이면 stash_denied(full/empty). 각인·장비는 한 칸에 한 개라 all 과 같다 */
export function move(world: World, from: StashPane, index: number, to: StashPane, all = false): number {
  if (from === to) return 0;
  const src = slotsOf(world, from);
  const dst = slotsOf(world, to);
  const slot = src[index];
  if (!slot) {
    world.events.emit('stash_denied', { reason: 'empty', from, to });
    return 0;
  }
  const want = all || slot.kind === 'sigil' || slot.kind === 'equip' ? slot.count : 1;
  const ids = { sigilId: slot.sigilId, equipId: slot.equipId };
  let moved = 0;
  while (moved < want && putOne(dst, slot.kind, stackMaxOf(to), ids)) moved++;
  if (moved === 0) {
    world.events.emit('stash_denied', { reason: 'full', from, to, kind: slot.kind });
    return 0;
  }
  slot.count -= moved;
  if (slot.count <= 0) src[index] = null;
  world.events.emit('stash_moved', { from, to, kind: slot.kind, count: moved, sigilId: ids.sigilId, equipId: ids.equipId });
  return moved;
}

/** 가방 전부 창고에 — 들어가는 만큼. 옮긴 개수 합 */
export function depositAll(world: World): number {
  let total = 0;
  for (let i = 0; i < world.inventory.length; i++) {
    if (!world.inventory[i]) continue;
    total += move(world, 'bag', i, 'stash', true);
  }
  return total;
}

// ---- 확장 ----

export function nextTier(world: World): Tier | null {
  return tiers()[world.stashTier] ?? null;
}

/** 열쇠가 어디에든 있는가 — 안전 칸·가방·창고 */
export function hasKey(world: World, kind: ItemKind): boolean {
  return countIn(world.secure, kind) + countOf(world, kind) + countIn(world.stash, kind) > 0;
}

function countIn(slots: (InventorySlot | null)[], kind: ItemKind): number {
  let n = 0;
  for (const s of slots) if (s && s.kind === kind) n += s.count;
  return n;
}

function takeFrom(slots: (InventorySlot | null)[], kind: ItemKind): boolean {
  const i = slots.findIndex((s) => s !== null && s.kind === kind);
  if (i < 0) return false;
  const s = slots[i]!;
  s.count--;
  if (s.count <= 0) slots[i] = null;
  return true;
}

export function canExpand(world: World): { ok: boolean; reason: 'max' | 'no_gold' | 'no_key' | null; tier: Tier | null } {
  const tier = nextTier(world);
  if (!tier) return { ok: false, reason: 'max', tier: null };
  if (world.gold < tier.gold) return { ok: false, reason: 'no_gold', tier };
  if (tier.key && !hasKey(world, tier.key as ItemKind)) return { ok: false, reason: 'no_key', tier };
  return { ok: true, reason: null, tier };
}

/** 다음 단계를 산다 — 골드와 열쇠 한 개(안전 칸 → 가방 → 창고 순으로 찾는다). 성공하면 stash_expanded */
export function expand(world: World): boolean {
  const c = canExpand(world);
  if (!c.ok || !c.tier) {
    world.events.emit('stash_denied', { reason: c.reason ?? 'max' });
    return false;
  }
  world.gold -= c.tier.gold;
  if (c.tier.key) {
    const kind = c.tier.key as ItemKind;
    if (!takeFrom(world.secure, kind) && !takeFrom(world.inventory, kind)) takeFrom(world.stash, kind);
  }
  world.stashTier++;
  world.stash = fit(world.stash, capacity(world));
  world.events.emit('stash_expanded', { tier: world.stashTier, slots: world.stash.length, gold: c.tier.gold, key: c.tier.key });
  return true;
}

/** 창고·안전 칸에 든 총 개수 (HUD·계측) */
export function stashedCount(world: World): number {
  let n = 0;
  for (const s of world.stash) if (s) n += s.count;
  return n;
}

/** 안전 칸으로 넣을 수 있는 종류인가 — 전부 된다. 열쇠는 자동으로도 들어간다(Inventory.addItem) */
export function isSecureFirst(kind: ItemKind): boolean {
  return isSecureKind(kind);
}
