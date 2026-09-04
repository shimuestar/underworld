// 전리품 — 적을 죽이면 아이템이 흩어지는 대신 '주머니' 하나가 떨어진다(2026-09-04).
// 주머니(와 보물상자)는 컨테이너다: 바라보며 E 를 누르면 루팅 UI(render/LootUI)가 열리고
// 시간이 멈춘다. 이 파일은 (1) 처치 → 주머니 만들기·병합, (2) 바라보는 컨테이너 판정과 열기,
// (3) UI 가 부르는 이전 규칙(하나/모두 가져오기·가방→컨테이너·바닥에 버리기·닫기)을 가진다.
// 확률·양은 balance.pickups(예전 Pickups.rollDrops 와 같은 굴림), 거리·시간은 balance.loot.
//
// 규칙 요약
//  - 골드는 항상 들어간다(카운터). 화살은 상한까지만(부분). 소모품은 가방에 자리가 있을 때만 1개씩.
//  - 각인(상자)은 가져가는 순간 Sigils 가 loot_taken 을 받아 습득한다.
//  - 비어 있는 주머니는 창을 닫을 때 사라진다. 상자는 비어도 남는다(뚜껑 열림).
//  - 주머니는 부활해도 남고(비석과 같은 규칙), 층을 오갈 때도 그대로다(FloorState).

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { addItem, dropSlot, hasRoom, itemDef } from '../core/Inventory';
import { sigilDef } from '../core/SigilData';
import {
  scatterAwayFromPlayer,
  type GroundItemState,
  type ItemKind,
  type LootEntry,
  type LootKind,
  type LootRef,
  type World,
} from '../core/World';

/** Loot 이 만드는 바닥 아이템 id 대역 — 각인 1 / 픽업 500000 / 버림 700000 / 상자 800000·900000 / 비석 960000 / 기믹 990000 과 구분 */
let nextLootId = 1200000;

const CONSUMABLES: ReadonlySet<string> = new Set(['potion', 'mana', 'food']);
export function isConsumable(kind: LootKind): kind is ItemKind {
  return CONSUMABLES.has(kind);
}

/** 같은 종류는 한 줄에 쌓는다 — 각인은 sigilId 가 같아야 한 줄 */
export function mergeEntry(entries: LootEntry[], e: LootEntry): void {
  if (e.count <= 0) return;
  const same = entries.find((x) =>
    x.kind === e.kind && (e.kind !== 'sigil' || x.sigilId === e.sigilId),
  );
  if (same) same.count += e.count;
  else entries.push({ kind: e.kind, count: e.count, ...(e.sigilId ? { sigilId: e.sigilId } : {}) });
}

/** 처치 전리품 굴림 — 예전 Pickups.rollDrops 와 같은 확률(pickups.*). 바닥에 뿌리지 않고 줄로 돌려준다.
 *  rng 를 주입받아 테스트가 결정적이다. 빈 배열이면 주머니가 떨어지지 않는다 */
export function rollLoot(enemyType: string, rng: () => number = Math.random): LootEntry[] {
  const def = enemyDef(enemyType);
  const cfg = balance.pickups;
  const out: LootEntry[] = [];
  if (rng() < cfg.potion.dropChance || (def.boss && cfg.potion.bossAlways)) mergeEntry(out, { kind: 'potion', count: 1 });
  if (rng() < cfg.manaPotion.dropChance || (def.boss && cfg.potion.bossAlways)) mergeEntry(out, { kind: 'mana', count: 1 });
  if (rng() < cfg.food.dropChance) mergeEntry(out, { kind: 'food', count: 1 });
  // 화살 — 활을 든 적만. 이게 없으면 활은 빗나갈 때마다 순손실이라 제단에서 사 쓰는 무기가 된다
  if (def.arrowDrop) {
    let count = def.arrowDrop.min;
    while (count < def.arrowDrop.max && rng() < def.arrowDrop.extraChance) count++;
    mergeEntry(out, { kind: 'arrow', count });
  }
  if (rng() < cfg.gold.dropChance || def.boss) {
    let amount = cfg.gold.min + Math.round(rng() * (cfg.gold.max - cfg.gold.min));
    if (def.boss) amount *= cfg.gold.bossMul;
    mergeEntry(out, { kind: 'gold', count: amount });
  }
  return out;
}

/** 시체 자리에 주머니 — 가까이(mergeRadius) 다른 주머니가 있으면 거기에 합친다.
 *  떨어진 뒤 settleTicks 동안은 손댈 수 없다(noMagnetTicks 를 안착 시간으로 쓴다) */
export function dropPouch(world: World, enemyType: string, x: number, z: number): GroundItemState | null {
  const entries = rollLoot(enemyType);
  if (entries.length === 0) return null;
  const cfg = balance.loot.pouch;
  const boss = enemyDef(enemyType).boss === true;
  const near = world.groundItems.find(
    (g) => g.kind === 'pouch' && Math.hypot(g.x - x, g.z - z) <= cfg.mergeRadius,
  );
  if (near) {
    const items = (near.pouchItems ??= []);
    for (const e of entries) mergeEntry(items, e);
    if (boss) near.pouchTier = 'boss';
    if (near.pouchOwner !== enemyType) near.pouchOwner = undefined; // 섞였다 — '전리품 주머니'
    near.noMagnetTicks = cfg.settleTicks;
    world.events.emit('pouch_dropped', {
      id: near.id, x: near.x, z: near.z, owner: near.pouchOwner, tier: near.pouchTier ?? 'normal',
      entries: items.length, merged: true,
    });
    return near;
  }
  // 플레이어 반대쪽으로 떨어진다 — 시체에서 내 발밑으로 직행하지 않는다 (공통 드랍 규칙)
  const at = scatterAwayFromPlayer(world, x, z, cfg.scatterRadius, balance.pickups.awayArcDeg);
  const pouch: GroundItemState = {
    id: nextLootId++, kind: 'pouch', x: at.x, z: at.z,
    pouchItems: entries, pouchTier: boss ? 'boss' : 'normal', pouchOwner: enemyType,
    noMagnetTicks: cfg.settleTicks,
  };
  world.groundItems.push(pouch);
  world.events.emit('pouch_dropped', {
    id: pouch.id, x: pouch.x, z: pouch.z, owner: enemyType, tier: pouch.pouchTier, entries: entries.length, merged: false,
  });
  return pouch;
}

/** 구독. 시작 시 1회 — 처치마다 주머니 (noLoot 소환수는 없다) */
export function init(world: World): void {
  world.events.on('enemy_died', (payload) => {
    const { enemyType, x, z, noLoot } = payload as { enemyType: string; x: number; z: number; noLoot?: boolean };
    if (noLoot) return; // 보스 소환수 — 아이템도 골드도 없다 (생명 입자는 LifeMotes 가 준다)
    dropPouch(world, enemyType, x, z);
  });
}

/** 플레이어가 내려놓은 보관 주머니의 주인 표기 */
export const PLAYER_OWNER = 'player';

/** 컨테이너 제목 — 주머니는 '고블린 러너의 주머니', 섞였으면 '전리품 주머니', 내가 놓았으면 '내 주머니', 상자는 '보물상자' */
export function titleOf(world: World, ref: LootRef): string {
  if (ref.kind === 'chest') return '보물상자';
  const pouch = world.groundItems.find((g) => g.id === ref.id);
  const owner = pouch?.pouchOwner;
  if (!owner) return '전리품 주머니';
  if (owner === PLAYER_OWNER) return '내 주머니';
  return `${enemyDef(owner).name ?? owner}의 주머니`;
}

/** 보관 주머니 — 가방 창에서 빈 주머니를 발밑(정면 placeAhead)에 내려놓고 곧장 열어 준다.
 *  넣어 둔 것은 층을 오가도·부활해도 그 자리에 남는다(다른 주머니와 같은 규칙). 비운 채 닫으면 사라진다 */
export function createPlayerPouch(world: World): GroundItemState {
  const p = world.player;
  const ahead = balance.loot.pouch.placeAhead;
  const pouch: GroundItemState = {
    id: nextLootId++, kind: 'pouch',
    x: p.x - Math.sin(p.yaw) * ahead, z: p.z - Math.cos(p.yaw) * ahead,
    pouchItems: [], pouchTier: 'normal', pouchOwner: PLAYER_OWNER, noMagnetTicks: 0,
  };
  world.groundItems.push(pouch);
  world.events.emit('pouch_placed', { id: pouch.id, x: pouch.x, z: pouch.z });
  world.lootOpen = { kind: 'pouch', id: pouch.id };
  world.events.emit('loot_opened', { kind: 'pouch', id: pouch.id, entries: 0, first: true });
  return pouch;
}

/** 줄 이름 — UI·안내 공용 */
export function entryName(e: LootEntry): string {
  if (isConsumable(e.kind)) return itemDef(e.kind).name;
  if (e.kind === 'gold') return '골드';
  if (e.kind === 'arrow') return '화살';
  return e.sigilId ? `${sigilDef(e.sigilId).name} (각인)` : '각인';
}

export interface Container {
  ref: LootRef;
  entries: LootEntry[];
  x: number;
  z: number;
  title: string;
  tier: 'normal' | 'boss';
}

/** 열어 둔 컨테이너 — 없어졌으면(슬라임이 먹었다 등) null */
export function container(world: World): Container | null {
  const ref = world.lootOpen;
  if (!ref) return null;
  if (ref.kind === 'pouch') {
    const pouch = world.groundItems.find((g) => g.id === ref.id && g.kind === 'pouch');
    if (!pouch) return null;
    return { ref, entries: (pouch.pouchItems ??= []), x: pouch.x, z: pouch.z, title: titleOf(world, ref), tier: pouch.pouchTier ?? 'normal' };
  }
  const chest = world.chests.find((c) => c.id === ref.id);
  if (!chest) return null;
  return { ref, entries: (chest.chestItems ??= []), x: chest.x, z: chest.z, title: titleOf(world, ref), tier: 'normal' };
}

/** 매 틱 — 안착 대기 카운트다운, 바라보는 주머니 판정, E 로 열기.
 *  상자(Chest.tick, 이 앞에서 돈다)가 대상이면 주머니는 양보한다 — 대상 우선순위 상자 > 주머니 > 바닥 아이템 */
export function tick(world: World, _dt: number): void {
  if (world.lootReopenGuard > 0) world.lootReopenGuard--;
  const cfg = balance.loot.pouch;
  const p = world.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const arcCos = Math.cos((cfg.facingArcDeg * Math.PI) / 360);
  let best: GroundItemState | null = null;
  let bestDist = Infinity;
  for (const item of world.groundItems) {
    if (item.kind !== 'pouch') continue;
    if ((item.noMagnetTicks ?? 0) > 0) {
      item.noMagnetTicks = (item.noMagnetTicks ?? 0) - 1; // 안착 중 — Pickups 는 주머니를 건너뛰므로 여기서 센다
      if (item.noMagnetTicks === 0) {
        // 툭 — 자루가 바닥에 닿았다 (소리·먼지는 main). 병합으로 다시 안착해도 다시 난다
        world.events.emit('pouch_landed', { id: item.id, x: item.x, z: item.z, tier: item.pouchTier ?? 'normal' });
      }
      continue;
    }
    const toX = item.x - p.x;
    const toZ = item.z - p.z;
    const dist = Math.hypot(toX, toZ);
    if (dist > cfg.radius || dist >= bestDist) continue;
    if (dist > 0.001 && (toX * fx + toZ * fz) / dist < arcCos) continue;
    best = item;
    bestDist = dist;
  }
  // 상자가 우선 — 상자(Chest.tick, 이 앞)가 대상이면 그것이 lootInView 다 (열기도 Chest 가 한다)
  if (world.chestInView) {
    world.lootInView = { kind: 'chest', id: world.chestInView.id };
    return;
  }
  world.lootInView = best ? { kind: 'pouch', id: best.id } : null;
  if (world.lootOpen || !best) return;
  if (world.input.interactPressed && world.lootReopenGuard === 0) {
    world.lootOpen = { kind: 'pouch', id: best.id };
    world.events.emit('loot_opened', { kind: 'pouch', id: best.id, entries: best.pouchItems?.length ?? 0 });
  }
}

export type TakeResult = 'taken' | 'full' | 'quiver' | 'none';

function takeOneImpl(world: World, c: Container, index: number, announceDeny: boolean): TakeResult {
  const e = c.entries[index];
  if (!e) return 'none';
  const from = c.ref.kind;
  const deny = (reason: 'full' | 'quiver'): TakeResult => {
    if (announceDeny) world.events.emit('loot_denied', { reason, kind: e.kind });
    return reason;
  };
  if (e.kind === 'gold') {
    // 골드는 카운터 — 한 번에 전부, 항상 들어간다. 획득 표기는 컨테이너 자리에서 뜬다
    const amount = e.count;
    world.gold += amount;
    c.entries.splice(index, 1);
    world.events.emit('gold_picked', { amount, total: world.gold, x: c.x, z: c.z });
    world.events.emit('loot_taken', { kind: 'gold', count: amount, from });
    return 'taken';
  }
  if (e.kind === 'arrow') {
    // 화살은 화살통 상한까지만 — 남은 것은 줄에 남는다 (제단에서 사 쓰는 무기가 안 되게 회수 경로는 유지)
    const bow = balance.weapons.bow;
    const room = bow.ammoMax - (world.weapon.arrows ?? 0);
    if (room <= 0) return deny('quiver');
    const n = Math.min(room, e.count);
    world.weapon.arrows = (world.weapon.arrows ?? 0) + n;
    e.count -= n;
    if (e.count <= 0) c.entries.splice(index, 1);
    world.events.emit('loot_taken', { kind: 'arrow', count: n, from });
    return 'taken';
  }
  if (e.kind === 'sigil') {
    const sigilId = e.sigilId;
    c.entries.splice(index, 1);
    world.events.emit('loot_taken', { kind: 'sigil', count: 1, from, sigilId }); // Sigils 가 받아 습득한다
    return 'taken';
  }
  // 소모품 — 가방에 자리가 있을 때만 1개씩
  if (!hasRoom(world, e.kind)) return deny('full');
  addItem(world, e.kind);
  e.count--;
  if (e.count <= 0) c.entries.splice(index, 1);
  world.events.emit('loot_taken', { kind: e.kind, count: 1, from });
  return 'taken';
}

/** 커서 줄에서 하나(골드·화살은 들어가는 만큼) 가져온다 */
export function takeOne(world: World, index: number): TakeResult {
  const c = container(world);
  if (!c) return 'none';
  return takeOneImpl(world, c, index, true);
}

const TAKE_ORDER: Record<LootKind, number> = { gold: 0, sigil: 1, arrow: 2, potion: 3, mana: 3, food: 3 };

/** 모두 가져오기 — 골드 → 각인 → 화살 → 소모품 순. 못 들어간 것은 남고, 거부 알림은 한 번만
 *  (소모품이 남았으면 '가방 가득', 화살만 남았으면 '화살통 가득') */
export function takeAll(world: World): { taken: number; leftover: number; denied: 'full' | 'quiver' | null } {
  const c = container(world);
  if (!c) return { taken: 0, leftover: 0, denied: null };
  const snapshot = [...c.entries].sort((a, b) => TAKE_ORDER[a.kind] - TAKE_ORDER[b.kind]);
  let taken = 0;
  let denied: 'full' | 'quiver' | null = null;
  for (const e of snapshot) {
    for (;;) {
      const idx = c.entries.indexOf(e);
      if (idx < 0) break;
      const before = e.count;
      const r = takeOneImpl(world, c, idx, false);
      if (r !== 'taken') {
        if (r === 'full') denied = 'full';
        else if (r === 'quiver' && denied === null) denied = 'quiver';
        break;
      }
      taken += c.entries.indexOf(e) < 0 ? before : before - e.count;
    }
  }
  const leftover = c.entries.reduce((sum, e) => sum + e.count, 0);
  if (denied) world.events.emit('loot_denied', { reason: denied, kind: denied === 'full' ? 'potion' : 'arrow' });
  return { taken, leftover, denied };
}

/** 내 가방 칸에서 컨테이너로 1개 옮긴다 — 커서 칸에서 뺀다(Inventory.takeItem 은 가장 작은 무더기를 고르므로 안 쓴다).
 *  퀵슬롯 등록은 건드리지 않는다(종류 기억) */
export function stash(world: World, slotIndex: number): boolean {
  const c = container(world);
  if (!c) return false;
  const slot = world.inventory[slotIndex];
  if (!slot) return false;
  slot.count--;
  if (slot.count <= 0) world.inventory[slotIndex] = null;
  mergeEntry(c.entries, { kind: slot.kind, count: 1 });
  world.events.emit('loot_stashed', { kind: slot.kind, count: 1, to: c.ref.kind });
  return true;
}

/** 바닥에 버린다 — 컨테이너 줄은 통째로(단위별 바닥 아이템), 가방 칸은 Inventory.dropSlot 그대로.
 *  버린 직후엔 자석·집기가 물지 않는다(items.dropNoMagnetTicks) */
export function dropToFloor(world: World, side: 'container' | 'bag', index: number): boolean {
  const c = container(world);
  if (!c) return false;
  if (side === 'bag') {
    const slot = world.inventory[index];
    if (!slot) return false;
    const kind = slot.kind;
    const count = slot.count;
    dropSlot(world, index); // item_dropped 를 낸다 — 가방 UI 의 우클릭과 같은 길
    world.events.emit('loot_dropped', { kind, count, from: 'bag' });
    return true;
  }
  const e = c.entries[index];
  if (!e) return false;
  c.entries.splice(index, 1);
  const grace = balance.items.dropNoMagnetTicks;
  const spot = (): { x: number; z: number } =>
    scatterAwayFromPlayer(world, c.x, c.z, balance.loot.dropScatter, balance.pickups.awayArcDeg);
  if (e.kind === 'gold') {
    const at = spot();
    world.groundItems.push({ id: nextLootId++, kind: 'gold', amount: e.count, x: at.x, z: at.z, noMagnetTicks: grace });
  } else if (e.kind === 'sigil') {
    const at = spot();
    world.groundItems.push({ id: nextLootId++, kind: 'sigil', sigilId: e.sigilId, x: at.x, z: at.z, noMagnetTicks: grace });
  } else {
    for (let i = 0; i < e.count; i++) {
      const at = spot();
      world.groundItems.push({
        id: nextLootId++, kind: e.kind, x: at.x, z: at.z, noMagnetTicks: grace,
        ...(e.kind === 'arrow' ? { amount: 1 } : {}),
      });
    }
  }
  world.events.emit('loot_dropped', { kind: e.kind, count: e.count, from: 'container' });
  return true;
}

/** 창을 닫는다 — 빈 주머니는 사라지고, 상자는 남는다. 닫은 E 가 도로 열지 않게 가드를 건다 */
export function closeLoot(world: World): void {
  const ref = world.lootOpen;
  if (!ref) return;
  world.lootOpen = null;
  world.lootReopenGuard = balance.loot.pouch.reopenGuardTicks;
  let emptied = false;
  if (ref.kind === 'pouch') {
    const idx = world.groundItems.findIndex((g) => g.id === ref.id && g.kind === 'pouch');
    if (idx >= 0 && (world.groundItems[idx]!.pouchItems?.length ?? 0) === 0) {
      world.groundItems.splice(idx, 1);
      emptied = true;
    }
  } else {
    const chest = world.chests.find((c) => c.id === ref.id);
    emptied = (chest?.chestItems?.length ?? 0) === 0;
  }
  world.events.emit('loot_closed', { kind: ref.kind, id: ref.id, emptied });
}
