// 바닥 아이템 물리와 습득 — 자석(골드·화살·탄약·수류탄·배터리·소모품), 비석 회수.
// 각인(Sigils)·주머니(Loot)와 같은 world.groundItems 배열을 쓰되 kind 로 구분한다.
// 자석 수치는 balance.pickups, 회복량은 balance.items.kinds.
//
// 2026-08: 포션·음식은 몸에 닿아도 즉시 먹지 않는다 — 가방(Items)으로 들어가고,
// 실제로 마시는 것은 퀵슬롯 1~5 다. 골드만 예전처럼 바로 주머니로 들어간다.
// 2026-09-04: 처치 드랍 굴림은 Loot 로 옮겼다 — 이제 적은 아이템이 아니라 주머니를 떨군다.

import { balance } from '../core/Balance';
import { addItem, hasRoom, recoverGrave } from '../core/Inventory';
import type { ItemKind, World } from '../core/World';

/** 바닥에 놓인 높이 (kind별) — 자석에 걸리기 전 기준 높이 */
function restHeight(kind: string): number {
  if (kind === 'gold') return 0.12;
  if (kind === 'arrow') return balance.pickups.arrow.restHeight; // 눕혀 놓인 화살
  if (kind === 'ammo' || kind === 'grenade' || kind === 'battery') return 0.14; // 기믹 전리품
  return 0.55;
}

/** 이 아이템을 지금 주울 이유가 있는가.
 *  이제 기준은 "체력이 모자란가"가 아니라 "가방에 자리가 있는가"다 —
 *  당장 필요 없어도 챙겨 뒀다 쓰는 게 가방의 값이고, 대신 가득 차면 바닥에 남는다 */
function wants(world: World, kind: string): boolean {
  if (kind === 'gold') return true;
  if (kind === 'key') return true; // 열쇠는 가방을 거치지 않는다 — 바로 손에 쥔다
  // 기믹 전리품 — 가방을 거치지 않고 바로 주머니로 (골드와 같은 빠른 경로)
  if (kind === 'ammo' || kind === 'grenade' || kind === 'battery') return true;
  // 화살은 가방이 아니라 무기 탄약이다 — 상한이 차면 권총탄처럼 바닥에 남는다
  if (kind === 'arrow') {
    return (world.weapon.arrows ?? 0) < balance.weapons.bow.ammoMax;
  }
  return hasRoom(world, kind as ItemKind);
}

/** 자석 흡수 — 반경에 들면 공중으로 떠올라 가속하며 몸으로 빨려든다.
 *  한 번 걸린 아이템은 플레이어가 멀어져도 계속 따라온다 */
export function tick(world: World, dt: number): void {
  if (world.groundItems.length === 0) return;
  const p = world.player;
  const cfg = balance.pickups;
  const mag = cfg.magnet;
  const targetY = balance.player.eyeHeight * mag.targetHeightMul; // 가슴 높이
  // 반경 안에 들어왔는데 가방이 가득이라 못 문 것이 있었는가 (틱당 한 번만 알린다)
  let blocked = false;
  let quiverBlocked = false;

  for (let i = world.groundItems.length - 1; i >= 0; i--) {
    const item = world.groundItems[i]!;
    if (item.kind === 'sigil' || item.kind === 'pouch') continue; // 각인은 Sigils, 주머니는 Loot 담당
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

    // 버린 직후에는 자석이 물지 않는다 (버리자마자 도로 주워지는 것을 막는다)
    if (item.noMagnetTicks && item.noMagnetTicks > 0) {
      item.noMagnetTicks--;
      continue;
    }
    if (!item.magnet) {
      const radius =
        item.kind === 'gold' || item.kind === 'key' ||
        item.kind === 'ammo' || item.kind === 'grenade' || item.kind === 'battery'
          ? cfg.gold.magnetRadius
          : item.kind === 'arrow'
            ? cfg.arrow.magnetRadius
            : item.kind === 'mana'
            ? cfg.manaPotion.magnetRadius
            : item.kind === 'food'
              ? cfg.food.magnetRadius
              : cfg.potion.magnetRadius;
      if (Math.hypot(p.x - item.x, p.z - item.z) > radius) continue;
      // 가방이 가득이면 걸리지 않는다 — 자리가 날 때 오라고 남겨둔다.
      // 다만 코앞까지 왔는데 아무 반응이 없으면 "왜 안 주워지지"가 되므로 한 번 알린다
      if (!wants(world, item.kind)) {
        // 화살통과 가방은 다른 물건이다 — 같은 안내를 쓰면
        // "가방을 비우라"는 엉뚱한 말을 화살 위에서 듣게 된다
        if (item.kind === 'arrow') quiverBlocked = true;
        else blocked = true;
        continue;
      }
      item.magnet = true;
      item.originX = item.x; // 놓여 있던 자리 — 획득 표기가 여기서 뜬다 (비행 후엔 잃는다)
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
      world.gold += item.amount ?? 0;
      world.events.emit('gold_picked', {
        amount: item.amount ?? 0, total: world.gold,
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
    // 소모품 — 가방으로. 자석에 걸린 뒤에 가방이 차 버렸으면 발밑에 도로 놓는다
    if (!addItem(world, item.kind as ItemKind)) {
      item.magnet = false;
      item.x = p.x;
      item.z = p.z;
      item.y = restHeight(item.kind);
      item.noMagnetTicks = balance.items.dropNoMagnetTicks;
      world.events.emit('inventory_full', { kind: item.kind });
      continue;
    }
    world.groundItems.splice(i, 1);
    world.events.emit('item_picked', { kind: item.kind });
  }

  if (blocked) world.events.emit('inventory_full', {});
  if (quiverBlocked) world.events.emit('quiver_full', {});
}
