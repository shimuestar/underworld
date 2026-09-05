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
import { equipDef } from '../core/EquipData';
import { enemyDef } from '../core/Entities';
import { addItem, autoBind, dropSlot, hasRoom, itemDef, addSigil, addEquip } from '../core/Inventory';
import { sigilDef } from '../core/SigilData';
import {
  findFreeSpot,
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
    x.kind === e.kind && (e.kind !== 'sigil' || x.sigilId === e.sigilId) && (e.kind !== 'equip' || x.equipId === e.equipId),
  );
  if (same) {
    same.count += e.count;
    if (e.searched) same.searched = true; // 내가 넣은 것이 섞이면 그 칸은 이미 안다
  } else {
    entries.push({ kind: e.kind, count: e.count, ...(e.sigilId ? { sigilId: e.sigilId } : {}), ...(e.searched ? { searched: true } : {}) });
  }
}

/** 칸 하나를 밝힌다 — 루팅 창이 한 칸씩 차례로 부른다(1초에 하나). 소리·계측은 이벤트로 */
export function revealEntry(world: World, entry: LootEntry): void {
  if (entry.searched) return;
  entry.searched = true;
  world.events.emit('loot_revealed', { kind: entry.kind, count: entry.count, sigilId: entry.sigilId });
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

/** 떨어질 자리 — 플레이어 반대쪽 호(awayArcDeg) 안에서, 다른 주머니와 minSpacing 이상 떨어지고 벽이 아닌 첫 자리.
 *  각도를 좌우로 벌리고 거리를 늘려 가며 찾는다. 다 실패하면 기본 자리(공통 드랍 규칙) */
function landingSpot(world: World, x: number, z: number, r: number): { x: number; z: number } {
  const cfg = balance.loot.pouch;
  const base = scatterAwayFromPlayer(world, x, z, r, balance.pickups.awayArcDeg);
  const spacing = cfg.minSpacing;
  if (spacing <= 0) return base;
  const p = world.player;
  const adx = x - p.x;
  const adz = z - p.z;
  const away = Math.hypot(adx, adz) > 0.001 ? Math.atan2(adx, adz) : Math.atan2(base.x - x, base.z - z);
  const cs = world.level.cellSize;
  const free = (cx: number, cz: number): boolean =>
    !world.level.solidAt(Math.floor(cx / cs), Math.floor(cz / cs)) &&
    world.groundItems.every((g) => g.kind !== 'pouch' || Math.hypot((g.originX ?? g.x) - cx, (g.originZ ?? g.z) - cz) >= spacing);
  if (free(base.x, base.z)) return base;
  const offsets = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, Math.PI * 0.6, -Math.PI * 0.6, Math.PI];
  for (const mul of [1, 1.6, 2.2, 3]) {
    for (const off of offsets) {
      const cx = x + Math.sin(away + off) * r * mul;
      const cz = z + Math.cos(away + off) * r * mul;
      if (free(cx, cz)) return { x: cx, z: cz };
    }
  }
  return base;
}

/** 시체 자리에 주머니 — 기본은 각자 떨어진다(다른 주머니와 minSpacing 이상 띄워). mergeRadius > 0 이면 그 안의 주머니에 합친다.
 *  떨어진 뒤 settleTicks 동안은 손댈 수 없다(noMagnetTicks 를 안착 시간으로 쓴다) */
export function dropPouch(world: World, enemyType: string, x: number, z: number): GroundItemState | null {
  const entries = rollLoot(enemyType);
  if (entries.length === 0) return null;
  const cfg = balance.loot.pouch;
  const boss = enemyDef(enemyType).boss === true;
  const near = cfg.mergeRadius > 0
    ? world.groundItems.find((g) => g.kind === 'pouch' && Math.hypot(g.x - x, g.z - z) <= cfg.mergeRadius)
    : undefined;
  if (near) {
    const items = (near.pouchItems ??= []);
    for (const e of entries) mergeEntry(items, e);
    if (boss) near.pouchTier = 'boss';
    if (near.pouchOwner !== enemyType) near.pouchOwner = undefined; // 섞였다 — '전리품 주머니'
    near.noMagnetTicks = cfg.settleTicks;
    // 받아 담는 그림 — 제자리에서 살짝 뛰었다 내려앉는다
    near.bounceFromX = near.x;
    near.bounceFromZ = near.z;
    near.originX = near.x;
    near.originZ = near.z;
    near.bounceY0 = cfg.mergeHop;
    near.y = 0;
    world.events.emit('pouch_dropped', {
      id: near.id, x: near.x, z: near.z, owner: near.pouchOwner, tier: near.pouchTier ?? 'normal',
      entries: items.length, merged: true,
    });
    return near;
  }
  // 플레이어 반대쪽으로 떨어진다 — 시체에서 내 발밑으로 직행하지 않는다 (공통 드랍 규칙).
  // 바닥에 '짠' 나타나지 않고 시체에서 적 머리 높이까지 튀어올랐다가 settleTicks 동안 그 자리로 떨어진다 (tick 이 굴린다)
  const at = landingSpot(world, x, z, cfg.scatterRadius);
  const pouch: GroundItemState = {
    id: nextLootId++, kind: 'pouch', x, z, y: cfg.launchY,
    pouchItems: entries, pouchTier: boss ? 'boss' : 'normal', pouchOwner: enemyType,
    noMagnetTicks: cfg.settleTicks,
    bounceFromX: x, bounceFromZ: z, originX: at.x, originZ: at.z, bounceY0: enemyDef(enemyType).height,
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
  return pouchTitle(world.groundItems.find((g) => g.id === ref.id));
}

/** 주머니 이름 — 주인(적 종류)이 하나면 '고블린 러너의 주머니', 섞였으면 '전리품 주머니', 내가 놓은 것은 '내 주머니' */
export function pouchTitle(pouch: GroundItemState | undefined): string {
  const owner = pouch?.pouchOwner;
  if (!owner) return '전리품 주머니';
  if (owner === PLAYER_OWNER) return '내 주머니';
  return `${enemyDef(owner).name ?? owner}의 주머니`;
}

/** 바닥 물건의 한글 이름 — 선 끝 키캡 옆 이름 판(Stage)과 하단 안내가 같은 말을 쓴다 (2026-09-04).
 *  비석·모르는 종류는 빈 문자열(이름 판 없음) */
export function groundItemName(item: GroundItemState): string {
  if (item.kind === 'pouch') return pouchTitle(item);
  if (isConsumable(item.kind as LootKind)) return itemDef(item.kind as ItemKind).name;
  if (item.kind === 'gold') return item.amount ? `골드 ${item.amount}` : '골드';
  if (item.kind === 'arrow') return '화살';
  if (item.kind === 'ammo') return '탄약';
  if (item.kind === 'grenade') return '수류탄';
  if (item.kind === 'battery') return '배터리';
  if (item.kind === 'sigil') return item.sigilId ? `${sigilDef(item.sigilId).name} (각인)` : '각인';
  if (item.kind === 'equip') return item.equipId ? `${equipDef(item.equipId).name} (장비)` : '장비';
  return '';
}

/** 보관 주머니 — 가방 창에서 빈 주머니를 발밑(정면 placeAhead)에 내려놓고 곧장 열어 준다.
 *  넣어 둔 것은 층을 오가도·부활해도 그 자리에 남는다(다른 주머니와 같은 규칙). 비운 채 닫으면 사라진다 */
export function createPlayerPouch(world: World): GroundItemState {
  const p = world.player;
  const ahead = balance.loot.pouch.placeAhead;
  // 정면 발밑 — 거기에 다른 주머니가 있으면 옆으로 비켜 놓는다 (landingSpot 은 시체→반대쪽 규칙이라 발밑 기준으로 따로)
  let px = p.x - Math.sin(p.yaw) * ahead;
  let pz = p.z - Math.cos(p.yaw) * ahead;
  const spacing = balance.loot.pouch.minSpacing;
  const crowded = (cx: number, cz: number): boolean =>
    world.groundItems.some((g) => g.kind === 'pouch' && Math.hypot(g.x - cx, g.z - cz) < spacing);
  for (let k = 1; k <= 8 && crowded(px, pz); k++) {
    const side = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * spacing;
    px = p.x - Math.sin(p.yaw) * ahead + Math.cos(p.yaw) * side;
    pz = p.z - Math.cos(p.yaw) * ahead - Math.sin(p.yaw) * side;
  }
  const pouch: GroundItemState = {
    id: nextLootId++, kind: 'pouch',
    x: px, z: pz,
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

/** 주머니 비행 — 시체(bounceFrom)에서 안착점(origin)으로 옮겨 가며, launchY 에서 정점(bounceY0 = 적 키)까지
 *  올라갔다 바닥으로 떨어지는 포물선. t = 안착 진행률 */
function flyPouch(item: GroundItemState, settleTicks: number, launchY: number): void {
  const t = Math.min(1, Math.max(0, 1 - (item.noMagnetTicks ?? 0) / Math.max(1, settleTicks)));
  const fromX = item.bounceFromX ?? item.x;
  const fromZ = item.bounceFromZ ?? item.z;
  const toX = item.originX ?? item.x;
  const toZ = item.originZ ?? item.z;
  const peak = item.bounceY0 ?? launchY;
  item.x = fromX + (toX - fromX) * t;
  item.z = fromZ + (toZ - fromZ) * t;
  item.y = launchY * (1 - t) + (peak - launchY * 0.5) * Math.sin(Math.PI * t);
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
  // 조준 규칙(주머니 전용) — 시선 3D 벡터와 주머니 방향의 각이 aimArcDeg 안이면 aimRadius 까지 멀어도 대상.
  // 발치까지 가지 않아도 크로스헤어를 얹으면 뒤질 수 있다 (사용자 요청 2026-09-04)
  const lookX = fx * Math.cos(p.pitch);
  const lookY = Math.sin(p.pitch);
  const lookZ = fz * Math.cos(p.pitch);
  const aimCos = Math.cos((cfg.aimArcDeg * Math.PI) / 180);
  const eyeY = balance.player.eyeHeight;
  let best: GroundItemState | null = null;
  let bestDist = Infinity;
  for (const item of world.groundItems) {
    if (item.kind !== 'pouch') continue;
    if ((item.noMagnetTicks ?? 0) > 0) {
      item.noMagnetTicks = (item.noMagnetTicks ?? 0) - 1; // 안착 중 — Pickups 는 주머니를 건너뛰므로 여기서 센다
      if (item.bounceFromX !== undefined) flyPouch(item, cfg.settleTicks, cfg.launchY);
      if (item.noMagnetTicks === 0) {
        // 툭 — 자루가 바닥에 닿았다 (소리·먼지는 main). 병합으로 다시 안착해도 다시 난다
        if (item.bounceFromX !== undefined) {
          item.x = item.originX ?? item.x;
          item.z = item.originZ ?? item.z;
          item.y = undefined;
          item.bounceFromX = undefined;
          item.bounceFromZ = undefined;
          item.bounceY0 = undefined;
        }
        world.events.emit('pouch_landed', { id: item.id, x: item.x, z: item.z, tier: item.pouchTier ?? 'normal' });
      }
      continue;
    }
    const toX = item.x - p.x;
    const toZ = item.z - p.z;
    const dist = Math.hypot(toX, toZ);
    if (dist >= bestDist) continue;
    const near = dist <= cfg.radius && (dist <= 0.001 || (toX * fx + toZ * fz) / dist >= arcCos);
    let aimed = false;
    if (!near && dist <= cfg.aimRadius) {
      const toY = cfg.aimHeight - eyeY;
      const len = Math.hypot(toX, toY, toZ);
      aimed = len > 0.001 && (toX * lookX + toY * lookY + toZ * lookZ) / len >= aimCos;
    }
    if (!near && !aimed) continue;
    best = item;
    bestDist = dist;
  }
  // 실시간 루팅 — 열어 둔 컨테이너에서 밀려나 멀어지면 끊긴다 (main 이 loot_interrupt 를 받아 창을 닫는다)
  if (world.lootOpen) {
    const ref = world.lootOpen;
    const src = ref.kind === 'pouch' ? world.groundItems.find((g) => g.id === ref.id) : world.chests.find((ch) => ch.id === ref.id);
    // 열 수 있는 최대 거리(가까이 또는 조준 5m) + 여유 — 고정 3.2m 였을 땐 멀리서 조준해 열면 그 틱에 끊겼다
    const limit = Math.max(cfg.radius, cfg.aimRadius) + balance.loot.live.closeSlack;
    if (src && Math.hypot(src.x - p.x, src.z - p.z) > limit) {
      world.events.emit('loot_interrupt', { reason: 'distance' });
    }
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
  if (!e.searched) return 'none'; // 아직 뒤지지 않은 칸 — 정체를 모르면 손댈 수 없다
  const from = c.ref.kind;
  const deny = (reason: 'full' | 'quiver'): TakeResult => {
    if (announceDeny) world.events.emit('loot_denied', { reason, kind: e.kind });
    return reason;
  };
  if (e.kind === 'gold') {
    // 골드는 카운터 — 한 번에 전부, 항상 들어간다. 획득 표기는 컨테이너 자리에서 뜬다
    const amount = Math.round(e.count * world.modifiers.goldMul); // 탐욕 반지·도둑 조끼
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
    // 각인은 가방 아이템 — 빈 칸이 있어야 한다. 스킬 탭에서 새긴다 (2026-09-04 아이템화)
    if (!hasRoom(world, 'sigil')) return deny('full');
    const sigilId = e.sigilId;
    addSigil(world, sigilId ?? '');
    e.count--;
    if (e.count <= 0) c.entries.splice(index, 1);
    world.events.emit('loot_taken', { kind: 'sigil', count: 1, from, sigilId });
    return 'taken';
  }
  if (e.kind === 'equip') {
    // 장비도 가방 아이템 — 빈 칸이 있어야 한다. 가방 탭에서 걸친다 (2026-09-04)
    if (!hasRoom(world, 'equip')) return deny('full');
    addEquip(world, e.equipId ?? '');
    e.count--;
    if (e.count <= 0) c.entries.splice(index, 1);
    world.events.emit('loot_taken', { kind: 'equip', count: 1, from, equipId: e.equipId });
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

/** 드래그로 컨테이너 항목을 가방의 '이 칸'에 놓는다 — 소모품은 그 칸이 비었거나 같은 종류면 들어가는 만큼(stackMax) 통째로.
 *  다른 종류가 있는 칸에는 안 들어간다(loot_denied full). 골드·화살·각인은 칸을 차지하지 않으니 takeOne 과 같다.
 *  옮긴 개수를 돌려준다 (0 = 안 됨) (2026-09-04) */
export function takeStackTo(world: World, entryIndex: number, slotIndex: number): number {
  const c = container(world);
  if (!c) return 0;
  const e = c.entries[entryIndex];
  if (!e || !e.searched) return 0;
  if (!isConsumable(e.kind)) return takeOneImpl(world, c, entryIndex, true) === 'taken' ? 1 : 0;
  const inv = world.inventory;
  if (slotIndex < 0 || slotIndex >= inv.length) return 0;
  const dst = inv[slotIndex];
  const stackMax = balance.items.stackMax;
  const room = !dst ? stackMax : dst.kind === e.kind ? stackMax - dst.count : 0;
  const n = Math.min(room, e.count);
  if (n <= 0) {
    world.events.emit('loot_denied', { reason: 'full', kind: e.kind });
    return 0;
  }
  if (!dst) inv[slotIndex] = { kind: e.kind, count: n };
  else dst.count += n;
  autoBind(world, e.kind);
  world.events.emit('item_gained', { kind: e.kind, count: countOfKind(world, e.kind) });
  e.count -= n;
  if (e.count <= 0) c.entries.splice(entryIndex, 1);
  world.events.emit('loot_taken', { kind: e.kind, count: n, from: c.ref.kind });
  return n;
}
function countOfKind(world: World, kind: ItemKind): number {
  return world.inventory.reduce((sum, s) => sum + (s && s.kind === kind ? s.count : 0), 0);
}

/** 드래그로 가방 칸을 컨테이너에 통째로 넣는다 — 같은 종류가 있으면 그 항목에 합쳐진다.
 *  넣은 것이 담긴 항목을 돌려준다(UI 가 놓은 칸에 배치한다), 못 넣으면 null */
export function stashStackTo(world: World, slotIndex: number): LootEntry | null {
  const c = container(world);
  if (!c) return null;
  const slot = world.inventory[slotIndex];
  if (!slot) return null;
  const { kind, count, sigilId, equipId } = slot;
  world.inventory[slotIndex] = null;
  mergeEntry(c.entries, { kind, count, searched: true, ...(sigilId ? { sigilId } : {}), ...(equipId ? { equipId } : {}) });
  world.events.emit('loot_stashed', { kind, count, to: c.ref.kind });
  return c.entries.find((x) => x.kind === kind && x.sigilId === sigilId && x.equipId === equipId) ?? null;
}

/** 커서 줄에서 하나(골드·화살은 들어가는 만큼) 가져온다 */
export function takeOne(world: World, index: number): TakeResult {
  const c = container(world);
  if (!c) return 'none';
  return takeOneImpl(world, c, index, true);
}

const TAKE_ORDER: Record<LootKind, number> = { gold: 0, sigil: 1, equip: 1, arrow: 2, potion: 3, mana: 3, food: 3 };

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
  mergeEntry(c.entries, { kind: slot.kind, count: 1, searched: true, ...(slot.sigilId ? { sigilId: slot.sigilId } : {}), ...(slot.equipId ? { equipId: slot.equipId } : {}) }); // 내가 넣은 것은 바로 보인다
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
  if (!e || !e.searched) return false; // 모르는 것을 버릴 수는 없다
  c.entries.splice(index, 1);
  const grace = balance.items.dropNoMagnetTicks;
  // 컨테이너에서 플레이어 반대쪽으로, 다른 바닥 아이템과 겹치지 않는 자리에 한 개씩 (loot.dropSpacing)
  const away = Math.hypot(c.x - world.player.x, c.z - world.player.z) > 0.001
    ? Math.atan2(c.x - world.player.x, c.z - world.player.z)
    : Math.random() * Math.PI * 2;
  const halfArc = ((balance.pickups.awayArcDeg / 2) * Math.PI) / 180;
  const spot = (): { x: number; z: number } =>
    findFreeSpot(world, c.x, c.z, balance.loot.dropScatter, balance.loot.dropSpacing, away + (Math.random() - 0.5) * 2 * halfArc);
  if (e.kind === 'gold') {
    const at = spot();
    world.groundItems.push({ id: nextLootId++, kind: 'gold', amount: e.count, x: at.x, z: at.z, noMagnetTicks: grace });
  } else if (e.kind === 'sigil' || e.kind === 'equip') {
    for (let i = 0; i < Math.max(1, e.count); i++) {
      const at = spot();
      world.groundItems.push({
        id: nextLootId++, kind: e.kind, x: at.x, z: at.z, noMagnetTicks: grace,
        ...(e.sigilId ? { sigilId: e.sigilId } : {}), ...(e.equipId ? { equipId: e.equipId } : {}),
      });
    }
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
