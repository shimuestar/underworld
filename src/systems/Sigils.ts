// 각인 — 획득(처형 드랍), 부착/해제, 파생 수치(Modifiers) 재계산.
// 주우면 즉시 부착되어 효과가 붙는다. 부위 페널티는 폐지(2026-08), 오염만 pending에 누적.
// docs/systems/economy.md §3~4.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { sigilDef, SIGIL_SLOTS, type SigilSlot } from '../core/SigilData';
import type { Modifiers, World } from '../core/World';

export function defaultModifiers(): Modifiers {
  return {
    dodgeDistanceMul: 1,
    dodgeIFrameTicks: balance.reaction.dodgeIFrameTicks,
    ambientVisionBoost: 0,
  };
}

let nextGroundItemId = 1;

function dropAll(world: World, enemyType: string, x: number, z: number): void {
  for (const id of enemyDef(enemyType).drops ?? []) {
    world.groundItems.push({ id: nextGroundItemId++, kind: 'sigil', sigilId: id, x, z });
    world.events.emit('sigil_dropped', { id });
  }
}

/** 드랍 구독. 시작 시 1회 호출.
 *  일반 적: 처형 시에만 드랍. 처형 불가능한 적(warden)·보스: 사망 시 드랍(dropsOnDeath) */
export function init(world: World): void {
  world.events.on('melee_kill', (payload) => {
    const { enemyType, execution, x, z } = payload as {
      enemyType: string;
      execution?: boolean;
      x?: number;
      z?: number;
    };
    if (!execution) return;
    if (enemyDef(enemyType).dropsOnDeath) return; // enemy_died 쪽에서 처리 (중복 방지)
    dropAll(world, enemyType, x ?? world.player.x, z ?? world.player.z);
  });

  world.events.on('enemy_died', (payload) => {
    const { enemyType, x, z } = payload as { enemyType: string; x: number; z: number };
    if (!enemyDef(enemyType).dropsOnDeath) return;
    dropAll(world, enemyType, x, z);
  });
}

/** 바닥 각인 줍기 — 접근하면 자동 획득 */
export function tick(world: World, _dt: number): void {
  if (world.groundItems.length === 0) return;
  const p = world.player;
  for (let i = world.groundItems.length - 1; i >= 0; i--) {
    const item = world.groundItems[i]!;
    if (item.kind !== 'sigil') continue; // 포션·골드는 Pickups가 줍는다
    if (Math.hypot(p.x - item.x, p.z - item.z) > balance.sigil.pickupRadius) continue;
    world.groundItems.splice(i, 1);
    const id = item.sigilId!;
    world.sigils.inventory.push(id);
    world.events.emit('sigil_acquired', { id });
    // 주우면 곧바로 몸에 새긴다 — 슬롯이 이미 차 있으면 인벤토리에 남는다
    attach(world, id);
  }
}

/** 인벤토리의 각인을 해당 부위에 부착. 슬롯이 차 있으면 실패 */
export function attach(world: World, sigilId: string): boolean {
  const index = world.sigils.inventory.indexOf(sigilId);
  if (index < 0) return false;
  const def = sigilDef(sigilId);
  if (world.sigils.equipped[def.slot] !== null) return false;

  world.sigils.inventory.splice(index, 1);
  world.sigils.equipped[def.slot] = sigilId;

  // 오염은 부착 시 1회 pending 누적, 제단에서 정산 (M6)
  const cost = balance.corruption.slotCost[def.slot];
  world.corruption.pending += cost;

  recompute(world);
  world.events.emit('sigil_attached', { id: sigilId, slot: def.slot, corruptionCost: cost });
  return true;
}

/** 부위의 각인을 떼어 인벤토리로. 흉터는 기록만 남는다 (페널티 폐지) */
export function detach(world: World, slot: SigilSlot): boolean {
  const id = world.sigils.equipped[slot];
  if (!id) return false;
  world.sigils.equipped[slot] = null;
  world.sigils.inventory.push(id);
  // 누적 최댓값 — 같은 부위 반복 부착/해제로 흉터가 무한히 쌓이지 않는다
  world.sigils.scars[slot] = Math.max(world.sigils.scars[slot], balance.sigil.scarRatio);
  recompute(world);
  world.events.emit('sigil_detached', { id, slot });
  return true;
}

/** 부착 상태에서 Modifiers 재계산.
 *  부착 페널티(장전 지연·조준 산포·랜턴 약화 등)는 폐지했다 (2026-08) —
 *  각인은 순수 강화이고, 대가는 오염 정산으로만 치른다 */
export function recompute(world: World): void {
  const mods = defaultModifiers();

  for (const slot of SIGIL_SLOTS) {
    const id = world.sigils.equipped[slot];
    if (!id) continue;
    // 각인 효과 (효과는 흉터와 무관 — 부착 중에만)
    const effects = sigilDef(id).effects;
    if (effects['dodgeDistanceMul']) mods.dodgeDistanceMul = effects['dodgeDistanceMul'];
    if (effects['iFrameTicks']) mods.dodgeIFrameTicks = effects['iFrameTicks'];
    if (effects['ambientVisionBoost']) mods.ambientVisionBoost = effects['ambientVisionBoost'];
  }

  world.modifiers = mods;
}
