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

/** 자동 획득 — 반경 안에 들어오면 즉시 효과 */
export function tick(world: World, _dt: number): void {
  if (world.groundItems.length === 0) return;
  const p = world.player;
  const cfg = balance.pickups;

  for (let i = world.groundItems.length - 1; i >= 0; i--) {
    const item = world.groundItems[i]!;
    const dist = Math.hypot(p.x - item.x, p.z - item.z);

    if (item.kind === 'potion') {
      // 체력이 가득이면 줍지 않는다 — 필요할 때 오라고 남겨둔다
      if (p.health >= balance.player.healthMax) continue;
      if (dist > cfg.potion.pickupRadius) continue;
      const before = p.health;
      p.health = Math.min(balance.player.healthMax, p.health + cfg.potion.healAmount);
      world.groundItems.splice(i, 1);
      world.events.emit('potion_picked', {
        healed: p.health - before,
        health: p.health,
      });
    } else if (item.kind === 'gold') {
      if (dist > cfg.gold.pickupRadius) continue;
      world.gold += item.amount ?? 0;
      world.groundItems.splice(i, 1);
      world.events.emit('gold_picked', { amount: item.amount ?? 0, total: world.gold });
    }
  }
}
