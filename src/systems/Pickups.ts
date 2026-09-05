// 바닥 아이템 물리와 습득 — 자석(골드·화살·탄약·수류탄·배터리), 소모품 E 집기·튕김, 비석 회수.
// 각인(Sigils)·주머니(Loot)와 같은 world.groundItems 배열을 쓰되 kind 로 구분한다.
// 자석 수치는 balance.pickups, 회복량은 balance.items.kinds.
//
// 2026-08: 포션·음식은 몸에 닿아도 즉시 먹지 않는다 — 가방(Items)으로 들어가고,
// 실제로 마시는 것은 퀵슬롯 1~5 다. 골드만 예전처럼 바로 주머니로 들어간다.
// 2026-09-04: 처치 드랍 굴림은 Loot 로 옮겼다 — 이제 적은 아이템이 아니라 주머니를 떨군다.

import { balance } from '../core/Balance';
import { addItem, recoverGrave, addSigil, addEquip } from '../core/Inventory';
import type { ItemKind, World } from '../core/World';

/** 바닥에 놓인 높이 (kind별) — 자석에 걸리기 전 기준 높이 */
function restHeight(kind: string): number {
  if (kind === 'gold') return 0.12;
  if (kind === 'arrow') return balance.pickups.arrow.restHeight; // 눕혀 놓인 화살
  if (kind === 'ammo' || kind === 'grenade' || kind === 'battery' || kind === 'equip') return 0.14; // 기믹 전리품·장비
  return 0.55;
}

/** 자석이 물 수 있는가 — 골드·기믹 전리품은 항상, 화살은 화살통 상한까지.
 *  소모품은 자석이 아니라 손(E)으로 집으므로 여기 오지 않는다 */
function wants(world: World, kind: string): boolean {
  if (kind === 'arrow') return (world.weapon.arrows ?? 0) < balance.weapons.bow.ammoMax;
  return true;
}

/** 손(E)으로 집는 종류 — 소모품 셋 + 각인(2026-09-04 아이템화). 자석에 걸리지 않고 바라보며 E */
const CONSUMABLE_KINDS: ReadonlySet<string> = new Set(['potion', 'mana', 'food', 'sigil', 'equip']);

/** 지금 집을 수 있는 바닥 소모품 — 반경·시야각(loot.pickup) 안에서 가장 가까운 것.
 *  날아오는 중·유예 중·튕겨 돌아가는 중은 뺀다 */
function findItemInView(world: World): { id: number; kind: ItemKind } | null {
  const cfg = balance.loot.pickup;
  const p = world.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const arcCos = Math.cos((cfg.facingArcDeg * Math.PI) / 360);
  let best: (typeof world.groundItems)[number] | null = null;
  let bestDist = Infinity;
  for (const item of world.groundItems) {
    if (!CONSUMABLE_KINDS.has(item.kind)) continue;
    if (item.magnet || (item.noMagnetTicks ?? 0) > 0 || (item.bounceTicks ?? 0) > 0) continue;
    const toX = item.x - p.x;
    const toZ = item.z - p.z;
    const dist = Math.hypot(toX, toZ);
    if (dist > cfg.radius || dist >= bestDist) continue;
    if (dist > 0.001 && (toX * fx + toZ * fz) / dist < arcCos) continue;
    best = item;
    bestDist = dist;
  }
  return best ? { id: best.id, kind: best.kind as ItemKind } : null;
}

/** 자석 흡수 + E 집기 — 골드·화살·탄약은 반경에 들면 공중으로 떠올라 가속하며 몸으로 빨려든다
 *  (한 번 걸린 아이템은 플레이어가 멀어져도 계속 따라온다). 소모품은 바라보며 E 를 눌러야
 *  같은 비행으로 날아온다(2026-09-04) — 가방이 가득이면 몸까지 왔다가 원자리로 튕겨 돌아간다 */
export function tick(world: World, dt: number): void {
  world.itemInView = null;
  if (world.groundItems.length === 0) return;
  const p = world.player;
  const cfg = balance.pickups;
  const mag = cfg.magnet;
  const targetY = balance.player.eyeHeight * mag.targetHeightMul; // 가슴 높이
  // 반경 안에 들어왔는데 화살통이 가득이라 못 문 것이 있었는가 (틱당 한 번만 알린다)
  let blocked = false;
  let quiverBlocked = false;
  // 집기 대상 — 컨테이너(상자·주머니)가 대상이면 양보한다 (우선순위 상자 > 주머니 > 바닥 아이템)
  const inView = world.chestInView || world.lootInView ? null : findItemInView(world);
  world.itemInView = inView;
  const grabId = inView && world.input.interactPressed && !world.lootOpen ? inView.id : null;

  for (let i = world.groundItems.length - 1; i >= 0; i--) {
    const item = world.groundItems[i]!;
    if (item.kind === 'pouch') continue; // 주머니는 Loot 담당 (각인은 소모품처럼 E 로 집는다)
    // 비석 — 돌이라 자석에 걸리지 않는다. 밟을 만큼 다가가야 유품을 다시 담아 간다
    if (item.kind === 'grave') {
      if (Math.hypot(p.x - item.x, p.z - item.z) > balance.pickups.grave.radius) continue;
      const result = recoverGrave(world, item);
      if (result === 'all') {
        world.groundItems.splice(i, 1);
        world.events.emit('grave_recovered', { partial: false });
      } else if (result === 'partial') {
        world.events.emit('grave_recovered', { partial: true });
      } else {
        blocked = true; // 가방이 가득 — 기존 "가방이 가득 찼다" 안내를 그대로 쓴다
      }
      continue;
    }

    // 튕겨 돌아가는 중 — 몸 앞에서 원자리로 포물선 (가방이 가득이었다)
    if ((item.bounceTicks ?? 0) > 0) {
      const b = balance.loot.bounce;
      item.bounceTicks = (item.bounceTicks ?? 0) - 1;
      const t = 1 - (item.bounceTicks ?? 0) / Math.max(1, b.ticks);
      const fromX = item.bounceFromX ?? item.x;
      const fromZ = item.bounceFromZ ?? item.z;
      const ox = item.originX ?? item.x;
      const oz = item.originZ ?? item.z;
      const rest = restHeight(item.kind);
      const y0 = item.bounceY0 ?? rest;
      item.x = fromX + (ox - fromX) * t;
      item.z = fromZ + (oz - fromZ) * t;
      item.y = y0 + (rest - y0) * t + b.popUp * Math.sin(Math.PI * t);
      if ((item.bounceTicks ?? 0) <= 0) {
        item.bounceTicks = undefined;
        item.bounceFromX = undefined;
        item.bounceFromZ = undefined;
        item.bounceY0 = undefined;
        item.x = ox;
        item.z = oz;
        item.y = undefined;
        item.noMagnetTicks = balance.items.dropNoMagnetTicks; // 바로 다시 집으려 들지 않게
        world.events.emit('pickup_bounced', { kind: item.kind, x: item.x, z: item.z });
      }
      continue;
    }

    // 버린 직후에는 자석·집기가 물지 않는다 (버리자마자 도로 주워지는 것을 막는다)
    if (item.noMagnetTicks && item.noMagnetTicks > 0) {
      item.noMagnetTicks--;
      continue;
    }
    if (!item.magnet) {
      if (CONSUMABLE_KINDS.has(item.kind)) {
        // 소모품은 손으로 — 바라보며 E. 가방이 가득이어도 일단 날아온다(튕겨 돌아가는 것이 안내다)
        if (grabId !== item.id) continue;
      } else {
        const radius = item.kind === 'arrow' ? cfg.arrow.magnetRadius : cfg.gold.magnetRadius;
        if (Math.hypot(p.x - item.x, p.z - item.z) > radius) continue;
        // 화살통이 가득이면 걸리지 않는다 — 자리가 날 때 오라고 남겨둔다. 코앞에서 아무 반응이
        // 없으면 "왜 안 주워지지"가 되므로 한 번 알린다
        if (!wants(world, item.kind)) {
          if (item.kind === 'arrow') quiverBlocked = true;
          else blocked = true;
          continue;
        }
      }
      item.magnet = true;
      item.originX = item.x; // 놓여 있던 자리 — 획득 표기가 여기서 뜨고, 튕기면 여기로 돌아간다
      item.originZ = item.z;
      item.y = restHeight(item.kind) + mag.popUp; // 살짝 튀어오르며 출발
      item.speed = mag.startSpeed;
    }

    item.speed = Math.min(mag.maxSpeed, (item.speed ?? mag.startSpeed) + mag.accel * dt);
    const dx = p.x - item.x;
    const dy = targetY - (item.y ?? restHeight(item.kind));
    const dz = p.z - item.z;
    const dist = Math.hypot(dx, dy, dz);
    const step = item.speed * dt;

    if (dist > mag.absorbRadius && step < dist) {
      item.x += (dx / dist) * step;
      item.y = (item.y ?? restHeight(item.kind)) + (dy / dist) * step;
      item.z += (dz / dist) * step;
      continue;
    }

    // 몸에 닿음
    // 화살 — 가방을 거치지 않고 탄약으로 바로 들어간다 (골드와 같은 빠른 경로).
    // 다만 무한 순환을 막으려고 여기서 부러짐을 굴린다. 꽂힐 때가 아니라 줍는
    // 순간에 굴려야 "주웠는데 왜 안 늘지"를 안내로 설명할 수 있다
    if (item.kind === 'arrow') {
      world.groundItems.splice(i, 1);
      const bow = balance.weapons.bow;
      if (Math.random() < bow.recoverChance) {
        world.weapon.arrows = Math.min(bow.ammoMax, (world.weapon.arrows ?? 0) + 1);
        world.events.emit('arrow_recovered', { arrows: world.weapon.arrows });
      } else {
        world.events.emit('arrow_broken', { arrows: world.weapon.arrows ?? 0 });
      }
      continue;
    }
    if (item.kind === 'key') {
      // 열쇠 흐름 폐지(2026-09) — 남은 저장 데이터의 열쇠는 조용히 삼킨다
      world.groundItems.splice(i, 1);
      continue;
    }
    if (item.kind === 'gold') {
      world.groundItems.splice(i, 1);
      const goldAmt = Math.round((item.amount ?? 0) * world.modifiers.goldMul); // 탐욕 반지·도둑 조끼
      world.gold += goldAmt;
      world.events.emit('gold_picked', {
        amount: goldAmt, total: world.gold,
        x: item.originX ?? item.x, z: item.originZ ?? item.z,
      });
      continue;
    }
    // 기믹 전리품 — 탄약·수류탄·배터리는 가방을 거치지 않고 바로 들어간다
    if (item.kind === 'ammo') {
      world.groundItems.splice(i, 1);
      world.weapon.reserve += item.amount ?? 0;
      world.events.emit('ammo_picked', { amount: item.amount ?? 0, reserve: world.weapon.reserve });
      continue;
    }
    if (item.kind === 'grenade') {
      world.groundItems.splice(i, 1);
      world.weapon.grenades += 1;
      world.events.emit('grenade_picked', { grenades: world.weapon.grenades });
      continue;
    }
    if (item.kind === 'battery') {
      world.groundItems.splice(i, 1);
      world.lantern.spares += 1;
      world.events.emit('battery_picked', { spares: world.lantern.spares });
      continue;
    }
    // 소모품 — 가방으로. 가방이 가득이면 몸까지 왔다가 원자리로 튕겨 돌아간다 (연출·소리는 main 이 pickup_bounced 로)
    const put =
      item.kind === 'sigil' ? addSigil(world, item.sigilId ?? '')
      : item.kind === 'equip' ? addEquip(world, item.equipId ?? '')
      : addItem(world, item.kind as ItemKind);
    if (!put) {
      item.magnet = false;
      item.bounceTicks = balance.loot.bounce.ticks;
      item.bounceFromX = item.x;
      item.bounceFromZ = item.z;
      item.bounceY0 = item.y ?? restHeight(item.kind);
      continue;
    }
    world.groundItems.splice(i, 1);
    world.events.emit('item_picked', { kind: item.kind, sigilId: item.sigilId, equipId: item.equipId });
  }

  if (blocked) world.events.emit('inventory_full', {});
  if (quiverBlocked) world.events.emit('quiver_full', {});
}
