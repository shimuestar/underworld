// 소모품 드랍 — 적 처치 시 HP 포션·골드를 바닥에 떨구고, 근처에 가면 자동 획득한다.
// 각인(Sigils)과 같은 world.groundItems 배열을 쓰되 kind로 구분한다.
// 수치는 전부 balance.pickups.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import type { World } from '../core/World';

let nextPickupId = 500000; // 각인 아이템 id 대역과 구분

/** 드랍 구독. 시작 시 1회 호출 */
export function init(world: World): void {
  world.events.on('enemy_died', (payload) => {
    const { enemyType, x, z } = payload as { enemyType: string; x: number; z: number };
    rollDrops(world, enemyType, x, z);
  });
}

/** 처치 드랍 굴림 — 포션은 낮은 확률(보스는 확정), 골드는 자주 */
export function rollDrops(world: World, enemyType: string, x: number, z: number): void {
  const def = enemyDef(enemyType);
  const cfg = balance.pickups;

  if (Math.random() < cfg.potion.dropChance || (def.boss && cfg.potion.bossAlways)) {
    world.groundItems.push({ id: nextPickupId++, kind: 'potion', x, z });
    world.events.emit('potion_dropped', { x, z });
  }

  if (Math.random() < cfg.gold.dropChance || def.boss) {
    const span = cfg.gold.max - cfg.gold.min;
    let amount = cfg.gold.min + Math.round(Math.random() * span);
    if (def.boss) amount *= cfg.gold.bossMul;
    // 두 드랍이 겹쳐 보이지 않게 살짝 흩뿌린다
    const angle = Math.random() * Math.PI * 2;
    world.groundItems.push({
      id: nextPickupId++,
      kind: 'gold',
      amount,
      x: x + Math.cos(angle) * 0.5,
      z: z + Math.sin(angle) * 0.5,
    });
    world.events.emit('gold_dropped', { amount, x, z });
  }
}

/** 바닥에 놓인 높이 (kind별) — 자석에 걸리기 전 기준 높이 */
function restHeight(kind: string): number {
  return kind === 'gold' ? 0.12 : 0.55;
}

/** 자석 흡수 — 반경에 들면 공중으로 떠올라 가속하며 몸으로 빨려든다.
 *  한 번 걸린 아이템은 플레이어가 멀어져도 계속 따라온다 */
export function tick(world: World, dt: number): void {
  if (world.groundItems.length === 0) return;
  const p = world.player;
  const cfg = balance.pickups;
  const mag = cfg.magnet;
  const targetY = balance.player.eyeHeight * mag.targetHeightMul; // 가슴 높이

  for (let i = world.groundItems.length - 1; i >= 0; i--) {
    const item = world.groundItems[i]!;
    if (item.kind !== 'potion' && item.kind !== 'gold') continue; // 각인은 Sigils

    // 체력이 가득이면 포션은 걸리지 않는다 — 필요할 때 오라고 남겨둔다
    if (item.kind === 'potion' && !item.magnet && p.health >= balance.player.healthMax) continue;

    if (!item.magnet) {
      const radius = item.kind === 'gold' ? cfg.gold.magnetRadius : cfg.potion.magnetRadius;
      if (Math.hypot(p.x - item.x, p.z - item.z) > radius) continue;
      item.magnet = true;
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

    // 몸에 닿음 — 효과 적용
    world.groundItems.splice(i, 1);
    if (item.kind === 'potion') {
      const before = p.health;
      p.health = Math.min(balance.player.healthMax, p.health + cfg.potion.healAmount);
      world.events.emit('potion_picked', { healed: p.health - before, health: p.health });
    } else {
      world.gold += item.amount ?? 0;
      world.events.emit('gold_picked', { amount: item.amount ?? 0, total: world.gold });
    }
  }
}
