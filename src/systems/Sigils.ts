// 각인 — 획득(처형 드랍), 부착/해제, 파생 수치(Modifiers) 재계산.
// 소지만으로는 무효. 부착 시 효과 + 부위 페널티 즉시 적용, 오염은 pending에 누적.
// docs/systems/economy.md §3~4.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { sigilDef, SIGIL_SLOTS, type SigilSlot } from '../core/SigilData';
import type { Modifiers, World } from '../core/World';

export function defaultModifiers(): Modifiers {
  return {
    reloadTimeMul: 1,
    lanternIntensityMul: 1,
    aimSpreadMul: 1,
    manaLostOnHit: 0,
    flashbangSelfDamage: false,
    dodgeDistanceMul: 1,
    dodgeIFrameTicks: balance.reaction.dodgeIFrameTicks,
    ambientVisionBoost: 0,
  };
}

let nextGroundItemId = 1;

/** 처형 드랍 구독. 시작 시 1회 호출 */
export function init(world: World): void {
  world.events.on('melee_kill', (payload) => {
    const { enemyType, execution, x, z } = payload as {
      enemyType: string;
      execution?: boolean;
      x?: number;
      z?: number;
    };
    if (!execution) return;
    for (const id of enemyDef(enemyType).drops ?? []) {
      world.groundItems.push({
        id: nextGroundItemId++,
        sigilId: id,
        x: x ?? world.player.x,
        z: z ?? world.player.z,
      });
      world.events.emit('sigil_dropped', { id });
    }
  });
}

/** 바닥 각인 줍기 — 접근하면 자동 획득 */
export function tick(world: World, _dt: number): void {
  if (world.groundItems.length === 0) return;
  const p = world.player;
  for (let i = world.groundItems.length - 1; i >= 0; i--) {
    const item = world.groundItems[i]!;
    if (Math.hypot(p.x - item.x, p.z - item.z) > balance.sigil.pickupRadius) continue;
    world.groundItems.splice(i, 1);
    world.sigils.inventory.push(item.sigilId);
    world.events.emit('sigil_acquired', { id: item.sigilId });
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

/** 부위의 각인을 떼어 인벤토리로. (흉터 잔존은 M6.3에서 추가) */
export function detach(world: World, slot: SigilSlot): boolean {
  const id = world.sigils.equipped[slot];
  if (!id) return false;
  world.sigils.equipped[slot] = null;
  world.sigils.inventory.push(id);
  recompute(world);
  world.events.emit('sigil_detached', { id, slot });
  return true;
}

/** 부착 상태에서 Modifiers 전체 재계산 */
export function recompute(world: World): void {
  const mods = defaultModifiers();
  const penalty = balance.sigil.slotPenalty;

  for (const slot of SIGIL_SLOTS) {
    const id = world.sigils.equipped[slot];
    if (!id) continue;

    // 부위 페널티 — 어떤 각인이든 그 부위를 쓰면 발생
    switch (slot) {
      case 'rightArm':
        mods.reloadTimeMul = 1 / penalty.rightArm.reloadSpeedMul;
        break;
      case 'leftArm':
        mods.lanternIntensityMul = penalty.leftArm.lanternIntensityMul;
        break;
      case 'spine':
        mods.aimSpreadMul = penalty.spine.aimSpreadMul;
        break;
      case 'heart':
        mods.manaLostOnHit = penalty.heart.manaLostOnHit;
        break;
      case 'eye':
        mods.flashbangSelfDamage = penalty.eye.flashbangSelfDamage;
        break;
    }

    // 각인 효과
    const effects = sigilDef(id).effects;
    if (effects['dodgeDistanceMul']) mods.dodgeDistanceMul = effects['dodgeDistanceMul'];
    if (effects['iFrameTicks']) mods.dodgeIFrameTicks = effects['iFrameTicks'];
    if (effects['ambientVisionBoost']) mods.ambientVisionBoost = effects['ambientVisionBoost'];
  }

  world.modifiers = mods;
}
