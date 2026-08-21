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

/** 부위의 각인을 떼어 인벤토리로. 흉터 — 페널티의 scarRatio만큼 영구 잔존 */
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

/** 부착 상태 + 흉터에서 Modifiers 전체 재계산 */
export function recompute(world: World): void {
  const mods = defaultModifiers();
  const penalty = balance.sigil.slotPenalty;

  for (const slot of SIGIL_SLOTS) {
    const id = world.sigils.equipped[slot];
    // 페널티 강도: 부착 중 1.0, 해제 후 흉터만 남으면 scarRatio (0이면 없음)
    const strength = id ? 1 : world.sigils.scars[slot];
    if (strength > 0) {
      switch (slot) {
        case 'rightArm':
          mods.reloadTimeMul = 1 + (1 / penalty.rightArm.reloadSpeedMul - 1) * strength;
          break;
        case 'leftArm':
          mods.lanternIntensityMul = 1 - (1 - penalty.leftArm.lanternIntensityMul) * strength;
          break;
        case 'spine':
          mods.aimSpreadMul = 1 + (penalty.spine.aimSpreadMul - 1) * strength;
          break;
        case 'heart':
          mods.manaLostOnHit = penalty.heart.manaLostOnHit * strength;
          break;
        case 'eye':
          // 불리언 페널티는 절반이 불가 — 부착 중에만 발동
          mods.flashbangSelfDamage = id !== null && penalty.eye.flashbangSelfDamage;
          break;
      }
    }

    if (!id) continue;
    // 각인 효과 (효과는 흉터와 무관 — 부착 중에만)
    const effects = sigilDef(id).effects;
    if (effects['dodgeDistanceMul']) mods.dodgeDistanceMul = effects['dodgeDistanceMul'];
    if (effects['iFrameTicks']) mods.dodgeIFrameTicks = effects['iFrameTicks'];
    if (effects['ambientVisionBoost']) mods.ambientVisionBoost = effects['ambientVisionBoost'];
  }

  world.modifiers = mods;
}
