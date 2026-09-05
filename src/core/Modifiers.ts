// 파생 수치(Modifiers) 재계산 — 부위에 새겨진 각인 + 몸에 걸친 장비 (2026-09-04 장비 도입).
// 각인(Sigils)과 장비(Equipment) 두 시스템이 모두 부르므로 core 에 둔다 (시스템끼리 직접 참조 금지).
// 규칙: *Mul 은 곱해 합치고, perfectBandBonus·bagSlots 는 더한다, shopDiscount 는 겹쳐도 (1-a)(1-b) 로 합쳐 100% 를 넘지 않는다.

import { balance } from './Balance';
import { EQUIP_SLOTS, equipDef } from './EquipData';
import { sigilDef } from './SigilData';
import type { Modifiers, World } from './World';

export function defaultModifiers(): Modifiers {
  return {
    dodgeDistanceMul: 1,
    dodgeIFrameTicks: balance.reaction.dodgeIFrameTicks,
    ambientVisionBoost: 0,
    revealTrapsRadius: 0,
    damageTakenMul: 1,
    trapDamageMul: 1,
    moveSpeedMul: 1,
    sprintDrainMul: 1,
    manaRegenMul: 1,
    goldMul: 1,
    perfectBandBonus: 0,
    stunMul: 1,
    shopDiscount: 0,
    itemChannelMul: 1,
    potionHealMul: 1,
    bagSlots: 0,
  };
}

const MUL_KEYS = new Set([
  'damageTakenMul', 'trapDamageMul', 'moveSpeedMul', 'sprintDrainMul', 'dodgeDistanceMul',
  'manaRegenMul', 'goldMul', 'stunMul', 'itemChannelMul', 'potionHealMul',
]);
const ADD_KEYS = new Set(['perfectBandBonus', 'bagSlots']);

export function recomputeModifiers(world: World): void {
  const mods = defaultModifiers();

  // 각인 — 부위에 새겨진 패시브만 (갖고만 있는 것은 꺼져 있다). 페널티 없음 (2026-08)
  for (const id of Object.values(world.sigils.equipped)) {
    if (!id) continue;
    const effects = sigilDef(id).effects;
    if (effects['dodgeDistanceMul']) mods.dodgeDistanceMul = effects['dodgeDistanceMul'];
    if (effects['iFrameTicks']) mods.dodgeIFrameTicks = effects['iFrameTicks'];
    if (effects['ambientVisionBoost']) mods.ambientVisionBoost = effects['ambientVisionBoost'];
    if (effects['revealTrapsRadius']) mods.revealTrapsRadius = effects['revealTrapsRadius'];
  }

  // 장비 — 곱/합 규칙으로 겹친다
  const m = mods as unknown as Record<string, number>;
  for (const slot of EQUIP_SLOTS) {
    const id = world.equipment[slot];
    if (!id) continue;
    for (const [key, value] of Object.entries(equipDef(id).effects)) {
      if (MUL_KEYS.has(key)) m[key] = (m[key] ?? 1) * value;
      else if (ADD_KEYS.has(key)) m[key] = (m[key] ?? 0) + value;
      else if (key === 'shopDiscount') m[key] = 1 - (1 - (m[key] ?? 0)) * (1 - value);
    }
  }

  world.modifiers = mods;
}
